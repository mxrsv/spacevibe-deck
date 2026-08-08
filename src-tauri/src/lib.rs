mod agents;
mod coordinator;
mod images;
mod info;
mod links;
mod menu;
mod menu_registry;
mod migrate;
mod native_terminal;
mod platform;
mod prompt_assets;
mod pty;
mod shell_integration;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
struct QuitState {
    confirmed: AtomicBool,
}

#[tauri::command]
fn confirm_quit(
    app: tauri::AppHandle,
    state: tauri::State<'_, QuitState>,
    native: tauri::State<'_, native_terminal::NativeTerminalState>,
) {
    state.confirmed.store(true, Ordering::SeqCst);
    native.terminate_all();
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init());

    if let Some(public_key) = option_env!("DECK_UPDATER_PUBLIC_KEY") {
        builder = builder.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(public_key)
                .build(),
        );
    }

    builder
        .manage(pty::PtyState::default())
        .manage(coordinator::WindowCoordinator::default())
        .manage(native_terminal::NativeTerminalState::default())
        .manage(QuitState::default())
        .setup(|app| {
            // Before anything reads the store: the frontend loads settings
            // lazily, so this is the last point at which the old identifier's
            // directory can still be carried over unseen.
            migrate::legacy_app_data(app.handle());
            menu::install(app)?;
            // Browser accelerator keys are on by wry's default and Tauri has no
            // builder flag for them: one F5 in the chrome discards every tab and
            // orphans every PTY. Applied per window, so a future second window
            // needs the same call.
            for window in app.webview_windows().values() {
                platform::harden_webview(window)?;
            }
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
            prompt_assets::list_prompt_assets,
            images::read_image_as_data_url,
            images::scan_workspace_favicon,
            links::resolve_paths,
            links::open_editor,
            native_terminal::spawn_alacritty,
            native_terminal::apply_alacritty_appearance,
            native_terminal::perform_alacritty_action,
            native_terminal::update_alacritty,
            native_terminal::focus_alacritty,
            native_terminal::kill_alacritty,
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
