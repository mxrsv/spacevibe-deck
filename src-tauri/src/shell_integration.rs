use std::path::{Path, PathBuf};

const OSC_PREFIX: &[u8] = b"\x1b]";
const MAX_PENDING_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShellIntegrationEvent {
    PromptReady,
    CurrentDirectory(String),
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ShellIntegrationParser {
    pending: Vec<u8>,
}

impl ShellIntegrationParser {
    pub fn parse(self, chunk: &str) -> (Self, Vec<ShellIntegrationEvent>) {
        let mut input = self.pending;
        input.extend_from_slice(chunk.as_bytes());
        if input.len() > MAX_PENDING_BYTES {
            input.drain(..input.len() - MAX_PENDING_BYTES);
        }

        let mut events = Vec::new();
        let mut cursor = 0;
        let mut incomplete_start = None;
        while let Some(relative_start) = find_sequence(&input[cursor..], OSC_PREFIX) {
            let start = cursor + relative_start;
            let payload_start = start + OSC_PREFIX.len();
            let Some((payload_length, terminator_length)) =
                find_terminator(&input[payload_start..])
            else {
                incomplete_start = Some(start);
                break;
            };
            let payload_end = payload_start + payload_length;
            if let Ok(payload) = std::str::from_utf8(&input[payload_start..payload_end]) {
                if let Some(event) = parse_payload(payload) {
                    events.push(event);
                }
            }
            cursor = payload_end + terminator_length;
        }

        let pending = match incomplete_start {
            Some(start) => input[start..].to_vec(),
            None if input.last() == Some(&b'\x1b') => vec![b'\x1b'],
            None => Vec::new(),
        };
        (Self { pending }, events)
    }
}

fn find_sequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn find_terminator(input: &[u8]) -> Option<(usize, usize)> {
    for (index, byte) in input.iter().enumerate() {
        if *byte == b'\x07' {
            return Some((index, 1));
        }
        if *byte == b'\x1b' && input.get(index + 1) == Some(&b'\\') {
            return Some((index, 2));
        }
    }
    None
}

fn parse_payload(payload: &str) -> Option<ShellIntegrationEvent> {
    if payload == "133;B" {
        return Some(ShellIntegrationEvent::PromptReady);
    }
    let cwd = payload.strip_prefix("9;9;")?.trim();
    let cwd = cwd
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(cwd);
    (!cwd.is_empty()).then(|| ShellIntegrationEvent::CurrentDirectory(cwd.to_string()))
}

/// A candidate root that must never reach the filesystem.
///
/// On Windows `\\host\share` is `is_absolute()`, and `is_dir()` on it is a real
/// `CreateFileW` into the MUP/SMB redirector: ~21 s per unreachable host, and
/// Windows offers the interactive user's NTLMv2 credentials to whatever host the
/// candidate names. The candidate comes verbatim off the PTY (`parse_payload`
/// accepts any `9;9;<anything>` with no nonce and no origin check), so terminal
/// output alone must not be able to choose a network destination. Verbatim
/// prefixes are rejected on the same pass — the spec already requires they never
/// flow onward into UI or editor argv.
fn has_rejected_root(candidate: &str, path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};

        let _ = candidate;
        if let Some(Component::Prefix(prefix)) = path.components().next() {
            return matches!(
                prefix.kind(),
                Prefix::UNC(..) | Prefix::VerbatimUNC(..) | Prefix::Verbatim(..)
            );
        }
        false
    }
    #[cfg(not(windows))]
    {
        // Windows path parsing is what classifies a prefix, and it is absent
        // here — so keep the guarantee testable on the macOS dev host with the
        // textual form instead. No legitimate POSIX working directory starts
        // with a backslash pair.
        let _ = path;
        candidate.starts_with(r"\\")
    }
}

pub fn retain_valid_cwd(current: Option<PathBuf>, candidate: &str) -> Option<PathBuf> {
    let candidate = candidate.trim();
    let path = PathBuf::from(candidate);
    if has_rejected_root(candidate, &path) {
        return current;
    }
    if path.is_absolute() && path.is_dir() {
        Some(path)
    } else {
        current
    }
}

#[cfg(test)]
mod tests {
    use super::{retain_valid_cwd, ShellIntegrationEvent, ShellIntegrationParser};
    use std::path::PathBuf;

    #[test]
    fn parses_split_prompt_ready() {
        let marker = "\u{1b}]133;B\u{7}";
        let mut parser = ShellIntegrationParser::default();
        let mut events = Vec::new();

        for character in marker.chars() {
            let (next, found) = parser.parse(&character.to_string());
            parser = next;
            events.extend(found);
        }

        assert_eq!(events, [ShellIntegrationEvent::PromptReady]);
    }

    #[test]
    fn parses_split_windows_cwd() {
        let cwd = r"C:\Users\dev\Space Vibe";
        let marker = format!("\u{1b}]9;9;\"{cwd}\"\u{1b}\\");
        for split in marker
            .char_indices()
            .map(|(index, _)| index)
            .filter(|index| *index > 0)
        {
            let (parser, first) = ShellIntegrationParser::default().parse(&marker[..split]);
            let (_, second) = parser.parse(&marker[split..]);

            assert!(first.is_empty(), "split {split} emitted too early");
            assert_eq!(
                second,
                [ShellIntegrationEvent::CurrentDirectory(cwd.into())],
                "split {split} lost the CWD marker"
            );
        }
    }

    #[test]
    fn rejects_relative_cwd() {
        let current = Some(std::env::temp_dir());

        assert_eq!(
            retain_valid_cwd(current.clone(), "relative/workspace"),
            current
        );
    }

    #[test]
    fn rejects_missing_cwd() {
        let current = Some(std::env::temp_dir());
        let missing = std::env::temp_dir().join("deck-missing-shell-cwd-for-test");

        assert_eq!(
            retain_valid_cwd(current.clone(), &missing.to_string_lossy()),
            current
        );
    }

    #[test]
    fn retains_last_valid_cwd() {
        let valid = std::env::temp_dir();
        let accepted = retain_valid_cwd(None, &valid.to_string_lossy());
        let retained = retain_valid_cwd(accepted, "not/absolute");

        assert_eq!(retained, Some(valid));
    }

    #[test]
    fn rejects_network_and_verbatim_roots() {
        use super::has_rejected_root;

        // Asserted on the predicate, not through retain_valid_cwd: on this
        // dev host a UNC string is not `is_absolute()`, so the outer function
        // already returns `current` and would pass without the guard. The
        // guard is what must stop `is_dir()` from reaching the SMB redirector
        // — and from offering the interactive user's NTLM credentials to
        // whatever host terminal output happened to name.
        for candidate in [
            r"\\10.255.255.1\share",
            r"\\corp\projects\deck",
            r"\\?\C:\Users\dev",
            r"\\?\UNC\corp\projects",
        ] {
            assert!(
                has_rejected_root(candidate, &PathBuf::from(candidate)),
                "{candidate} must be rejected before any filesystem call"
            );
        }
    }

    #[test]
    fn accepts_ordinary_local_roots() {
        use super::has_rejected_root;

        // The guard must not swallow legitimate candidates — a drive-letter
        // path on Windows, and this host's own temp dir everywhere.
        let temp = std::env::temp_dir();
        assert!(!has_rejected_root(&temp.to_string_lossy(), &temp));
        assert!(!has_rejected_root(
            r"C:\Users\dev",
            &PathBuf::from(r"C:\Users\dev")
        ));
    }

    #[test]
    fn retains_current_cwd_for_a_rejected_root() {
        // The end-to-end shape, kept alongside the predicate tests so the
        // wiring is pinned even though this one cannot fail on POSIX.
        let current = Some(std::env::temp_dir());

        assert_eq!(
            retain_valid_cwd(current.clone(), r"\\10.255.255.1\share"),
            current
        );
    }

    #[test]
    fn emits_every_complete_ready_marker() {
        let data = "\u{1b}]133;B\u{7}text\u{1b}]133;B\u{1b}\\";
        let (_, events) = ShellIntegrationParser::default().parse(data);

        assert_eq!(
            events,
            [
                ShellIntegrationEvent::PromptReady,
                ShellIntegrationEvent::PromptReady,
            ]
        );
    }

    #[test]
    fn incomplete_noise_stays_bounded() {
        let noise = format!("\u{1b}]9;9;{}", "x".repeat(300_000));
        let (parser, events) = ShellIntegrationParser::default().parse(&noise);

        assert!(events.is_empty());
        assert!(parser.pending.len() < 300_000);
    }
}
