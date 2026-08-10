//! Quit, owned by Rust (spec §9.4).
//!
//! With peer windows, ⌘Q used to be broadcast: every window ran its own guard
//! and every window opened its own dialog. Here exactly one window is asked,
//! behind a global in-flight lock, and the census that dialog shows is computed
//! from `PtyState` rather than from whichever webview happens to answer.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

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

    #[allow(dead_code)] // gains its caller in B10
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
}
