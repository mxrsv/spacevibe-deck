/**
 * Pane classification — a 1:1 port of the tables in `src-tauri/src/info.rs`.
 *
 * The renderer keys the agent chip, the dot colour and attention state off
 * these two values, and the serialized forms must match what the Tauri build
 * sent: kebab-case for the kind (`idle-shell`), lowercase for the agent id
 * (`opencode`, `agy`).
 */

export type PaneProcessKind = "idle-shell" | "agent" | "busy" | "unknown";

export type PaneAgent = "claude" | "codex" | "gemini" | "opencode" | "agy";

/**
 * Built-in agent binaries. A built-in id equals its binary name — that
 * invariant is why `gemini` survived the Antigravity addition, since every
 * `lastAgent` already on disk resolves through it.
 */
const AGENT_BY_BINARY: Readonly<Record<string, PaneAgent>> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  opencode: "opencode",
  agy: "agy",
};

/** Shells that mean "nothing is running here". */
const SHELL_NAMES: ReadonlySet<string> = new Set([
  "zsh",
  "bash",
  "fish",
  "sh",
  "dash",
  "nu",
  "pwsh",
  "powershell",
]);

const EXECUTABLE_SUFFIXES = [".exe", ".cmd", ".bat", ".ps1"];

/**
 * Basename, lowercased, with a Windows executable suffix removed.
 * Splits on both separators so a Windows-style path classifies correctly even
 * when the string reaches a POSIX host.
 */
export function normalizedProcessName(process: string): string | null {
  const basename = (process.split(/[/\\]/).pop() ?? "").trim().toLowerCase();
  if (basename.length === 0) {
    return null;
  }
  const suffix = EXECUTABLE_SUFFIXES.find((candidate) =>
    basename.endsWith(candidate),
  );
  const stripped =
    suffix === undefined ? basename : basename.slice(0, -suffix.length);
  return stripped.length > 0 ? stripped : null;
}

export interface Classification {
  readonly kind: PaneProcessKind;
  readonly agent: PaneAgent | null;
}

const UNKNOWN: Classification = { kind: "unknown", agent: null };

/**
 * Classify a foreground process name.
 *
 * `complete` is false when the inspection itself failed — a missing answer must
 * report `unknown` rather than defaulting to `busy`, because `busy` is what
 * blocks a quit.
 */
export function classifyProcess(
  process: string | null,
  complete: boolean,
): Classification {
  if (!complete) {
    return UNKNOWN;
  }
  const normalized = process === null ? null : normalizedProcessName(process);
  if (normalized === null) {
    return UNKNOWN;
  }
  const agent = AGENT_BY_BINARY[normalized];
  if (agent !== undefined) {
    return { kind: "agent", agent };
  }
  if (SHELL_NAMES.has(normalized)) {
    return { kind: "idle-shell", agent: null };
  }
  return { kind: "busy", agent: null };
}
