mod agents;
mod coordinator;
mod images;
mod info;
mod links;
mod menu;
mod menu_registry;
mod migrate;
mod platform;
mod pty;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct QuitState {
    confirmed: AtomicBool,
}

#[tauri::command]
fn confirm_quit(app: tauri::AppHandle, state: tauri::State<'_, QuitState>) {
    state.confirmed.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(pty::PtyState::default())
        .manage(coordinator::WindowCoordinator::default())
        .manage(QuitState::default())
        .setup(|app| {
            // Before anything reads the store: the frontend loads settings
            // lazily, so this is the last point at which the old identifier's
            // directory can still be carried over unseen.
            migrate::legacy_app_data(app.handle());
            menu::install(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pty::spawn_shell,
            pty::write_pty,
            pty::resize_pty,
            pty::kill_pty,
            platform::desktop_environment,
            coordinator::move_pane_ownership,
            info::pty_info,
            info::git_branch,
            agents::detect_agents,
            agents::dirs_exist,
            images::read_image_as_data_url,
            images::scan_workspace_favicon,
            links::resolve_paths,
            links::open_editor,
            confirm_quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app_handle.state::<QuitState>();
                if !state.confirmed.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app_handle.emit("quit-requested", ());
                }
            }
        });
}
