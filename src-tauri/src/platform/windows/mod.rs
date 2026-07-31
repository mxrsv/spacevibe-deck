pub(crate) mod agent_discovery;
pub(crate) mod command_line;
pub(crate) mod job_object;
pub(crate) mod process_identity;
pub(crate) mod process_snapshot;
pub(crate) mod shell;
// Unlike the sibling modules above, this one has no cross-platform-testable
// logic to abstract behind a trait — it is a direct COM call-through — so it
// is gated to the real Windows target rather than also compiling under
// `cfg(test)` on other hosts the way `mod windows` itself does.
#[cfg(target_os = "windows")]
pub(crate) mod webview;

use super::{ProcessInspection, SessionIdentity, ShellLaunch};
use crate::agents::AgentInfo;
use portable_pty::{ChildKiller, MasterPty};
#[cfg(target_os = "windows")]
use process_snapshot::{ProcessClassification, SessionProcessRoot, SnapshotError};
use std::path::PathBuf;

/// Win32 process-creation flag that suppresses the console window a
/// console-subsystem child (`git`, a `.cmd`/`.bat` shim) would otherwise
/// flash open: `main.rs` builds release as a GUI-subsystem process with no
/// console of its own to inherit, so any child spawned without this pops a
/// new one into view for an instant. Shared by `git_branch` in `info.rs` and
/// the editor spawn in `links.rs` — the two spawn sites this gap was found
/// on — via `std::os::windows::process::CommandExt::creation_flags`.
#[cfg(target_os = "windows")]
pub(crate) const NO_CONSOLE_WINDOW: u32 = windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

// Pin the binding's value: `Command` has no public getter for creation
// flags, so this — evaluated by the compiler itself, not by running a test
// binary — is the only way to verify from a non-Windows host that the right
// flag is wired in. `cargo check --target x86_64-pc-windows-msvc` fails to
// compile if `windows-sys` ever changes this value or the wrong constant
// gets swapped in here.
#[cfg(target_os = "windows")]
const _: () = assert!(
    NO_CONSOLE_WINDOW == 0x0800_0000,
    "CREATE_NO_WINDOW's value moved upstream in windows-sys; re-verify before trusting this flag"
);

pub struct PlatformSession {
    identity: SessionIdentity,
    #[cfg(target_os = "windows")]
    job: job_object::PlatformJobObject,
}

impl PlatformSession {
    pub fn identity(&self) -> SessionIdentity {
        self.identity
    }
}

pub fn create_session(root_pid: Option<u32>) -> Result<PlatformSession, String> {
    let root_pid =
        root_pid.ok_or_else(|| "The Windows shell process id is unavailable".to_string())?;

    #[cfg(target_os = "windows")]
    let job = job_object::PlatformJobObject::create(root_pid)?;
    #[cfg(target_os = "windows")]
    let creation_date = match process_identity::creation_time_micros(root_pid) {
        Ok(creation_date) => Some(creation_date),
        Err(error) => {
            // SessionIdentity is Copy and written once, never backfilled, so a
            // silent miss pins this pane to `unknown` for its whole life — no
            // Attention Rail gate, generic close dialog. Do not swallow it.
            eprintln!("Deck: pane identity unavailable for pid {root_pid}: {error}");
            None
        }
    };
    #[cfg(not(target_os = "windows"))]
    let creation_date = None;

    Ok(PlatformSession {
        identity: SessionIdentity::with_creation_date(Some(root_pid), creation_date),
        #[cfg(target_os = "windows")]
        job,
    })
}

pub fn user_home() -> Result<PathBuf, String> {
    shell::user_home()
}

pub fn shell_launch() -> Result<ShellLaunch, String> {
    shell::shell_launch()
}

pub async fn discover_agents() -> Vec<AgentInfo> {
    agent_discovery::discover_agents().await
}

pub fn inspect_process(_pid: i32) -> ProcessInspection {
    ProcessInspection {
        cwd: None,
        process: None,
        complete: false,
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn inspect_processes(
    roots: &[SessionProcessRoot],
) -> Vec<(u32, Result<ProcessClassification, SnapshotError>)> {
    process_snapshot::classify_many(&process_snapshot::WmiProcessSnapshotProvider, roots)
}

pub fn foreground_process_group(_master: &dyn MasterPty) -> Option<i32> {
    None
}

#[cfg(target_os = "windows")]
pub fn harden_webview(window: &tauri::WebviewWindow) -> Result<(), String> {
    webview::harden_webview(window)
}

pub fn terminate_session(
    session: &PlatformSession,
    _foreground_process_group: Option<i32>,
    killer: &mut (dyn ChildKiller + Send + Sync),
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = killer;
        session.job.terminate()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = session;
        killer.kill().map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runtime counterpart to the `const _: () = assert!(...)` pin above.
    /// `Command` exposes no getter for creation flags, so a flags-value
    /// assertion is the narrowest thing that can stand in for "the console
    /// window is suppressed" without spawning anything. This needs
    /// `windows_sys` — a Windows-only dependency — so it cannot compile, let
    /// alone run, on this (macOS) host; it runs for real on Windows CI. See
    /// the PR report for how the equivalent const assertion was verified to
    /// genuinely fail (and then pass again) from this host via `cargo check
    /// --target x86_64-pc-windows-msvc`.
    #[cfg(target_os = "windows")]
    #[test]
    fn no_console_window_is_the_win32_create_no_window_value() {
        assert_eq!(NO_CONSOLE_WINDOW, 0x0800_0000);
    }
}
