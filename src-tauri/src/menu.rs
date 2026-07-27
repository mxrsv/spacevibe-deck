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
    // codegen, see menu_registry.rs). The action item(s) themselves are NOT
    // retyped here: they're built straight from `menu_registry::APP_MENU_ITEMS`
    // (generated from action-registry.ts), so there is no second hand-written
    // copy of id/label/accelerator left to go stale — only the interspersion
    // with Cocoa builtins below is hand-placed. If action-registry.ts adds or
    // removes an App-menu action, `npm run generate:menu` updates the table
    // and this loop picks it up with no further edit needed here.
    let app_action_items: Vec<MenuItem<R>> = menu_registry::APP_MENU_ITEMS
        .iter()
        .map(|(action, label, accelerator)| action_item(handle, action, label, *accelerator))
        .collect::<tauri::Result<_>>()?;
    let mut app_menu_builder =
        SubmenuBuilder::new(handle, app_name).about(Some(AboutMetadata::default()));
    for item in &app_action_items {
        app_menu_builder = app_menu_builder.item(item);
    }
    let app_menu = app_menu_builder
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
    // Find/Find Next/Find Previous/Clear Buffer are built straight from
    // `menu_registry::EDIT_MENU_ITEMS` below, in the same order the registry
    // declares them — see the App-menu comment above for why that removes
    // the stale-hand-copy risk. Hand-written here is only the interspersion
    // with Cocoa builtins (Undo/Redo/Cut/Copy/Paste/Select All).
    let edit_action_items: Vec<MenuItem<R>> = menu_registry::EDIT_MENU_ITEMS
        .iter()
        .map(|(action, label, accelerator)| action_item(handle, action, label, *accelerator))
        .collect::<tauri::Result<_>>()?;
    let mut edit_menu_builder = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator();
    for item in &edit_action_items {
        edit_menu_builder = edit_menu_builder.item(item);
    }
    let edit_menu = edit_menu_builder.build()?;

    // File and View are 100% ACTION_REGISTRY items (no Cocoa builtins mixed
    // in), so they're generated in full from menu_registry.rs — see
    // scripts/generate-menu.ts. Editing an item's label/accelerator/menu
    // position happens in action-registry.ts, then `npm run generate:menu`
    // (predev/prebuild already runs this), never here.
    let file_menu = menu_registry::build_file_menu(handle)?;
    let view_menu = menu_registry::build_view_menu(handle)?;
    // New/Save Layout Preset moved to the File menu above — Window is now
    // just native window management, so `menu_registry::WINDOW_MENU_ITEMS` is
    // empty today and this loop is a no-op. It stays wired up (rather than
    // hand-added later) so that if action-registry.ts ever puts a Window-menu
    // action back, this picks it up automatically after `npm run generate:menu`
    // — no separate hand-written list to remember.
    let window_action_items: Vec<MenuItem<R>> = menu_registry::WINDOW_MENU_ITEMS
        .iter()
        .map(|(action, label, accelerator)| action_item(handle, action, label, *accelerator))
        .collect::<tauri::Result<_>>()?;
    let mut window_menu_builder = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen();
    for item in &window_action_items {
        window_menu_builder = window_menu_builder.item(item);
    }
    let window_menu = window_menu_builder.build()?;
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

// Not `target_os = "macos"` gated: this module reads plain data
// (`menu_registry`'s generated `&[(&str, &str, Option<&str>)]` tables), so it
// compiles and runs on any target, including the ubuntu CI runner — see
// docs/plans/2026-07-27-action-registry.md §2.2 and the CI workflow, which
// now runs `cargo test` there instead of requiring a macOS runner.
//
// This used to cross-check hand-typed (id, label, accelerator) triples
// against these same generated tables. That second hand-written copy is
// gone now: `install()`'s App/Edit/Window submenus build their action items
// directly from `APP_MENU_ITEMS`/`EDIT_MENU_ITEMS`/`WINDOW_MENU_ITEMS` (see
// the loops above), so there is nothing left to drift out of sync with the
// registry — the exact bug class `09f5c4d` exposed (an accelerator added in
// menu.rs that keymap.ts didn't know about) is now structurally impossible,
// not just detected after the fact.
//
// What's still worth guarding here: that `action-registry.ts` keeps putting
// each action in the submenu everyone expects. If a future action gains a
// `menu: { submenu: "Edit" }` (say) without anyone noticing, this goes red
// and forces a deliberate update instead of a silent menu change.
#[cfg(test)]
mod tests {
    use crate::menu_registry::{APP_MENU_ITEMS, EDIT_MENU_ITEMS, WINDOW_MENU_ITEMS};

    #[test]
    fn app_menu_items_is_exactly_toggle_settings() {
        let ids: Vec<&str> = APP_MENU_ITEMS.iter().map(|(id, _, _)| *id).collect();
        assert_eq!(ids, ["toggle-settings"]);
    }

    #[test]
    fn edit_menu_items_matches_expected_ids_in_order() {
        let ids: Vec<&str> = EDIT_MENU_ITEMS.iter().map(|(id, _, _)| *id).collect();
        assert_eq!(ids, ["find", "find-next", "find-previous", "clear-buffer"]);
    }

    #[test]
    fn window_menu_items_is_empty() {
        // New/Save Layout Preset moved to File (7583463) — Window is 100%
        // Cocoa builtins now (minimize/maximize/fullscreen).
        assert!(WINDOW_MENU_ITEMS.is_empty());
    }
}
