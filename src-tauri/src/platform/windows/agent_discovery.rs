use crate::agents::{AgentInfo, AGENT_ALLOWLIST, DETECT_TIMEOUT};
use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::time::Duration;

trait AgentSearchProvider: Send {
    fn find(&self, name: &str) -> Result<Option<String>, String>;
}

const COMMAND_SUFFIXES: [&str; 5] = ["", ".exe", ".cmd", ".bat", ".ps1"];

/// Resolve `name` against `path` the way a Windows command actually needs to
/// be found: probing PATHEXT-style suffixes, not just `.exe`. `Command::new`
/// and Rust's std `resolve_exe` only append `.exe`, so a tool that ships only
/// as a shim (`.cmd`/`.bat`/`.ps1`, no bare `.exe` on PATH at all) is
/// otherwise unfindable. `pub(crate)` because `links.rs` hits the identical
/// gap for the built-in `code`/`cursor` editor commands and reuses this
/// directly rather than re-implementing the probe.
pub(crate) fn resolve_on_path(name: &str, path: &OsStr) -> Option<String> {
    for directory in std::env::split_paths(path).filter(|directory| directory.is_absolute()) {
        for suffix in COMMAND_SUFFIXES {
            let candidate = directory.join(format!("{name}{suffix}"));
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }
    None
}

struct EnvironmentAgentSearchProvider {
    path: Option<OsString>,
}

impl EnvironmentAgentSearchProvider {
    fn from_environment() -> Self {
        Self {
            path: std::env::var_os("PATH"),
        }
    }
}

impl AgentSearchProvider for EnvironmentAgentSearchProvider {
    fn find(&self, name: &str) -> Result<Option<String>, String> {
        let Some(path) = self.path.as_ref() else {
            return Ok(None);
        };
        Ok(resolve_on_path(name, path))
    }
}

fn is_absolute_windows_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    let drive_absolute = bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/');
    let unc_absolute = value.starts_with(r"\\")
        && value[2..]
            .split(['\\', '/'])
            .filter(|component| !component.is_empty())
            .count()
            >= 2;
    drive_absolute || unc_absolute
}

fn normalize_agent_name(path: &str) -> Option<String> {
    let basename = path.rsplit(['\\', '/']).next()?.to_ascii_lowercase();
    let normalized = [".exe", ".cmd", ".bat", ".ps1"]
        .iter()
        .find_map(|suffix| basename.strip_suffix(suffix))
        .unwrap_or(&basename);
    AGENT_ALLOWLIST
        .iter()
        .find(|allowed| **allowed == normalized)
        .map(|allowed| (*allowed).to_string())
}

fn discover_sync(provider: &impl AgentSearchProvider) -> Result<Vec<AgentInfo>, String> {
    let mut seen = HashSet::new();
    let mut agents = Vec::new();
    for requested_name in AGENT_ALLOWLIST {
        let Some(path) = provider.find(requested_name)? else {
            continue;
        };
        let Some(name) = normalize_agent_name(&path) else {
            continue;
        };
        if name != requested_name || !is_absolute_windows_path(&path) || !seen.insert(name.clone())
        {
            continue;
        }
        agents.push(AgentInfo { name, path });
    }
    Ok(agents)
}

async fn discover_with_provider(
    provider: impl AgentSearchProvider + 'static,
    timeout: Duration,
) -> Vec<AgentInfo> {
    let task = tauri::async_runtime::spawn_blocking(move || discover_sync(&provider));
    match tokio::time::timeout(timeout, task).await {
        Ok(Ok(Ok(agents))) => agents,
        Ok(Ok(Err(error))) => {
            eprintln!("Windows agent discovery failed: {error}");
            Vec::new()
        }
        Ok(Err(error)) => {
            eprintln!("Windows agent discovery task failed: {error}");
            Vec::new()
        }
        Err(_) => {
            eprintln!("Windows agent discovery timed out");
            Vec::new()
        }
    }
}

pub(super) async fn discover_agents() -> Vec<AgentInfo> {
    discover_with_provider(
        EnvironmentAgentSearchProvider::from_environment(),
        DETECT_TIMEOUT,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::{discover_sync, discover_with_provider, AgentSearchProvider};
    use crate::agents::AgentInfo;
    use std::collections::HashMap;
    use std::time::Duration;

    struct FixtureProvider {
        paths: HashMap<String, String>,
    }

    impl FixtureProvider {
        fn new(entries: &[(&str, &str)]) -> Self {
            Self {
                paths: entries
                    .iter()
                    .map(|(name, path)| ((*name).to_string(), (*path).to_string()))
                    .collect(),
            }
        }
    }

    impl AgentSearchProvider for FixtureProvider {
        fn find(&self, name: &str) -> Result<Option<String>, String> {
            Ok(self.paths.get(name).cloned())
        }
    }

    #[test]
    fn accepts_absolute_allowlisted_commands() {
        let provider = FixtureProvider::new(&[
            ("claude", r"C:\Users\dev\bin\claude.cmd"),
            ("codex", r"\\tools\agents\codex.exe"),
            ("gemini", "D:/Agents/gemini.ps1"),
        ]);

        assert_eq!(
            discover_sync(&provider).unwrap(),
            vec![
                AgentInfo {
                    name: "claude".into(),
                    path: r"C:\Users\dev\bin\claude.cmd".into(),
                },
                AgentInfo {
                    name: "codex".into(),
                    path: r"\\tools\agents\codex.exe".into(),
                },
                AgentInfo {
                    name: "gemini".into(),
                    path: "D:/Agents/gemini.ps1".into(),
                },
            ]
        );
    }

    #[test]
    fn rejects_relative_or_wrong_basename() {
        let provider = FixtureProvider::new(&[
            ("claude", r".\bin\claude.cmd"),
            ("codex", r"C:\Tools\not-codex.exe"),
            ("gemini", r"C:\Tools\gemini.zip"),
        ]);

        assert!(discover_sync(&provider).unwrap().is_empty());
    }

    #[test]
    fn normalizes_windows_suffixes() {
        let provider = FixtureProvider::new(&[
            ("claude", r"C:\Tools\CLAUDE.EXE"),
            ("codex", r"C:\Tools\CoDeX.BaT"),
            ("gemini", r"C:\Tools\GEMINI.PS1"),
        ]);

        let names = discover_sync(&provider)
            .unwrap()
            .into_iter()
            .map(|agent| agent.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["claude", "codex", "gemini"]);
    }

    struct SlowProvider;

    impl AgentSearchProvider for SlowProvider {
        fn find(&self, _name: &str) -> Result<Option<String>, String> {
            std::thread::sleep(Duration::from_millis(50));
            Ok(None)
        }
    }

    #[test]
    fn times_out_to_empty() {
        let agents = tauri::async_runtime::block_on(discover_with_provider(
            SlowProvider,
            Duration::from_millis(1),
        ));

        assert!(agents.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn searches_a_real_windows_path_entry() {
        let directory = std::env::temp_dir().join("deck-windows-agent-search-test");
        std::fs::create_dir_all(&directory).unwrap();
        let executable = directory.join("claude.cmd");
        std::fs::write(&executable, "@echo off").unwrap();
        let path = std::env::join_paths([&directory]).unwrap();
        let provider = super::EnvironmentAgentSearchProvider { path: Some(path) };

        assert_eq!(
            provider.find("claude").unwrap().as_deref(),
            Some(executable.to_string_lossy().as_ref())
        );

        std::fs::remove_dir_all(directory).unwrap();
    }
}
