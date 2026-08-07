use crate::platform;
#[cfg(any(target_os = "windows", test))]
use crate::platform::windows::process_snapshot::{
    self, AgentIdentity as WindowsAgent, ProcessClassification, ProcessKind as WindowsProcessKind,
    ProcessSnapshotProvider, SessionProcessRoot, SnapshotError,
};
use crate::pty::{PtySessionSnapshot, PtyState};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::State;

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PaneProcessKind {
    IdleShell,
    Agent,
    Busy,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PaneAgent {
    Claude,
    Codex,
    Gemini,
    OpenCode,
    /// Antigravity CLI — the binary is `agy`, so the lowercase serialization
    /// this enum derives already matches the frontend's `PaneAgent` id.
    Agy,
}

#[derive(Clone, serde::Serialize)]
pub struct PtyInfo {
    pub id: u32,
    pub cwd: Option<String>,
    pub process: Option<String>,
    pub kind: PaneProcessKind,
    pub agent: Option<PaneAgent>,
}

fn classify_process(process: Option<&str>, complete: bool) -> (PaneProcessKind, Option<PaneAgent>) {
    if !complete {
        return (PaneProcessKind::Unknown, None);
    }
    let Some(normalized) = process.and_then(normalized_process_name) else {
        return (PaneProcessKind::Unknown, None);
    };
    let agent = match normalized.as_str() {
        "claude" => Some(PaneAgent::Claude),
        "codex" => Some(PaneAgent::Codex),
        "gemini" => Some(PaneAgent::Gemini),
        "opencode" => Some(PaneAgent::OpenCode),
        "agy" => Some(PaneAgent::Agy),
        _ => None,
    };
    if agent.is_some() {
        return (PaneProcessKind::Agent, agent);
    }
    if matches!(
        normalized.as_str(),
        "zsh" | "bash" | "fish" | "sh" | "dash" | "nu" | "pwsh" | "powershell"
    ) {
        return (PaneProcessKind::IdleShell, None);
    }
    (PaneProcessKind::Busy, None)
}

fn normalized_process_name(process: &str) -> Option<String> {
    let basename = process
        .rsplit(['/', '\\'])
        .next()?
        .trim()
        .to_ascii_lowercase();
    if basename.is_empty() {
        return None;
    }
    Some(
        [".exe", ".cmd", ".bat", ".ps1"]
            .iter()
            .find_map(|suffix| basename.strip_suffix(suffix))
            .unwrap_or(&basename)
            .to_string(),
    )
}

fn unknown_info(snapshot: &PtySessionSnapshot) -> PtyInfo {
    PtyInfo {
        id: snapshot.id,
        cwd: snapshot.cwd.clone(),
        process: None,
        kind: PaneProcessKind::Unknown,
        agent: None,
    }
}

#[cfg(not(target_os = "windows"))]
fn inspect_current_platform(snapshots: &[PtySessionSnapshot]) -> Vec<PtyInfo> {
    snapshots
        .iter()
        .map(|snapshot| {
            let Some(pid) = snapshot.foreground_pid else {
                return unknown_info(snapshot);
            };
            let inspection = platform::inspect_process(pid);
            let (kind, agent) =
                classify_process(inspection.process.as_deref(), inspection.complete);
            PtyInfo {
                id: snapshot.id,
                cwd: inspection.cwd.or_else(|| snapshot.cwd.clone()),
                process: inspection.process,
                kind,
                agent,
            }
        })
        .collect()
}

#[cfg(any(target_os = "windows", test))]
fn windows_roots(snapshots: &[PtySessionSnapshot]) -> Vec<SessionProcessRoot> {
    snapshots
        .iter()
        .map(|snapshot| SessionProcessRoot {
            session_id: snapshot.id,
            process_id: snapshot.identity.and_then(|identity| identity.root_pid()),
            creation_date: snapshot
                .identity
                .and_then(|identity| identity.creation_date()),
        })
        .collect()
}

#[cfg(any(target_os = "windows", test))]
fn map_windows_results(
    snapshots: &[PtySessionSnapshot],
    results: Vec<(u32, Result<ProcessClassification, SnapshotError>)>,
) -> Vec<PtyInfo> {
    let mut results = results.into_iter();
    snapshots
        .iter()
        .map(|snapshot| {
            let Some((id, Ok(classification))) = results.next() else {
                return unknown_info(snapshot);
            };
            if id != snapshot.id {
                return unknown_info(snapshot);
            }
            let kind = match classification.kind {
                WindowsProcessKind::IdleShell => PaneProcessKind::IdleShell,
                WindowsProcessKind::Agent => PaneProcessKind::Agent,
                WindowsProcessKind::Busy => PaneProcessKind::Busy,
            };
            let agent = classification.agent.map(|agent| match agent {
                WindowsAgent::Claude => PaneAgent::Claude,
                WindowsAgent::Codex => PaneAgent::Codex,
                WindowsAgent::Gemini => PaneAgent::Gemini,
                WindowsAgent::OpenCode => PaneAgent::OpenCode,
                WindowsAgent::Agy => PaneAgent::Agy,
            });
            PtyInfo {
                id: snapshot.id,
                cwd: snapshot.cwd.clone(),
                process: classification.process,
                kind,
                agent,
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn inspect_windows(snapshots: &[PtySessionSnapshot]) -> Vec<PtyInfo> {
    let results = platform::windows::inspect_processes(&windows_roots(snapshots));
    map_windows_results(snapshots, results)
}

#[cfg(test)]
fn inspect_windows_with_provider(
    snapshots: &[PtySessionSnapshot],
    provider: &impl ProcessSnapshotProvider,
) -> Vec<PtyInfo> {
    let results = process_snapshot::classify_many(provider, &windows_roots(snapshots));
    map_windows_results(snapshots, results)
}

/// Explicit process truth and cwd for each requested PTY. Inspection failures
/// become per-pane `unknown` entries so the polling command remains usable.
#[tauri::command]
pub async fn pty_info(state: State<'_, PtyState>, ids: Vec<u32>) -> Result<Vec<PtyInfo>, String> {
    let snapshots = state.session_snapshots(&ids);

    #[cfg(target_os = "windows")]
    {
        let fallback = snapshots.clone();
        let task = tauri::async_runtime::spawn_blocking(move || inspect_windows(&snapshots));
        return Ok(task
            .await
            .unwrap_or_else(|_| fallback.iter().map(unknown_info).collect()));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(inspect_current_platform(&snapshots))
    }
}

/// Current branch of the repo containing `cwd`; `None` when not a repo
/// (or git is missing / the lookup fails).
#[tauri::command]
pub async fn git_branch(cwd: String) -> Option<String> {
    let mut command = std::process::Command::new("git");
    command.args(["-C", &cwd, "rev-parse", "--abbrev-ref", "HEAD"]);
    // Suppress the console window flash: this runs once per distinct pane
    // cwd, and release is a GUI-subsystem process with no console to
    // inherit — see `platform::windows::NO_CONSOLE_WINDOW`.
    #[cfg(target_os = "windows")]
    command.creation_flags(platform::windows::NO_CONSOLE_WINDOW);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!branch.is_empty()).then_some(branch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_a_recognized_agent_process() {
        assert_eq!(
            classify_process(Some("claude"), true),
            (PaneProcessKind::Agent, Some(PaneAgent::Claude))
        );
    }

    #[test]
    fn classifies_opencode_from_a_macos_style_process_path() {
        assert_eq!(
            classify_process(Some("/opt/homebrew/bin/opencode"), true),
            (PaneProcessKind::Agent, Some(PaneAgent::OpenCode))
        );
    }

    #[test]
    fn classifies_agy_as_an_agent_not_a_busy_process() {
        assert_eq!(
            classify_process(Some("/Users/dev/.local/bin/agy"), true),
            (PaneProcessKind::Agent, Some(PaneAgent::Agy))
        );
    }

    #[test]
    fn classifies_idle_busy_and_incomplete_processes() {
        assert_eq!(
            classify_process(Some("zsh"), true),
            (PaneProcessKind::IdleShell, None)
        );
        assert_eq!(
            classify_process(Some("/usr/bin/git"), true),
            (PaneProcessKind::Busy, None)
        );
        assert_eq!(
            classify_process(Some("CODEX.EXE"), true),
            (PaneProcessKind::Agent, Some(PaneAgent::Codex))
        );
        assert_eq!(
            classify_process(Some("claude"), false),
            (PaneProcessKind::Unknown, None)
        );
        assert_eq!(
            classify_process(None, true),
            (PaneProcessKind::Unknown, None)
        );
    }

    struct FailingSnapshotProvider;

    impl ProcessSnapshotProvider for FailingSnapshotProvider {
        fn snapshot(
            &self,
        ) -> Result<Vec<process_snapshot::ProcessRecord>, process_snapshot::SnapshotError> {
            Err(SnapshotError::Query("WMI unavailable".into()))
        }
    }

    #[test]
    fn windows_provider_failure_returns_unknown_for_every_requested_id() {
        let snapshots = vec![
            PtySessionSnapshot {
                id: 1,
                identity: Some(platform::SessionIdentity::with_creation_date(
                    Some(10),
                    Some(1_000),
                )),
                cwd: Some(r"C:\work".into()),
                foreground_pid: Some(10),
            },
            PtySessionSnapshot {
                id: 2,
                identity: Some(platform::SessionIdentity::with_creation_date(
                    Some(20),
                    Some(2_000),
                )),
                cwd: None,
                foreground_pid: Some(20),
            },
        ];

        let infos = inspect_windows_with_provider(&snapshots, &FailingSnapshotProvider);

        assert_eq!(infos.len(), 2);
        assert!(infos
            .iter()
            .all(|info| info.kind == PaneProcessKind::Unknown && info.agent.is_none()));
        assert_eq!(infos[0].cwd.as_deref(), Some(r"C:\work"));
    }

    #[test]
    fn serializes_the_explicit_process_contract() {
        let info = PtyInfo {
            id: 7,
            cwd: Some(r"C:\Users\dev".into()),
            process: Some("node".into()),
            kind: PaneProcessKind::Agent,
            agent: Some(PaneAgent::Codex),
        };

        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({
                "id": 7,
                "cwd": r"C:\Users\dev",
                "process": "node",
                "kind": "agent",
                "agent": "codex",
            })
        );
    }

    #[test]
    fn git_branch_is_none_outside_a_repo() {
        let dir = std::env::temp_dir().join("stackgrid-git-none");
        std::fs::create_dir_all(&dir).unwrap();
        let branch = tauri::async_runtime::block_on(git_branch(dir.to_string_lossy().into_owned()));
        assert_eq!(branch, None);
    }

    #[test]
    fn git_branch_reads_the_current_branch() {
        let dir = std::env::temp_dir().join(format!("stackgrid-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            let status = std::process::Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .env("GIT_AUTHOR_NAME", "test")
                .env("GIT_AUTHOR_EMAIL", "test@test")
                .env("GIT_COMMITTER_NAME", "test")
                .env("GIT_COMMITTER_EMAIL", "test@test")
                .status()
                .unwrap();
            assert!(status.success());
        };
        git(&["init", "--initial-branch=main"]);
        git(&["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"]);
        let branch = tauri::async_runtime::block_on(git_branch(dir.to_string_lossy().into_owned()));
        assert_eq!(branch, Some("main".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
