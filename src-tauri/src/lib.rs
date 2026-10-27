mod fs_ops;
mod project;

use std::path::Path;
use project::is_markdown;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 命令行或系统打开事件传入、尚未被前端取走的文件路径
pub struct PendingFiles(pub Mutex<Vec<String>>);

impl PendingFiles {
    fn enqueue(&self, files: Vec<String>) {
        if let Ok(mut pending) = self.0.lock() {
            pending.extend(files);
        }
    }

    fn take(&self) -> Vec<String> {
        match self.0.lock() {
            Ok(mut pending) => std::mem::take(&mut *pending),
            Err(_) => Vec::new(),
        }
    }
}

fn queue_open_files(app: &tauri::AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    // macOS 冷启动时 Opened 可能早于前端监听，必须先缓存再通知。
    app.state::<PendingFiles>().enqueue(files);
    let _ = app.emit("open-file", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn collect_files<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.trim_start().starts_with('-'))
        .filter(|a| !a.is_empty())
        .filter(|a| {
            let p = Path::new(a);
            is_markdown(p) && p.exists()
        })
        .collect()
}

/// 前端监听就绪及收到打开通知后取走文件；同一批路径只交付一次。
#[tauri::command]
fn take_initial_files(state: tauri::State<'_, PendingFiles>) -> Vec<String> {
    state.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pending = collect_files(std::env::args().skip(1));

    let app = tauri::Builder::default()
        // single-instance 必须最先注册
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let files = collect_files(argv.into_iter().skip(1));
            queue_open_files(app, files);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFiles(Mutex::new(pending)))
        .invoke_handler(tauri::generate_handler![
            take_initial_files,
            fs_ops::read_file_base64,
            fs_ops::write_file_bytes,
            fs_ops::file_stat,
            fs_ops::path_exists,
            fs_ops::same_file,
            fs_ops::write_attachment,
            fs_ops::list_dir,
            fs_ops::ensure_dir,
            fs_ops::reveal_in_file_manager,
            project::scan_project,
        ])
        .build(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");

    app.run(|app_handle, event| {
        // macOS：在 Finder 中双击 .md 文件（文件关联）会走这里
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let files: Vec<String> = urls
                .iter()
                .filter_map(|u| u.to_file_path().ok())
                .map(|p| p.to_string_lossy().to_string())
                .filter(|p| {
                    let path = Path::new(p);
                    is_markdown(path) && path.exists()
                })
                .collect();
            queue_open_files(app_handle, files);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app_handle, event);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_open_before_frontend_ready_is_retained() {
        let pending = PendingFiles(Mutex::new(Vec::new()));
        pending.enqueue(vec!["/文档/启动 文件.md".into()]);
        // 即使前端错过通知，启动后的主动读取仍能拿到系统传入的路径。
        assert_eq!(pending.take(), vec!["/文档/启动 文件.md"]);
        assert!(pending.take().is_empty());
    }

    #[test]
    fn later_system_opens_are_delivered_once_after_initial_drain() {
        let pending = PendingFiles(Mutex::new(vec!["/docs/initial.md".into()]));
        assert_eq!(pending.take(), vec!["/docs/initial.md"]);
        pending.enqueue(vec!["/docs/next.md".into()]);
        assert_eq!(pending.take(), vec!["/docs/next.md"]);
        assert!(pending.take().is_empty());
    }
}
