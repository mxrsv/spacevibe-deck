/**
 * Read-only scan of the skills / subagents an agent CLI has on disk — the port
 * of `src-tauri/src/prompt_assets.rs`.
 *
 * No shell, no PTY, no new dependencies: this walks a handful of known
 * directories, reads the head of each descriptor and returns what it found. A
 * missing directory, an unreadable file or an unknown agent is an empty list,
 * never an error — the Prompt Board still pastes templates when detection
 * finds nothing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Bytes read from any descriptor. Frontmatter sits at the top, so a
 * multi-megabyte SKILL.md must never be pulled into memory to find it. */
const HEAD_BYTES = 16 * 1024;

/** Upper bound per kind — a pathological plugin cache cannot flood the picker. */
const RESULT_CAP = 200;

/** Descriptions land in a `<select>` option; past this they are noise. */
const DESCRIPTION_MAX = 256;

export type AssetKind = "skill" | "subagent";
export type AssetSource = "global" | "project" | "plugin";

export interface PromptAsset {
  readonly kind: AssetKind;
  /** Qualified exactly as the CLI would address it (`plugin:skill` included). */
  readonly name: string;
  readonly description: string;
  readonly source: AssetSource;
}

export interface PromptAssets {
  readonly skills: PromptAsset[];
  readonly subagents: PromptAsset[];
}

/** Strip one layer of matching single/double quotes, if present. */
function unquote(value: string): string {
  if (
    value.length >= 2 &&
    (value.startsWith('"') || value.startsWith("'")) &&
    value.endsWith(value[0])
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * The `name:` / `description:` of a YAML frontmatter block.
 *
 * Deliberately not a YAML parser (zero new dependencies): every descriptor
 * verified on disk carries these two as plain, quoted, or folded/literal
 * (`>`, `|`) scalars, and a folded scalar's indented continuation lines are
 * joined with single spaces. Anything else in the block is skipped rather than
 * guessed at.
 */
export function parseFrontmatter(head: string): {
  name: string | null;
  description: string | null;
} {
  const lines = head.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { name: null, description: null };
  }
  let name: string | null = null;
  let description: string | null = null;
  let folding: { isName: boolean; joined: string } | null = null;

  const assign = (isName: boolean, value: string): void => {
    if (isName) {
      name ??= value;
    } else {
      description ??= value;
    }
  };

  for (const line of lines.slice(1)) {
    if (line.trim() === "---") {
      break;
    }
    const indented = line.startsWith(" ") || line.startsWith("\t");
    if (folding !== null && (indented || line.trim().length === 0)) {
      const piece = line.trim();
      if (piece.length > 0) {
        folding.joined =
          folding.joined.length > 0 ? `${folding.joined} ${piece}` : piece;
      }
      continue;
    }
    if (folding !== null) {
      assign(folding.isName, folding.joined);
      folding = null;
    }
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    if (key !== "name" && key !== "description") {
      continue;
    }
    const value = line.slice(separator + 1).trim();
    if ([">", "|", ">-", "|-", ">+", "|+"].includes(value)) {
      folding = { isName: key === "name", joined: "" };
      continue;
    }
    assign(key === "name", unquote(value));
  }
  if (folding !== null) {
    assign(folding.isName, folding.joined);
  }
  return { name, description };
}

/**
 * A top-level `description = "..."` in a Codex agent `.toml`.
 *
 * Scanning stops at the first table header or multi-line (`"""`) value: a
 * `description` below either is not the agent's own.
 */
export function parseTomlDescription(head: string): string | null {
  for (const line of head.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") || trimmed.includes('"""')) {
      break;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    if (trimmed.slice(0, separator).trim() !== "description") {
      continue;
    }
    const value = unquote(trimmed.slice(separator + 1).trim());
    return value.length > 0 ? value : null;
  }
  return null;
}

/** One line, collapsed whitespace, clamped to DESCRIPTION_MAX characters. */
export function clampDescription(value: string | null): string {
  const flattened = (value ?? "").split(/\s+/).filter(Boolean).join(" ");
  return [...flattened].slice(0, DESCRIPTION_MAX).join("");
}

/**
 * The first HEAD_BYTES of a regular file, or null.
 *
 * Symlinks are refused rather than followed: one can point straight out of the
 * scanned tree, and this scan promises to stay inside it.
 */
export function readHead(target: string): string | null {
  let handle: number | null = null;
  try {
    const meta = fs.lstatSync(target);
    if (meta.isSymbolicLink() || !meta.isFile()) {
      return null;
    }
    handle = fs.openSync(target, "r");
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = fs.readSync(handle, buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {
        // Nothing useful to do with a failed close.
      }
    }
  }
}

/**
 * The nearest ancestor of `cwd` (itself included) holding `.claude` or `.git`.
 *
 * A pane's cwd is usually INSIDE a project, not at its root, so the project's
 * own `.claude/skills` is invisible without this walk.
 */
export function projectRoot(cwd: string): string | null {
  let current = path.resolve(cwd);
  for (;;) {
    try {
      if (fs.statSync(path.join(current, ".claude")).isDirectory()) {
        return current;
      }
    } catch {
      // Not here; try `.git` then walk up.
    }
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Every active plugin's `[name, installPath]`.
 *
 * Read from `installed_plugins.json` rather than globbed off the cache
 * directory: the cache keeps stale versions of the same plugin side by side,
 * so a glob would offer skills the CLI can no longer see.
 */
export function pluginRoots(installedJson: string): Array<[string, string]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(installedJson);
  } catch {
    return [];
  }
  const plugins = (parsed as { plugins?: unknown })?.plugins;
  if (typeof plugins !== "object" || plugins === null) {
    return [];
  }
  const roots: Array<[string, string]> = [];
  for (const [key, installs] of Object.entries(
    plugins as Record<string, unknown>,
  )) {
    const name = key.split("@")[0] ?? key;
    if (!Array.isArray(installs)) {
      continue;
    }
    for (const entry of installs) {
      const install = (entry as { installPath?: unknown })?.installPath;
      if (typeof install === "string") {
        roots.push([name, install]);
      }
    }
  }
  roots.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  return roots;
}

/** Directory names directly under `dir`, sorted, symlinked entries skipped. */
function childDirNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** File stems directly under `dir` with the given extension, sorted. */
function childFileStems(dir: string, extension: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
      .filter((entry) => path.extname(entry.name) === `.${extension}`)
      .map((entry) => path.basename(entry.name, `.${extension}`))
      .sort();
  } catch {
    return [];
  }
}

/** `<root>/skills/<name>/SKILL.md`. `prefix` qualifies a plugin's skills. */
function scanSkills(
  root: string,
  source: AssetSource,
  prefix: string | null,
  out: PromptAsset[],
): void {
  const dir = path.join(root, "skills");
  for (const entry of childDirNames(dir)) {
    const head = readHead(path.join(dir, entry, "SKILL.md"));
    if (head === null) {
      continue;
    }
    const { name: declared, description } = parseFrontmatter(head);
    const base = declared ?? entry;
    out.push({
      kind: "skill",
      name: prefix === null ? base : `${prefix}:${base}`,
      description: clampDescription(description),
      source,
    });
  }
}

/**
 * `<root>/agents/<name>.md` (frontmatter) or `<name>.toml` (Codex).
 *
 * The name is always the FILE STEM — a `name:` field that disagrees with the
 * file the CLI loads by path would send the wrong reference into the prompt.
 */
function scanAgents(
  root: string,
  source: AssetSource,
  extension: string,
  out: PromptAsset[],
): void {
  const dir = path.join(root, "agents");
  for (const stem of childFileStems(dir, extension)) {
    const head = readHead(path.join(dir, `${stem}.${extension}`));
    if (head === null) {
      continue;
    }
    const description =
      extension === "toml"
        ? parseTomlDescription(head)
        : parseFrontmatter(head).description;
    out.push({
      kind: "subagent",
      name: stem,
      description: clampDescription(description),
      source,
    });
  }
}

/** Project entries shadow global ones of the same name (they are collected
 * first), and the per-kind cap applies after the dedupe. */
function merge(ordered: PromptAsset[]): PromptAsset[] {
  const seen = new Set<string>();
  return ordered
    .filter((asset) => {
      if (seen.has(asset.name)) {
        return false;
      }
      seen.add(asset.name);
      return true;
    })
    .slice(0, RESULT_CAP);
}

/** The scan itself, with its roots injected so tests never touch a real home. */
export function collect(
  agent: string,
  home: string,
  project: string | null,
): PromptAssets {
  const skills: PromptAsset[] = [];
  const subagents: PromptAsset[] = [];

  if (agent === "claude") {
    if (project !== null) {
      const root = path.join(project, ".claude");
      scanSkills(root, "project", null, skills);
      scanAgents(root, "project", "md", subagents);
    }
    const user = path.join(home, ".claude");
    scanSkills(user, "global", null, skills);
    scanAgents(user, "global", "md", subagents);
    const manifest = readHead(
      path.join(user, "plugins", "installed_plugins.json"),
    );
    if (manifest !== null) {
      for (const [name, install] of pluginRoots(manifest)) {
        scanSkills(install, "plugin", name, skills);
      }
    }
  } else if (agent === "codex") {
    const user = path.join(home, ".codex");
    scanSkills(user, "global", null, skills);
    scanAgents(user, "global", "toml", subagents);
  }
  // Unknown / unverified CLI (gemini, opencode, agy, a declared agent): empty
  // lists, not an error — the picker hides itself.

  return { skills: merge(skills), subagents: merge(subagents) };
}

/** The one command. `cwd` is a pane's working directory, not a project root. */
export function listPromptAssets(
  agent: string,
  cwd: string | null,
): PromptAssets {
  const project = cwd === null ? null : projectRoot(cwd);
  return collect(agent, os.homedir(), project);
}
