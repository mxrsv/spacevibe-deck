#[cfg(target_os = "macos")]
use crate::menu_registry;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder},
    App, Emitter, Runtime,
};

#[cfg(not(target_os = "macos"))]
use tauri::{App, Runtime};

#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "quit-confirm";
/// Prefix marking a menu item whose id IS a frontend keymap action. The
/// handler strips it and forwards the rest as one `menu:action` payload, so
/// adding an item below needs no new branch here and no new listener there.
#[cfg(target_os = "macos")]
const ACTION_PREFIX: &str = "action:";

/// A menu item bound 1:1 to a keymap action in `src/terminal/keymap.ts`.
///
/// The accelerator is deliberately the SAME chord the webview keymap already
/// binds. macOS gives the menu the key first, so the webview stops seeing it
/// — the item is not an addition to the shortcut, it becomes the shortcut.
/// That is why every one of these routes back into the same dispatch table
/// (`TabManager.runAction`) rather than doing anything of its own.
#[cfg(target_os = "macos")]
pub(crate) fn action_item<R: Runtime>(
    handle: &tauri::AppHandle<R>,
    action: &str,
    label: &str,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(
        handle,
        format!("{ACTION_PREFIX}{action}"),
        label,
        true,
        accelerator,
    )
}

/// Explicit macOS menu, replacing the default one for two reasons:
/// - The default Quit item (Cmd+Q) exits the process without going through
///   RunEvent::ExitRequested (tauri-apps/tauri#3124), so a custom item keeps
///   the shortcut but emits "quit-requested" for the frontend confirm dialog.
/// - The default File > Close Window item owns Cmd+W, which must reach the
///   webview instead (close-tab shortcut).
#[cfg(target_os = "macos")]
pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let handle = app.handle();
    let app_name = handle.package_info().name.clone();
    let quit = MenuItem::with_id(
        handle,
        QUIT_MENU_ID,
        format!("Quit {app_name}"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    // HIG placement: right after About, above Services, its own separator.
    // Hand-written (mixes in Cocoa builtins — About/Services/Hide, no full
    // codegen, see menu_registry.rs). If you change an item here, update
    // HAND_WRITTEN_APP in `mod tests` below AND action-registry.ts —
    // `cargo test` goes red if you forget either.
    let settings = action_item(handle, "toggle-settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let app_menu = SubmenuBuilder::new(handle, app_name)
        .about(Some(AboutMetadata::default()))
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    // Find lives under Edit because that is where macOS users look for it —
    // ⌘F reaching only the webview meant the app had no discoverable find.
    // Hand-written (mixes in Cocoa builtins — Undo/Redo/Cut/Copy/Paste/Select
    // All). If you change an item here, update HAND_WRITTEN_EDIT in
    // `mod tests` below AND action-registry.ts — `cargo test` goes red if
    // you forget either.
    let find = action_item(handle, "find", "Find…", Some("CmdOrCtrl+F"))?;
    // Repeat the last search, with or without the bar open (search-bar.ts's
    // `advanceSearch`) — standard macOS Find Next/Previous placement.
    let find_next = action_item(handle, "find-next", "Find Next", Some("CmdOrCtrl+G"))?;
    let find_previous = action_item(
        handle,
        "find-previous",
        "Find Previous",
        Some("CmdOrCtrl+Shift+G"),
    )?;
    let clear_buffer = action_item(handle, "clear-buffer", "Clear Buffer", Some("CmdOrCtrl+K"))?;
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .item(&find_next)
        .item(&find_previous)
        .item(&clear_buffer)
        .build()?;

    // File and View are 100% ACTION_REGISTRY items (no Cocoa builtins mixed
    // in), so they're generated in full from menu_registry.rs — see
    // scripts/generate-menu.ts. Editing an item's label/accelerator/menu
    // position happens in action-registry.ts, then `npm run generate:menu`
    // (predev/prebuild already runs this), never here.
    let file_menu = menu_registry::build_file_menu(handle)?;
    let view_menu = menu_registry::build_view_menu(handle)?;
    // New/Save Layout Preset moved to the File menu above — Window is now
    // just native window management. Hand-written (100% Cocoa builtins,
    // zero action items — HAND_WRITTEN_WINDOW below is deliberately empty).
    // If you add an action item here, update HAND_WRITTEN_WINDOW in
    // `mod tests` below AND action-registry.ts.
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;
    let menu = MenuBuilder::new(handle)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|handle, event| {
        let id = event.id().0.as_str();
        if id == QUIT_MENU_ID {
            let _ = handle.emit("quit-requested", ());
        } else if let Some(action) = id.strip_prefix(ACTION_PREFIX) {
            let _ = handle.emit("menu:action", action);
        }
    });
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install<R: Runtime>(_app: &App<R>) -> tauri::Result<()> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::menu_registry::{APP_MENU_ITEMS, EDIT_MENU_ITEMS, WINDOW_MENU_ITEMS};

    // The (action id, label, accelerator) triples hand-written in install()
    // for App/Edit/Window — must match the generated registry EXACTLY. This
    // is the safety net for the three submenus that mix in native Cocoa
    // builtins and so can't be generated in full — see
    // docs/plans/2026-07-27-action-registry.md §2.2. This is the mechanism
    // that would have caught 09f5c4d's staleness (an accelerator added to
    // menu.rs that keymap.ts didn't know about) had it existed already.
    const HAND_WRITTEN_APP: &[(&str, &str, Option<&str>)] =
        &[("toggle-settings", "Settings…", Some("CmdOrCtrl+,"))];
    const HAND_WRITTEN_EDIT: &[(&str, &str, Option<&str>)] = &[
        ("find", "Find…", Some("CmdOrCtrl+F")),
        ("find-next", "Find Next", Some("CmdOrCtrl+G")),
        ("find-previous", "Find Previous", Some("CmdOrCtrl+Shift+G")),
        ("clear-buffer", "Clear Buffer", Some("CmdOrCtrl+K")),
    ];
    // Empty on purpose: New/Save Layout Preset moved to File
    // (7583463) — Window is 100% Cocoa builtins now (minimize/maximize/
    // fullscreen), zero action items left to cross-check.
    const HAND_WRITTEN_WINDOW: &[(&str, &str, Option<&str>)] = &[];

    #[test]
    fn app_menu_matches_registry() {
        assert_eq!(HAND_WRITTEN_APP, APP_MENU_ITEMS);
    }

    #[test]
    fn edit_menu_matches_registry() {
        assert_eq!(HAND_WRITTEN_EDIT, EDIT_MENU_ITEMS);
    }

    #[test]
    fn window_menu_matches_registry() {
        assert_eq!(HAND_WRITTEN_WINDOW, WINDOW_MENU_ITEMS);
    }
}
