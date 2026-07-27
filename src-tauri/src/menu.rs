#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItem, SubmenuBuilder},
    App, Emitter, Runtime,
};

#[cfg(not(target_os = "macos"))]
use tauri::{App, Runtime};

#[cfg(target_os = "macos")]
const QUIT_MENU_ID: &str = "quit-confirm";
#[cfg(target_os = "macos")]
const NEW_PRESET_MENU_ID: &str = "new-preset";
#[cfg(target_os = "macos")]
const SAVE_PRESET_MENU_ID: &str = "save-preset";
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
fn action_item<R: Runtime>(
    handle: &tauri::AppHandle<R>,
    action: &str,
    label: &str,
    accelerator: &str,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(
        handle,
        format!("{ACTION_PREFIX}{action}"),
        label,
        true,
        Some(accelerator),
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
    let settings = action_item(handle, "toggle-settings", "Settings…", "CmdOrCtrl+,")?;
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
    let find = action_item(handle, "find", "Find…", "CmdOrCtrl+F")?;
    let clear_buffer = action_item(handle, "clear-buffer", "Clear Buffer", "CmdOrCtrl+K")?;
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
        .item(&clear_buffer)
        .build()?;

    let new_tab = action_item(handle, "new-tab", "New Tab", "CmdOrCtrl+T")?;
    let close_pane = action_item(handle, "close-pane", "Close Pane", "CmdOrCtrl+W")?;
    let close_tab = action_item(handle, "close-tab", "Close Tab", "CmdOrCtrl+Shift+W")?;
    let reopen_tab = action_item(
        handle,
        "reopen-tab",
        "Reopen Closed Tab",
        "CmdOrCtrl+Shift+T",
    )?;
    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&new_tab)
        .item(&reopen_tab)
        .separator()
        .item(&close_pane)
        .item(&close_tab)
        .build()?;

    // Labels match the chrome-action tooltips: ⌘D splits vertically (a new
    // pane to the RIGHT, i.e. a row split), ⌘⇧D horizontally.
    let split_row = action_item(handle, "split-row", "Split Vertically", "CmdOrCtrl+D")?;
    let split_column = action_item(
        handle,
        "split-column",
        "Split Horizontally",
        "CmdOrCtrl+Shift+D",
    )?;
    let zoom_pane = action_item(
        handle,
        "toggle-zoom-pane",
        "Zoom Pane",
        "CmdOrCtrl+Shift+Enter",
    )?;
    let focus_expand = action_item(handle, "toggle-expand", "Focus Expand", "CmdOrCtrl+E")?;
    let font_bigger = action_item(handle, "zoom-in", "Increase Font Size", "CmdOrCtrl+=")?;
    let font_smaller = action_item(handle, "zoom-out", "Decrease Font Size", "CmdOrCtrl+-")?;
    let font_reset = action_item(handle, "zoom-reset", "Actual Size", "CmdOrCtrl+0")?;
    let next_attention = action_item(
        handle,
        "focus-next-attention",
        "Next Agent Needing Attention",
        "CmdOrCtrl+Shift+A",
    )?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&split_row)
        .item(&split_column)
        .separator()
        .item(&zoom_pane)
        .item(&focus_expand)
        .separator()
        .item(&font_bigger)
        .item(&font_smaller)
        .item(&font_reset)
        .separator()
        .item(&next_attention)
        .build()?;
    let new_preset = MenuItem::with_id(
        handle,
        NEW_PRESET_MENU_ID,
        "New Layout Preset…",
        true,
        None::<&str>,
    )?;
    let save_preset = MenuItem::with_id(
        handle,
        SAVE_PRESET_MENU_ID,
        "Save Layout as Preset…",
        true,
        Some("CmdOrCtrl+Shift+S"),
    )?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .separator()
        .item(&new_preset)
        .item(&save_preset)
        .build()?;
    let menu = MenuBuilder::new(handle)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|handle, event| {
        let id = event.id().0.as_str();
        if id == QUIT_MENU_ID {
            let _ = handle.emit("quit-requested", ());
        } else if id == NEW_PRESET_MENU_ID {
            let _ = handle.emit("menu:new-preset", ());
        } else if id == SAVE_PRESET_MENU_ID {
            let _ = handle.emit("menu:save-preset", ());
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
