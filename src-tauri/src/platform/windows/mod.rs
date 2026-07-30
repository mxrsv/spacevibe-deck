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
