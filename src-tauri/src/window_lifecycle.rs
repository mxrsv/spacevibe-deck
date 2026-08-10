//! Per-window state that is keyed by window label and must outlive any single
//! webview: label allocation, most-recently-focused order, and the pending
//! adoption a freshly created window reads at boot (spec §9.1, §9.2).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State};

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
}
