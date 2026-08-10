//! Closing one window without touching its peers (spec §9.5).

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

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
