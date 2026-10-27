//! 项目索引只读取目录项，不读取 Markdown 正文。
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

const EXCLUDED: &[&str] = &[".git", "node_modules", "target", "dist", ".build-tools"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    path: String,
    relative_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIndex {
    root: String,
    files: Vec<ProjectFile>,
    warnings: Vec<String>,
    scanned_directories: usize,
    elapsed_ms: f64,
}

pub fn is_markdown(path: &Path) -> bool {
    matches!(path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("md" | "markdown" | "mdown" | "mkd" | "mkdn" | "mdx"))
}

fn is_link(path: &Path, kind: fs::FileType) -> bool {
    if kind.is_symlink() { return true; }
    // Windows junction 不一定表现为符号链接；不进入任何目录重解析点。
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if kind.is_dir() {
            return fs::symlink_metadata(path).map(|m| m.file_attributes() & 0x400 != 0).unwrap_or(true);
        }
    }
    let _ = path;
    false
}

fn scan(root: &Path) -> Result<ProjectIndex, String> {
    let started = Instant::now();
    let root = fs::canonicalize(root).map_err(|e| format!("无法打开项目文件夹：{e}"))?;
    let mut pending = vec![root.clone()];
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut scanned_directories = 0;
    while let Some(dir) = pending.pop() {
        // 每次只持有一个目录句柄，大型目录树不耗尽文件描述符。
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(e) if dir == root => return Err(format!("无法读取项目文件夹：{e}")),
            Err(e) => { warnings.push(format!("{}：{e}", dir.display())); continue; }
        };
        scanned_directories += 1;
        for entry in entries {
            let result = (|| -> Result<(), std::io::Error> {
                let entry = entry?;
                let path = entry.path();
                let kind = entry.file_type()?;
                if is_link(&path, kind) { return Ok(()); }
                if kind.is_dir() {
                    if entry.file_name().to_str().is_some_and(|value| EXCLUDED.iter().any(|name| value.eq_ignore_ascii_case(name))) { return Ok(()); }
                    pending.push(path);
                } else if kind.is_file() && is_markdown(&path) {
                    let relative = path.strip_prefix(&root).expect("entry belongs to root");
                    files.push(ProjectFile {
                        path: path.to_string_lossy().into_owned(),
                        relative_path: relative.components().map(|p| p.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"),
                    });
                }
                Ok(())
            })();
            if let Err(e) = result { warnings.push(format!("{}：{e}", dir.display())); }
        }
    }
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(ProjectIndex { root: root.to_string_lossy().into_owned(), files, warnings,
        scanned_directories, elapsed_ms: started.elapsed().as_secs_f64() * 1000.0 })
}

#[tauri::command]
pub async fn scan_project(root: String) -> Result<ProjectIndex, String> {
    tauri::async_runtime::spawn_blocking(move || scan(&PathBuf::from(root)))
        .await.map_err(|e| format!("项目扫描失败：{e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("airmd-project-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str) {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, b"# fixture").unwrap();
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn indexes_nested_markdown_and_skips_dependencies() {
        let dir = Fixture::new();
        for file in ["README.MD", "中文 空格/笔记.markdown", "docs/file.mdx", "image.png", ".git/hidden.md", "node_modules/pkg/doc.md", "target/doc.md", "dist/doc.md", ".build-tools/doc.md"] { dir.file(file); }
        let index = scan(&dir.0).unwrap();
        assert_eq!(index.files.iter().map(|f| f.relative_path.as_str()).collect::<Vec<_>>(),
            vec!["README.MD", "docs/file.mdx", "中文 空格/笔记.markdown"]);
        assert!(index.warnings.is_empty());
        assert_eq!(index.scanned_directories, 3);
    }

    #[test]
    fn distinguishes_empty_missing_and_file_roots() {
        let dir = Fixture::new();
        assert!(scan(&dir.0).unwrap().files.is_empty());
        assert!(scan(&dir.0.join("missing")).is_err());
        dir.file("file.md");
        assert!(scan(&dir.0.join("file.md")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn skips_links_and_reports_unreadable_directories_without_reading_content() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = Fixture::new();
        dir.file("visible.md");
        dir.file("private/secret.md");
        fs::set_permissions(dir.0.join("visible.md"), fs::Permissions::from_mode(0o000)).unwrap();
        fs::set_permissions(dir.0.join("private"), fs::Permissions::from_mode(0o000)).unwrap();
        symlink(&dir.0, dir.0.join("loop")).unwrap();
        symlink(dir.0.join("visible.md"), dir.0.join("alias.md")).unwrap();
        let index = scan(&dir.0).unwrap();
        fs::set_permissions(dir.0.join("private"), fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(index.files.len(), 1);
        assert_eq!(index.files[0].relative_path, "visible.md");
        assert_eq!(index.warnings.len(), 1);
    }

    #[test]
    #[ignore = "手动性能测量：创建一万多个目录项，输出五轮扫描与序列化耗时"]
    fn benchmark_large_project() {
        let dir = Fixture::new();
        for folder in 0..100 {
            for file in 0..100 {
                dir.file(&format!("docs/{folder:03}/file-{file:03}.{}", if file < 30 { "md" } else { "txt" }));
            }
        }
        for file in 0..1000 { dir.file(&format!("node_modules/package-{file}/README.md")); }
        dir.file(&format!("{}/deep.md", (0..40).map(|i| format!("level-{i}")).collect::<Vec<_>>().join("/")));
        for trial in 1..=5 {
            let index = scan(&dir.0).unwrap();
            assert_eq!(index.files.len(), 3001);
            let scan_ms = index.elapsed_ms;
            let started = Instant::now();
            let json = serde_json::to_vec(&index).unwrap();
            println!("trial={trial} files={} directories={} scan_ms={scan_ms:.3} serialize_ms={:.3} bytes={}",
                index.files.len(), index.scanned_directories, started.elapsed().as_secs_f64() * 1000.0, json.len());
        }
    }
}
