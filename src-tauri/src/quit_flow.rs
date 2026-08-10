//! Quit, owned by Rust (spec §9.4).
//!
//! With peer windows, ⌘Q used to be broadcast: every window ran its own guard
//! and every window opened its own dialog. Here exactly one window is asked,
//! behind a global in-flight lock, and the census that dialog shows is computed
//! from `PtyState` rather than from whichever webview happens to answer.

use crate::coordinator::WindowCoordinator;
use crate::pane_census::census_for;
use crate::pty::PtyState;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, Runtime, State};

struct InFlight {
    request_id: u64,
    window: String,
}

/// At most one quit prompt exists at a time, app-wide.
#[derive(Default)]
pub struct QuitFlight {
    current: Mutex<Option<InFlight>>,
    next_id: AtomicU64,
}

impl QuitFlight {
    /// Claim the prompt for `window`. `None` means another window already has
    /// it — a second ⌘Q must not open a second dialog.
    pub fn try_begin(&self, window: &str) -> Option<u64> {
        let mut current = self.current.lock().ok()?;
        if current.is_some() {
            return None;
        }
        let request_id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        *current = Some(InFlight {
            request_id,
            window: window.to_string(),
        });
        Some(request_id)
    }

    /// Release the prompt. False for a stale or unknown id, so a late reply
    /// from a previous quit cannot cancel the current one.
    pub fn finish(&self, request_id: u64) -> bool {
        let Ok(mut current) = self.current.lock() else {
            return false;
        };
        match current.as_ref() {
            Some(flight) if flight.request_id == request_id => {
                *current = None;
                true
            }
            _ => false,
        }
    }

    pub fn holder(&self) -> Option<String> {
        self.current
            .lock()
            .ok()?
            .as_ref()
            .map(|flight| flight.window.clone())
    }

    /// Release the prompt if `label` was holding it. Peers means the window
    /// showing the dialog can die first; without this, quit stays locked for
    /// the rest of the process.
    pub fn forget_window(&self, label: &str) -> bool {
        let Ok(mut current) = self.current.lock() else {
            return false;
        };
        match current.as_ref() {
            Some(flight) if flight.window == label => {
                *current = None;
                true
            }
            _ => false,
        }
    }
}

/// What to do with `RunEvent::ExitRequested`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExitPolicy {
    Allow,
    PromptAndPrevent,
}

/// `code` is `Some` only for a programmatic exit — `confirm_quit`'s `app.exit`
/// and the updater's `restart` — which has already passed its own guard and
/// must not be blocked. `open_windows == 0` is the peer-window case: nobody is
/// left to answer a prompt, so preventing exit would hang the process invisibly.
pub fn exit_policy(code: Option<i32>, open_windows: usize) -> ExitPolicy {
    if code.is_some() || open_windows == 0 {
        return ExitPolicy::Allow;
    }
    ExitPolicy::PromptAndPrevent
}

/// Ask one window — the focused one, else the most recently focused — to show
/// the quit dialog.
///
/// The census is gathered off the event loop: on Windows classification is a
/// WMI query, and blocking the loop here would freeze every window while the
/// user waits to be asked a question.
pub fn request_quit<R: Runtime>(app: &tauri::AppHandle<R>) {
    let Some(target) = crate::window_lifecycle::menu_target(app) else {
        // No window can answer. Exit rather than prevent: see `exit_policy`.
        app.exit(0);
        return;
    };
    let flight = app.state::<QuitFlight>();
    let Some(request_id) = flight.try_begin(&target) else {
        // A dialog is already open somewhere. A second Cmd+Q is a no-op.
        return;
    };

    let pane_ids = app.state::<WindowCoordinator>().all_panes();
    let snapshots = app.state::<PtyState>().session_snapshots(&pane_ids);
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let infos = crate::info::inspect_snapshots(snapshots).await;
        let census = census_for(request_id, &infos);
        if handle.emit_to(target, "quit-requested", census).is_err() {
            // The chosen window went away between the census and the emit;
            // release the lock so the next Cmd+Q is not swallowed.
            handle.state::<QuitFlight>().finish(request_id);
        }
    });
}

/// The user said yes. Exiting with a code is what makes `exit_policy` allow it.
#[tauri::command]
pub fn confirm_quit(
    app: tauri::AppHandle,
    flight: State<'_, QuitFlight>,
    request_id: u64,
) -> Result<(), String> {
    if !flight.finish(request_id) {
        return Err(format!("Quit request #{request_id} is no longer current"));
    }
    app.exit(0);
    Ok(())
}

/// The user said no, or the dialog failed to open.
#[tauri::command]
pub fn cancel_quit(flight: State<'_, QuitFlight>, request_id: u64) -> Result<(), String> {
    if !flight.finish(request_id) {
        return Err(format!("Quit request #{request_id} is no longer current"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{exit_policy, ExitPolicy, QuitFlight};

    #[test]
    fn a_second_quit_cannot_open_a_second_dialog() {
        let flight = QuitFlight::default();
        let first = flight.try_begin("main").expect("first quit begins");

        assert_eq!(flight.try_begin("deck-1"), None);
        assert_eq!(flight.holder().as_deref(), Some("main"));
        assert!(flight.finish(first));
    }

    #[test]
    fn finishing_with_a_stale_request_id_changes_nothing() {
        let flight = QuitFlight::default();
        let first = flight.try_begin("main").unwrap();

        assert!(!flight.finish(first + 999));
        assert_eq!(flight.holder().as_deref(), Some("main"));
        assert!(flight.finish(first));
        assert!(flight.try_begin("deck-1").is_some());
    }

    #[test]
    fn request_ids_are_not_reused_after_a_cancel() {
        let flight = QuitFlight::default();
        let first = flight.try_begin("main").unwrap();
        flight.finish(first);
        let second = flight.try_begin("main").unwrap();

        assert_ne!(first, second);
    }

    #[test]
    fn losing_the_dialog_window_releases_the_lock() {
        let flight = QuitFlight::default();
        flight.try_begin("deck-1").unwrap();

        assert!(flight.forget_window("deck-1"));
        assert!(
            flight.try_begin("main").is_some(),
            "a dead window must not brick quit for the session"
        );
    }

    #[test]
    fn losing_an_unrelated_window_keeps_the_lock() {
        let flight = QuitFlight::default();
        flight.try_begin("main").unwrap();

        assert!(!flight.forget_window("deck-1"));
        assert_eq!(flight.holder().as_deref(), Some("main"));
    }

    #[test]
    fn a_programmatic_exit_is_never_prevented() {
        assert_eq!(exit_policy(Some(0), 2), ExitPolicy::Allow);
        assert_eq!(exit_policy(Some(i32::MAX), 1), ExitPolicy::Allow);
    }

    #[test]
    fn a_user_exit_prompts_while_a_window_remains() {
        assert_eq!(exit_policy(None, 1), ExitPolicy::PromptAndPrevent);
        assert_eq!(exit_policy(None, 3), ExitPolicy::PromptAndPrevent);
    }

    #[test]
    fn a_user_exit_with_no_windows_left_must_be_allowed() {
        // Otherwise the last window closing leaves a process with nothing to
        // show a dialog in and no way to quit.
        assert_eq!(exit_policy(None, 0), ExitPolicy::Allow);
    }

    use crate::info::{PaneProcessKind, PtyInfo};
    use crate::pane_census::{all_idle, census_for};

    fn idle(id: u32) -> PtyInfo {
        PtyInfo {
            id,
            cwd: None,
            process: Some("zsh".into()),
            kind: PaneProcessKind::IdleShell,
            agent: None,
        }
    }

    #[test]
    fn an_all_idle_app_still_carries_the_request_id_so_the_window_can_flush() {
        // Nothing to warn about, but the frontend must still flush settings and
        // call confirm_quit — so the request is issued either way, with an
        // empty census.
        let infos = [idle(1), idle(2)];
        let census = census_for(11, &infos);

        assert!(all_idle(&infos));
        assert_eq!(census.request_id, 11);
        assert_eq!(census.busy_panes, 0);
    }

    #[test]
    fn the_census_counts_a_pane_that_is_mid_transfer() {
        // `all_panes` (Owned + Transferring) and `panes_for_window` (Owned
        // only) disagree exactly here, and quit must read the wider one: an
        // agent that happens to be moving between windows is still running.
        //
        // `begin_transfer` is the inherent method behind the `prepare_transfer`
        // command; the command takes a `tauri::Window`, which no unit test can
        // construct. The recording sink and the injected `now` are what make it
        // callable here at all — see §0.2.
        use crate::coordinator::{test_support::RecordingSink, WindowCoordinator};
        use std::time::Instant;

        let coordinator = WindowCoordinator::default();
        let sink = RecordingSink::default();
        coordinator.register(1, "main".into());
        coordinator.register(2, "main".into());
        coordinator
            .begin_transfer(&sink, "main", 2, Instant::now())
            .expect("pane 2 enters the Transferring state");

        assert_eq!(coordinator.panes_for_window("main"), vec![1]);
        let mut all = coordinator.all_panes();
        all.sort();
        assert_eq!(all, vec![1, 2]);
    }

    #[test]
    fn confirming_an_unknown_request_is_an_error_not_an_exit() {
        let flight = QuitFlight::default();
        let request_id = flight.try_begin("main").unwrap();

        assert!(!flight.finish(request_id + 1));
        assert_eq!(flight.holder().as_deref(), Some("main"));
    }
}
