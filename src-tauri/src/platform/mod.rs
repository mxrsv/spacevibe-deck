#[cfg(target_os = "macos")]
pub(crate) mod macos;
#[cfg(not(target_os = "macos"))]
mod unsupported;

use serde::Serialize;
use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
pub use macos::{
    create_session, discover_agents, foreground_process_group, inspect_process, shell_launch,
    terminate_session, user_home, PlatformSession,
};
#[cfg(not(target_os = "macos"))]
pub use unsupported::{
    create_session, discover_agents, foreground_process_group, inspect_process, shell_launch,
    terminate_session, user_home, PlatformSession,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlatformName {
    Macos,
    Windows,
    Unsupported,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopEnvironment {
    pub platform: PlatformName,
    pub home_dir: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShellLaunch {
    pub executable: String,
    pub args: Vec<String>,
}

impl ShellLaunch {
    pub fn new(executable: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            executable: executable.into(),
            args,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SessionIdentity {
    root_pid: Option<u32>,
}

impl SessionIdentity {
    pub fn new(root_pid: Option<u32>) -> Self {
        Self { root_pid }
    }

    pub fn root_pid(self) -> Option<u32> {
        self.root_pid
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProcessInspection {
    pub cwd: Option<String>,
    pub process: Option<String>,
    pub complete: bool,
}

pub const fn current_platform() -> PlatformName {
    #[cfg(target_os = "macos")]
    {
        return PlatformName::Macos;
    }
    #[cfg(target_os = "windows")]
    {
        return PlatformName::Windows;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        PlatformName::Unsupported
    }
}

#[tauri::command]
pub fn desktop_environment() -> Result<DesktopEnvironment, String> {
    let home = user_home()?;
    Ok(DesktopEnvironment {
        platform: current_platform(),
        home_dir: home.to_string_lossy().into_owned(),
    })
}

pub(super) fn validate_user_home(path: PathBuf) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("The user profile directory is not absolute".into());
    }
    if !path.is_dir() {
        return Err("The user profile directory does not exist".into());
    }
    Ok(path)
}

pub(super) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        current_platform, validate_user_home, DesktopEnvironment, PlatformName, SessionIdentity,
    };
    use portable_pty::MasterPty;

    #[test]
    fn reports_the_compile_target_platform() {
        #[cfg(target_os = "macos")]
        assert_eq!(current_platform(), PlatformName::Macos);

        #[cfg(target_os = "windows")]
        assert_eq!(current_platform(), PlatformName::Windows);

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert_eq!(current_platform(), PlatformName::Unsupported);
    }

    #[test]
    fn desktop_environment_serializes_for_frontend_initialization() {
        let environment = DesktopEnvironment {
            platform: PlatformName::Macos,
            home_dir: "/Users/dev".into(),
        };

        assert_eq!(
            serde_json::to_value(environment).unwrap(),
            serde_json::json!({
                "platform": "macos",
                "homeDir": "/Users/dev",
            })
        );
    }

    #[test]
    fn session_identity_keeps_the_root_process() {
        let identity = SessionIdentity::new(Some(42));

        assert_eq!(identity.root_pid(), Some(42));
    }

    #[test]
    fn exposes_foreground_process_group_through_the_platform_adapter() {
        let adapter: fn(&dyn MasterPty) -> Option<i32> = super::foreground_process_group;

        let _ = adapter;
    }

    #[test]
    fn validates_an_absolute_existing_home() {
        assert_eq!(
            validate_user_home(std::env::temp_dir()).unwrap(),
            std::env::temp_dir()
        );
    }

    #[test]
    fn rejects_a_relative_or_missing_home() {
        assert!(validate_user_home("relative/home".into()).is_err());
        assert!(
            validate_user_home(std::env::temp_dir().join("deck-missing-home-for-test")).is_err()
        );
    }
}
