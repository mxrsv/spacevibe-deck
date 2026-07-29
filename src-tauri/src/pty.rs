use crate::coordinator::{emit_to_owner, WindowCoordinator};
use crate::platform::{self, PlatformName, PlatformSession};
use crate::shell_integration::{retain_valid_cwd, ShellIntegrationEvent, ShellIntegrationParser};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

pub const EVENT_OUTPUT: &str = "pty:output";
pub const EVENT_EXIT: &str = "pty:exit";
pub const EVENT_PROMPT_READY: &str = "pty:prompt-ready";

#[derive(Clone, serde::Serialize)]
struct OutputPayload {
    id: u32,
    data: String,
}

#[derive(Clone, serde::Serialize)]
struct ExitPayload {
    id: u32,
}

#[derive(Clone, serde::Serialize)]
struct PromptReadyPayload {
    id: u32,
}

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    platform: PlatformSession,
    shell_integration: ShellIntegrationParser,
    cwd: Option<PathBuf>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<u32, Session>>,
    next_id: AtomicU32,
}

/// Drains the longest decodable prefix of `pending` into a String, leaving an
/// incomplete trailing UTF-8 sequence (at most 3 bytes) behind for the next
/// read. Invalid bytes inside the stream become U+FFFD and are consumed, so a
/// malformed byte can never stall the pipeline.
fn take_valid_utf8(pending: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(s) => {
                out.push_str(s);
                pending.clear();
                return out;
            }
            Err(e) => {
                let valid = e.valid_up_to();
                // The prefix up to the error is valid by definition.
                out.push_str(std::str::from_utf8(&pending[..valid]).unwrap_or(""));
                match e.error_len() {
                    // Incomplete sequence at the end — keep it for the next read.
                    None => {
                        pending.drain(..valid);
                        return out;
                    }
                    // Genuinely invalid bytes — replace and keep scanning.
                    Some(len) => {
                        out.push('\u{FFFD}');
                        pending.drain(..valid + len);
                    }
                }
            }
        }
    }
}

/// Bound on the reader→emitter queue. `sync_channel` blocks the reader once
/// the queue is full, so a fast producer (`cat` a huge file, `yes`) backs up
/// into the PTY pipe and gets throttled by the kernel — an unbounded channel
/// would let the queue grow to the size of the output instead.
const QUEUE_CHUNKS: usize = 64;

/// Cap for a single emitted batch — large enough to absorb a bursty `cat`,
/// small enough that one IPC message stays cheap.
const BATCH_MAX_BYTES: usize = 64 * 1024;

/// Append `first` plus any already-queued chunks to `out`, up to `cap` bytes.
/// Order is preserved. A chunk that would push the batch past `cap` is parked
/// in `held` for the next call (std mpsc cannot peek / un-recv).
///
/// Appending straight into the caller's buffer keeps this to one copy per
/// chunk; building an intermediate batch would copy every byte twice.
fn collect_batch(
    first: Vec<u8>,
    rx: &mpsc::Receiver<Vec<u8>>,
    cap: usize,
    held: &mut Option<Vec<u8>>,
    out: &mut Vec<u8>,
) {
    let mut len = first.len();
    out.extend_from_slice(&first);
    loop {
        if len >= cap {
            break;
        }
        let chunk = match held.take() {
            Some(chunk) => chunk,
            None => match rx.try_recv() {
                Ok(chunk) => chunk,
                Err(mpsc::TryRecvError::Empty | mpsc::TryRecvError::Disconnected) => break,
            },
        };
        if len != 0 && len + chunk.len() > cap {
            *held = Some(chunk);
            break;
        }
        out.extend_from_slice(&chunk);
        len += chunk.len();
    }
}

fn remove_session(app: &AppHandle, id: u32) {
    let state = app.state::<PtyState>();
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.remove(&id);
    };
}

fn consume_shell_integration(app: &AppHandle, id: u32, data: &str) {
    let events = {
        let state = app.state::<PtyState>();
        let Ok(mut sessions) = state.sessions.lock() else {
            return;
        };
        let Some(session) = sessions.get_mut(&id) else {
            return;
        };
        let parser = std::mem::take(&mut session.shell_integration);
        let (next_parser, events) = parser.parse(data);
        let next_cwd = events
            .iter()
            .fold(session.cwd.clone(), |current, event| match event {
                ShellIntegrationEvent::CurrentDirectory(candidate) => {
                    retain_valid_cwd(current, candidate)
                }
                ShellIntegrationEvent::PromptReady => current,
            });
        session.shell_integration = next_parser;
        session.cwd = next_cwd;
        events
    };

    let coordinator = app.state::<WindowCoordinator>();
    for event in events {
        if event == ShellIntegrationEvent::PromptReady {
            emit_to_owner(
                app,
                &coordinator,
                id,
                EVENT_PROMPT_READY,
                PromptReadyPayload { id },
            );
        }
    }
}

/// Working directory for a new shell: an existing directory passes through;
/// anything else falls back to the platform's validated user profile.
fn resolve_spawn_cwd(
    cwd: Option<String>,
    home: Result<std::path::PathBuf, String>,
) -> Result<String, String> {
    if let Some(directory) = cwd.filter(|directory| std::path::Path::new(directory).is_dir()) {
        return Ok(directory);
    }
    home.map(|directory| directory.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn spawn_shell(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, PtyState>,
    coordinator: State<'_, WindowCoordinator>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let launch = platform::shell_launch()?;
    let mut cmd = CommandBuilder::new(&launch.executable);
    for arg in launch.args {
        cmd.arg(arg);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Own identity — tools can detect Deck without ConEmu spoofing. No space
    // in the value: every terminal in the wild ships a single token here
    // (`iTerm.app`, `Apple_Terminal`, `ghostty`), and naive parsers split on
    // whitespace, so the product name loses its space rather than its meaning.
    // Keep ConEmuANSI below until OSC 9;4 emitters recognize TERM_PROGRAM.
    cmd.env("TERM_PROGRAM", "SpaceVibeDeck");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    if platform::current_platform() == PlatformName::Macos {
        // Deck consumes OSC 9;4 progress reports (the sidebar spinner),
        // but Claude Code only emits them when it recognizes the terminal:
        // its gate checks ConEmu* env vars or TERM_PROGRAM ghostty/iTerm.app
        // with a minimum TERM_PROGRAM_VERSION. ConEmuANSI=ON is the smallest
        // such capability flag — ConEmu is Windows-only, so no macOS tool
        // changes behavior on it (and on a real Windows build we must NOT
        // fake it: tools pick ConEmu-specific paths on a plain ConPTY).
        // Own TERM_PROGRAM is set above so we can drop this spoof once
        // Claude Code (and peers) recognize Deck by name.
        // Verified empirically (PTY harness): without this claude emits zero
        // OSC 9;4; with it, state 0 at startup, 3 while working, 0 when done.
        cmd.env("ConEmuANSI", "ON");
    }
    cmd.cwd(resolve_spawn_cwd(cwd, platform::user_home())?);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let child_pid = child.process_id();
    let platform_session = match platform::create_session(child_pid) {
        Ok(session) => session,
        Err(error) => {
            let mut killer = child.clone_killer();
            let _ = killer.kill();
            return Err(error);
        }
    };

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    {
        let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
        sessions.insert(
            id,
            Session {
                master: pair.master,
                writer,
                killer: child.clone_killer(),
                platform: platform_session,
                shell_integration: ShellIntegrationParser::default(),
                cwd: None,
            },
        );
    }
    // Ownership seam: pane stays tied to the spawning window until Move to window.
    coordinator.register(id, window.label().to_string());

    // Reader forwards raw bytes; emitter batches + decodes. No timer — when
    // emit keeps up, each chunk goes straight through; when the webview is
    // slower, try_recv drains the backlog into larger IPC messages. The
    // channel is bounded so that backlog cannot outgrow QUEUE_CHUNKS.
    let (tx, rx) = mpsc::sync_channel::<Vec<u8>>(QUEUE_CHUNKS);
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
        // Drop tx so the emitter sees Disconnected and runs the exit path.
    });

    let output_app = app.clone();
    thread::spawn(move || {
        // Multi-byte UTF-8 sequences can straddle chunk boundaries; lossy-
        // decoding each batch independently turns the split halves into
        // U+FFFD. Hold back an incomplete trailing sequence instead.
        let mut pending: Vec<u8> = Vec::new();
        let mut held: Option<Vec<u8>> = None;
        loop {
            let first = match held.take() {
                Some(chunk) => chunk,
                None => match rx.recv() {
                    Ok(chunk) => chunk,
                    Err(mpsc::RecvError) => break,
                },
            };
            collect_batch(first, &rx, BATCH_MAX_BYTES, &mut held, &mut pending);
            let data = take_valid_utf8(&mut pending);
            if data.is_empty() {
                continue;
            }
            consume_shell_integration(&output_app, id, &data);
            let coordinator = output_app.state::<WindowCoordinator>();
            emit_to_owner(
                &output_app,
                &coordinator,
                id,
                EVENT_OUTPUT,
                OutputPayload { id, data },
            );
        }
        // Channel closed — flush whatever is left, lossily, then exit. `held`
        // is necessarily None here: the loop only reaches `recv` (and so only
        // breaks) on an iteration that found nothing parked.
        if !pending.is_empty() {
            let data = String::from_utf8_lossy(&pending).to_string();
            consume_shell_integration(&output_app, id, &data);
            let coordinator = output_app.state::<WindowCoordinator>();
            emit_to_owner(
                &output_app,
                &coordinator,
                id,
                EVENT_OUTPUT,
                OutputPayload { id, data },
            );
        }
        remove_session(&output_app, id);
        {
            let coordinator = output_app.state::<WindowCoordinator>();
            // Emit exit while ownership is still known, then clear the map.
            emit_to_owner(
                &output_app,
                &coordinator,
                id,
                EVENT_EXIT,
                ExitPayload { id },
            );
            coordinator.unregister(id);
        }
    });

    thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });

    Ok(id)
}

#[tauri::command]
pub fn write_pty(state: State<PtyState>, id: u32, data: String) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| format!("Terminal session #{id} not found"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_pty(state: State<PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&id)
        .ok_or_else(|| format!("Terminal session #{id} not found"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn kill_pty(
    state: State<'_, PtyState>,
    coordinator: State<'_, WindowCoordinator>,
    id: u32,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get_mut(&id) {
        platform::terminate_session(
            &session.platform,
            platform::foreground_process_group(session.master.as_ref()),
            session.killer.as_mut(),
        )?;
        sessions.remove(&id);
    }
    coordinator.unregister(id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{collect_batch, take_valid_utf8, QUEUE_CHUNKS};
    use std::sync::mpsc;

    #[test]
    fn collect_batch_concatenates_queued_chunks_in_order() {
        let (tx, rx) = mpsc::sync_channel(QUEUE_CHUNKS);
        tx.send(b"bb".to_vec()).unwrap();
        tx.send(b"cc".to_vec()).unwrap();
        let mut held = None;
        let mut out = Vec::new();
        collect_batch(b"aa".to_vec(), &rx, 64 * 1024, &mut held, &mut out);
        assert_eq!(out, b"aabbcc");
        assert!(held.is_none());
    }

    #[test]
    fn collect_batch_appends_after_an_incomplete_tail() {
        // `out` is the emitter's `pending`, which may already hold the first
        // bytes of a UTF-8 sequence split across reads — those must survive.
        let (_tx, rx) = mpsc::sync_channel::<Vec<u8>>(QUEUE_CHUNKS);
        let mut held = None;
        let mut out = vec![0xE1, 0xBB]; // leading two bytes of "ố"
        collect_batch(vec![0x91], &rx, 64 * 1024, &mut held, &mut out);
        assert_eq!(String::from_utf8(out).unwrap(), "ố");
    }

    #[test]
    fn collect_batch_stops_at_cap_and_holds_the_overflow_chunk() {
        let (tx, rx) = mpsc::sync_channel(QUEUE_CHUNKS);
        let chunk = vec![b'x'; 30 * 1024];
        tx.send(chunk.clone()).unwrap();
        tx.send(chunk.clone()).unwrap();
        tx.send(chunk.clone()).unwrap();
        let mut held = None;
        let mut out = Vec::new();
        let first = rx.recv().unwrap();
        collect_batch(first, &rx, 64 * 1024, &mut held, &mut out);
        assert_eq!(out.len(), 60 * 1024);
        assert_eq!(held.as_ref().map(|c| c.len()), Some(30 * 1024));
        // Nothing left in rx — the overflow sits in `held` for the next call
        // (std mpsc cannot put a chunk back after try_recv).
        assert!(rx.try_recv().is_err());
    }

    #[test]
    fn collect_batch_returns_first_when_queue_is_empty() {
        let (_tx, rx) = mpsc::sync_channel::<Vec<u8>>(QUEUE_CHUNKS);
        let mut held = None;
        let mut out = Vec::new();
        collect_batch(b"solo".to_vec(), &rx, 64 * 1024, &mut held, &mut out);
        assert_eq!(out, b"solo");
        assert!(held.is_none());
    }

    #[test]
    fn passes_through_complete_utf8() {
        let mut pending = "chào ─── bạn".as_bytes().to_vec();
        assert_eq!(take_valid_utf8(&mut pending), "chào ─── bạn");
        assert!(pending.is_empty());
    }

    #[test]
    fn holds_back_split_box_drawing_char() {
        // "──" = E2 94 80 E2 94 80; split mid-second-char like a read boundary
        let bytes = "──".as_bytes();
        let mut pending = bytes[..4].to_vec();
        assert_eq!(take_valid_utf8(&mut pending), "─");
        assert_eq!(pending, &bytes[3..4]); // partial E2 held back

        pending.extend_from_slice(&bytes[4..]);
        assert_eq!(take_valid_utf8(&mut pending), "─");
        assert!(pending.is_empty());
    }

    #[test]
    fn holds_back_split_vietnamese_char() {
        // "ố" = E1 BB 91 (3 bytes); boundary after the first byte
        let bytes = "sống".as_bytes();
        let mut pending = bytes[..2].to_vec(); // "s" + first byte of "ố"
        assert_eq!(take_valid_utf8(&mut pending), "s");
        pending.extend_from_slice(&bytes[2..]);
        assert_eq!(take_valid_utf8(&mut pending), "ống");
        assert!(pending.is_empty());
    }

    #[test]
    fn replaces_truly_invalid_bytes_without_stalling() {
        let mut pending = vec![b'a', 0xFF, b'b'];
        assert_eq!(take_valid_utf8(&mut pending), "a\u{FFFD}b");
        assert!(pending.is_empty());
    }

    #[test]
    fn empty_input_yields_empty_string() {
        let mut pending = Vec::new();
        assert_eq!(take_valid_utf8(&mut pending), "");
    }

    #[test]
    fn resolve_spawn_cwd_accepts_an_existing_dir() {
        let dir = std::env::temp_dir().to_string_lossy().into_owned();
        assert_eq!(
            super::resolve_spawn_cwd(Some(dir.clone()), Err("unused".into())).unwrap(),
            dir
        );
    }

    #[cfg(target_os = "macos")]
    mod terminate_process_groups {
        use crate::platform::macos::terminate_process_groups;
        use std::os::unix::process::CommandExt;
        use std::process::{Child, Command};
        use std::time::{Duration, Instant};

        /// Spawns `/bin/sh -c <script>` as the leader of a fresh process
        /// group, standing in for a shell (or its foreground job) on the PTY.
        fn spawn_in_own_group(script: &str) -> Child {
            Command::new("/bin/sh")
                .arg("-c")
                .arg(script)
                .process_group(0)
                .spawn()
                .expect("spawn test process")
        }

        fn exits_within(child: &mut Child, timeout: Duration) -> bool {
            let deadline = Instant::now() + timeout;
            while Instant::now() < deadline {
                if child.try_wait().expect("try_wait").is_some() {
                    return true;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            false
        }

        #[test]
        fn sigkills_the_shell_group_even_when_hup_is_ignored() {
            let mut child = spawn_in_own_group("trap '' HUP; sleep 300");
            let pgid = child.id() as i32;
            // Grace far beyond the assertion window: only the immediate
            // shell-group SIGKILL can make this pass.
            terminate_process_groups(None, Some(pgid), Duration::from_secs(30));
            assert!(
                exits_within(&mut child, Duration::from_secs(1)),
                "shell process group survived kill"
            );
        }

        #[test]
        fn hangs_up_the_foreground_group_without_waiting_for_the_grace() {
            let mut child = spawn_in_own_group("sleep 300");
            let pgid = child.id() as i32;
            terminate_process_groups(Some(pgid), None, Duration::from_secs(30));
            assert!(
                exits_within(&mut child, Duration::from_secs(1)),
                "foreground group did not receive SIGHUP"
            );
        }

        /// The audited leak: SIGKILL on the shell pid alone left HUP-ignoring
        /// descendants holding the slave fd, so the reader thread never saw
        /// EOF. Exercises the same calls kill_pty makes, on a real PTY.
        #[test]
        fn kill_path_frees_the_pty_reader_even_with_hup_ignoring_children() {
            use portable_pty::{native_pty_system, CommandBuilder, PtySize};
            use std::io::Read;

            let pair = native_pty_system()
                .openpty(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .expect("openpty");
            let mut cmd = CommandBuilder::new("/bin/sh");
            cmd.arg("-c");
            cmd.arg("trap '' HUP; sleep 300");
            let mut child = pair.slave.spawn_command(cmd).expect("spawn shell");
            drop(pair.slave);
            let mut reader = pair.master.try_clone_reader().expect("clone reader");

            // Let sh install the trap before signals arrive.
            std::thread::sleep(Duration::from_millis(200));
            terminate_process_groups(
                pair.master.process_group_leader(),
                child.process_id().map(|pid| pid as i32),
                Duration::from_secs(30),
            );

            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => continue,
                    }
                }
                let _ = tx.send(());
            });
            assert!(
                rx.recv_timeout(Duration::from_secs(3)).is_ok(),
                "PTY reader never saw EOF — descendants still hold the slave fd"
            );
            let _ = child.wait();
        }

        #[test]
        fn escalates_a_hup_ignoring_foreground_group_to_sigkill() {
            let mut child = spawn_in_own_group("trap '' HUP; sleep 300");
            // Let sh install the trap before the HUP arrives.
            std::thread::sleep(Duration::from_millis(200));
            let pgid = child.id() as i32;
            terminate_process_groups(Some(pgid), None, Duration::from_millis(200));
            assert!(
                exits_within(&mut child, Duration::from_secs(3)),
                "HUP-ignoring foreground group was never SIGKILLed"
            );
        }
    }

    #[test]
    fn resolve_spawn_cwd_falls_back_to_home() {
        let home = std::env::temp_dir().to_string_lossy().into_owned();
        assert_eq!(
            super::resolve_spawn_cwd(
                Some("/definitely/not/a/dir".into()),
                Ok(std::env::temp_dir())
            )
            .unwrap(),
            home
        );
        assert_eq!(
            super::resolve_spawn_cwd(None, Ok(std::env::temp_dir())).unwrap(),
            home
        );
    }

    #[test]
    fn resolve_spawn_cwd_reports_a_missing_home() {
        assert_eq!(
            super::resolve_spawn_cwd(None, Err("home unavailable".into())),
            Err("home unavailable".into())
        );
    }
}

impl PtyState {
    /// Foreground process id per session: the PTY's foreground process
    /// group leader, falling back to the spawned child pid.
    pub fn foreground_pids(&self, ids: &[u32]) -> Vec<(u32, Option<i32>)> {
        let sessions = match self.sessions.lock() {
            Ok(sessions) => sessions,
            Err(_) => return ids.iter().map(|&id| (id, None)).collect(),
        };
        ids.iter()
            .map(|&id| {
                let pid = sessions.get(&id).and_then(|session| {
                    platform::foreground_process_group(session.master.as_ref())
                        .filter(|pid| *pid > 0)
                        .or_else(|| session.platform.identity().root_pid().map(|pid| pid as i32))
                });
                (id, pid)
            })
            .collect()
    }
}
