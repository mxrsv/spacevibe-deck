/**
 * Terminal link resolution and editor launch — the port of
 * `src-tauri/src/links.rs`.
 *
 * Every input here is untrusted terminal output. Two guards carry the weight:
 *
 *  - `hasRejectedRoot` runs BEFORE any filesystem call, shared with the shell
 *    integration parser. On Windows, probing a `\\host\share` candidate is a
 *    blocking network call that also offers the user's NTLMv2 credentials to
 *    whatever host the hover text happened to name.
 *  - A custom editor template is validated as a FIXED command with
 *    placeholders, never as a shell string with the file interpolated. The
 *    POSIX path quotes every argument before it reaches `sh -c`.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasRejectedRoot } from "./shell-integration";
import * as macos from "./platform/macos";

/** Upper bound on one hover's resolve batch. The renderer already caps its
 * candidates per line; this keeps a hostile or garbled line cheap. */
const MAX_PATHS = 64;
const MAX_PATH_BYTES = 32_768;
const MAX_EDITOR_TEMPLATE_BYTES = 4_096;

/** A GUI editor returns immediately; anything still running past this has
 * launched (or the login shell is hanging) — either way, stop waiting. */
const EDITOR_TIMEOUT_MS = 10_000;

function isWindowsAbsolute(raw: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith("\\\\");
}

function expandTilde(raw: string, home: string): string | null {
  if (raw === "~") {
    return home;
  }
  const rest = raw.startsWith("~/") ? raw.slice(2) : raw.startsWith("~\\") ? raw.slice(2) : null;
  if (rest === null) {
    return raw;
  }
  const separator = home.includes("\\") && !home.includes("/") ? "\\" : "/";
  return `${home.replace(/[/\\]+$/, "")}${separator}${rest}`;
}

/**
 * Absolute path of `raw` when it is an existing FILE, else null.
 *
 * `base` is null when the pane's cwd is unknown. A relative candidate is then
 * unresolvable and comes back null: guessing a base would let `src/main.ts`
 * printed by an agent in `~/work/api` resolve to an unrelated `~/src/main.ts`
 * that happens to exist, and a click would open the wrong file with the hover
 * text looking exactly right.
 *
 * Directories are deliberately not linkified: there is no line to jump to.
 */
export function resolveOne(base: string | null, home: string, raw: string): string | null {
  const expanded = expandTilde(raw, home);
  if (expanded === null) {
    return null;
  }
  const absolute = path.isAbsolute(expanded) || isWindowsAbsolute(expanded);
  if (!absolute && base === null) {
    return null;
  }
  const full = absolute ? expanded : path.join(base as string, expanded);
  // Before the filesystem call — see the header.
  if (hasRejectedRoot(full)) {
    return null;
  }
  try {
    const canonical = fs.realpathSync(full);
    return fs.statSync(canonical).isFile() ? canonical : null;
  } catch {
    return null;
  }
}

/** Resolve link candidates against a pane's cwd; index-aligned with `paths`. */
export function resolvePaths(cwd: string, paths: readonly string[]): (string | null)[] {
  const home = os.homedir();
  let base: string | null = null;
  if (cwd.length > 0 && (path.isAbsolute(cwd) || isWindowsAbsolute(cwd))) {
    try {
      base = fs.statSync(cwd).isDirectory() ? cwd : null;
    } catch {
      base = null;
    }
  }
  return paths.map((raw, index) =>
    index < MAX_PATHS && raw.length <= MAX_PATH_BYTES ? resolveOne(base, home, raw) : null,
  );
}

export interface OpenEditorRequest {
  readonly editor: string;
  readonly template: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

const EDITORS = ["vscode", "cursor", "zed", "custom"] as const;
type EditorId = (typeof EDITORS)[number];

interface ValidatedRequest {
  readonly editor: EditorId;
  readonly template: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

function positivePosition(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`The editor ${label} must be a positive number.`);
  }
  return value;
}

/** Error messages are user-facing verbatim, so they stay plain. */
export function validateOpenEditorRequest(request: OpenEditorRequest): ValidatedRequest {
  if (!EDITORS.includes(request.editor as EditorId)) {
    throw new Error("The selected editor is not supported.");
  }
  const editor = request.editor as EditorId;
  if (request.template.length > MAX_EDITOR_TEMPLATE_BYTES || request.template.includes("\0")) {
    throw new Error("The custom editor command is invalid or too long.");
  }
  if (request.file.length > MAX_PATH_BYTES || request.file.includes("\0")) {
    throw new Error("The editor file path is invalid or too long.");
  }
  const template = request.template.trim();
  if (editor === "custom" && template.length === 0) {
    throw new Error("No custom editor command is configured.");
  }
  const executableToken = template.split(/\s+/)[0] ?? "";
  if (
    editor === "custom" &&
    ["{file}", "{line}", "{col}"].some((placeholder) => executableToken.includes(placeholder))
  ) {
    // The executable itself must be fixed: a placeholder there would let
    // terminal output choose which program runs.
    throw new Error("The custom editor executable must be a fixed command.");
  }
  const line = positivePosition(request.line, "line");
  const column = positivePosition(request.column, "column");
  if (request.file.toLowerCase().startsWith("\\\\?\\")) {
    throw new Error("The editor file path must not use a verbatim prefix.");
  }
  if (!(path.isAbsolute(request.file) || isWindowsAbsolute(request.file))) {
    throw new Error("The editor file path must be absolute.");
  }
  if (hasRejectedRoot(request.file)) {
    throw new Error("The editor file path must not be a network location.");
  }
  let canonical: string;
  try {
    canonical = fs.realpathSync(request.file);
  } catch {
    throw new Error("The editor file does not exist or cannot be read.");
  }
  if (!fs.statSync(canonical).isFile()) {
    throw new Error("The editor target must be a file.");
  }
  if (request.file !== canonical) {
    // A non-canonical path means symlink or `..` trickery got this far.
    throw new Error("The editor file path is not canonical.");
  }
  return { editor, template, file: canonical, line, column };
}

interface EditorProgram {
  readonly executable: string;
  readonly args: readonly string[];
}

function fixedEditorProgram(request: ValidatedRequest): EditorProgram {
  const location = `${request.file}:${request.line}:${request.column}`;
  switch (request.editor) {
    case "vscode":
      return { executable: "code", args: ["-g", location] };
    case "cursor":
      return { executable: "cursor", args: ["-g", location] };
    case "zed":
      return { executable: "zed", args: [location] };
    case "custom":
      throw new Error("A custom editor needs a command template.");
  }
}

function posixQuote(value: string): string {
  return `'${value.replaceAll("'", String.raw`'\''`)}'`;
}

/** The command string handed to `$SHELL -l -c`. Every argument is quoted, so a
 * path containing a space or a quote cannot become extra arguments. */
export function posixEditorCommand(request: ValidatedRequest): string {
  if (request.editor !== "custom") {
    const program = fixedEditorProgram(request);
    return [program.executable, ...program.args].map(posixQuote).join(" ");
  }
  if (request.template.length === 0) {
    throw new Error("No custom editor command is configured.");
  }
  const template = request.template.includes("{file}")
    ? request.template
    : `${request.template} {file}`;
  return template
    .replaceAll("{line}", String(request.line))
    .replaceAll("{col}", String(request.column))
    .replaceAll("{file}", posixQuote(request.file));
}

/**
 * Launch the editor.
 *
 * The launch goes through a login shell because that is where a GUI app's PATH
 * lives — `code` and `cursor` ship as shims that a bare `execFile` would not
 * find from a packaged app. A process still running past the timeout is
 * treated as launched: a GUI editor that stays open is the normal case.
 */
export function openEditor(request: OpenEditorRequest): Promise<void> {
  const validated = validateOpenEditorRequest(request);
  if (process.platform === "win32") {
    throw new Error("Opening an editor is unavailable on this platform.");
  }
  const command = posixEditorCommand(validated);
  const launch = macos.shellLaunch();
  return new Promise((resolve, reject) => {
    const child = execFile(
      launch.executable,
      [...launch.args, "-c", command],
      { timeout: EDITOR_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error === null) {
          resolve();
          return;
        }
        // A timeout means the editor is still running, which is success.
        if ((error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
          resolve();
          return;
        }
        const detail = String(stderr).trim();
        reject(
          new Error(
            detail.length > 0
              ? `Couldn't start the editor: ${detail}`
              : "Couldn't start the editor.",
          ),
        );
      },
    );
    child.unref();
  });
}
