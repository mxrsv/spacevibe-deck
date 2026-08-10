use std::{collections::HashMap, sync::Mutex, time::Instant};
// `State` and `WebviewWindow` come back in A6 with the commands; importing
// them now would be an unused_imports warning across A1-A5.
use tauri::{AppHandle, Emitter};

/// One PTY event held back while its pane is mid-transfer.
#[derive(Clone, Debug, PartialEq)]
pub struct BufferedEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

/// Where a pane's output goes right now.
enum PaneRoute {
    /// Steady state — delivered to this window label.
    Owned(String),
    /// A transfer is open; output is buffered, not delivered (§7.2).
    Transferring(Transfer),
}

/// An open transfer. The spec sketches this as inline enum fields; a named
/// struct keeps every lookup helper returning `&mut Transfer` instead of
/// re-destructuring the variant at each call site.
struct Transfer {
    /// Window the pane is leaving.
    from: String,
    /// Window that claimed it. `None` until `claim_transfer`.
    to: Option<String>,
    /// Window a pending adoption was registered for, before it claims. Lets a
    /// destination that dies before `claim` still abort the transfer (§7.6).
    reserved_to: Option<String>,
    token: String,
    buffered: Vec<BufferedEvent>,
    buffered_bytes: usize,
    /// The PTY exited mid-transfer. The route entry must outlive that so the
    /// buffered exit event still reaches the destination (§7.6).
    exited: bool,
    started: Instant,
}

/// Where the coordinator emits. Production is `AppSink`; tests record, which is
/// the only way to assert delivery order — `AppHandle` cannot be constructed in
/// a unit test.
pub trait EventSink {
    fn emit(&self, label: &str, event: &str, payload: &serde_json::Value);
}

pub struct AppSink<'a>(pub &'a AppHandle);

impl EventSink for AppSink<'_> {
    fn emit(&self, label: &str, event: &str, payload: &serde_json::Value) {
        let _ = self.0.emit_to(label.to_string(), event, payload);
    }
}

/// Everything the coordinator guards, behind ONE mutex. Routes and settled
/// tokens must move together: a commit changes both, and a reader that saw one
/// without the other would answer wrongly.
#[derive(Default)]
struct CoordinatorState {
    routes: HashMap<u32, PaneRoute>,
}

/// App-level pane → window routing. Routes PTY output/exit to the owning
/// webview only, and holds output still across a pane transfer (§7).
#[derive(Default)]
pub struct WindowCoordinator {
    state: Mutex<CoordinatorState>,
}

impl WindowCoordinator {
    pub fn register(&self, pane_id: u32, window_label: String) {
        if let Ok(mut state) = self.state.lock() {
            state.routes.insert(pane_id, PaneRoute::Owned(window_label));
        }
    }

    pub fn unregister(&self, pane_id: u32) {
        if let Ok(mut state) = self.state.lock() {
            state.routes.remove(&pane_id);
        }
    }

    /// The owning window, or `None` while a transfer is open — a transferring
    /// pane has no owner, and saying otherwise would let a caller act on it.
    #[allow(dead_code)] // window lifecycle census (§9.4)
    pub fn owner(&self, pane_id: u32) -> Option<String> {
        let state = self.state.lock().ok()?;
        match state.routes.get(&pane_id) {
            Some(PaneRoute::Owned(label)) => Some(label.clone()),
            Some(PaneRoute::Transferring(_)) | None => None,
        }
    }

    /// Pane ids still owned by this window (for close-window dispose).
    #[allow(dead_code)] // used when multi-window close lands
    pub fn panes_for_window(&self, window_label: &str) -> Vec<u32> {
        let Ok(state) = self.state.lock() else {
            return Vec::new();
        };
        state
            .routes
            .iter()
            .filter_map(|(id, route)| match route {
                PaneRoute::Owned(label) if label == window_label => Some(*id),
                _ => None,
            })
            .collect()
    }

    /// Route one PTY event under a SINGLE lock (§7.2). Emission happens while
    /// the lock is held, so a chunk read during a commit cannot overtake the
    /// flush that commit performs.
    pub fn deliver(
        &self,
        sink: &dyn EventSink,
        pane_id: u32,
        event: &str,
        payload: serde_json::Value,
        _now: Instant,
    ) {
        let Ok(mut state) = self.state.lock() else {
            eprintln!("Deck: route lock poisoned, dropping {event} for pane {pane_id}");
            return;
        };
        match state.routes.get_mut(&pane_id) {
            Some(PaneRoute::Owned(label)) => sink.emit(label, event, &payload),
            Some(PaneRoute::Transferring(transfer)) => {
                transfer.buffered.push(BufferedEvent {
                    event: event.to_string(),
                    payload,
                });
            }
            // No broadcast fallback: sending one window's terminal output to
            // every window is a data leak, not a safety net (§7.2).
            None => eprintln!("Deck: no route for pane {pane_id}, dropping {event}"),
        }
    }
}

/// Emit a PTY event to the pane's current route.
pub fn emit_to_owner<S: serde::Serialize + Clone>(
    app: &AppHandle,
    coordinator: &WindowCoordinator,
    pane_id: u32,
    event: &str,
    payload: S,
) {
    let value = match serde_json::to_value(payload) {
        Ok(value) => value,
        Err(error) => {
            eprintln!("Deck: cannot serialize {event} for pane {pane_id}: {error}");
            return;
        }
    };
    coordinator.deliver(&AppSink(app), pane_id, event, value, Instant::now());
}

/// Test double shared across the crate.
///
/// **This is `pub(crate)` on purpose — do not "clean up" an apparently unused
/// visibility.** The window-lifecycle tests live in other modules and drive the
/// coordinator through `&dyn EventSink` as well (their census test passes one
/// to `begin_transfer`), so a private double here would force a duplicate over
/// there. The path other modules import is
/// `crate::coordinator::test_support::RecordingSink`.
#[cfg(test)]
pub(crate) mod test_support {
    use super::EventSink;
    use std::sync::Mutex;

    /// Records what the coordinator emitted, in emission order. Stands in for
    /// `AppSink`, which needs an `AppHandle` no unit test can build.
    #[derive(Default)]
    pub(crate) struct RecordingSink {
        emitted: Mutex<Vec<(String, String, serde_json::Value)>>,
    }

    impl EventSink for RecordingSink {
        fn emit(&self, label: &str, event: &str, payload: &serde_json::Value) {
            self.emitted.lock().expect("recording sink lock").push((
                label.to_string(),
                event.to_string(),
                payload.clone(),
            ));
        }
    }

    impl RecordingSink {
        /// `(label, data)` for PTY output only, in order. Filtered on purpose:
        /// `transfer:settled` shares this stream from Task A3 onward, and an
        /// unfiltered view would make every ordering assertion here depend on
        /// a payload shape it is not testing.
        pub(crate) fn delivered(&self) -> Vec<(String, String)> {
            self.emitted
                .lock()
                .expect("recording sink lock")
                .iter()
                .filter(|(_, event, _)| event == "pty:output")
                .map(|(label, _, payload)| {
                    (
                        label.clone(),
                        payload["data"].as_str().unwrap_or_default().to_string(),
                    )
                })
                .collect()
        }

        /// `(label, event)` for every emission, in order — the unfiltered view.
        pub(crate) fn events(&self) -> Vec<(String, String)> {
            self.emitted
                .lock()
                .expect("recording sink lock")
                .iter()
                .map(|(label, event, _)| (label.clone(), event.clone()))
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::RecordingSink;
    use super::WindowCoordinator;
    use std::time::Instant;

    /// Local to this module: the shared double is `RecordingSink`, not the
    /// payload builders. Another module testing its own concern builds its own.
    fn output(data: &str) -> serde_json::Value {
        serde_json::json!({ "id": 1, "data": data })
    }

    #[test]
    fn owned_route_delivers_to_the_owning_window_only() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        coordinator.register(1, "main".into());
        coordinator.register(2, "deck-1".into());

        coordinator.deliver(&sink, 1, "pty:output", output("hello"), Instant::now());

        assert_eq!(
            sink.delivered(),
            vec![("main".to_string(), "hello".to_string())]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
    }

    #[test]
    fn an_unrouted_pane_drops_the_chunk_instead_of_broadcasting() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();

        coordinator.deliver(&sink, 7, "pty:output", output("secret"), Instant::now());

        assert!(
            sink.delivered().is_empty(),
            "output for an unrouted pane must be dropped, never broadcast"
        );
    }

    #[test]
    fn unregister_clears_an_owned_route() {
        let coordinator = WindowCoordinator::default();
        coordinator.register(1, "main".into());
        coordinator.unregister(1);
        assert_eq!(coordinator.owner(1), None);
    }

    #[test]
    fn panes_for_window_filters() {
        let coordinator = WindowCoordinator::default();
        coordinator.register(1, "a".into());
        coordinator.register(2, "b".into());
        coordinator.register(3, "a".into());
        let mut panes = coordinator.panes_for_window("a");
        panes.sort();
        assert_eq!(panes, vec![1, 3]);
    }
}
