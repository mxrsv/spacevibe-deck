use crate::platform;
use crate::pty::PtyState;
use tauri::State;

#[derive(Clone, serde::Serialize)]
pub struct PtyInfo {
    pub id: u32,
    pub cwd: Option<String>,
    pub process: Option<String>,
}

/// Foreground process name + cwd for each PTY. Lookup failures degrade to
/// `None` fields — the command itself never fails in practice, so the
/// frontend polling loop keeps running.
#[tauri::command]
pub async fn pty_info(state: State<'_, PtyState>, ids: Vec<u32>) -> Result<Vec<PtyInfo>, String> {
    let pids = state.foreground_pids(&ids);
    Ok(pids
        .into_iter()
        .map(|(id, pid)| match pid {
            Some(pid) => {
                let inspection = platform::inspect_process(pid);
                PtyInfo {
                    id,
                    cwd: inspection.cwd,
                    process: inspection.process,
                }
            }
            None => PtyInfo {
                id,
                cwd: None,
                process: None,
            },
        })
        .collect())
}

/// Current branch of the repo containing `cwd`; `None` when not a repo
/// (or git is missing / the lookup fails).
#[tauri::command]
pub async fn git_branch(cwd: String) -> Option<String> {
    let output = std::process::Command::new("git")
        .args(["-C", &cwd, "rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .ok()?;
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
