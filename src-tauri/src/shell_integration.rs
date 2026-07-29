use std::path::PathBuf;

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

pub fn retain_valid_cwd(current: Option<PathBuf>, candidate: &str) -> Option<PathBuf> {
    let candidate = candidate.trim();
    let path = PathBuf::from(candidate);
    if path.is_absolute() && path.is_dir() {
        Some(path)
    } else {
        current
    }
}

#[cfg(test)]
mod tests {
    use super::{retain_valid_cwd, ShellIntegrationEvent, ShellIntegrationParser};

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
