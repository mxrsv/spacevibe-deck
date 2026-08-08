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

/// The nearest ancestor of `cwd` (itself included) holding `.claude` or
/// `.git`.
///
/// A pane's CWD is usually *inside* a project, not at its root, so the
/// project's own `.claude/skills` is invisible without this walk. First hit
/// wins; `ancestors()` stops at the filesystem root on its own.
pub(crate) fn project_root(cwd: &Path) -> Option<PathBuf> {
    for dir in cwd.ancestors() {
        if dir.join(".claude").is_dir() || dir.join(".git").exists() {
            return Some(dir.to_path_buf());
        }
    }
    None
}

/// Every active plugin's `(name, installPath)`, name being the part of
/// `<plugin>@<marketplace>` before the `@`.
///
/// Read from `installed_plugins.json` rather than globbed off the cache
/// directory: the cache keeps stale versions of the same plugin side by side,
/// so a glob would offer skills the CLI can no longer see.
pub(crate) fn plugin_roots(installed_json: &str) -> Vec<(String, PathBuf)> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(installed_json) else {
        return Vec::new();
    };
    let Some(plugins) = value.get("plugins").and_then(|node| node.as_object()) else {
        return Vec::new();
    };
    let mut roots: Vec<(String, PathBuf)> = Vec::new();
    for (key, installs) in plugins {
        let name = key.split('@').next().unwrap_or(key).to_string();
        let Some(entries) = installs.as_array() else {
            continue;
        };
        for entry in entries {
            if let Some(path) = entry.get("installPath").and_then(|node| node.as_str()) {
                roots.push((name.clone(), PathBuf::from(path)));
            }
        }
    }
    roots.sort();
    roots
}

/// Directory names directly under `dir`, sorted, symlinked entries skipped.
fn child_dir_names(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_dir() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .filter_map(|entry| entry.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

/// File names directly under `dir` with the given extension, sorted, symlinks
/// skipped.
fn child_file_stems(dir: &Path, extension: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut stems: Vec<String> = entries
        .flatten()
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file() && !kind.is_symlink())
                .unwrap_or(false)
        })
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some(extension) {
                return None;
            }
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(str::to_string)
        })
        .collect();
    stems.sort();
    stems
}

/// `<dir>/skills/<name>/SKILL.md`, one asset per readable entry. `prefix`
/// qualifies a plugin's skills (`superpowers:brainstorming`).
fn scan_skills(root: &Path, source: AssetSource, prefix: Option<&str>, out: &mut Vec<PromptAsset>) {
    let dir = root.join("skills");
    for entry in child_dir_names(&dir) {
        let Some(head) = read_head(&dir.join(&entry).join("SKILL.md")) else {
            continue;
        };
        let (declared, description) = parse_frontmatter(&head);
        let base = declared.unwrap_or(entry);
        let name = match prefix {
            Some(plugin) => format!("{plugin}:{base}"),
            None => base,
        };
        out.push(PromptAsset {
            kind: AssetKind::Skill,
            name,
            description: clamp_description(description),
            source,
        });
    }
}

/// `<root>/agents/<name>.md` (frontmatter) or `<name>.toml` (Codex). The name
/// is always the file stem — a `name:` field that disagrees with the file the
/// CLI loads by path would send the wrong reference into the prompt.
fn scan_agents(root: &Path, source: AssetSource, extension: &str, out: &mut Vec<PromptAsset>) {
    let dir = root.join("agents");
    for stem in child_file_stems(&dir, extension) {
        let path = dir.join(format!("{stem}.{extension}"));
        let Some(head) = read_head(&path) else {
            continue;
        };
        let description = if extension == "toml" {
            parse_toml_description(&head)
        } else {
            parse_frontmatter(&head).1
        };
        out.push(PromptAsset {
            kind: AssetKind::Subagent,
            name: stem,
            description: clamp_description(description),
            source,
        });
    }
}

/// Project entries shadow global ones of the same name (they are collected
/// first), and the per-kind cap applies after the dedupe.
fn merge(mut ordered: Vec<PromptAsset>) -> Vec<PromptAsset> {
    let mut seen = std::collections::HashSet::new();
    ordered.retain(|asset| seen.insert(asset.name.clone()));
    ordered.truncate(RESULT_CAP);
    ordered
}

/// The scan itself, with its roots injected so tests never touch a real home
/// directory. `project` is already resolved by `project_root`.
pub(crate) fn collect(agent: &str, home: &Path, project: Option<&Path>) -> PromptAssets {
    let mut skills: Vec<PromptAsset> = Vec::new();
    let mut subagents: Vec<PromptAsset> = Vec::new();
    match agent {
        "claude" => {
            if let Some(root) = project {
                scan_skills(
                    &root.join(".claude"),
                    AssetSource::Project,
                    None,
                    &mut skills,
                );
                scan_agents(
                    &root.join(".claude"),
                    AssetSource::Project,
                    "md",
                    &mut subagents,
                );
            }
            let user = home.join(".claude");
            scan_skills(&user, AssetSource::Global, None, &mut skills);
            scan_agents(&user, AssetSource::Global, "md", &mut subagents);
            let manifest = user.join("plugins").join("installed_plugins.json");
            if let Some(json) = read_head(&manifest) {
                for (name, install) in plugin_roots(&json) {
                    scan_skills(&install, AssetSource::Plugin, Some(&name), &mut skills);
                }
            }
        }
        "codex" => {
            let user = home.join(".codex");
            scan_skills(&user, AssetSource::Global, None, &mut skills);
            scan_agents(&user, AssetSource::Global, "toml", &mut subagents);
        }
        // Unknown / unverified CLI (gemini, opencode, agy, a declared agent):
        // empty lists, not an error — the picker hides itself (spec §9).
        _ => {}
    }
    PromptAssets {
        skills: merge(skills),
        subagents: merge(subagents),
    }
}

/// The one command. `cwd` is a pane's working directory, not a project root —
/// `project_root` resolves that. A home directory that cannot be resolved is
/// an empty answer, same fail-soft rule as everything else here.
///
/// Note on `read_head` for `installed_plugins.json`: 16 KiB is the same head
/// bound used for descriptors. If a machine's manifest ever exceeds it,
/// `serde_json` fails to parse the truncated text and `plugin_roots` returns an
/// empty list — plugin skills disappear, nothing else breaks. Accepted.
#[tauri::command]
pub async fn list_prompt_assets(agent: String, cwd: Option<String>) -> PromptAssets {
    let Ok(home) = crate::platform::user_home() else {
        return PromptAssets::default();
    };
    let project = cwd.map(PathBuf::from).and_then(|dir| project_root(&dir));
    collect(&agent, &home, project.as_deref())
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

    /// A throwaway tree under the OS temp dir. No `tempfile` dev-dependency:
    /// this feature ships zero new crates, test-only included.
    fn fixture(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("deck-prompt-assets-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_skill(root: &Path, skill: &str, description: &str) {
        let dir = root.join("skills").join(skill);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("SKILL.md"),
            format!("---\nname: {skill}\ndescription: {description}\n---\n"),
        )
        .unwrap();
    }

    fn write_agent_md(root: &Path, agent: &str, description: &str) {
        let dir = root.join("agents");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(format!("{agent}.md")),
            format!("---\nname: {agent}\ndescription: {description}\n---\n"),
        )
        .unwrap();
    }

    #[test]
    fn project_root_walks_up_to_the_nearest_marker() {
        let base = fixture("project-root");
        let nested = base.join("repo/src/deep");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::create_dir_all(base.join("repo/.git")).unwrap();
        assert_eq!(project_root(&nested), Some(base.join("repo")));

        let orphan = fixture("project-root-orphan");
        assert_eq!(project_root(&orphan), None);
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&orphan);
    }

    #[test]
    fn plugin_roots_read_install_paths_not_the_cache_directory() {
        let json = r#"{
            "version": 2,
            "plugins": {
                "superpowers@official": [
                    { "scope": "user", "installPath": "/cache/official/superpowers/6.2.0" }
                ],
                "broken@official": [ { "scope": "user" } ]
            }
        }"#;
        assert_eq!(
            plugin_roots(json),
            vec![(
                "superpowers".to_string(),
                PathBuf::from("/cache/official/superpowers/6.2.0")
            )]
        );
        assert_eq!(plugin_roots("not json"), Vec::new());
    }

    #[test]
    fn collects_claude_assets_with_project_shadowing_global() {
        let base = fixture("claude-scan");
        let home = base.join("home");
        let project = base.join("repo");
        std::fs::create_dir_all(project.join(".claude")).unwrap();
        write_skill(&home.join(".claude"), "code-review", "global one");
        write_skill(&home.join(".claude"), "only-global", "global only");
        write_skill(&project.join(".claude"), "code-review", "project one");
        write_agent_md(&home.join(".claude"), "planner", "global planner");
        write_agent_md(&project.join(".claude"), "planner", "project planner");

        let assets = collect("claude", &home, Some(&project));
        let names: Vec<&str> = assets.skills.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["code-review", "only-global"]);
        assert_eq!(assets.skills[0].description, "project one");
        assert_eq!(assets.skills[0].source, AssetSource::Project);
        assert_eq!(assets.skills[1].source, AssetSource::Global);
        assert_eq!(assets.subagents.len(), 1);
        assert_eq!(assets.subagents[0].description, "project planner");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn plugin_skills_stay_qualified_and_never_shadow_a_bare_name() {
        let base = fixture("plugin-scan");
        let home = base.join("home");
        let plugin = base.join("cache/superpowers/6.2.0");
        write_skill(&home.join(".claude"), "brainstorming", "bare one");
        write_skill(&plugin, "brainstorming", "plugin one");
        let plugins_dir = home.join(".claude/plugins");
        std::fs::create_dir_all(&plugins_dir).unwrap();
        std::fs::write(
            plugins_dir.join("installed_plugins.json"),
            format!(
                "{{\"plugins\":{{\"superpowers@official\":[{{\"installPath\":\"{}\"}}]}}}}",
                plugin.to_string_lossy()
            ),
        )
        .unwrap();

        let assets = collect("claude", &home, None);
        let names: Vec<&str> = assets.skills.iter().map(|a| a.name.as_str()).collect();
        assert_eq!(names, vec!["brainstorming", "superpowers:brainstorming"]);
        assert_eq!(assets.skills[1].source, AssetSource::Plugin);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn collects_codex_assets_from_user_dirs_only() {
        let base = fixture("codex-scan");
        let home = base.join("home");
        write_skill(&home.join(".codex"), "audit-5-layers", "five layers");
        let agents = home.join(".codex/agents");
        std::fs::create_dir_all(&agents).unwrap();
        std::fs::write(
            agents.join("plan-reviewer.toml"),
            "name = \"ignored\"\ndescription = \"Reviews plans.\"\n",
        )
        .unwrap();
        // A project dir must not be scanned for codex — user dirs only (spec §8).
        let project = base.join("repo");
        write_skill(&project.join(".claude"), "project-skill", "nope");

        let assets = collect("codex", &home, Some(&project));
        assert_eq!(assets.skills.len(), 1);
        assert_eq!(assets.skills[0].name, "audit-5-layers");
        assert_eq!(assets.subagents.len(), 1);
        // Name is the file stem, not the `name =` field (spec §8).
        assert_eq!(assets.subagents[0].name, "plan-reviewer");
        assert_eq!(assets.subagents[0].description, "Reviews plans.");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn unknown_agents_and_missing_dirs_are_empty_not_errors() {
        let base = fixture("empty-scan");
        assert_eq!(collect("gemini", &base, None), PromptAssets::default());
        assert_eq!(
            collect("claude", &base.join("nowhere"), None),
            PromptAssets::default()
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn one_unreadable_descriptor_skips_only_itself() {
        let base = fixture("bad-file");
        let home = base.join("home");
        write_skill(&home.join(".claude"), "good", "fine");
        // A skill directory with no SKILL.md at all.
        std::fs::create_dir_all(home.join(".claude/skills/empty")).unwrap();
        let assets = collect("claude", &home, None);
        assert_eq!(assets.skills.len(), 1);
        assert_eq!(assets.skills[0].name, "good");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn serializes_for_the_frontend_contract() {
        let asset = PromptAsset {
            kind: AssetKind::Subagent,
            name: "plan-reviewer".into(),
            description: "Reviews plans.".into(),
            source: AssetSource::Plugin,
        };
        assert_eq!(
            serde_json::to_value(&asset).unwrap(),
            serde_json::json!({
                "kind": "subagent",
                "name": "plan-reviewer",
                "description": "Reviews plans.",
                "source": "plugin",
            })
        );
    }
}
