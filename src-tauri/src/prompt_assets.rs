//! Read-only scan of the skills / subagents an agent CLI has on disk.
//!
//! No shell, no PTY, no new crates: this walks a handful of known directories,
//! reads the head of each descriptor file and returns what it found. It is not
//! one of the R4 load-bearing seams. A missing directory, an unreadable file or
//! an unknown agent is an empty list, never an error — the Prompt Board still
//! pastes templates when detection finds nothing.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Bytes read from any descriptor file. Frontmatter sits at the top, so a
/// multi-megabyte SKILL.md must never be pulled into memory to find it.
const HEAD_BYTES: usize = 16 * 1024;

/// Upper bound per kind — a pathological plugin cache cannot flood the picker.
const RESULT_CAP: usize = 200;

/// Descriptions land in a `<select>` option; past this they are noise.
const DESCRIPTION_MAX: usize = 256;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Skill,
    Subagent,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AssetSource {
    Global,
    Project,
    Plugin,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAsset {
    pub kind: AssetKind,
    /// Qualified exactly as the CLI would address it (`plugin:skill` included).
    pub name: String,
    pub description: String,
    pub source: AssetSource,
}

#[derive(Debug, Default, Eq, PartialEq, Serialize)]
pub struct PromptAssets {
    pub skills: Vec<PromptAsset>,
    pub subagents: Vec<PromptAsset>,
}

/// Strip one layer of matching single/double quotes, if present.
fn unquote(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && (bytes[0] == b'"' || bytes[0] == b'\'')
        && bytes[bytes.len() - 1] == bytes[0]
    {
        return &value[1..value.len() - 1];
    }
    value
}

fn assign(
    is_name: bool,
    value: String,
    name: &mut Option<String>,
    description: &mut Option<String>,
) {
    if is_name {
        name.get_or_insert(value);
    } else {
        description.get_or_insert(value);
    }
}

/// The `name:` / `description:` of a YAML frontmatter block.
///
/// Deliberately not a YAML parser (zero new dependencies): every SKILL.md and
/// agent `.md` verified on disk 2026-08-08 carries these two as plain,
/// quoted, or folded/literal (`>`, `|`) scalars, and a folded scalar's
/// indented continuation lines are joined with single spaces. Anything else in
/// the block is skipped rather than guessed at.
pub(crate) fn parse_frontmatter(head: &str) -> (Option<String>, Option<String>) {
    let mut lines = head.lines();
    if lines.next().map(str::trim) != Some("---") {
        return (None, None);
    }
    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    // Which field a folded/literal block is collecting, and what it has so far.
    let mut folding: Option<(bool, String)> = None;
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if folding.is_some() && (indented || line.trim().is_empty()) {
            let piece = line.trim();
            if !piece.is_empty() {
                let (_, joined) = folding.as_mut().expect("checked just above");
                if !joined.is_empty() {
                    joined.push(' ');
                }
                joined.push_str(piece);
            }
            continue;
        }
        if let Some((is_name, joined)) = folding.take() {
            assign(is_name, joined, &mut name, &mut description);
        }
        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let is_name = match key.trim() {
            "name" => true,
            "description" => false,
            _ => continue,
        };
        let value = rest.trim();
        if matches!(value, ">" | "|" | ">-" | "|-" | ">+" | "|+") {
            folding = Some((is_name, String::new()));
            continue;
        }
        assign(
            is_name,
            unquote(value).to_string(),
            &mut name,
            &mut description,
        );
    }
    if let Some((is_name, joined)) = folding {
        assign(is_name, joined, &mut name, &mut description);
    }
    (name, description)
}

/// A top-level `description = "..."` in a Codex agent `.toml`.
///
/// Scanning stops at the first table header or multi-line (`"""`) value: a
/// `description` below either is not the agent's own. Not a TOML parser, for
/// the same zero-dependency reason as `parse_frontmatter`.
pub(crate) fn parse_toml_description(head: &str) -> Option<String> {
    for line in head.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') || trimmed.contains("\"\"\"") {
            break;
        }
        let Some((key, rest)) = trimmed.split_once('=') else {
            continue;
        };
        if key.trim() != "description" {
            continue;
        }
        let value = unquote(rest.trim());
        return if value.is_empty() {
            None
        } else {
            Some(value.to_string())
        };
    }
    None
}

/// One line, collapsed whitespace, clamped to `DESCRIPTION_MAX` characters
/// (not bytes — clamping mid-codepoint would panic on a UTF-8 boundary).
pub(crate) fn clamp_description(value: Option<String>) -> String {
    let text = value.unwrap_or_default();
    let flattened = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.chars().count() <= DESCRIPTION_MAX {
        return flattened;
    }
    flattened.chars().take(DESCRIPTION_MAX).collect()
}

/// The first `HEAD_BYTES` of a regular file.
///
/// `None` for a symlink, a directory, an unreadable file or an IO error.
/// Symlinks are refused rather than followed: one can point straight out of
/// the scanned tree, and this scan promises to stay inside it.
pub(crate) fn read_head(path: &Path) -> Option<String> {
    let meta = std::fs::symlink_metadata(path).ok()?;
    if meta.file_type().is_symlink() || !meta.is_file() {
        return None;
    }
    let mut file = std::fs::File::open(path).ok()?;
    let mut buffer = vec![0u8; HEAD_BYTES];
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(_) => return None,
        }
    }
    buffer.truncate(filled);
    Some(String::from_utf8_lossy(&buffer).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_plain_frontmatter_scalars() {
        let head = "---\nname: code-review\ndescription: Parallel code review.\n---\n# Body\n";
        assert_eq!(
            parse_frontmatter(head),
            (
                Some("code-review".to_string()),
                Some("Parallel code review.".to_string())
            )
        );
    }

    #[test]
    fn unquotes_a_quoted_scalar() {
        let head = "---\nname: brainstorming\ndescription: \"You MUST use this first.\"\n---\n";
        assert_eq!(
            parse_frontmatter(head).1,
            Some("You MUST use this first.".to_string())
        );
    }

    #[test]
    fn joins_a_folded_scalar_into_one_line() {
        let head = "---\nname: dataviz\ndescription: >\n  Use this whenever you\n  build a chart.\ntools: Read\n---\n";
        assert_eq!(
            parse_frontmatter(head),
            (
                Some("dataviz".to_string()),
                Some("Use this whenever you build a chart.".to_string())
            )
        );
    }

    #[test]
    fn ignores_a_file_with_no_frontmatter_block() {
        assert_eq!(parse_frontmatter("# Just a heading\n"), (None, None));
    }

    #[test]
    fn stops_at_the_closing_fence() {
        let head = "---\nname: a\n---\ndescription: not frontmatter\n";
        assert_eq!(parse_frontmatter(head).1, None);
    }

    #[test]
    fn reads_a_top_level_toml_description() {
        let head = "name = \"plan-reviewer\"\ndescription = \"Reviews plans.\"\nmodel = \"inherit\"\n";
        assert_eq!(
            parse_toml_description(head),
            Some("Reviews plans.".to_string())
        );
    }

    #[test]
    fn ignores_a_description_inside_a_table_or_a_multiline_block() {
        assert_eq!(
            parse_toml_description("[nested]\ndescription = \"not mine\"\n"),
            None
        );
        assert_eq!(
            parse_toml_description("developer_instructions = \"\"\"\ndescription = \"not mine\"\n"),
            None
        );
    }

    #[test]
    fn clamps_and_flattens_a_description() {
        let long = "a ".repeat(400);
        let clamped = clamp_description(Some(long));
        assert_eq!(clamped.chars().count(), DESCRIPTION_MAX);
        assert_eq!(clamp_description(Some("a\n  b\n".into())), "a b");
        assert_eq!(clamp_description(None), "");
    }

    #[test]
    fn read_head_stops_at_the_byte_cap_and_skips_symlinks() {
        let dir = std::env::temp_dir().join("deck-prompt-assets-read-head");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let big = dir.join("big.md");
        std::fs::write(&big, "x".repeat(HEAD_BYTES + 500)).unwrap();
        assert_eq!(read_head(&big).unwrap().len(), HEAD_BYTES);

        #[cfg(unix)]
        {
            let link = dir.join("link.md");
            std::os::unix::fs::symlink(&big, &link).unwrap();
            assert!(read_head(&link).is_none());
        }
        assert!(read_head(&dir.join("missing.md")).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
