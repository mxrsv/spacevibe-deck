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

        // Exposes the job's raw handle so tests can inspect the job directly
        // (e.g. via `QueryInformationJobObject`) instead of only observing
        // spawned child processes. `cfg(test)`-gated: compiled out of every
        // non-test build, so it is not part of the production API surface.
        #[cfg(test)]
        pub(crate) fn raw_handle(&self) -> HANDLE {
            self.job.handle.raw()
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

    // `real_job_close_terminates_the_child` and `real_job_termination_stops_the_child`
    // above only poll `child.try_wait()` on `cmd.exe`, the direct child.
    // `spawn_long_running_child` runs `cmd.exe /C ping ...`, so `ping.exe` is
    // a grandchild the OS folds into the same job automatically — a
    // root-only kill that left `ping.exe` orphaned would still leave those
    // two tests green (audit gate W3). This test inspects the job's actual
    // process list via `QueryInformationJobObject` instead of only watching
    // the root process exit.

    #[cfg(target_os = "windows")]
    #[repr(C)]
    struct ProcessIdListBuffer {
        header: windows_sys::Win32::System::JobObjects::JOBOBJECT_BASIC_PROCESS_ID_LIST,
        // `JOBOBJECT_BASIC_PROCESS_ID_LIST::ProcessIdList` is declared as a
        // single-element array — it is really the head of a variable-length
        // list the kernel fills in based on the buffer size we pass. This
        // reserves 63 more trailing `usize` slots (64 PIDs total), far more
        // than the cmd.exe + ping.exe pair this test expects.
        extra_pids: [usize; 63],
    }

    #[cfg(target_os = "windows")]
    fn job_process_ids(handle: windows_sys::Win32::Foundation::HANDLE) -> Vec<usize> {
        use windows_sys::Win32::System::JobObjects::{
            JobObjectBasicProcessIdList, QueryInformationJobObject,
        };

        let mut buffer = ProcessIdListBuffer {
            header: Default::default(),
            extra_pids: [0; 63],
        };
        let mut returned_length: u32 = 0;

        // SAFETY: `buffer` is a repr(C) struct laid out as a
        // JOBOBJECT_BASIC_PROCESS_ID_LIST immediately followed by 63 more
        // `usize` slots with no padding between them, so its address is a
        // valid destination for up to 64 process IDs and
        // `size_of::<ProcessIdListBuffer>()` accurately describes its byte
        // length. `handle` is a job object handle the caller still owns for
        // the duration of this synchronous call.
        let succeeded = unsafe {
            QueryInformationJobObject(
                handle,
                JobObjectBasicProcessIdList,
                &mut buffer as *mut ProcessIdListBuffer as *mut core::ffi::c_void,
                std::mem::size_of::<ProcessIdListBuffer>() as u32,
                &mut returned_length,
            )
        };
        assert_ne!(
            succeeded,
            0,
            "QueryInformationJobObject failed: {}",
            std::io::Error::last_os_error()
        );

        let count = buffer.header.NumberOfProcessIdsInList as usize;
        assert!(
            count <= 64,
            "job holds more processes than the fixture buffer reserves for: {count}"
        );

        let mut pids = Vec::with_capacity(count);
        if count > 0 {
            pids.push(buffer.header.ProcessIdList[0]);
            pids.extend(buffer.extra_pids.iter().take(count - 1).copied());
        }
        pids
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn real_job_tracks_and_releases_the_grandchild_process() {
        let mut child = spawn_long_running_child();
        let job = super::PlatformJobObject::create(child.id()).unwrap_or_else(|error| {
            let _ = child.kill();
            panic!("{error}");
        });
        let handle = job.raw_handle();

        // The grandchild may not have spawned the instant `Command::spawn`
        // returned cmd.exe, so poll with a deadline rather than a fixed
        // sleep, matching `child_exits_within`'s style.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut pids = job_process_ids(handle);
        while pids.len() < 2 && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
            pids = job_process_ids(handle);
        }
        assert!(
            pids.len() >= 2,
            "expected the job to contain cmd.exe and its ping.exe grandchild, found {pids:?}"
        );

        job.terminate().unwrap();

        assert!(child_exits_within(
            &mut child,
            std::time::Duration::from_secs(5)
        ));

        // TerminateJobObject asks every member process to exit; give the
        // kernel a moment to finish tearing down ping.exe too instead of
        // asserting on a single snapshot taken right after the call returns.
        let empty_deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        let mut remaining = job_process_ids(handle);
        while !remaining.is_empty() && std::time::Instant::now() < empty_deadline {
            std::thread::sleep(std::time::Duration::from_millis(20));
            remaining = job_process_ids(handle);
        }
        assert!(
            remaining.is_empty(),
            "job object still lists processes after termination: {remaining:?}"
        );
    }
}
