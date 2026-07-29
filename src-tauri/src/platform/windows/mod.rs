pub(crate) mod agent_discovery;
pub(crate) mod command_line;
pub(crate) mod job_object;
pub(crate) mod process_snapshot;
pub(crate) mod shell;

use super::{ProcessInspection, SessionIdentity, ShellLaunch};
use crate::agents::AgentInfo;
use portable_pty::{ChildKiller, MasterPty};
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
    #[cfg(target_os = "windows")]
    let job = job_object::PlatformJobObject::create(
        root_pid.ok_or_else(|| "The Windows shell process id is unavailable".to_string())?,
    )?;

    Ok(PlatformSession {
        identity: SessionIdentity::new(root_pid),
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

pub fn foreground_process_group(_master: &dyn MasterPty) -> Option<i32> {
    None
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
