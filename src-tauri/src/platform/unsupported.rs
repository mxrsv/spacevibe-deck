use super::{ProcessInspection, SessionIdentity, ShellLaunch};
use crate::agents::AgentInfo;
use portable_pty::{ChildKiller, MasterPty};
use std::path::PathBuf;

pub struct PlatformSession {
    identity: SessionIdentity,
}

impl PlatformSession {
    pub fn identity(&self) -> SessionIdentity {
        self.identity
    }
}

pub fn create_session(root_pid: Option<u32>) -> Result<PlatformSession, String> {
    Ok(PlatformSession {
        identity: SessionIdentity::new(root_pid),
    })
}

pub fn user_home() -> Result<PathBuf, String> {
    Err("The user profile directory is unavailable on this platform".into())
}

pub fn shell_launch() -> Result<ShellLaunch, String> {
    Err("Terminal sessions are unavailable on this platform".into())
}

pub async fn discover_agents(_names: Vec<String>) -> Vec<AgentInfo> {
    Vec::new()
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
    _session: &PlatformSession,
    _foreground_process_group: Option<i32>,
    killer: &mut (dyn ChildKiller + Send + Sync),
) -> Result<(), String> {
    killer.kill().map_err(|error| error.to_string())
}
