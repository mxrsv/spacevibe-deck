mod agents;
mod coordinator;
mod images;
mod info;
mod links;
mod menu;
mod menu_registry;
mod migrate;
mod pane_census;
mod platform;
mod prompt_assets;
mod pty;
mod quit_flow;
mod shell_integration;
mod update_flight;
mod window_close;
mod window_lifecycle;

use tauri::Manager;

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
        .manage(quit_flow::QuitFlight::default())
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
            coordinator::prepare_transfer,
            coordinator::stage_transfer,
            coordinator::claim_transfer,
            coordinator::commit_transfer,
            coordinator::abort_transfer,
            info::pty_info,
            info::git_branch,
            agents::detect_agents,
            agents::dirs_exist,
            prompt_assets::list_prompt_assets,
            images::read_image_as_data_url,
            images::scan_workspace_favicon,
            links::resolve_paths,
            links::open_editor,
            quit_flow::confirm_quit,
            quit_flow::cancel_quit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // `code` is `Some` only for a programmatic exit, which has
                // already passed its own guard. With peer windows the last
                // window really can go away, so preventing exit with no window
                // left would leave a process nothing can quit.
                let open_windows = app_handle.webview_windows().len();
                if quit_flow::exit_policy(code, open_windows)
                    == quit_flow::ExitPolicy::PromptAndPrevent
                {
                    api.prevent_exit();
                    quit_flow::request_quit(app_handle);
                }
            }
        });
}
