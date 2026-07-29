use std::{collections::HashMap, sync::Mutex};
use tauri::{AppHandle, Emitter, State};

/// App-level pane → window ownership (ADR docs/decisions/0001).
/// Routes PTY output/exit to the owning webview only.
#[derive(Default)]
pub struct WindowCoordinator {
    /// pane-id (PTY id) → webview window label
    owners: Mutex<HashMap<u32, String>>,
}

impl WindowCoordinator {
    pub fn register(&self, pane_id: u32, window_label: String) {
        if let Ok(mut owners) = self.owners.lock() {
            owners.insert(pane_id, window_label);
        }
    }

    pub fn unregister(&self, pane_id: u32) {
        if let Ok(mut owners) = self.owners.lock() {
            owners.remove(&pane_id);
        }
    }

    pub fn owner(&self, pane_id: u32) -> Option<String> {
        self.owners
            .lock()
            .ok()
            .and_then(|owners| owners.get(&pane_id).cloned())
    }

    /// Reassign ownership without touching the PTY (Move to window).
    pub fn move_ownership(&self, pane_id: u32, window_label: String) -> bool {
        let Ok(mut owners) = self.owners.lock() else {
            return false;
        };
        if !owners.contains_key(&pane_id) {
            return false;
        }
        owners.insert(pane_id, window_label);
        true
    }

    /// Pane ids still owned by this window (for close-window dispose).
    #[allow(dead_code)] // used when multi-window close lands
    pub fn panes_for_window(&self, window_label: &str) -> Vec<u32> {
        let Ok(owners) = self.owners.lock() else {
            return Vec::new();
        };
        owners
            .iter()
            .filter(|(_, label)| label.as_str() == window_label)
            .map(|(&id, _)| id)
            .collect()
    }
}

/// Emit a PTY event to the owning window; fall back to broadcast if unregistered
/// (should not happen after spawn registers — keeps single-window brownfield safe).
pub fn emit_to_owner<S: serde::Serialize + Clone>(
    app: &AppHandle,
    coordinator: &WindowCoordinator,
    pane_id: u32,
    event: &str,
    payload: S,
) {
    if let Some(label) = coordinator.owner(pane_id) {
        let _ = app.emit_to(label, event, payload);
    } else {
        let _ = app.emit(event, payload);
    }
}

#[tauri::command]
pub fn move_pane_ownership(
    coordinator: State<'_, WindowCoordinator>,
    pane_id: u32,
    window_label: String,
) -> Result<(), String> {
    if coordinator.move_ownership(pane_id, window_label) {
        Ok(())
    } else {
        Err(format!("Pane #{pane_id} is not registered"))
    }
}

#[cfg(test)]
mod tests {
    use super::WindowCoordinator;

    #[test]
    fn register_and_owner() {
        let c = WindowCoordinator::default();
        c.register(1, "main".into());
        assert_eq!(c.owner(1).as_deref(), Some("main"));
        assert_eq!(c.owner(2), None);
    }

    #[test]
    fn move_ownership_updates_label() {
        let c = WindowCoordinator::default();
        c.register(1, "a".into());
        assert!(c.move_ownership(1, "b".into()));
        assert_eq!(c.owner(1).as_deref(), Some("b"));
        assert!(!c.move_ownership(99, "b".into()));
    }

    #[test]
    fn unregister_clears() {
        let c = WindowCoordinator::default();
        c.register(1, "main".into());
        c.unregister(1);
        assert_eq!(c.owner(1), None);
    }

    #[test]
    fn panes_for_window_filters() {
        let c = WindowCoordinator::default();
        c.register(1, "a".into());
        c.register(2, "b".into());
        c.register(3, "a".into());
        let mut panes = c.panes_for_window("a");
        panes.sort();
        assert_eq!(panes, vec![1, 3]);
    }
}
