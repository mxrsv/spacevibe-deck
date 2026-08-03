use super::{path_to_string, validate_user_home, ProcessInspection, SessionIdentity, ShellLaunch};
use crate::agents::{parse_command_v_output, AgentInfo, DETECT_TIMEOUT};
use portable_pty::{ChildKiller, MasterPty};
use std::path::PathBuf;
use std::thread;

const KILL_GRACE: std::time::Duration = std::time::Duration::from_millis(500);

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
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "The user profile directory is unavailable".to_string())?;
    validate_user_home(home)
}

pub fn shell_launch() -> Result<ShellLaunch, String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    Ok(ShellLaunch::new(shell, vec!["-l".into()]))
}

/// `names` has already passed `is_probe_safe` in `probe_names` — that is what
/// makes interpolating them into this script safe.
pub async fn discover_agents(names: Vec<String>) -> Vec<AgentInfo> {
    let launch = match shell_launch() {
        Ok(launch) => launch,
        Err(_) => return Vec::new(),
    };
    let script = names
        .iter()
        .map(|name| format!("command -v {name}"))
        .collect::<Vec<_>>()
        .join("; ");
    let task = tauri::async_runtime::spawn_blocking(move || {
        std::process::Command::new(launch.executable)
            .args(["-ilc", &script])
            .output()
    });
    let output = match tokio::time::timeout(DETECT_TIMEOUT, task).await {
        Ok(Ok(Ok(output))) => output,
        _ => return Vec::new(),
    };
    parse_command_v_output(&String::from_utf8_lossy(&output.stdout), &names)
}

pub fn inspect_process(pid: i32) -> ProcessInspection {
    ProcessInspection {
        cwd: process_cwd(pid),
        process: process_name(pid),
        complete: true,
    }
}

pub fn foreground_process_group(master: &dyn MasterPty) -> Option<i32> {
    master.process_group_leader()
}

pub fn terminate_session(
    session: &PlatformSession,
    foreground_process_group: Option<i32>,
    killer: &mut (dyn ChildKiller + Send + Sync),
) -> Result<(), String> {
    terminate_process_groups(
        foreground_process_group,
        session.identity().root_pid().map(|pid| pid as i32),
        KILL_GRACE,
    );
    let _ = killer.kill();
    Ok(())
}

pub(crate) fn terminate_process_groups(
    foreground_process_group: Option<i32>,
    shell_process_group: Option<i32>,
    grace: std::time::Duration,
) {
    let foreground = foreground_process_group.filter(|process_group| *process_group > 1);
    let shell = shell_process_group.filter(|process_group| *process_group > 1);
    if let Some(process_group) = foreground {
        unsafe { libc::killpg(process_group, libc::SIGHUP) };
        thread::spawn(move || {
            thread::sleep(grace);
            unsafe { libc::killpg(process_group, libc::SIGKILL) };
        });
    }
    if let Some(process_group) = shell {
        unsafe { libc::killpg(process_group, libc::SIGKILL) };
    }
}

fn process_name(pid: i32) -> Option<String> {
    argv0_name(pid).or_else(|| proc_name_raw(pid))
}

fn argv0_name(pid: i32) -> Option<String> {
    let mut mib = [libc::CTL_KERN, libc::KERN_PROCARGS2, pid];
    let mut size: libc::size_t = 0;
    let ok = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as libc::c_uint,
            std::ptr::null_mut(),
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if ok != 0 || size <= std::mem::size_of::<libc::c_int>() {
        return None;
    }
    let mut buffer = vec![0u8; size];
    let ok = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as libc::c_uint,
            buffer.as_mut_ptr() as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if ok != 0 {
        return None;
    }
    buffer.truncate(size);
    let rest = buffer.get(std::mem::size_of::<libc::c_int>()..)?;
    let executable_end = rest.iter().position(|&byte| byte == 0)?;
    let after_executable = &rest[executable_end..];
    let argv0_start = after_executable.iter().position(|&byte| byte != 0)?;
    let argv0_bytes = &after_executable[argv0_start..];
    let argv0_end = argv0_bytes.iter().position(|&byte| byte == 0)?;
    let argv0 = std::str::from_utf8(&argv0_bytes[..argv0_end]).ok()?;
    let basename = argv0.rsplit('/').next()?.trim_start_matches('-');
    (!basename.is_empty()).then(|| basename.to_string())
}

fn proc_name_raw(pid: i32) -> Option<String> {
    let mut buffer = [0u8; 64];
    let length = unsafe {
        libc::proc_name(
            pid,
            buffer.as_mut_ptr() as *mut libc::c_void,
            buffer.len() as u32,
        )
    };
    if length <= 0 {
        return None;
    }
    String::from_utf8(buffer[..length as usize].to_vec()).ok()
}

fn process_cwd(pid: i32) -> Option<String> {
    let mut info: libc::proc_vnodepathinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_vnodepathinfo>() as libc::c_int;
    let read = unsafe {
        libc::proc_pidinfo(
            pid,
            libc::PROC_PIDVNODEPATHINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    if read < size {
        return None;
    }
    let path =
        unsafe { std::ffi::CStr::from_ptr(info.pvi_cdir.vip_path.as_ptr() as *const libc::c_char) };
    path.to_str()
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|value| path_to_string(&value))
}

#[cfg(test)]
mod tests {
    use super::{process_name, shell_launch};
    use std::os::unix::process::CommandExt;

    fn with_renamed_sleep(arg0: &str, check: impl FnOnce(i32)) {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg0(arg0)
            .arg("10")
            .spawn()
            .expect("spawn sleep");
        std::thread::sleep(std::time::Duration::from_millis(200));
        check(child.id() as i32);
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn shell_launch_is_a_login_shell() {
        let launch = shell_launch().unwrap();

        assert_eq!(launch.args, ["-l"]);
        assert!(!launch.executable.is_empty());
    }

    #[test]
    fn process_name_prefers_argv0_over_the_executable_name() {
        with_renamed_sleep("fake-agent", |pid| {
            assert_eq!(process_name(pid).as_deref(), Some("fake-agent"));
        });
    }

    #[test]
    fn process_name_takes_the_basename_of_a_path_argv0() {
        with_renamed_sleep("/usr/local/bin/claude", |pid| {
            assert_eq!(process_name(pid).as_deref(), Some("claude"));
        });
    }

    #[test]
    fn process_name_strips_the_login_shell_dash() {
        with_renamed_sleep("-zsh", |pid| {
            assert_eq!(process_name(pid).as_deref(), Some("zsh"));
        });
    }
}
