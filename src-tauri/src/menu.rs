#[cfg(target_os = "macos")]
use crate::menu_registry;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{AboutMetadata, Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder},
    App, Emitter, Manager, Runtime,
};

#[cfg(not(target_os = "macos"))]
use tauri::{App, Runtime};

const QUIT_MENU_ID: &str = "quit-confirm";
/// Prefix marking a menu item whose id IS a frontend keymap action. The
/// handler strips it and forwards the rest as one `menu:action` payload, so
/// adding an item below needs no new branch here and no new listener there.
const ACTION_PREFIX: &str = "action:";
/// Prefix marking a menu item built at runtime from the live window list. It is
/// deliberately NOT `action:`: these ids never reach the frontend keymap, so
/// they must never look like one to `isActionId`.
pub const WINDOW_TARGET_PREFIX: &str = "window-target:";

/// Where a menu event goes now that menu events are no longer broadcast
/// (spec §9.3).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MenuRoute {
    /// Quit never needs a focused window: the census owns it (spec §9.4).
    Quit,
    Action {
        window: String,
        action: String,
    },
    /// A click in the dynamic Move Pane to Window submenu. `window` is the
    /// source (the focused window that owns the pane); `target_label` is where
    /// the pane should land.
    MovePaneToWindow {
        window: String,
        target_label: String,
    },
    Dropped,
}

/// Pure routing decision. `target` is the focused window, or the most recently
/// focused one that still exists, or `None` when neither exists.
pub fn route_menu_event(id: &str, target: Option<&str>) -> MenuRoute {
    if id == QUIT_MENU_ID {
        return MenuRoute::Quit;
    }
    if let Some(target_label) = id.strip_prefix(WINDOW_TARGET_PREFIX) {
        return match target {
            Some(window) => MenuRoute::MovePaneToWindow {
                window: window.to_string(),
                target_label: target_label.to_string(),
            },
            None => MenuRoute::Dropped,
        };
    }
    match (id.strip_prefix(ACTION_PREFIX), target) {
        (Some(action), Some(window)) => MenuRoute::Action {
            window: window.to_string(),
            action: action.to_string(),
        },
        _ => MenuRoute::Dropped,
    }
}

/// Windows a pane can move to: every live window except the one it is in,
/// in the order handed in (the caller passes `FocusRegistry::rank`'s output, so
/// the most recently used destination is first).
pub fn move_pane_targets(ranked: &[String], source: &str) -> Vec<String> {
    ranked
        .iter()
        .filter(|label| label.as_str() != source)
        .cloned()
        .collect()
}

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
    rebuild_move_pane_submenu(app.handle())?;
    app.on_menu_event(|handle, event| {
        // Broadcast is gone: with peer windows it delivered every accelerator
        // to every window, so one Cmd+T opened a tab in each (spec §9.3).
        let target = crate::window_lifecycle::menu_target(handle);
        match route_menu_event(event.id().0.as_str(), target.as_deref()) {
            MenuRoute::Quit => crate::quit_flow::request_quit(handle),
            MenuRoute::Action { window, action } => {
                let _ = handle.emit_to(window, "menu:action", action);
            }
            MenuRoute::MovePaneToWindow {
                window,
                target_label,
            } => {
                // The source window runs prepare -> stage -> offer_transfer:
                // only it knows which pane has focus, and §7.4 makes it
                // serialize the xterm buffer before the destination may claim.
                let _ = handle.emit_to(
                    window,
                    "menu:move-pane-to-window",
                    serde_json::json!({ "targetLabel": target_label }),
                );
            }
            MenuRoute::Dropped => {}
        }
    });
    Ok(())
}

#[cfg(target_os = "macos")]
const MOVE_PANE_SUBMENU_TITLE: &str = "Move Pane to Window";

/// Rebuild the dynamic submenu from the live window list.
///
/// Called whenever the window set or the focus order changes — window created,
/// `Focused`, `Destroyed` — because a submenu built once at startup would list
/// windows that no longer exist and omit every window opened since.
#[cfg(target_os = "macos")]
pub fn rebuild_move_pane_submenu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let live = crate::window_lifecycle::live_window_labels(app);
    let ranked = app
        .state::<crate::window_lifecycle::FocusRegistry>()
        .rank(&live);
    let source = crate::window_lifecycle::menu_target(app).unwrap_or_default();

    let mut builder = SubmenuBuilder::new(app, MOVE_PANE_SUBMENU_TITLE);
    let targets = move_pane_targets(&ranked, &source);
    if targets.is_empty() {
        // One window open: an empty submenu reads as broken, a disabled item
        // reads as "nowhere to send it yet".
        let placeholder = MenuItem::with_id(
            app,
            "window-target-none",
            "No Other Window",
            false,
            None::<&str>,
        )?;
        builder = builder.item(&placeholder);
    } else {
        for label in &targets {
            let item = MenuItem::with_id(
                app,
                format!("{WINDOW_TARGET_PREFIX}{label}"),
                label,
                true,
                None::<&str>,
            )?;
            builder = builder.item(&item);
        }
    }
    let submenu = builder.build()?;
    install_menu_with_move_pane(app, submenu)
}

#[cfg(not(target_os = "macos"))]
pub fn rebuild_move_pane_submenu<R: Runtime>(_app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_menu_with_move_pane<R: Runtime>(
    app: &tauri::AppHandle<R>,
    move_pane: Submenu<R>,
) -> tauri::Result<()> {
    let menu = build_menu(app, &move_pane)?;
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn build_menu<R: Runtime>(
    handle: &tauri::AppHandle<R>,
    move_pane: &Submenu<R>,
) -> tauri::Result<Menu<R>> {
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
    // Appended to a submenu that is built but NOT yet installed. The
    // half-updated-menu objection applies to mutating a LIVE menu; here nothing
    // is on screen yet and the only visible transition is the single
    // `set_menu` the caller performs.
    file_menu.append(move_pane)?;
    MenuBuilder::new(handle)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu])
        .build()
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
    fn app_menu_items_match_expected_ids_in_order() {
        let ids: Vec<&str> = APP_MENU_ITEMS.iter().map(|(id, _, _)| *id).collect();
        assert_eq!(
            ids,
            ["check-for-updates", "open-release-notes", "toggle-settings"]
        );
    }

    #[test]
    fn edit_menu_items_matches_expected_ids_in_order() {
        let ids: Vec<&str> = EDIT_MENU_ITEMS.iter().map(|(id, _, _)| *id).collect();
        // copy-cwd added in docs/plans/2026-07-27-keyboard-parity.md Task 3 —
        // this list is a deliberate tripwire (see the module comment above):
        // it must be updated by hand whenever action-registry.ts adds an Edit
        // action, so nobody grows the menu without noticing.
        assert_eq!(
            ids,
            [
                "find",
                "find-next",
                "find-previous",
                "clear-buffer",
                "copy-cwd"
            ]
        );
    }

    #[test]
    fn window_menu_items_is_empty() {
        // New/Save Layout Preset moved to File (7583463) — Window is 100%
        // Cocoa builtins now (minimize/maximize/fullscreen).
        assert!(WINDOW_MENU_ITEMS.is_empty());
    }

    use crate::menu::{route_menu_event, MenuRoute};

    #[test]
    fn an_action_goes_to_the_target_window_only() {
        assert_eq!(
            route_menu_event("action:new-tab", Some("deck-2")),
            MenuRoute::Action {
                window: "deck-2".into(),
                action: "new-tab".into()
            }
        );
    }

    #[test]
    fn a_pane_scoped_action_is_dropped_when_no_window_can_receive_it() {
        // macOS fires menu events with no window focused; a pane action with
        // nowhere to land must be dropped, never broadcast.
        assert_eq!(
            route_menu_event("action:close-pane", None),
            MenuRoute::Dropped
        );
    }

    #[test]
    fn quit_is_routed_through_the_census_regardless_of_focus() {
        assert_eq!(route_menu_event("quit-confirm", None), MenuRoute::Quit);
        assert_eq!(
            route_menu_event("quit-confirm", Some("main")),
            MenuRoute::Quit
        );
    }

    #[test]
    fn an_unknown_menu_id_is_dropped() {
        assert_eq!(route_menu_event("about", Some("main")), MenuRoute::Dropped);
    }

    #[test]
    fn a_window_target_click_routes_to_the_focused_window_with_its_target() {
        assert_eq!(
            route_menu_event("window-target:deck-2", Some("main")),
            MenuRoute::MovePaneToWindow {
                window: "main".into(),
                target_label: "deck-2".into()
            }
        );
    }

    #[test]
    fn a_window_target_click_with_no_focused_window_is_dropped() {
        assert_eq!(
            route_menu_event("window-target:deck-2", None),
            MenuRoute::Dropped
        );
    }

    #[test]
    fn a_window_target_id_never_looks_like_a_keymap_action() {
        // `action:` is what the frontend validates with isActionId. A dynamic
        // id must not travel that path — action-registry.ts would reject it.
        assert!(!"window-target:deck-2".starts_with(super::ACTION_PREFIX));
    }

    #[test]
    fn the_submenu_lists_every_other_window_most_recent_first() {
        assert_eq!(
            super::move_pane_targets(&["deck-1".into(), "main".into(), "deck-2".into()], "deck-1"),
            vec!["main".to_string(), "deck-2".to_string()]
        );
    }

    #[test]
    fn the_submenu_is_empty_when_there_is_nowhere_to_move_a_pane() {
        assert!(super::move_pane_targets(&["main".into()], "main").is_empty());
    }
}
