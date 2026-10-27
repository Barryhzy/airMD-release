//! 文件读写命令。
//!
//! 这里刻意绕开了 tauri-plugin-fs，原因有三：
//! 1. 需要「原子写」（临时文件 + rename），避免中途崩溃把原文件写坏；
//! 2. 需要返回 mtime / readonly，用于外部修改检测；
//! 3. 需要读任意路径的图片（文档可能在任意目录），插件的作用域模型不适合。

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub exists: bool,
    pub size: u64,
    pub mtime_ms: f64,
    pub readonly: bool,
}

impl FileStat {
    fn missing() -> Self {
        Self {
            exists: false,
            size: 0,
            mtime_ms: 0.0,
            readonly: false,
        }
    }
}

fn to_ms(time: SystemTime) -> f64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(d) => d.as_millis() as f64,
        Err(_) => 0.0,
    }
}

fn stat_of(path: &Path) -> FileStat {
    match fs::metadata(path) {
        Ok(meta) => FileStat {
            exists: true,
            size: meta.len(),
            mtime_ms: meta.modified().map(to_ms).unwrap_or(0.0),
            readonly: meta.permissions().readonly(),
        },
        Err(_) => FileStat::missing(),
    }
}

/// 只允许单层文件名，防止 ../ 逃逸
fn safe_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件名为空".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == ".." || trimmed == "." {
        return Err("文件名不能包含路径分隔符".into());
    }
    Ok(trimmed.to_string())
}

/// 原子写入：先写同目录临时文件，再 rename 覆盖目标。
/// rename 在 Windows 上同样会替换已存在的文件（MoveFileEx + REPLACE_EXISTING）。
fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    atomic_write_with_replace(path, bytes, |source, target| fs::rename(source, target))
}

fn atomic_write_with_replace(
    path: &Path,
    bytes: &[u8],
    replace: impl FnOnce(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    let permissions = match fs::metadata(path) {
        Ok(meta) if meta.permissions().readonly() => {
            return Err(io::Error::new(io::ErrorKind::PermissionDenied, "文件是只读的"));
        }
        Ok(meta) => Some(meta.permissions()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("document.md");
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp: PathBuf = parent.join(format!(".{}.{}.tmp", file_name, stamp));

    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
    let result = (|| {
        file.write_all(bytes)?;
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        file.sync_all()?;
        drop(file);
        replace(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if p.is_dir() {
        return Err(format!("{} 是一个目录", path));
    }
    let bytes = fs::read(p).map_err(|e| format!("读取失败：{}", e))?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
pub fn write_file_bytes(path: String, data_base64: String) -> Result<(), String> {
    let bytes = STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("内容解码失败：{}", e))?;
    atomic_write(Path::new(&path), &bytes).map_err(|e| format!("写入失败：{}", e))
}

#[tauri::command]
pub fn file_stat(path: String) -> Result<FileStat, String> {
    Ok(stat_of(Path::new(&path)))
}

#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
pub fn same_file(left: String, right: String) -> Result<bool, String> {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => Ok(left == right),
        (Err(error), _) | (_, Err(error)) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        (Err(error), _) | (_, Err(error)) => Err(format!("无法确认文件路径：{}", error)),
    }
}

#[tauri::command]
pub fn write_attachment(dir: String, file_name: String, data_base64: String) -> Result<String, String> {
    let name = safe_file_name(&file_name)?;
    let bytes = STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("内容解码失败：{}", e))?;
    let dir_path = Path::new(&dir);
    fs::create_dir_all(dir_path).map_err(|e| format!("创建目录失败：{}", e))?;
    let target = dir_path.join(name);
    atomic_write(&target, &bytes).map_err(|e| format!("写入附件失败：{}", e))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_dir(dir: String) -> Result<Vec<String>, String> {
    let mut names = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(names),
    };
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

#[tauri::command]
pub fn ensure_dir(dir: String) -> Result<(), String> {
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败：{}", e))
}

#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);

    #[cfg(target_os = "windows")]
    {
        // explorer 即便成功也常返回非 0 退出码，因此忽略结果
        let _ = std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.to_string_lossy()))
            .spawn();
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg("-R").arg(&p).spawn();
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let parent = p.parent().unwrap_or(Path::new("."));
        let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err("当前平台不支持在文件管理器中定位".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_traversal_file_names() {
        assert!(safe_file_name("../evil.png").is_err());
        assert!(safe_file_name("a/b.png").is_err());
        assert!(safe_file_name("ok.png").is_ok());
    }

    #[test]
    fn atomic_write_replaces_content() {
        let dir = std::env::temp_dir().join(format!("airmd-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("a.md");
        atomic_write(&file, b"one").unwrap();
        atomic_write(&file, b"two").unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn failed_replace_keeps_original_and_cleans_temporary_file() {
        let dir = std::env::temp_dir().join(format!("airmd-failed-replace-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.md");
        fs::write(&path, b"original").unwrap();
        let result = atomic_write_with_replace(&path, b"new content", |_, _| {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, "file is busy"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_rejects_readonly_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("airmd-readonly-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("readonly.md");
        fs::write(&path, b"original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert!(atomic_write(&path, b"replacement").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"original");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn same_file_resolves_symbolic_links() {
        let dir = std::env::temp_dir().join(format!("airmd-same-file-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("original.md");
        let alias = dir.join("alias.md");
        fs::write(&path, b"original").unwrap();
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(same_file(path.to_string_lossy().into_owned(), alias.to_string_lossy().into_owned()).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }
}
