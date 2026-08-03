use serde::Serialize;
use std::time::Duration;

/// Login shells that hang (e.g. a `.zprofile` waiting on network) must not
/// wedge the picker forever — degrade to empty after this.
pub(crate) const DETECT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AgentInfo {
    pub name: String,
    pub path: String,
}

/// Recognised out of the box; always probed, whatever the caller asks for.
/// Mirrors `BUILTIN_AGENTS` in src/lib/agent-catalog.ts.
pub(crate) const BUILTIN_AGENTS: [&str; 4] = ["claude", "codex", "gemini", "opencode"];

/// Upper bound on a probed name; mirrors `PROBE_NAME_MAX` in agent-catalog.ts.
const PROBE_NAME_MAX: usize = 128;

/// Whether a name may be interpolated into the discovery probe.
///
/// This is a security boundary, not a tidiness check. macOS discovery builds
/// `command -v <name>` strings and runs them through `sh -ilc`, so a name
/// carrying `;`, `&`, `|`, `$`, a backtick, a quote or whitespace would
/// execute. The frontend validates too; this check exists because the
/// frontend is not the trust boundary — the command arrives over IPC and any
/// page bug or future caller lands here first.
pub(crate) fn is_probe_safe(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= PROBE_NAME_MAX
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '~' | '+' | '/' | '-'))
}

/// The names to probe: every built-in, then each safe caller-supplied name not
/// already present. Built-ins are unconditional so a frontend bug can never
/// collapse the picker to Shell only.
pub(crate) fn probe_names(requested: Vec<String>) -> Vec<String> {
    let mut names: Vec<String> = BUILTIN_AGENTS.iter().map(|name| (*name).to_string()).collect();
    for name in requested {
        if is_probe_safe(&name) && !names.iter().any(|existing| *existing == name) {
            names.push(name);
        }
    }
    names
}

/// The basename a probed name resolves to. A declared agent may be a path
/// (`~/bin/agent.sh`), while `command -v` answers with the resolved absolute
/// path — so both sides are compared by their last segment.
pub(crate) fn probe_key(name: &str) -> &str {
    name.rsplit(['/', '\\']).next().unwrap_or(name)
}

/// Strip terminal control sequences from one line. An interactive login shell
/// (`-ilc`) runs rc-file hooks that print terminal noise with no trailing
/// newline — iTerm shell-integration OSC sequences (`ESC ] … BEL|ST`),
/// powerlevel10k CSI color codes (`ESC [ … <final>`) — so that noise prefixes
/// the first real output line and hides the `command -v` path behind it. Bytes
/// outside escapes are copied verbatim (UTF-8 paths survive); lossy-decode at
/// the end covers any escape that split a multi-byte boundary.
fn strip_ansi(line: &str) -> String {
    let bytes = line.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != 0x1b {
            out.push(bytes[i]);
            i += 1;
            continue;
        }
        match bytes.get(i + 1) {
            // CSI: parameters until a final byte in 0x40..=0x7E.
            Some(b'[') => {
                i += 2;
                while i < bytes.len() && !(0x40..=0x7e).contains(&bytes[i]) {
                    i += 1;
                }
                i += 1; // consume the final byte (or step past the end)
            }
            // OSC: string until BEL (0x07) or ST (ESC \).
            Some(b']') => {
                i += 2;
                while i < bytes.len() {
                    if bytes[i] == 0x07 {
                        i += 1;
                        break;
                    }
                    if bytes[i] == 0x1b && bytes.get(i + 1) == Some(&b'\\') {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
            }
            // Any other 2-byte escape (charset select, etc.): drop both bytes.
            Some(_) => i += 2,
            // Trailing lone ESC at end of line.
            None => i += 1,
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Keep only absolute paths whose basename was asked for, first hit per name
/// wins, result ordered by first appearance (the script emits `probed` order,
/// so numbering in the picker is stable).
pub(crate) fn parse_command_v_output(output: &str, probed: &[String]) -> Vec<AgentInfo> {
    let wanted: Vec<&str> = probed.iter().map(|name| probe_key(name)).collect();
    let mut found: Vec<AgentInfo> = Vec::new();
    for line in output.lines() {
        let stripped = strip_ansi(line);
        let path = stripped.trim();
        if !path.starts_with('/') {
            continue;
        }
        let Some(name) = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
        else {
            continue;
        };
        if wanted.contains(&name) && !found.iter().any(|a| a.name == name) {
            found.push(AgentInfo {
                name: name.to_string(),
                path: path.to_string(),
            });
        }
    }
    found
}

/// Resolve the allowlist through the user's INTERACTIVE LOGIN shell — the same
/// shell a real pane runs (`spawn_shell` runs `-l` on a PTY, which is
/// interactive). The `-i` is load-bearing: CLIs like `claude` register their
/// PATH in `.zshrc`/`.bashrc`, which a non-interactive shell (`-lc`) never
/// sources. Under launchd (the packaged .app) the GUI inherits only a bare
/// PATH, so a non-interactive probe finds nothing and the picker collapses to
/// Shell only — while `tauri dev`, launched from a terminal, inherits the
/// terminal's PATH and masks the bug. Interactive-login matches the panes and
/// fixes both. Any failure (spawn error, non-blocking-pool panic, or a hung rc
/// file past `DETECT_TIMEOUT`) degrades to an empty list (picker then shows
/// Shell only — FR-025) instead of blocking a Tokio worker thread forever.
/// `names` are the caller's declared agent binaries; they are re-filtered here
/// and merged with the built-ins by `probe_names`.
#[tauri::command]
pub async fn detect_agents(names: Vec<String>) -> Vec<AgentInfo> {
    crate::platform::discover_agents(probe_names(names)).await
}

/// Existence check for workspace recents (FR-003 AC-2); order mirrors input.
#[tauri::command]
pub async fn dirs_exist(paths: Vec<String>) -> Vec<bool> {
    paths
        .iter()
        .map(|path| std::path::Path::new(path).is_dir())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn builtins() -> Vec<String> {
        BUILTIN_AGENTS.iter().map(|name| (*name).to_string()).collect()
    }

    #[test]
    fn probe_safety_rejects_every_shell_metacharacter() {
        // Each of these, interpolated into `command -v <name>` under `sh -ilc`,
        // would run something the user never asked to run.
        for name in [
            "x; rm -rf ~",
            "x && rm -rf ~",
            "x | tee /tmp/x",
            "$(id)",
            "`id`",
            "x>out",
            "x<in",
            "a b",
            "a\nb",
            "a\tb",
            "'x'",
            "\"x\"",
            "x(1)",
            "x{1}",
            "x[1]",
            "x*",
            "x?",
            "x!",
            "x#c",
            "x\\y",
            "x%y",
            "x=y",
            "x:y",
            "x,y",
            "x@y",
            "x^y",
            "",
        ] {
            assert!(!is_probe_safe(name), "{name} must not reach the shell");
        }
    }

    #[test]
    fn probe_safety_accepts_real_binary_names_and_paths() {
        for name in ["aider", "my-agent_1", "~/bin/agent.sh", "/opt/bin/claude", "g++"] {
            assert!(is_probe_safe(name), "{name} is a legitimate binary name");
        }
        assert!(is_probe_safe(&"a".repeat(PROBE_NAME_MAX)));
        assert!(!is_probe_safe(&"a".repeat(PROBE_NAME_MAX + 1)));
    }

    #[test]
    fn probe_names_keeps_builtins_whatever_the_caller_sends() {
        // A frontend bug (empty list) or a hostile one (all-invalid) must never
        // collapse the picker to Shell only.
        assert_eq!(probe_names(Vec::new()), builtins());
        assert_eq!(probe_names(vec!["x; rm -rf ~".into()]), builtins());
    }

    #[test]
    fn probe_names_appends_safe_requests_once() {
        let names = probe_names(vec!["aider".into(), "aider".into(), "claude".into()]);
        let mut expected = builtins();
        expected.push("aider".into());
        assert_eq!(names, expected);
    }

    #[test]
    fn parse_matches_a_declared_path_by_its_basename() {
        // `command -v ~/bin/agent.sh` answers with the resolved absolute path,
        // so the two sides only ever agree on the last segment.
        let out = "/Users/dev/bin/agent.sh\n";
        assert_eq!(
            parse_command_v_output(out, &["~/bin/agent.sh".to_string()]),
            vec![AgentInfo {
                name: "agent.sh".into(),
                path: "/Users/dev/bin/agent.sh".into()
            }]
        );
    }

    #[test]
    fn parses_absolute_paths_in_allowlist_order() {
        let out =
            "/usr/local/bin/claude\n/Users/dev/.local/bin/gemini\n/opt/homebrew/bin/opencode\n";
        assert_eq!(
            parse_command_v_output(out, &builtins()),
            vec![
                AgentInfo {
                    name: "claude".into(),
                    path: "/usr/local/bin/claude".into()
                },
                AgentInfo {
                    name: "gemini".into(),
                    path: "/Users/dev/.local/bin/gemini".into()
                },
                AgentInfo {
                    name: "opencode".into(),
                    path: "/opt/homebrew/bin/opencode".into()
                },
            ]
        );
    }

    #[test]
    fn ignores_non_paths_and_unknown_binaries() {
        // `command -v` may echo aliases/functions or nothing; keep only
        // absolute paths whose basename is on the allowlist.
        let out = "alias claude='claude --tips'\n/usr/local/bin/ripgrep\n\n/opt/bin/codex\n";
        assert_eq!(
            parse_command_v_output(out, &builtins()),
            vec![AgentInfo {
                name: "codex".into(),
                path: "/opt/bin/codex".into()
            }]
        );
    }

    #[test]
    fn dedupes_repeated_names() {
        let out = "/a/claude\n/b/claude\n";
        assert_eq!(parse_command_v_output(out, &builtins()).len(), 1);
    }

    #[test]
    fn recovers_path_buried_behind_iterm_osc_noise() {
        // An interactive login shell (`-ilc`) runs iTerm shell-integration
        // hooks that emit OSC 1337 sequences with no trailing newline, so they
        // prefix the first path line. Verbatim capture from a real machine.
        let out = "[oh-my-zsh] theme 'x/y' not found\n\
            \x1b]1337;RemoteHost=user@host\x07\
            \x1b]1337;CurrentDir=/Users/dev/proj\x07\
            \x1b]1337;ShellIntegrationVersion=14;shell=zsh\x07\
            /Users/dev/.local/bin/claude\n";
        assert_eq!(
            parse_command_v_output(out, &builtins()),
            vec![AgentInfo {
                name: "claude".into(),
                path: "/Users/dev/.local/bin/claude".into()
            }]
        );
    }

    #[test]
    fn strips_powerlevel10k_csi_color_codes() {
        // p10k wraps output in CSI color/style codes; ST-terminated OSC too.
        let out = "\x1b[32m\x1b[1m/opt/homebrew/bin/codex\x1b[0m\n\
            \x1b]0;title\x1b\\/usr/local/bin/gemini\n";
        assert_eq!(
            parse_command_v_output(out, &builtins()),
            vec![
                AgentInfo {
                    name: "codex".into(),
                    path: "/opt/homebrew/bin/codex".into()
                },
                AgentInfo {
                    name: "gemini".into(),
                    path: "/usr/local/bin/gemini".into()
                },
            ]
        );
    }

    #[test]
    fn strip_ansi_preserves_utf8_paths() {
        assert_eq!(
            strip_ansi("\x1b[1m/Users/bình/.local/bin/claude\x1b[0m"),
            "/Users/bình/.local/bin/claude"
        );
    }

    #[test]
    fn dirs_exist_checks_each_path() {
        let tmp = std::env::temp_dir();
        let missing = tmp.join("stackgrid-definitely-missing-dir");
        let results = tauri::async_runtime::block_on(dirs_exist(vec![
            tmp.to_string_lossy().into_owned(),
            missing.to_string_lossy().into_owned(),
        ]));
        assert_eq!(results, vec![true, false]);
    }
}
