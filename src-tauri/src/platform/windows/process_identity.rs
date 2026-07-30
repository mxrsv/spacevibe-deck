//! Root-process creation identity for a pane, read from the process handle.
//!
//! `create_session` runs inline on the WebView2 UI thread (tao makes it an STA),
//! so the previous `Win32_Process` WMI query — a fresh COM connection plus a
//! full-machine enumeration with `ExecutablePath` and `CommandLine`, walked one
//! object per LRPC round trip with no timeout — blocked every pane spawn and
//! could hang it indefinitely against a wedged WmiPrvSE. `GetProcessTimes` needs
//! one handle and returns in microseconds.

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
};

/// Microseconds since the Unix epoch, matching `process_snapshot`'s scale so a
/// pane's identity is comparable regardless of which producer supplied it.
#[cfg(target_os = "windows")]
pub(crate) fn creation_time_micros(process_id: u32) -> Result<i64, String> {
    // SAFETY: PROCESS_QUERY_LIMITED_INFORMATION is the least privilege that
    // satisfies GetProcessTimes and succeeds across integrity levels for a child
    // we just created. A null return is the documented failure signal.
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
    if handle.is_null() {
        return Err(format!("Cannot open process {process_id} for identity"));
    }

    let mut creation = FILETIME::default();
    let mut exit = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: `handle` is non-null and owned here; all four out-params are live
    // stack slots for the duration of the call.
    let ok = unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) };
    // SAFETY: `handle` came from OpenProcess above and is closed exactly once.
    let closed = unsafe { CloseHandle(handle) };
    debug_assert!(closed != 0, "CloseHandle failed on a handle we opened");

    if ok == 0 {
        return Err(format!("Cannot read start time for process {process_id}"));
    }
    Ok(filetime_to_unix_micros(&creation))
}

/// FILETIME counts 100-nanosecond ticks from 1601-01-01; the Unix epoch is
/// 11644473600 seconds later.
#[cfg(target_os = "windows")]
fn filetime_to_unix_micros(value: &FILETIME) -> i64 {
    const TICKS_PER_MICROSECOND: i64 = 10;
    const EPOCH_DIFFERENCE_MICROSECONDS: i64 = 11_644_473_600 * 1_000_000;

    let ticks = ((value.dwHighDateTime as u64) << 32 | value.dwLowDateTime as u64) as i64;
    ticks / TICKS_PER_MICROSECOND - EPOCH_DIFFERENCE_MICROSECONDS
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn reads_the_current_process_creation_time() {
        let own = std::process::id();

        let creation =
            super::creation_time_micros(own).expect("own process must have a start time");

        // FILETIME epoch is 1601; anything after the Unix epoch confirms the
        // conversion, and a positive value confirms the handle was opened.
        assert!(creation > 0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn rejects_a_process_id_that_cannot_be_opened() {
        // PID 0 is the System Idle Process — OpenProcess always denies it, which
        // is the error path that must stay an Err rather than a silent zero.
        assert!(super::creation_time_micros(0).is_err());
    }
}
