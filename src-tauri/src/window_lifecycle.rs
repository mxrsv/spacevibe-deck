//! Per-window state that is keyed by window label and must outlive any single
//! webview: label allocation, most-recently-focused order, and the pending
//! adoption a freshly created window reads at boot (spec §9.1, §9.2).

use crate::coordinator::WindowCoordinator;
use crate::platform;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::utils::config::WindowConfig;
use tauri::{Manager, PhysicalPosition, State, WebviewWindowBuilder};

/// Every window this app creates after the configured `main` window carries
/// this prefix, so a generated label can never shadow the configured one.
pub const DECK_LABEL_PREFIX: &str = "deck-";

/// Monotonic label source. A label is never reused inside a process run:
/// reuse would let a stale `emit_to` from a dead window's route land in a live
/// one that happens to have taken the same name.
pub struct WindowLabels {
    next: AtomicU32,
}

impl Default for WindowLabels {
    fn default() -> Self {
        Self {
            next: AtomicU32::new(1),
        }
    }
}

impl WindowLabels {
    pub fn allocate(&self) -> String {
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        format!("{DECK_LABEL_PREFIX}{n}")
    }
}

/// Window labels in most-recently-focused order, newest first.
///
/// A poisoned lock degrades to "no fallback" rather than to a panic: losing the
/// menu fallback drops one keystroke, panicking on the event loop takes the app
/// down.
#[derive(Default)]
pub struct FocusRegistry {
    order: Mutex<Vec<String>>,
}

impl FocusRegistry {
    pub fn record(&self, label: &str) {
        let Ok(mut order) = self.order.lock() else {
            return;
        };
        order.retain(|existing| existing != label);
        order.insert(0, label.to_string());
    }

    pub fn forget(&self, label: &str) {
        let Ok(mut order) = self.order.lock() else {
            return;
        };
        order.retain(|existing| existing != label);
    }

    pub fn most_recent_among(&self, existing: &[String]) -> Option<String> {
        let order = self.order.lock().ok()?;
        order
            .iter()
            .find(|label| existing.iter().any(|live| live == *label))
            .cloned()
    }

    /// `existing`, sorted most-recently-focused first. A window that has never
    /// been focused still exists and still accepts a drop, so it goes to the
    /// back rather than disappearing from the list.
    pub fn rank(&self, existing: &[String]) -> Vec<String> {
        let Ok(order) = self.order.lock() else {
            return existing.to_vec();
        };
        let mut ranked: Vec<String> = order
            .iter()
            .filter(|label| existing.iter().any(|window| window == *label))
            .cloned()
            .collect();
        for label in existing {
            if !ranked.iter().any(|known| known == label) {
                ranked.push(label.clone());
            }
        }
        ranked
    }
}

/// Adoption tokens keyed by the label of the window that has not booted yet.
///
/// Registered before `build()` so the entry is in place no matter how fast the
/// webview loads, and consumed by the first `window_boot_mode` call.
#[derive(Default)]
pub struct PendingAdoptions {
    tokens: Mutex<HashMap<String, String>>,
}

impl PendingAdoptions {
    pub fn register(&self, label: String, token: String) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.insert(label, token);
        }
    }

    pub fn take(&self, label: &str) -> Option<String> {
        self.tokens.lock().ok()?.remove(label)
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut tokens) = self.tokens.lock() {
            tokens.remove(label);
        }
    }
}

/// What a window should build at startup (spec §9.2). `adopt` skips the Open
/// Board and builds one tab around the transferred pane.
#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum BootMode {
    Normal,
    Adopt { token: String },
}

#[tauri::command]
pub fn window_boot_mode(window: tauri::Window, pending: State<'_, PendingAdoptions>) -> BootMode {
    match pending.take(window.label()) {
        Some(token) => BootMode::Adopt { token },
        None => BootMode::Normal,
    }
}

/// The configured window, with the label swapped. Reusing the config is what
/// keeps a detached window's title, size, minimum size and background color in
/// one place — `tauri.conf.json` — instead of retyped as Rust constants.
pub fn relabel_window_config(source: &WindowConfig, label: &str) -> WindowConfig {
    let mut config = source.clone();
    config.label = label.to_string();
    config
}

/// `open_pane_window`'s frozen argument shape.
///
/// `screen_x`/`screen_y` are **CSS pixels** — the units the browser's
/// `screenX`/`screenY` report and the units the drag section relays. They are
/// absent on the menu-command path, which takes the OS's default placement.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenPaneWindowArgs {
    pub token: String,
    pub screen_x: Option<f64>,
    pub screen_y: Option<f64>,
}

/// One screen axis, CSS pixels → physical pixels.
///
/// Derived from the §6 spike, where `clientX = screenX − innerPosition.x /
/// scaleFactor` had residual exactly 0 at two positions with `innerPosition`
/// physical and `screenX` in CSS. Multiply, never divide.
pub fn physical_from_css(css: f64, scale_factor: f64) -> f64 {
    css * scale_factor
}

/// Upper bound on waiting for the main event loop to run the hardening
/// closure. The loop runs it inline or within one turn; five seconds means
/// "the loop is gone", not "the loop is busy".
const HARDEN_TIMEOUT: Duration = Duration::from_secs(5);

/// Create a Deck window that boots straight into adopting `args.token`'s pane.
///
/// Async on purpose: `WebviewWindowBuilder` deadlocks on Windows when a
/// synchronous command creates a window.
#[tauri::command]
pub async fn open_pane_window(
    app: tauri::AppHandle,
    labels: State<'_, WindowLabels>,
    pending: State<'_, PendingAdoptions>,
    coordinator: State<'_, WindowCoordinator>,
    args: OpenPaneWindowArgs,
) -> Result<String, String> {
    let label = labels.allocate();
    let source = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .ok_or_else(|| "No window is configured in tauri.conf.json".to_string())?;
    let config = relabel_window_config(&source, &label);

    // Before `build()`, and before anything can fail afterwards: without the
    // reservation the coordinator cannot tell that a window destroyed before
    // it claims was THIS transfer's destination, so §7.6 row 1 degrades from
    // an immediate abort into the §7.5 ten-second timeout.
    coordinator.reserve_destination(&args.token, &label)?;

    // Registered before `build()` too: the webview can call `window_boot_mode`
    // as soon as it loads, and losing that race would boot the Open Board
    // into a window that exists only to receive a pane.
    pending.register(label.clone(), args.token);

    let window = match WebviewWindowBuilder::from_config(&app, &config)
        .and_then(|builder| builder.build())
    {
        Ok(window) => window,
        Err(error) => {
            pending.forget(&label);
            return Err(error.to_string());
        }
    };

    // Placement, when the drag section supplied a drop point. Physical rather
    // than the builder's logical position: a global logical coordinate is
    // ambiguous once two monitors have different scale factors. A failure here
    // is not fatal — a window in the wrong place still holds the pane — so it
    // is reported and the move continues.
    if let (Some(screen_x), Some(screen_y)) = (args.screen_x, args.screen_y) {
        let scale = app
            .monitor_from_point(screen_x, screen_y)
            .ok()
            .flatten()
            .map(|monitor| monitor.scale_factor())
            .or_else(|| {
                app.primary_monitor()
                    .ok()
                    .flatten()
                    .map(|monitor| monitor.scale_factor())
            })
            .unwrap_or(1.0);
        let position = PhysicalPosition::new(
            physical_from_css(screen_x, scale).round() as i32,
            physical_from_css(screen_y, scale).round() as i32,
        );
        if let Err(error) = window.set_position(position) {
            eprintln!("Deck: could not place {label} at the drop point: {error}");
        }
    }

    // Spec §9.1: this must run ON the main event-loop thread. Off it,
    // `with_webview` returns Ok for "enqueued" and the closure may never run,
    // leaving browser accelerator keys live — one F5 discarding every pane in
    // the new window. The channel is what turns that silence into an error.
    let (sender, receiver) = mpsc::channel::<Result<(), String>>();
    let target = window.clone();
    let dispatched = app.run_on_main_thread(move || {
        let _ = sender.send(platform::harden_webview(&target));
    });
    let hardened = match dispatched {
        Ok(()) => receiver
            .recv_timeout(HARDEN_TIMEOUT)
            .map_err(|_| "Webview hardening never ran on the main event loop".to_string())
            .and_then(|result| result),
        Err(error) => Err(error.to_string()),
    };
    if let Err(error) = hardened {
        let _ = window.destroy();
        pending.forget(&label);
        return Err(format!("Could not harden the new window: {error}"));
    }

    Ok(label)
}

/// The window a menu event or a quit prompt belongs to: the focused one, else
/// the most recently focused one that still exists (spec §9.3). `None` means
/// every Deck window is gone or none has ever been focused.
#[allow(dead_code)] // gains its callers in B6 and B10
pub fn menu_target<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<String> {
    let windows = app.webview_windows();
    if let Some(label) = windows
        .iter()
        .find(|(_, window)| window.is_focused().unwrap_or(false))
        .map(|(label, _)| label.clone())
    {
        return Some(label);
    }
    let live: Vec<String> = windows.keys().cloned().collect();
    app.state::<FocusRegistry>().most_recent_among(&live)
}

/// Live window labels, most recently focused first.
///
/// Read-only on purpose. It does not focus, raise or reorder anything: spec
/// §11.2 forbids raising a window mid-drag because `setFocus` steals focus and
/// risks breaking pointer capture, and this must not become a back door to it.
#[tauri::command]
pub fn focus_order(app: tauri::AppHandle) -> Vec<String> {
    let live: Vec<String> = app.webview_windows().keys().cloned().collect();
    app.state::<FocusRegistry>().rank(&live)
}

#[cfg(test)]
mod tests {
    use super::{BootMode, FocusRegistry, PendingAdoptions, WindowLabels, DECK_LABEL_PREFIX};
    use std::collections::HashSet;

    fn labels(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn allocates_prefixed_labels_in_order() {
        let labels = WindowLabels::default();
        assert_eq!(labels.allocate(), "deck-1");
        assert_eq!(labels.allocate(), "deck-2");
        assert_eq!(labels.allocate(), "deck-3");
        assert!("deck-1".starts_with(DECK_LABEL_PREFIX));
    }

    #[test]
    fn never_reuses_a_label_and_never_collides_with_main() {
        let labels = WindowLabels::default();
        let mut seen = HashSet::new();
        for _ in 0..1000 {
            let label = labels.allocate();
            assert_ne!(label, "main");
            assert!(seen.insert(label), "a label was handed out twice");
        }
    }

    #[test]
    fn returns_the_most_recently_focused_live_window() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");
        registry.record("main");

        assert_eq!(
            registry.most_recent_among(&labels(&["main", "deck-1"])),
            Some("main".to_string())
        );
    }

    #[test]
    fn skips_a_window_that_no_longer_exists() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");

        assert_eq!(
            registry.most_recent_among(&labels(&["main"])),
            Some("main".to_string())
        );
        assert_eq!(registry.most_recent_among(&[]), None);
    }

    #[test]
    fn forget_drops_a_destroyed_window() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");
        registry.forget("deck-1");

        assert_eq!(
            registry.most_recent_among(&labels(&["main", "deck-1"])),
            Some("main".to_string())
        );
    }

    #[test]
    fn re_focusing_moves_a_window_to_the_front_without_duplicating_it() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");
        registry.record("main");
        registry.forget("main");

        assert_eq!(
            registry.most_recent_among(&labels(&["main", "deck-1"])),
            Some("deck-1".to_string())
        );
    }

    #[test]
    fn rank_orders_by_recency_and_keeps_never_focused_windows_last() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");

        assert_eq!(
            registry.rank(&labels(&["main", "deck-1", "deck-2"])),
            labels(&["deck-1", "main", "deck-2"])
        );
    }

    #[test]
    fn rank_drops_windows_that_no_longer_exist() {
        let registry = FocusRegistry::default();
        registry.record("main");
        registry.record("deck-1");

        assert_eq!(registry.rank(&labels(&["main"])), labels(&["main"]));
    }

    #[test]
    fn boot_mode_is_normal_without_a_pending_adoption() {
        let pending = PendingAdoptions::default();
        assert_eq!(pending.take("deck-1"), None);
    }

    #[test]
    fn a_registered_adoption_is_handed_out_exactly_once() {
        let pending = PendingAdoptions::default();
        pending.register("deck-1".into(), "token-abc".into());

        assert_eq!(pending.take("deck-1"), Some("token-abc".to_string()));
        assert_eq!(pending.take("deck-1"), None);
    }

    #[test]
    fn forget_drops_an_adoption_whose_window_never_loaded() {
        let pending = PendingAdoptions::default();
        pending.register("deck-1".into(), "token-abc".into());
        pending.forget("deck-1");

        assert_eq!(pending.take("deck-1"), None);
    }

    #[test]
    fn boot_mode_serializes_the_shape_the_frontend_reads() {
        assert_eq!(
            serde_json::to_value(BootMode::Normal).unwrap(),
            serde_json::json!({ "kind": "normal" })
        );
        assert_eq!(
            serde_json::to_value(BootMode::Adopt {
                token: "token-abc".into()
            })
            .unwrap(),
            serde_json::json!({ "kind": "adopt", "token": "token-abc" })
        );
    }

    #[test]
    fn window_config_takes_its_geometry_from_the_configured_window() {
        let source = tauri::utils::config::WindowConfig {
            label: "main".into(),
            title: "SpaceVibe Deck".into(),
            width: 1100.0,
            height: 720.0,
            ..Default::default()
        };

        let derived = super::relabel_window_config(&source, "deck-1");

        assert_eq!(derived.label, "deck-1");
        assert_eq!(derived.title, "SpaceVibe Deck");
        assert_eq!(derived.width, 1100.0);
        assert_eq!(derived.height, 720.0);
    }

    #[test]
    fn css_screen_coordinates_convert_to_physical_by_multiplying_the_scale() {
        // Anchored on the §6 spike: innerPosition was physical (820, 226) at
        // scaleFactor 2, which is CSS (410, 113). Dividing instead of
        // multiplying — or converting before picking the monitor — silently
        // places the window on the wrong display.
        assert_eq!(super::physical_from_css(410.0, 2.0), 820.0);
        assert_eq!(super::physical_from_css(113.0, 2.0), 226.0);
        assert_eq!(super::physical_from_css(410.0, 1.0), 410.0);
        assert_eq!(super::physical_from_css(-227.0, 2.0), -454.0);
    }

    #[test]
    fn open_pane_window_args_deserialize_camel_case_with_optional_coordinates() {
        let with_point: super::OpenPaneWindowArgs = serde_json::from_value(serde_json::json!({
            "token": "token-abc",
            "screenX": 410.0,
            "screenY": 113.0
        }))
        .unwrap();
        assert_eq!(with_point.token, "token-abc");
        assert_eq!(with_point.screen_x, Some(410.0));
        assert_eq!(with_point.screen_y, Some(113.0));

        // The menu-command path sends no point and must still parse.
        let without_point: super::OpenPaneWindowArgs =
            serde_json::from_value(serde_json::json!({ "token": "token-abc" })).unwrap();
        assert_eq!(without_point.screen_x, None);
    }

    #[test]
    fn the_shipped_capability_covers_generated_window_labels() {
        let raw = include_str!("../capabilities/default.json");
        let capability: serde_json::Value = serde_json::from_str(raw).unwrap();
        let windows = capability["windows"].as_array().unwrap();
        let patterns: Vec<&str> = windows.iter().map(|w| w.as_str().unwrap()).collect();

        assert!(
            patterns.contains(&"main"),
            "the configured window lost its capability"
        );
        assert!(
            patterns.contains(&"deck-*"),
            "detached windows would boot with no IPC access at all"
        );
        assert_eq!(format!("{DECK_LABEL_PREFIX}1"), "deck-1");
    }
}
