//! Where the transcripts are, and which session each file belongs to.

use super::{
    CLAUDE_DIR, CLAUDE_PROJECTS_DIR, CLAUDE_SUBAGENTS_DIR, CODEX_ARCHIVED_DIR, CODEX_DIR,
    CODEX_ROLLOUT_PREFIX, CODEX_SESSIONS_DIR, IDENTITY_HEAD_BYTES, MAX_WALK_DEPTH,
    TRANSCRIPT_EXTENSION,
};
use std::path::{Path, PathBuf};

/// Up to `cap` bytes of a file, truncated at the first newline.
///
/// Deliberately not `BufRead::read_line`: a subagent transcript opens with a
/// `type: "user"` line that can carry a pasted blob, and an unbounded read
/// here would reintroduce exactly the hazard the capped line reader exists to
/// remove.
fn read_first_line(path: &Path, cap: usize) -> Option<Vec<u8>> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut head = Vec::new();
    file.take(cap as u64).read_to_end(&mut head).ok()?;
    let end = head
        .iter()
        .position(|byte| *byte == b'\n')
        .unwrap_or(head.len());
    head.truncate(end);
    Some(head)
}

/// FNV-1a, 64-bit. Not a security hash — it exists so a file whose first line
/// names no session still gets a stable, content-free identity.
fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// A file's session identity, from its first line.
///
/// Claude writes `sessionId` on every line including the first; Codex writes
/// `payload.id` (and the identical `payload.session_id`) on its `session_meta`
/// line. When neither is there — 1 of 200 real subagent files opens with a
/// `fork-context-ref` line — the fallback is a **hash** of the head, never the
/// head itself: the cache must not store conversation bytes (privacy
/// contract).
fn identity_from_head(head: &[u8]) -> String {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(head) {
        let named = value
            .get("sessionId")
            .and_then(serde_json::Value::as_str)
            .or_else(|| {
                value
                    .get("payload")
                    .and_then(|payload| payload.get("id"))
                    .and_then(serde_json::Value::as_str)
            })
            .or_else(|| {
                value
                    .get("payload")
                    .and_then(|payload| payload.get("session_id"))
                    .and_then(serde_json::Value::as_str)
            });
        if let Some(identity) = named.filter(|text| !text.is_empty()) {
            return identity.to_string();
        }
    }
    format!("h:{:016x}", fnv1a64(head))
}

pub(crate) fn file_identity(path: &Path) -> Option<String> {
    read_first_line(path, IDENTITY_HEAD_BYTES).map(|head| identity_from_head(&head))
}

/// Whether a source root could be looked at, before anything was read from it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DiscoveryState {
    /// The root does not exist. The honest "no data yet".
    Missing,
    /// The root exists but cannot be listed. NOT the same as missing (spec,
    /// major M7) — it is an error state the UI has to show as one.
    Unreadable,
    Present,
}

pub(crate) struct Discovery {
    pub(crate) files: Vec<PathBuf>,
    pub(crate) state: DiscoveryState,
}

pub(crate) struct CodexDiscovery {
    pub(crate) active: Vec<PathBuf>,
    pub(crate) archived: Vec<PathBuf>,
    pub(crate) state: DiscoveryState,
}

/// Regular, non-symlinked entries of `dir` matching `prefix` (when given) and
/// the transcript extension. Symlinks are refused rather than followed: one
/// can point straight out of the scanned tree.
fn push_transcripts(dir: &Path, prefix: Option<&str>, out: &mut Vec<PathBuf>) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let is_file = entry
            .file_type()
            .map(|kind| kind.is_file() && !kind.is_symlink())
            .unwrap_or(false);
        if !is_file {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some(TRANSCRIPT_EXTENSION) {
            continue;
        }
        if let Some(prefix) = prefix {
            let matches = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with(prefix))
                .unwrap_or(false);
            if !matches {
                continue;
            }
        }
        out.push(path);
    }
    true
}

/// Directory entries of `dir` that are real directories, sorted.
fn child_dirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .collect();
    dirs.sort();
    dirs
}

/// `<home>/.claude/projects/*/*.jsonl` and everything under
/// `<home>/.claude/projects/*/*/subagents/`, at any depth up to the cap.
///
/// Both globs, not just the first: subagent transcripts are ~47% of this
/// machine's Claude history by size, and omitting them undercounts by almost
/// half (spec, blocker B3). Recursive because `subagents/workflows/<id>/`
/// nests one level deeper than the flat `subagents/<agent>.jsonl` the first
/// draft assumed.
pub(crate) fn discover_claude(home: &Path) -> Discovery {
    let root = home.join(CLAUDE_DIR).join(CLAUDE_PROJECTS_DIR);
    if !root.exists() {
        return Discovery {
            files: Vec::new(),
            state: DiscoveryState::Missing,
        };
    }
    let Ok(projects) = std::fs::read_dir(&root) else {
        return Discovery {
            files: Vec::new(),
            state: DiscoveryState::Unreadable,
        };
    };
    let mut files = Vec::new();
    let mut project_dirs: Vec<PathBuf> = projects
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .collect();
    project_dirs.sort();
    for project in project_dirs {
        push_transcripts(&project, None, &mut files);
        for session in child_dirs(&project) {
            walk_subagents(&session.join(CLAUDE_SUBAGENTS_DIR), 0, &mut files);
        }
    }
    files.sort();
    Discovery {
        files,
        state: DiscoveryState::Present,
    }
}

/// Every transcript under a `subagents/` directory, at any depth up to the
/// cap. Symlinked directories are never descended (see `child_dirs`), so a
/// loop cannot be built out of them either.
fn walk_subagents(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth > MAX_WALK_DEPTH {
        return;
    }
    push_transcripts(dir, None, out);
    for child in child_dirs(dir) {
        walk_subagents(&child, depth + 1, out);
    }
}

/// Every `rollout-*.jsonl` under a Codex root, at any depth up to the cap.
///
/// Recursive because the two roots have different shapes: `sessions/` is
/// `YYYY/MM/DD/`, while `archived_sessions/` is FLAT on the dev machine
/// (verified 2026-08-10, against the spec's implication that both are dated).
/// The depth cap bounds a pathological tree; symlinked directories are never
/// descended, so a loop cannot be built out of them either.
fn walk_rollouts(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) -> bool {
    if depth > MAX_WALK_DEPTH {
        return true;
    }
    if !push_transcripts(dir, Some(CODEX_ROLLOUT_PREFIX), out) {
        return false;
    }
    for child in child_dirs(dir) {
        walk_rollouts(&child, depth + 1, out);
    }
    true
}

/// `<home>/.codex/sessions/**` and `<home>/.codex/archived_sessions/**`.
///
/// Missing only when BOTH roots are absent — a machine that has archived
/// sessions but no live ones still has data to show.
pub(crate) fn discover_codex(home: &Path) -> CodexDiscovery {
    let base = home.join(CODEX_DIR);
    let live = base.join(CODEX_SESSIONS_DIR);
    let old = base.join(CODEX_ARCHIVED_DIR);
    let live_exists = live.exists();
    let old_exists = old.exists();
    if !live_exists && !old_exists {
        return CodexDiscovery {
            active: Vec::new(),
            archived: Vec::new(),
            state: DiscoveryState::Missing,
        };
    }
    let mut active = Vec::new();
    let mut archived = Vec::new();
    let mut readable = false;
    if live_exists && walk_rollouts(&live, 0, &mut active) {
        readable = true;
    }
    if old_exists && walk_rollouts(&old, 0, &mut archived) {
        readable = true;
    }
    active.sort();
    archived.sort();
    CodexDiscovery {
        active,
        archived,
        state: if readable {
            DiscoveryState::Present
        } else {
            DiscoveryState::Unreadable
        },
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::usage::cache::tests::fixture;

    pub(crate) fn write_file(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn names(paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn discovers_claude_session_and_subagent_transcripts() {
        let home = fixture("discover-claude");
        let projects = home
            .join(".claude")
            .join("projects")
            .join("-Users-dev-repo");
        write_file(&projects.join("sess-1.jsonl"), "{}\n");
        write_file(&projects.join("sess-2.jsonl"), "{}\n");
        write_file(
            &projects
                .join("sess-1")
                .join("subagents")
                .join("agent-a.jsonl"),
            "{}\n",
        );
        // `subagents/workflows/<id>/` nests deeper than the flat layout the
        // first draft assumed — the walk must still reach it.
        write_file(
            &projects
                .join("sess-1")
                .join("subagents")
                .join("workflows")
                .join("wf-1")
                .join("agent-b.jsonl"),
            "{}\n",
        );
        // Neighbours that are not transcripts must not be picked up.
        write_file(&projects.join("sess-1").join("MEMORY.md"), "notes\n");
        write_file(
            &projects.join("sess-1").join("tool-results").join("r.jsonl"),
            "{}\n",
        );
        write_file(&projects.join("notes.txt"), "text\n");

        let found = discover_claude(&home);
        assert!(matches!(found.state, DiscoveryState::Present));
        assert_eq!(
            names(&found.files),
            vec![
                "agent-a.jsonl",
                "agent-b.jsonl",
                "sess-1.jsonl",
                "sess-2.jsonl"
            ]
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn tells_a_missing_claude_root_apart_from_an_unreadable_one() {
        let home = fixture("claude-missing");
        let found = discover_claude(&home);
        assert!(matches!(found.state, DiscoveryState::Missing));
        assert!(found.files.is_empty());

        // `projects` exists but is a regular file: it exists, and `read_dir`
        // on it fails. That is the M7 "unreadable", not "no data yet".
        let broken = fixture("claude-unreadable");
        write_file(&broken.join(".claude").join("projects"), "not a directory");
        let found = discover_claude(&broken);
        assert!(matches!(found.state, DiscoveryState::Unreadable));
        assert!(found.files.is_empty());

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&broken);
    }

    #[test]
    fn discovers_codex_rollouts_under_both_the_dated_and_the_flat_layout() {
        let home = fixture("discover-codex");
        let codex = home.join(".codex");
        write_file(
            &codex.join("sessions/2026/08/10/rollout-2026-08-10T11-45-40-a.jsonl"),
            "{}\n",
        );
        write_file(
            &codex.join("sessions/2026/08/09/rollout-2026-08-09T09-00-00-b.jsonl"),
            "{}\n",
        );
        // archived_sessions is FLAT on the dev machine, verified 2026-08-10.
        write_file(
            &codex.join("archived_sessions/rollout-2026-04-27T12-16-52-c.jsonl"),
            "{}\n",
        );
        // Not a rollout, and not a transcript extension.
        write_file(&codex.join("sessions/2026/08/10/notes.jsonl"), "{}\n");
        write_file(&codex.join("sessions/2026/08/10/rollout-x.txt"), "{}\n");

        let found = discover_codex(&home);
        assert!(matches!(found.state, DiscoveryState::Present));
        assert_eq!(
            names(&found.active),
            vec![
                "rollout-2026-08-09T09-00-00-b.jsonl",
                "rollout-2026-08-10T11-45-40-a.jsonl",
            ]
        );
        assert_eq!(
            names(&found.archived),
            vec!["rollout-2026-04-27T12-16-52-c.jsonl"]
        );

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn codex_is_missing_only_when_both_roots_are_absent() {
        let home = fixture("codex-missing");
        assert!(matches!(
            discover_codex(&home).state,
            DiscoveryState::Missing
        ));

        // Only the archived root exists: present, not missing.
        let partial = fixture("codex-archived-only");
        write_file(
            &partial.join(".codex/archived_sessions/rollout-a.jsonl"),
            "{}\n",
        );
        let found = discover_codex(&partial);
        assert!(matches!(found.state, DiscoveryState::Present));
        assert!(found.active.is_empty());
        assert_eq!(found.archived.len(), 1);

        // A `sessions` that is a file, with no archived root at all.
        let broken = fixture("codex-unreadable");
        write_file(&broken.join(".codex").join("sessions"), "not a directory");
        assert!(matches!(
            discover_codex(&broken).state,
            DiscoveryState::Unreadable
        ));

        let _ = std::fs::remove_dir_all(&home);
        let _ = std::fs::remove_dir_all(&partial);
        let _ = std::fs::remove_dir_all(&broken);
    }

    #[test]
    fn reads_the_session_identity_out_of_the_first_line() {
        // Claude: `sessionId` on whatever the first line happens to be.
        assert_eq!(
            identity_from_head(br#"{"type":"mode","sessionId":"aa8311ee","mode":"x"}"#),
            "aa8311ee"
        );
        // Codex: `payload.id`, with `payload.session_id` as the fallback the
        // spec names (§0.4 erratum 3 — both keys exist and agree).
        assert_eq!(
            identity_from_head(
                br#"{"type":"session_meta","payload":{"session_id":"019fe9fd","id":"019fe9fd"}}"#
            ),
            "019fe9fd"
        );
        assert_eq!(
            identity_from_head(br#"{"type":"session_meta","payload":{"session_id":"only"}}"#),
            "only"
        );
    }

    #[test]
    fn falls_back_to_a_hash_when_the_first_line_carries_no_session_id() {
        // 1 of 200 real subagent files opens with a `fork-context-ref` line
        // that has no sessionId, so the fallback is not hypothetical.
        let one = identity_from_head(br#"{"type":"fork-context-ref","ref":"abc"}"#);
        let two = identity_from_head(br#"{"type":"fork-context-ref","ref":"abd"}"#);
        assert!(one.starts_with("h:"));
        assert_ne!(one, two, "different first lines are different identities");
        assert_eq!(
            one,
            identity_from_head(br#"{"type":"fork-context-ref","ref":"abc"}"#)
        );
        // Not valid JSON at all still yields a stable identity.
        assert!(identity_from_head(b"half a line").starts_with("h:"));
        // The hash is over bytes, never over stored content: the identity is
        // 18 characters no matter how long the line was.
        assert_eq!(one.len(), 18);
    }

    #[test]
    fn the_identity_read_is_bounded_and_stops_at_the_first_newline() {
        let dir = fixture("identity-head");
        let path = dir.join("big.jsonl");
        let mut contents = format!(r#"{{"sessionId":"sess-1","blob":"{}"}}"#, "x".repeat(200));
        contents.push('\n');
        contents.push_str("{\"second\":true}\n");
        std::fs::write(&path, &contents).unwrap();

        assert_eq!(file_identity(&path).as_deref(), Some("sess-1"));
        // Truncated below the JSON's length: the parse fails and the hash of
        // the bounded head is used instead of reading the whole line.
        assert_eq!(read_first_line(&path, 32).unwrap().len(), 32);
        assert!(identity_from_head(&read_first_line(&path, 32).unwrap()).starts_with("h:"));
        assert!(file_identity(&dir.join("gone.jsonl")).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
