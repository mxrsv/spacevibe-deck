//! One update check at a time across peer windows (spec §9.5).
//!
//! Not "the first window is primary": with peers the first window can be the
//! first to die. Any window may hold the flight, and `Destroyed` releases it.

use std::sync::Mutex;
use tauri::State;

#[derive(Default)]
pub struct UpdateFlight {
    holder: Mutex<Option<String>>,
}

impl UpdateFlight {
    /// True when this window won the check. False means another window is
    /// already checking and this one must do nothing.
    pub fn try_begin(&self, label: &str) -> bool {
        let Ok(mut holder) = self.holder.lock() else {
            return false;
        };
        if holder.is_some() {
            return false;
        }
        *holder = Some(label.to_string());
        true
    }

    /// Release the flight. False when `label` is not the holder, so a stale
    /// end from a previous check cannot free a live one.
    pub fn finish(&self, label: &str) -> bool {
        let Ok(mut holder) = self.holder.lock() else {
            return false;
        };
        match holder.as_deref() {
            Some(current) if current == label => {
                *holder = None;
                true
            }
            _ => false,
        }
    }

    pub fn forget(&self, label: &str) {
        self.finish(label);
    }
}

#[tauri::command]
pub fn begin_update_check(window: tauri::Window, flight: State<'_, UpdateFlight>) -> bool {
    flight.try_begin(window.label())
}

#[tauri::command]
pub fn end_update_check(
    window: tauri::Window,
    flight: State<'_, UpdateFlight>,
) -> Result<(), String> {
    if !flight.finish(window.label()) {
        return Err(format!(
            "Window {} does not hold the update check",
            window.label()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::UpdateFlight;

    #[test]
    fn only_one_window_checks_at_a_time() {
        let flight = UpdateFlight::default();

        assert!(flight.try_begin("main"));
        assert!(!flight.try_begin("deck-1"));
    }

    #[test]
    fn the_holder_releases_and_the_next_window_may_check() {
        let flight = UpdateFlight::default();
        flight.try_begin("main");

        assert!(!flight.finish("deck-1"), "a non-holder cannot release");
        assert!(flight.finish("main"));
        assert!(flight.try_begin("deck-1"));
    }

    #[test]
    fn a_dead_holder_does_not_block_every_later_check() {
        let flight = UpdateFlight::default();
        flight.try_begin("deck-1");
        flight.forget("deck-1");

        assert!(flight.try_begin("main"));
    }

    #[test]
    fn forgetting_a_window_that_is_not_the_holder_changes_nothing() {
        let flight = UpdateFlight::default();
        flight.try_begin("main");
        flight.forget("deck-1");

        assert!(!flight.try_begin("deck-1"));
    }
}
