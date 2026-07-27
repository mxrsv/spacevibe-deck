use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

/// Upper bound on one hover's resolve batch — the frontend already caps its
/// candidates per line, this just keeps a hostile/garbled line cheap.
const MAX_PATHS: usize = 64;

/// A GUI editor returns immediately; anything still running past this has
/// launched (or the login shell is hanging) — either way, stop waiting.
const EDITOR_TIMEOUT: Duration = Duration::from_secs(10);

/// How often the launched editor is checked for having exited. Short enough
/// that a "command not found" surfaces immediately, long enough to be free.
const EDITOR_POLL: Duration = Duration::from_millis(25);

fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_default()
}

fn expand_tilde(raw: &str, home: &str) -> PathBuf {
    if raw == "~" {
        return PathBuf::from(home);
    }
    match raw.strip_prefix("~/") {
        Some(rest) => Path::new(home).join(rest),
        None => PathBuf::from(raw),
    }
}

/// Absolute path of `raw` when it is an existing FILE, else `None`.
///
/// `base` is `None` when the pane's cwd is not known. A relative candidate is
/// then unresolvable and comes back `None`: guessing a base would let
/// `src/main.ts` printed by an agent in `~/work/api` resolve to an unrelated
/// `~/src/main.ts` that happens to exist, and ⌘+click would open the wrong
/// file with the hover text looking exactly right. An absolute or `~` path
/// carries its own base and still resolves.
///
/// Directories are deliberately not linkified: there is no line to jump to and
/// `code -g <dir>:1:1` is meaningless.
fn resolve_one(base: Option<&Path>, home: &str, raw: &str) -> Option<String> {
    let expanded = expand_tilde(raw, home);
    let full = if expanded.is_absolute() {
        expanded
    } else {
        base?.join(expanded)
    };
    let canonical = std::fs::canonicalize(full).ok()?;
    canonical
        .is_file()
        .then(|| canonical.to_string_lossy().into_owned())
}

/// Resolve terminal-link path candidates against a pane's cwd. The result is
/// index-aligned with `paths`; a candidate that is not an existing file (or a
/// candidate past `MAX_PATHS`) comes back as `None`. An empty `cwd` — a pane
/// whose info has not been polled yet, or whose foreground process the kernel
/// will not report on — resolves only the candidates that are already absolute;
/// see `resolve_one` for why relative ones are dropped rather than guessed at.
#[tauri::command]
pub async fn resolve_paths(cwd: String, paths: Vec<String>) -> Vec<Option<String>> {
    let home = home_dir();
    let base = (!cwd.is_empty()).then(|| PathBuf::from(&cwd));
    paths
        .iter()
        .enumerate()
        .map(|(i, raw)| {
            if i < MAX_PATHS {
                resolve_one(base.as_deref(), &home, raw)
            } else {
                None
            }
        })
        .collect()
}

/// Run the user's editor command through their LOGIN shell. A macOS GUI process
/// inherits a stripped `PATH`, so `code` / `cursor` / `zed` are only reachable
/// via `$SHELL -lc` (the same trick as `detect_agents`). The command is built
/// frontend-side from the configured template with the path already escaped.
///
/// The child is polled rather than waited on: `Command::output()` blocks its
/// thread until the process exits, so an editor that does not fork (`vim`, a
/// wrapper script that waits) would park a blocking thread for the life of the
/// app — one more on every ⌘+click — and the surrounding timeout could not
/// reclaim it. Polling lets the timeout return while the child keeps running on
/// its own.
#[tauri::command]
pub async fn open_editor(command: String) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("No editor command is configured.".to_string());
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut child = std::process::Command::new(&shell)
        .args(["-lc", &command])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        // Kept so a failing command ("command not found") can be reported.
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Couldn't start the editor: {err}"))?;

    let deadline = Instant::now() + EDITOR_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if Instant::now() >= deadline {
                    // A GUI editor returns at once; anything still alive here
                    // has launched and owns its own lifetime from now on.
                    return Ok(());
                }
                tokio::time::sleep(EDITOR_POLL).await;
            }
            Err(err) => return Err(format!("Couldn't start the editor: {err}")),
        }
    };
    if status.success() {
        return Ok(());
    }
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        let _ = pipe.read_to_string(&mut stderr);
    }
    let stderr = stderr.trim().to_string();
    Err(if stderr.is_empty() {
        format!("The editor command exited with {status}.")
    } else {
        stderr
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_dir() -> PathBuf {
        let dir = std::env::temp_dir().join("stackgrid-links-test");
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/foo.ts"), "x").unwrap();
        dir
    }

    #[test]
    fn resolves_a_relative_path_against_the_cwd() {
        let dir = fixture_dir();
        let resolved = resolve_one(Some(&dir), "", "src/foo.ts").unwrap();
        assert!(resolved.ends_with("/src/foo.ts"));
    }

    #[test]
    fn resolves_an_absolute_path_ignoring_the_cwd() {
        let dir = fixture_dir();
        let abs = dir.join("src/foo.ts").to_string_lossy().into_owned();
        assert!(resolve_one(Some(Path::new("/nowhere")), "", &abs).is_some());
    }

    #[test]
    fn expands_a_tilde_path() {
        let dir = fixture_dir();
        let home = dir.to_string_lossy().into_owned();
        assert!(resolve_one(Some(Path::new("/nowhere")), &home, "~/src/foo.ts").is_some());
    }

    #[test]
    fn rejects_a_missing_file() {
        let dir = fixture_dir();
        assert_eq!(resolve_one(Some(&dir), "", "src/nope.ts"), None);
    }

    #[test]
    fn rejects_a_directory() {
        let dir = fixture_dir();
        assert_eq!(resolve_one(Some(&dir), "", "src"), None);
    }

    /// An unknown cwd must not silently borrow one: a relative candidate that
    /// happens to exist under some other root would open the wrong file.
    #[test]
    fn drops_a_relative_path_when_the_cwd_is_unknown() {
        let dir = fixture_dir();
        let home = dir.to_string_lossy().into_owned();
        assert_eq!(resolve_one(None, &home, "src/foo.ts"), None);
    }

    #[test]
    fn still_resolves_absolute_and_tilde_paths_when_the_cwd_is_unknown() {
        let dir = fixture_dir();
        let home = dir.to_string_lossy().into_owned();
        let abs = dir.join("src/foo.ts").to_string_lossy().into_owned();
        assert!(resolve_one(None, &home, &abs).is_some());
        assert!(resolve_one(None, &home, "~/src/foo.ts").is_some());
    }

    #[test]
    fn resolve_paths_with_an_empty_cwd_keeps_only_the_absolute_candidates() {
        let dir = fixture_dir();
        let abs = dir.join("src/foo.ts").to_string_lossy().into_owned();
        let results = tauri::async_runtime::block_on(resolve_paths(
            String::new(),
            vec!["src/foo.ts".into(), abs],
        ));
        assert_eq!(results[0], None);
        assert!(results[1].is_some());
    }

    #[test]
    fn resolve_paths_keeps_the_input_order() {
        let dir = fixture_dir();
        let cwd = dir.to_string_lossy().into_owned();
        let results = tauri::async_runtime::block_on(resolve_paths(
            cwd,
            vec!["nope.ts".into(), "src/foo.ts".into()],
        ));
        assert_eq!(results.len(), 2);
        assert!(results[0].is_none());
        assert!(results[1].is_some());
    }

    #[test]
    fn open_editor_rejects_an_empty_command() {
        assert!(tauri::async_runtime::block_on(open_editor("  ".into())).is_err());
    }

    #[test]
    fn open_editor_reports_a_failing_command_with_its_stderr() {
        let result = tauri::async_runtime::block_on(open_editor(
            "echo 'no such editor' >&2; exit 3".into(),
        ));
        let message = result.expect_err("a non-zero exit must surface as an error");
        assert!(
            message.contains("no such editor"),
            "stderr should reach the user, got: {message}"
        );
    }

    #[test]
    fn open_editor_succeeds_for_a_command_that_exits_cleanly() {
        assert!(tauri::async_runtime::block_on(open_editor("true".into())).is_ok());
    }
}
