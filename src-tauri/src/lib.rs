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
mod settings_merge;
mod shell_integration;
mod update_flight;
mod usage;
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
        .manage(window_lifecycle::WindowLabels::default())
        .manage(window_lifecycle::FocusRegistry::default())
        .manage(window_lifecycle::PendingAdoptions::default())
        .manage(quit_flow::QuitFlight::default())
        .manage(window_close::CloseFlight::default())
        .manage(update_flight::UpdateFlight::default())
        .manage(settings_merge::SettingsWriteLock::default())
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
            for (label, window) in app.webview_windows() {
                platform::harden_webview(&window)?;
                // The configured window is created before `on_window_event` can
                // see any focus change, so its first focus is seeded here.
                if window.is_focused().unwrap_or(false) {
                    app.state::<window_lifecycle::FocusRegistry>()
                        .record(&label);
                }
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
            usage::usage_snapshot,
            images::read_image_as_data_url,
            images::scan_workspace_favicon,
            links::resolve_paths,
            links::open_editor,
            quit_flow::confirm_quit,
            quit_flow::cancel_quit,
            window_lifecycle::window_boot_mode,
            window_lifecycle::open_pane_window,
            window_lifecycle::offer_transfer,
            window_close::confirm_close_window,
            window_close::cancel_close_window,
            update_flight::begin_update_check,
            update_flight::end_update_check,
            settings_merge::apply_settings_patch
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(true) => {
                window
                    .state::<window_lifecycle::FocusRegistry>()
                    .record(window.label());
                // The submenu is ordered most-recently-focused first, so focus
                // changing changes its contents.
                let _ = menu::rebuild_move_pane_submenu(window.app_handle());
            }
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if window_close::on_close_requested(window) {
                    api.prevent_close();
                }
            }
            tauri::WindowEvent::Destroyed => {
                let app = window.app_handle();
                let label = window.label().to_string();
                // Crash path: no CloseRequested fired and no busy guard ran, so
                // the panes this window still owned would otherwise outlive it
                // with nobody reading their output (spec §7.6).
                coordinator::on_window_destroyed(app, &label);
                window_lifecycle::forget_window(app, &label);
                // After forget_window, so the dead label is already out of the
                // focus registry and cannot be listed as a drop target.
                let _ = menu::rebuild_move_pane_submenu(app);
            }
            _ => {}
        })
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
