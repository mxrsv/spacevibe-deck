//! Closing one window without touching its peers (spec §9.5).

use crate::coordinator::{self, WindowCoordinator};
use crate::pane_census::census_for;
use crate::pty::PtyState;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

/// One outstanding close prompt per window. Per window, not global: closing two
/// windows at once is ordinary, and each guards only its own panes.
#[derive(Default)]
pub struct CloseFlight {
    pending: Mutex<HashMap<String, u64>>,
    next_id: AtomicU64,
}

impl CloseFlight {
    pub fn try_begin(&self, label: &str) -> Option<u64> {
        let mut pending = self.pending.lock().ok()?;
        if pending.contains_key(label) {
            return None;
        }
        let request_id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        pending.insert(label.to_string(), request_id);
        Some(request_id)
    }

    /// Consume the prompt. False for a stale id, so a reply belonging to an
    /// earlier close attempt cannot destroy a window the user kept.
    pub fn take(&self, label: &str, request_id: u64) -> bool {
        let Ok(mut pending) = self.pending.lock() else {
            return false;
        };
        match pending.get(label) {
            Some(&current) if current == request_id => {
                pending.remove(label);
                true
            }
            _ => false,
        }
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(label);
        }
    }
}

/// Returns true when the close was prevented and a prompt was dispatched.
///
/// # Teardown order (spec §9.5) — this sequence is load-bearing
///
/// 1. abort transfers involving this window (here)
/// 2. census this window's OWN panes (here, spawned)
/// 3. kill those panes (`confirm_close_window`)
/// 4. destroy the window (`confirm_close_window`)
///
/// Steps 3 and 4 run in the other entry point because the user answers a dialog
/// between 2 and 3. **Do not reorder 1 and 2**: a pane mid-handoff has no owner
/// to count and no PTY this window may kill, so an abort after the census would
/// either miss the pane or count it in the wrong window. There is no unit test
/// holding this — the manual pass is the guard.
///
/// Runs on the event loop, so it does nothing slow: the abort is a lock and a
/// flush, and the census is spawned.
///
/// Not generic over `Runtime`: `abort_transfers_involving` takes a concrete
/// `&AppHandle`, and the only caller is `lib.rs`'s `.on_window_event`, which is
/// already `Wry`.
pub fn on_close_requested(window: &tauri::Window) -> bool {
    let app = window.app_handle().clone();
    let label = window.label().to_string();

    // Order step 1. Before the census, so a pane that was mid handoff is back
    // with an owner and gets counted exactly once. Takes the handle because the
    // abort emits `transfer:settled` to the peer window that is still alive.
    coordinator::abort_transfers_involving(&app, &label);

    let Some(request_id) = app.state::<CloseFlight>().try_begin(&label) else {
        // A prompt for this window is already open; keep it open.
        return true;
    };

    // Order step 2, off the event loop.
    let pane_ids = app.state::<WindowCoordinator>().panes_for_window(&label);
    let snapshots = app.state::<PtyState>().session_snapshots(&pane_ids);
    let handle = app.clone();
    let target = label.clone();
    tauri::async_runtime::spawn(async move {
        let infos = crate::info::inspect_snapshots(snapshots).await;
        let census = census_for(request_id, &infos);
        if handle
            .emit_to(target.clone(), "window:close-requested", census)
            .is_err()
        {
            handle.state::<CloseFlight>().forget(&target);
        }
    });
    true
}

/// Steps 3 and 4: kill this window's panes, then destroy it.
#[tauri::command]
pub fn confirm_close_window(
    window: tauri::Window,
    flight: State<'_, CloseFlight>,
    coordinator: State<'_, WindowCoordinator>,
    pty: State<'_, PtyState>,
    request_id: u64,
) -> Result<(), String> {
    let label = window.label().to_string();
    if !flight.take(&label, request_id) {
        return Err(format!("Close request #{request_id} is no longer current"));
    }
    for pane_id in coordinator.panes_for_window(&label) {
        // A failed kill must not strand the window open: the PTY is reported
        // and the teardown continues, because the alternative is a window the
        // user cannot close.
        //
        // `terminate_pane` takes no coordinator: owner validation lives in the
        // `kill_pty` command, and there is no live window to validate against
        // once this teardown starts. The route is dropped by the `Destroyed`
        // handler's orphan pass.
        if let Err(error) = crate::pty::terminate_pane(&pty, pane_id) {
            eprintln!("Deck: could not terminate pane #{pane_id} while closing {label}: {error}");
        }
    }
    // destroy(), not close(): close() re-fires CloseRequested and would run
    // this guard again.
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cancel_close_window(
    window: tauri::Window,
    flight: State<'_, CloseFlight>,
    request_id: u64,
) -> Result<(), String> {
    if !flight.take(window.label(), request_id) {
        return Err(format!("Close request #{request_id} is no longer current"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::CloseFlight;

    #[test]
    fn one_window_cannot_open_two_close_prompts() {
        let flight = CloseFlight::default();
        let first = flight.try_begin("deck-1").expect("first close begins");

        assert_eq!(flight.try_begin("deck-1"), None);
        assert!(flight.take("deck-1", first));
    }

    #[test]
    fn two_windows_prompt_independently() {
        let flight = CloseFlight::default();
        let a = flight.try_begin("main").expect("main begins");
        let b = flight.try_begin("deck-1").expect("deck-1 begins");

        assert_ne!(a, b);
        assert!(flight.take("main", a));
        assert!(flight.take("deck-1", b));
    }

    #[test]
    fn a_stale_reply_cannot_close_a_window() {
        let flight = CloseFlight::default();
        let first = flight.try_begin("deck-1").unwrap();
        assert!(flight.take("deck-1", first));
        let second = flight.try_begin("deck-1").unwrap();

        assert!(!flight.take("deck-1", first));
        assert!(flight.take("deck-1", second));
    }

    #[test]
    fn forget_releases_a_window_that_died_mid_prompt() {
        let flight = CloseFlight::default();
        flight.try_begin("deck-1").unwrap();
        flight.forget("deck-1");

        assert!(flight.try_begin("deck-1").is_some());
    }
}
