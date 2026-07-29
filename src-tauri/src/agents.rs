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

/// Allowlist aligned with the chrome recognition names (ARCH D6).
pub(crate) const AGENT_ALLOWLIST: [&str; 3] = ["claude", "codex", "gemini"];

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

/// Keep only absolute paths whose basename is allowlisted, first hit per
/// name wins, result ordered by first appearance (script emits allowlist
/// order, so numbering in the picker is stable).
pub(crate) fn parse_command_v_output(output: &str) -> Vec<AgentInfo> {
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
        if AGENT_ALLOWLIST.contains(&name) && !found.iter().any(|a| a.name == name) {
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
#[tauri::command]
pub async fn detect_agents() -> Vec<AgentInfo> {
    crate::platform::discover_agents().await
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

    #[test]
    fn parses_absolute_paths_in_allowlist_order() {
        let out = "/usr/local/bin/claude\n/Users/dev/.local/bin/gemini\n";
        assert_eq!(
            parse_command_v_output(out),
            vec![
                AgentInfo {
                    name: "claude".into(),
                    path: "/usr/local/bin/claude".into()
                },
                AgentInfo {
                    name: "gemini".into(),
                    path: "/Users/dev/.local/bin/gemini".into()
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
            parse_command_v_output(out),
            vec![AgentInfo {
                name: "codex".into(),
                path: "/opt/bin/codex".into()
            }]
        );
    }

    #[test]
    fn dedupes_repeated_names() {
        let out = "/a/claude\n/b/claude\n";
        assert_eq!(parse_command_v_output(out).len(), 1);
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
            parse_command_v_output(out),
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
            parse_command_v_output(out),
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
