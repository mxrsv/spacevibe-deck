trait JobObjectProvider {
    type Handle;

    fn create(&self) -> Result<Self::Handle, String>;
    fn set_kill_on_close(&self, handle: &Self::Handle) -> Result<(), String>;
    fn assign_process(&self, handle: &Self::Handle, pid: u32) -> Result<(), String>;
    fn terminate(&self, handle: &Self::Handle) -> Result<(), String>;
}

struct OwnedJob<H> {
    handle: H,
}

fn create_owned_job<P: JobObjectProvider>(
    provider: &P,
    pid: u32,
) -> Result<OwnedJob<P::Handle>, String> {
    let handle = provider.create()?;
    provider.set_kill_on_close(&handle)?;
    provider.assign_process(&handle, pid)?;
    Ok(OwnedJob { handle })
}

fn terminate_owned_job<P: JobObjectProvider>(
    provider: &P,
    job: &OwnedJob<P::Handle>,
) -> Result<(), String> {
    provider.terminate(&job.handle)
}

#[cfg(target_os = "windows")]
mod win32 {
    use super::{create_owned_job, terminate_owned_job, JobObjectProvider, OwnedJob};
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    struct OwnedHandle(isize);

    impl OwnedHandle {
        fn new(handle: HANDLE, context: &str) -> Result<Self, String> {
            if handle.is_null() {
                return Err(last_error(context));
            }
            Ok(Self(handle as isize))
        }

        fn raw(&self) -> HANDLE {
            self.0 as HANDLE
        }
    }

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.raw());
            }
        }
    }

    struct Win32JobObjectProvider;

    impl JobObjectProvider for Win32JobObjectProvider {
        type Handle = OwnedHandle;

        fn create(&self) -> Result<Self::Handle, String> {
            let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
            OwnedHandle::new(handle, "Couldn't create the Windows process Job Object")
        }

        fn set_kill_on_close(&self, handle: &Self::Handle) -> Result<(), String> {
            let mut information = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let succeeded = unsafe {
                SetInformationJobObject(
                    handle.raw(),
                    JobObjectExtendedLimitInformation,
                    &information as *const _ as *const c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            bool_result(
                succeeded,
                "Couldn't enable kill-on-close for the Windows process Job Object",
            )
        }

        fn assign_process(&self, handle: &Self::Handle, pid: u32) -> Result<(), String> {
            let process = OwnedHandle::new(
                unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) },
                "Couldn't open the spawned Windows shell process",
            )?;
            let succeeded = unsafe { AssignProcessToJobObject(handle.raw(), process.raw()) };
            bool_result(
                succeeded,
                "Couldn't assign the Windows shell to its process Job Object",
            )
        }

        fn terminate(&self, handle: &Self::Handle) -> Result<(), String> {
            let succeeded = unsafe { TerminateJobObject(handle.raw(), 1) };
            bool_result(
                succeeded,
                "Couldn't terminate the Windows process Job Object",
            )
        }
    }

    fn bool_result(succeeded: i32, context: &str) -> Result<(), String> {
        if succeeded == 0 {
            Err(last_error(context))
        } else {
            Ok(())
        }
    }

    fn last_error(context: &str) -> String {
        format!("{context}: {}", std::io::Error::last_os_error())
    }

    pub struct PlatformJobObject {
        job: OwnedJob<OwnedHandle>,
    }

    impl PlatformJobObject {
        pub fn create(pid: u32) -> Result<Self, String> {
            create_owned_job(&Win32JobObjectProvider, pid).map(|job| Self { job })
        }

        pub fn terminate(&self) -> Result<(), String> {
            terminate_owned_job(&Win32JobObjectProvider, &self.job)
        }
    }
}

#[cfg(target_os = "windows")]
pub use win32::PlatformJobObject;

#[cfg(test)]
mod tests {
    use super::{create_owned_job, terminate_owned_job, JobObjectProvider};
    use std::sync::{Arc, Mutex};

    struct FixtureHandle {
        calls: Arc<Mutex<Vec<String>>>,
    }

    impl Drop for FixtureHandle {
        fn drop(&mut self) {
            self.calls.lock().unwrap().push("close".into());
        }
    }

    struct FixtureProvider {
        calls: Arc<Mutex<Vec<String>>>,
        terminate_error: bool,
    }

    impl FixtureProvider {
        fn new(terminate_error: bool) -> Self {
            Self {
                calls: Arc::new(Mutex::new(Vec::new())),
                terminate_error,
            }
        }

        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl JobObjectProvider for FixtureProvider {
        type Handle = FixtureHandle;

        fn create(&self) -> Result<Self::Handle, String> {
            self.calls.lock().unwrap().push("create".into());
            Ok(FixtureHandle {
                calls: Arc::clone(&self.calls),
            })
        }

        fn set_kill_on_close(&self, _handle: &Self::Handle) -> Result<(), String> {
            self.calls.lock().unwrap().push("set-kill".into());
            Ok(())
        }

        fn assign_process(&self, _handle: &Self::Handle, pid: u32) -> Result<(), String> {
            self.calls.lock().unwrap().push(format!("assign:{pid}"));
            Ok(())
        }

        fn terminate(&self, _handle: &Self::Handle) -> Result<(), String> {
            self.calls.lock().unwrap().push("terminate".into());
            if self.terminate_error {
                Err("termination failed".into())
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn sets_kill_on_close() {
        let provider = FixtureProvider::new(false);
        let _job = create_owned_job(&provider, 42).unwrap();

        assert!(provider.calls().contains(&"set-kill".into()));
    }

    #[test]
    fn assigns_spawned_process() {
        let provider = FixtureProvider::new(false);
        let _job = create_owned_job(&provider, 42).unwrap();

        assert!(provider.calls().contains(&"assign:42".into()));
    }

    #[test]
    fn closes_owned_tree() {
        let provider = FixtureProvider::new(false);
        let job = create_owned_job(&provider, 42).unwrap();

        terminate_owned_job(&provider, &job).unwrap();
        drop(job);

        assert_eq!(
            provider.calls(),
            ["create", "set-kill", "assign:42", "terminate", "close"]
        );
    }

    #[test]
    fn keeps_session_on_termination_failure() {
        let provider = FixtureProvider::new(true);
        let session = Some(create_owned_job(&provider, 42).unwrap());

        assert!(terminate_owned_job(&provider, session.as_ref().unwrap()).is_err());
        assert!(session.is_some());
    }

    #[cfg(target_os = "windows")]
    fn spawn_long_running_child() -> std::process::Child {
        std::process::Command::new("cmd.exe")
            .args(["/D", "/S", "/C", "ping -n 30 127.0.0.1 >NUL"])
            .spawn()
            .expect("spawn Windows Job Object fixture")
    }

    #[cfg(target_os = "windows")]
    fn child_exits_within(child: &mut std::process::Child, timeout: std::time::Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        while std::time::Instant::now() < deadline {
            if child.try_wait().expect("poll child").is_some() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        false
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn real_job_close_terminates_the_child() {
        let mut child = spawn_long_running_child();
        let job = super::PlatformJobObject::create(child.id()).unwrap_or_else(|error| {
            let _ = child.kill();
            panic!("{error}");
        });

        drop(job);

        assert!(child_exits_within(
            &mut child,
            std::time::Duration::from_secs(5)
        ));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn real_job_termination_stops_the_child() {
        let mut child = spawn_long_running_child();
        let job = super::PlatformJobObject::create(child.id()).unwrap_or_else(|error| {
            let _ = child.kill();
            panic!("{error}");
        });

        job.terminate().unwrap();

        assert!(child_exits_within(
            &mut child,
            std::time::Duration::from_secs(5)
        ));
    }
}
