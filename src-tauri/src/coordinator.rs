use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
// `State` and `WebviewWindow` come back in A6 with the commands; importing
// them now would be an unused_imports warning across A1-A5.
use tauri::{AppHandle, Emitter};

/// One PTY event held back while its pane is mid-transfer.
#[derive(Clone, Debug, PartialEq)]
pub struct BufferedEvent {
    pub event: String,
    pub payload: serde_json::Value,
}

/// What moves with a pane (§10.2). Serialized to the destination window;
/// deserialized from the source when it stages. camelCase over the wire, as in
/// `links.rs` and `prompt_assets.rs`.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptionPayload {
    pub pane_id: u32,
    pub cwd: Option<String>,
    pub agent_id: Option<String>,
    pub scrollback: String,
    pub cols: u16,
    pub rows: u16,
    pub tab_name: Option<String>,
    pub dot_color: Option<String>,
    pub workspace_path: Option<String>,
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
    /// Adoption payload put up by the source between `prepare` and `claim`.
    staged: Option<AdoptionPayload>,
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

pub const EVENT_TRANSFER_SETTLED: &str = "transfer:settled";

/// A transfer that has not committed by this point is abandoned back to its
/// source (§7.5). Enforced lazily on every coordinator entry point rather than
/// by a timer thread, so there is no wakeup to schedule and no thread to leak.
pub const TRANSFER_TIMEOUT: Duration = Duration::from_secs(10);

/// Ceiling on what one transfer may hold back (§7.5). Past it, the move is
/// abandoned and everything buffered goes to the source — losing the move is
/// recoverable, losing output is not.
pub const BUFFER_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Serialized size of one buffered event. Only ever called while a transfer is
/// open, i.e. for tens of milliseconds per move.
fn estimate_bytes(payload: &serde_json::Value) -> usize {
    serde_json::to_vec(payload)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
}

/// How many finished tokens stay answerable. A retry arrives within one
/// transfer window, so a small ring is enough — and it stops a long session
/// from accumulating one entry per move forever.
const SETTLED_TOKENS_MAX: usize = 64;

/// Why a transfer ended anywhere other than a commit. Rides `transfer:settled`
/// so a caller can tell a destination that refused from one that never
/// answered — §13 makes the source act differently on each, and after
/// `stage_transfer` it has no other signal.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbortReason {
    /// A window called `abort_transfer` — the destination refused the pane, or
    /// the source changed its mind.
    Requested,
    /// No commit within `TRANSFER_TIMEOUT` (§7.5).
    TimedOut,
    /// The held-back output passed `BUFFER_MAX_BYTES` (§7.5).
    BufferFull,
    /// A window the transfer depends on was destroyed or is closing (§7.6).
    WindowGone,
}

impl AbortReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Requested => "requested",
            Self::TimedOut => "timedOut",
            Self::BufferFull => "bufferFull",
            Self::WindowGone => "windowGone",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Settled {
    Committed,
    Aborted(AbortReason),
}

/// Everything the coordinator guards, behind ONE mutex. Routes and settled
/// tokens must move together: a commit changes both, and a reader that saw one
/// without the other would answer wrongly.
#[derive(Default)]
struct CoordinatorState {
    routes: HashMap<u32, PaneRoute>,
    settled: HashMap<String, Settled>,
    settled_order: VecDeque<String>,
}

/// The open transfer carrying `token`, with the pane it belongs to.
fn transfer_mut<'a>(
    routes: &'a mut HashMap<u32, PaneRoute>,
    token: &str,
) -> Option<(u32, &'a mut Transfer)> {
    routes.iter_mut().find_map(|(id, route)| match route {
        PaneRoute::Transferring(transfer) if transfer.token == token => Some((*id, transfer)),
        _ => None,
    })
}

/// Close a transfer under the lock: flush every buffered event to `label` in
/// append order, then hand the route over. Emission happens INSIDE the caller's
/// lock, so a chunk read after the flush cannot overtake it (§7.3).
fn settle(
    state: &mut CoordinatorState,
    sink: &dyn EventSink,
    pane_id: u32,
    label: &str,
    outcome: Settled,
) {
    let Some(PaneRoute::Transferring(transfer)) = state.routes.remove(&pane_id) else {
        return;
    };
    for buffered in &transfer.buffered {
        sink.emit(label, &buffered.event, &buffered.payload);
    }
    announce_settled(sink, &transfer, outcome);
    // A PTY that exited mid-transfer deferred its unregister so the buffered
    // exit above could still be delivered. Now honour it, rather than writing
    // an owned route for a pane that no longer exists.
    if !transfer.exited {
        state
            .routes
            .insert(pane_id, PaneRoute::Owned(label.to_string()));
    }
    remember_settled(state, transfer.token, outcome);
}

/// Abandon every transfer that outlived `TRANSFER_TIMEOUT`, returning each
/// pane to its source. Runs inside the caller's lock.
fn sweep_locked(state: &mut CoordinatorState, sink: &dyn EventSink, now: Instant) {
    let expired: Vec<(u32, String)> = state
        .routes
        .iter()
        .filter_map(|(id, route)| match route {
            PaneRoute::Transferring(transfer)
                if now.saturating_duration_since(transfer.started) >= TRANSFER_TIMEOUT =>
            {
                Some((*id, transfer.from.clone()))
            }
            _ => None,
        })
        .collect();
    for (pane_id, source) in expired {
        eprintln!("Deck: transfer for pane {pane_id} timed out, returning it to window {source}");
        settle(
            state,
            sink,
            pane_id,
            &source,
            Settled::Aborted(AbortReason::TimedOut),
        );
    }
}

/// Tell both ends how the transfer ended. Emitted after the flush, so a
/// destination has every buffered byte before it learns the pane is its own,
/// and inside the caller's lock, so nothing can settle twice.
///
/// A label whose window is already gone still gets the emit: `AppSink` throws
/// the result away, exactly as it does for any other event aimed at a dead
/// window. Filtering here would mean tracking window liveness for no gain.
fn announce_settled(sink: &dyn EventSink, transfer: &Transfer, outcome: Settled) {
    let payload = match outcome {
        Settled::Committed => serde_json::json!({
            "token": transfer.token,
            "outcome": "committed",
        }),
        Settled::Aborted(reason) => serde_json::json!({
            "token": transfer.token,
            "outcome": "aborted",
            "reason": reason.as_str(),
        }),
    };
    sink.emit(&transfer.from, EVENT_TRANSFER_SETTLED, &payload);
    // Whoever claimed, or — when nobody did — whoever a window was opened for.
    // A boot-adopt window that died before claiming is the case §13 cares
    // about: it must learn the transfer is over rather than wait out the
    // timeout.
    let other = transfer.to.as_deref().or(transfer.reserved_to.as_deref());
    if let Some(label) = other.filter(|label| *label != transfer.from) {
        sink.emit(label, EVENT_TRANSFER_SETTLED, &payload);
    }
}

fn remember_settled(state: &mut CoordinatorState, token: String, outcome: Settled) {
    if state.settled.insert(token.clone(), outcome).is_none() {
        state.settled_order.push_back(token);
    }
    while state.settled_order.len() > SETTLED_TOKENS_MAX {
        if let Some(oldest) = state.settled_order.pop_front() {
            state.settled.remove(&oldest);
        }
    }
}

/// App-level pane → window routing. Routes PTY output/exit to the owning
/// webview only, and holds output still across a pane transfer (§7).
#[derive(Default)]
pub struct WindowCoordinator {
    state: Mutex<CoordinatorState>,
    /// Monotonic within a process run; a token is never reused, which is what
    /// makes `commit`/`abort` idempotent (§7.6).
    next_token: AtomicU64,
}

impl WindowCoordinator {
    pub fn register(&self, pane_id: u32, window_label: String) {
        if let Ok(mut state) = self.state.lock() {
            state.routes.insert(pane_id, PaneRoute::Owned(window_label));
        }
    }

    pub fn unregister(&self, pane_id: u32) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        match state.routes.get_mut(&pane_id) {
            // Mid-transfer the entry must outlive the PTY: it holds the exit
            // event the destination is owed on commit (§7.6). `settle` drops
            // the route instead of re-owning it.
            Some(PaneRoute::Transferring(transfer)) => transfer.exited = true,
            Some(PaneRoute::Owned(_)) | None => {
                state.routes.remove(&pane_id);
            }
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
        now: Instant,
    ) {
        let Ok(mut state) = self.state.lock() else {
            eprintln!("Deck: route lock poisoned, dropping {event} for pane {pane_id}");
            return;
        };
        sweep_locked(&mut state, sink, now);
        let mut overflowed: Option<(u32, String)> = None;
        match state.routes.get_mut(&pane_id) {
            Some(PaneRoute::Owned(label)) => sink.emit(label, event, &payload),
            Some(PaneRoute::Transferring(transfer)) => {
                transfer.buffered_bytes = transfer
                    .buffered_bytes
                    .saturating_add(estimate_bytes(&payload));
                transfer.buffered.push(BufferedEvent {
                    event: event.to_string(),
                    payload,
                });
                if transfer.buffered_bytes > BUFFER_MAX_BYTES {
                    overflowed = Some((pane_id, transfer.from.clone()));
                }
            }
            // No broadcast fallback: sending one window's terminal output to
            // every window is a data leak, not a safety net (§7.2).
            None => eprintln!("Deck: no route for pane {pane_id}, dropping {event}"),
        }
        // Settled after the match, not inside it: the arm holds a mutable
        // borrow of `state.routes`. The overflowing chunk was already pushed,
        // so the flush carries it too.
        if let Some((pane_id, source)) = overflowed {
            eprintln!(
                "Deck: transfer buffer for pane {pane_id} passed {BUFFER_MAX_BYTES} bytes, returning it to window {source}"
            );
            settle(
                &mut state,
                sink,
                pane_id,
                &source,
                Settled::Aborted(AbortReason::BufferFull),
            );
        }
    }

    /// Enforce the transfer timeout. Called by the PTY commands as well as the
    /// transfer commands: mid-transfer `write_pty` is rejected, so a pane whose
    /// destination died produces no output and would otherwise never be swept.
    pub fn sweep(&self, sink: &dyn EventSink, now: Instant) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        sweep_locked(&mut state, sink, now);
    }

    /// Open a transfer for a pane this window owns (§7.3 `prepare_transfer`).
    /// Output starts buffering the moment this returns.
    pub fn begin_transfer(
        &self,
        sink: &dyn EventSink,
        from: &str,
        pane_id: u32,
        now: Instant,
    ) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        // Before the route match, so a pane whose previous transfer expired can
        // start a new one.
        sweep_locked(&mut state, sink, now);
        match state.routes.get(&pane_id) {
            Some(PaneRoute::Owned(label)) if label == from => {}
            Some(PaneRoute::Owned(label)) => {
                return Err(format!("Pane #{pane_id} is owned by window {label}"))
            }
            Some(PaneRoute::Transferring(_)) => {
                return Err(format!("Pane #{pane_id} is already being transferred"))
            }
            None => return Err(format!("Pane #{pane_id} is not registered")),
        }
        let token = format!(
            "xfer-{}",
            self.next_token.fetch_add(1, Ordering::Relaxed) + 1
        );
        state.routes.insert(
            pane_id,
            PaneRoute::Transferring(Transfer {
                from: from.to_string(),
                to: None,
                reserved_to: None,
                token: token.clone(),
                staged: None,
                buffered: Vec::new(),
                buffered_bytes: 0,
                exited: false,
                started: now,
            }),
        );
        Ok(token)
    }

    /// The source puts up the adoption payload it serialized after `prepare`
    /// quiesced the stream (§7.4). Separate from `prepare` because the payload
    /// does not exist yet when `prepare` returns.
    pub fn stage_payload(
        &self,
        sink: &dyn EventSink,
        token: &str,
        caller: &str,
        payload: AdoptionPayload,
        now: Instant,
    ) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        sweep_locked(&mut state, sink, now);
        let Some((_, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        if transfer.from != caller {
            return Err(format!(
                "Transfer {token} can only be staged by window {}",
                transfer.from
            ));
        }
        if transfer.staged.is_some() {
            return Err(format!("Transfer {token} already carries a payload"));
        }
        transfer.staged = Some(payload);
        Ok(())
    }

    /// The destination takes the payload and records itself as the receiver.
    pub fn claim(
        &self,
        sink: &dyn EventSink,
        token: &str,
        caller: &str,
        now: Instant,
    ) -> Result<AdoptionPayload, String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        sweep_locked(&mut state, sink, now);
        let Some((_, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        if transfer.to.is_some() {
            return Err(format!("Transfer {token} was already claimed"));
        }
        let Some(payload) = transfer.staged.clone() else {
            return Err(format!("Transfer {token} has no staged payload"));
        };
        transfer.to = Some(caller.to_string());
        Ok(payload)
    }

    /// Name the window a pending adoption was opened for, before it claims.
    /// The window-lifecycle section calls this from `open_pane_window` so that
    /// a destination dying before `claim` still aborts the transfer (§7.6).
    #[allow(dead_code)] // wired by the window lifecycle section
    pub fn reserve_destination(&self, token: &str, label: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        let Some((_, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        transfer.reserved_to = Some(label.to_string());
        Ok(())
    }

    /// Hand the pane to the window that claimed it, flushing what buffered.
    pub fn commit(
        &self,
        sink: &dyn EventSink,
        token: &str,
        caller: &str,
        now: Instant,
    ) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        sweep_locked(&mut state, sink, now);
        if let Some(settled) = state.settled.get(token).copied() {
            return match settled {
                Settled::Committed => Ok(()),
                Settled::Aborted(_) => Err(format!("Transfer {token} was aborted")),
            };
        }
        let Some((pane_id, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        if transfer.to.as_deref() != Some(caller) {
            return Err(format!(
                "Transfer {token} can only be committed by the window that claimed it"
            ));
        }
        let destination = caller.to_string();
        settle(&mut state, sink, pane_id, &destination, Settled::Committed);
        Ok(())
    }

    /// Return the pane to its source, flushing what buffered. Any caller may
    /// abort: abort never moves a pane anywhere it was not already, so there is
    /// nothing to guard, and a destination that failed before it claimed still
    /// needs to release the pane.
    pub fn abort(&self, sink: &dyn EventSink, token: &str, now: Instant) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|error| error.to_string())?;
        sweep_locked(&mut state, sink, now);
        if let Some(settled) = state.settled.get(token).copied() {
            return match settled {
                Settled::Aborted(_) => Ok(()),
                Settled::Committed => Err(format!("Transfer {token} was already committed")),
            };
        }
        let Some((pane_id, transfer)) = transfer_mut(&mut state.routes, token) else {
            return Err(format!("Transfer {token} is not open"));
        };
        let source = transfer.from.clone();
        settle(
            &mut state,
            sink,
            pane_id,
            &source,
            Settled::Aborted(AbortReason::Requested),
        );
        Ok(())
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

        /// `(label, payload)` for every `transfer:settled`, in order.
        pub(crate) fn settled(&self) -> Vec<(String, serde_json::Value)> {
            self.emitted
                .lock()
                .expect("recording sink lock")
                .iter()
                .filter(|(_, event, _)| event == "transfer:settled")
                .map(|(label, _, payload)| (label.clone(), payload.clone()))
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

    use super::AdoptionPayload;

    fn payload(pane_id: u32) -> AdoptionPayload {
        AdoptionPayload {
            pane_id,
            cwd: Some("/tmp".into()),
            agent_id: Some("claude".into()),
            scrollback: "scrollback".into(),
            cols: 80,
            rows: 24,
            tab_name: Some("agent".into()),
            dot_color: Some("--cyan".into()),
            workspace_path: Some("/tmp/work".into()),
        }
    }

    #[test]
    fn prepare_buffers_output_and_only_the_owner_may_start_it() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());

        assert_eq!(
            coordinator.begin_transfer(&sink, "deck-1", 1, now),
            Err("Pane #1 is owned by window main".into())
        );
        assert_eq!(
            coordinator.begin_transfer(&sink, "main", 9, now),
            Err("Pane #9 is not registered".into())
        );

        let token = coordinator
            .begin_transfer(&sink, "main", 1, now)
            .expect("owner may start a transfer");
        coordinator.deliver(&sink, 1, "pty:output", output("held"), now);

        assert!(
            sink.delivered().is_empty(),
            "output must buffer once a transfer is open"
        );
        assert_eq!(coordinator.owner(1), None);
        assert!(token.starts_with("xfer-"));
    }

    #[test]
    fn a_second_prepare_for_the_same_pane_is_rejected() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        assert_eq!(
            coordinator.begin_transfer(&sink, "main", 1, now),
            Err("Pane #1 is already being transferred".into())
        );
    }

    #[test]
    fn staging_requires_the_source_window_and_happens_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        assert_eq!(
            coordinator.stage_payload(&sink, &token, "deck-1", payload(1), now),
            Err(format!(
                "Transfer {token} can only be staged by window main"
            ))
        );
        assert_eq!(
            coordinator.stage_payload(&sink, "xfer-999", "main", payload(1), now),
            Err("Transfer xfer-999 is not open".into())
        );
        assert_eq!(
            coordinator.stage_payload(&sink, &token, "main", payload(1), now),
            Ok(())
        );
        assert_eq!(
            coordinator.stage_payload(&sink, &token, "main", payload(1), now),
            Err(format!("Transfer {token} already carries a payload"))
        );
    }

    #[test]
    fn claim_needs_a_staged_payload_and_succeeds_only_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        assert_eq!(
            coordinator.claim(&sink, &token, "deck-1", now),
            Err(format!("Transfer {token} has no staged payload"))
        );
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        assert_eq!(
            coordinator.claim(&sink, &token, "deck-1", now),
            Ok(payload(1))
        );
        assert_eq!(
            coordinator.claim(&sink, &token, "deck-2", now),
            Err(format!("Transfer {token} was already claimed"))
        );
        assert_eq!(
            coordinator.claim(&sink, "xfer-999", "deck-1", now),
            Err("Transfer xfer-999 is not open".into())
        );
    }

    #[test]
    fn adoption_payload_serializes_camel_case() {
        let json = serde_json::to_value(payload(4)).expect("serialize");
        assert_eq!(json["paneId"], 4);
        assert_eq!(json["agentId"], "claude");
        assert_eq!(json["tabName"], "agent");
        assert_eq!(json["dotColor"], "--cyan");
        assert_eq!(json["workspacePath"], "/tmp/work");
    }

    #[test]
    fn commit_flushes_in_read_order_and_delivers_each_chunk_exactly_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.deliver(&sink, 1, "pty:output", output("before"), now);

        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("a"), now);
        coordinator.deliver(&sink, 1, "pty:output", output("b"), now);
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("c"), now);
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("after"), now);

        assert_eq!(
            sink.delivered(),
            vec![
                ("main".to_string(), "before".to_string()),
                ("deck-1".to_string(), "a".to_string()),
                ("deck-1".to_string(), "b".to_string()),
                ("deck-1".to_string(), "c".to_string()),
                ("deck-1".to_string(), "after".to_string()),
            ]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("deck-1"));
    }

    #[test]
    fn only_the_claiming_window_may_commit() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();

        assert_eq!(
            coordinator.commit(&sink, &token, "deck-1", now),
            Err(format!(
                "Transfer {token} can only be committed by the window that claimed it"
            ))
        );
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        assert_eq!(
            coordinator.commit(&sink, &token, "deck-2", now),
            Err(format!(
                "Transfer {token} can only be committed by the window that claimed it"
            ))
        );
    }

    #[test]
    fn abort_returns_the_pane_and_its_buffer_to_the_source() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("a"), now);
        coordinator.deliver(&sink, 1, "pty:output", output("b"), now);

        coordinator.abort(&sink, &token, now).unwrap();

        assert_eq!(
            sink.delivered(),
            vec![
                ("main".to_string(), "a".to_string()),
                ("main".to_string(), "b".to_string()),
            ]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
    }

    #[test]
    fn a_retried_command_is_idempotent_through_its_token() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("a"), now);
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        // A committed token replies success, not a second commit — no second
        // flush of the same chunk.
        assert_eq!(coordinator.commit(&sink, &token, "deck-1", now), Ok(()));
        assert_eq!(
            sink.delivered(),
            vec![("deck-1".to_string(), "a".to_string())]
        );
        assert_eq!(
            coordinator.abort(&sink, &token, now),
            Err(format!("Transfer {token} was already committed"))
        );

        let second = coordinator.begin_transfer(&sink, "deck-1", 1, now).unwrap();
        coordinator.abort(&sink, &second, now).unwrap();
        assert_eq!(coordinator.abort(&sink, &second, now), Ok(()));
        assert_eq!(
            coordinator.commit(&sink, &second, "deck-1", now),
            Err(format!("Transfer {second} was aborted"))
        );
    }

    /// The one test that exercises the claim the whole design rests on. Every
    /// other test here is single-threaded, so it proves the state machine but
    /// says nothing about whether the mutex actually orders a real PTY emitter
    /// thread against a commit — which is the exact race §7.1 exists to close.
    ///
    /// The assertions hold for EVERY interleaving, so this is deterministic
    /// despite the thread: the chunk sequence is dense and strictly increasing
    /// (nothing lost, duplicated or reordered), and not one chunk reaches the
    /// source. What it cannot do is force the worst interleaving; it makes the
    /// race reachable, it does not prove it was reached. Run it under
    /// `--test-threads=1` on a loaded machine if it ever needs to bite harder.
    #[test]
    fn a_concurrent_reader_cannot_overtake_or_straddle_a_commit() {
        use std::sync::atomic::{AtomicBool, AtomicU32, Ordering as AtomicOrdering};
        use std::sync::Arc;

        let coordinator = Arc::new(WindowCoordinator::default());
        let sink = Arc::new(RecordingSink::default());
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&*sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&*sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&*sink, &token, "deck-1", now).unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let sent = Arc::new(AtomicU32::new(0));
        let reader = {
            let (coordinator, sink, stop, sent) = (
                Arc::clone(&coordinator),
                Arc::clone(&sink),
                Arc::clone(&stop),
                Arc::clone(&sent),
            );
            std::thread::spawn(move || {
                // Stands in for the PTY emitter thread in `spawn_shell`.
                while !stop.load(AtomicOrdering::Relaxed) {
                    let n = sent.load(AtomicOrdering::Relaxed);
                    coordinator.deliver(
                        &*sink,
                        1,
                        "pty:output",
                        output(&n.to_string()),
                        Instant::now(),
                    );
                    sent.store(n + 1, AtomicOrdering::Release);
                }
            })
        };

        // Let the reader get well ahead, so the commit lands mid-stream rather
        // than before the first chunk.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while sent.load(AtomicOrdering::Acquire) < 200 {
            assert!(
                std::time::Instant::now() < deadline,
                "the reader thread never ran"
            );
            std::thread::yield_now();
        }
        coordinator.commit(&*sink, &token, "deck-1", now).unwrap();
        // Keep it running past the commit so post-commit delivery interleaves
        // with the flush that just happened.
        let after_commit = sent.load(AtomicOrdering::Acquire) + 200;
        while sent.load(AtomicOrdering::Acquire) < after_commit {
            assert!(
                std::time::Instant::now() < deadline,
                "the reader thread stalled after the commit"
            );
            std::thread::yield_now();
        }
        stop.store(true, AtomicOrdering::Relaxed);
        reader.join().expect("reader thread");

        let delivered = sink.delivered();
        let expected: Vec<String> = (0..delivered.len() as u32).map(|n| n.to_string()).collect();
        let seen: Vec<String> = delivered.iter().map(|(_, data)| data.clone()).collect();
        // Dense and strictly increasing: nothing dropped, nothing delivered
        // twice, nothing reordered across the commit.
        assert_eq!(seen, expected);
        assert!(delivered.len() >= 400, "the race window was never opened");
        // After the commit no chunk reaches the source — and the ones buffered
        // before it were flushed to the destination, so `main` sees none at all.
        assert!(
            delivered.iter().all(|(label, _)| label == "deck-1"),
            "a chunk reached a window that does not own the pane"
        );
    }

    #[test]
    fn both_ends_are_told_exactly_once_how_the_transfer_ended() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        assert_eq!(
            sink.settled(),
            vec![
                (
                    "main".to_string(),
                    serde_json::json!({ "token": token, "outcome": "committed" })
                ),
                (
                    "deck-1".to_string(),
                    serde_json::json!({ "token": token, "outcome": "committed" })
                ),
            ]
        );
        // The idempotent replay must not announce a second time.
        coordinator.commit(&sink, &token, "deck-1", now).unwrap();
        assert_eq!(sink.settled().len(), 2);
    }

    #[test]
    fn an_abort_names_a_reason_and_reaches_a_window_that_never_claimed() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        // A boot-adopt window exists but has not claimed yet. §13 needs it told
        // too, or it waits out the whole timeout for nothing.
        coordinator.reserve_destination(&token, "deck-1").unwrap();

        coordinator.abort(&sink, &token, now).unwrap();

        let expected = serde_json::json!({
            "token": token,
            "outcome": "aborted",
            "reason": "requested",
        });
        assert_eq!(
            sink.settled(),
            vec![
                ("main".to_string(), expected.clone()),
                ("deck-1".to_string(), expected),
            ]
        );
    }

    #[test]
    fn a_transfer_that_never_left_its_window_is_announced_once() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        coordinator.abort(&sink, &token, now).unwrap();

        // Nobody claimed and nothing was reserved, so `from` is the only end
        // there is — it must not be told twice.
        assert_eq!(sink.settled().len(), 1);
        assert_eq!(sink.settled()[0].0, "main");
    }

    #[test]
    fn a_pty_exit_mid_transfer_is_buffered_and_delivered_on_commit() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();
        coordinator
            .stage_payload(&sink, &token, "main", payload(1), now)
            .unwrap();
        coordinator.claim(&sink, &token, "deck-1", now).unwrap();

        // Exactly what the emitter thread does on EOF: emit the exit, then
        // unregister. The route entry must survive both.
        coordinator.deliver(&sink, 1, "pty:output", output("bye"), now);
        coordinator.deliver(&sink, 1, "pty:exit", serde_json::json!({ "id": 1 }), now);
        coordinator.unregister(1);

        coordinator.commit(&sink, &token, "deck-1", now).unwrap();

        assert_eq!(
            sink.events(),
            vec![
                ("deck-1".to_string(), "pty:output".to_string()),
                ("deck-1".to_string(), "pty:exit".to_string()),
                // Both ends learn the transfer landed, after the flush.
                ("main".to_string(), "transfer:settled".to_string()),
                ("deck-1".to_string(), "transfer:settled".to_string()),
            ]
        );
        // The pane is gone, so no dead route may be left behind.
        assert_eq!(coordinator.owner(1), None);
        assert!(coordinator.panes_for_window("deck-1").is_empty());
    }

    use super::{BUFFER_MAX_BYTES, TRANSFER_TIMEOUT};

    #[test]
    fn an_uncommitted_transfer_expires_back_to_the_source() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let start = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, start).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("held"), start);

        // One tick before the bound, nothing has changed.
        coordinator.sweep(
            &sink,
            start + TRANSFER_TIMEOUT - std::time::Duration::from_millis(1),
        );
        assert!(sink.delivered().is_empty());

        coordinator.sweep(&sink, start + TRANSFER_TIMEOUT);

        assert_eq!(
            sink.delivered(),
            vec![("main".to_string(), "held".to_string())]
        );
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
        assert_eq!(
            coordinator.claim(&sink, &token, "deck-1", start + TRANSFER_TIMEOUT),
            Err(format!("Transfer {token} is not open"))
        );
    }

    #[test]
    fn an_expired_transfer_is_swept_by_the_next_delivery() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let start = Instant::now();
        coordinator.register(1, "main".into());
        coordinator.begin_transfer(&sink, "main", 1, start).unwrap();
        coordinator.deliver(&sink, 1, "pty:output", output("held"), start);

        coordinator.deliver(
            &sink,
            1,
            "pty:output",
            output("later"),
            start + TRANSFER_TIMEOUT,
        );

        assert_eq!(
            sink.delivered(),
            vec![
                ("main".to_string(), "held".to_string()),
                ("main".to_string(), "later".to_string()),
            ]
        );
    }

    #[test]
    fn a_buffer_past_the_cap_aborts_back_to_the_source_keeping_every_chunk() {
        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        let now = Instant::now();
        coordinator.register(1, "main".into());
        let token = coordinator.begin_transfer(&sink, "main", 1, now).unwrap();

        let chunk = "x".repeat(BUFFER_MAX_BYTES / 2);
        coordinator.deliver(&sink, 1, "pty:output", output(&chunk), now);
        assert!(sink.delivered().is_empty(), "half the cap still buffers");
        coordinator.deliver(&sink, 1, "pty:output", output(&chunk), now);

        let delivered = sink.delivered();
        assert_eq!(delivered.len(), 2, "the overflowing chunk is flushed too");
        assert!(delivered.iter().all(|(label, _)| label == "main"));
        assert_eq!(coordinator.owner(1).as_deref(), Some("main"));
        assert_eq!(
            coordinator.commit(&sink, &token, "deck-1", now),
            Err(format!("Transfer {token} was aborted"))
        );
    }
}
