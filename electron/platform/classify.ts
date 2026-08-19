/**
 * Pane classification — a 1:1 port of the tables in `src-tauri/src/info.rs`.
 *
 * The renderer keys the agent chip, the dot colour and attention state off
 * these two values. Process kinds remain kebab-case (`idle-shell`); built-in
 * agents keep the lowercase ids sent by Tauri (`opencode`, `agy`), while a
 * validated user-declared agent carries its display label.
 */

export type PaneProcessKind = "idle-shell" | "agent" | "busy" | "unknown";

/** Built-ins keep their stable ids; declared agents use their validated label. */
export type PaneAgent = string;

export interface AgentProcessMatcher {
  readonly binary: string;
  readonly agent: string;
}

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
const INTERPRETER_NAMES: ReadonlySet<string> = new Set([
  "node",
  "bun",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
  "zsh",
  "bash",
  "fish",
  "sh",
  "dash",
  "pwsh",
  "powershell",
]);
const MATCHER_BINARY = /^[A-Za-z0-9._+~-]{1,128}$/;
const MATCHER_AGENT_MAX = 32;

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
  const suffix = EXECUTABLE_SUFFIXES.find((candidate) => basename.endsWith(candidate));
  const stripped = suffix === undefined ? basename : basename.slice(0, -suffix.length);
  return stripped.length > 0 ? stripped : null;
}

export interface Classification {
  readonly kind: PaneProcessKind;
  readonly agent: PaneAgent | null;
}

const UNKNOWN: Classification = { kind: "unknown", agent: null };

function validMatcher(value: AgentProcessMatcher): AgentProcessMatcher | null {
  const binary = normalizedProcessName(value.binary);
  const agent = value.agent.trim();
  if (
    binary === null ||
    !MATCHER_BINARY.test(binary) ||
    agent.length === 0 ||
    agent.length > MATCHER_AGENT_MAX
  ) {
    return null;
  }
  return { binary, agent };
}

/** Validate the untrusted renderer payload before it reaches classification. */
export function validateAgentProcessMatchers(value: unknown): AgentProcessMatcher[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: AgentProcessMatcher[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const source = entry as Record<string, unknown>;
    if (typeof source.binary !== "string" || typeof source.agent !== "string") {
      continue;
    }
    const matcher = validMatcher({
      binary: source.binary,
      agent: source.agent,
    });
    if (matcher === null || seen.has(matcher.binary)) {
      continue;
    }
    seen.add(matcher.binary);
    result.push(matcher);
  }
  return result;
}

/**
 * Script basename when `ps args` shows an interpreter as argv0. macOS executes
 * `#!/usr/bin/env node` CLIs as `node /path/to/gemini`, so argv0 alone loses
 * the agent identity even though the entrypoint remains visible.
 */
function interpretedEntrypoint(commandLine: string): string | null {
  const tokens = commandLine.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }
  let executableIndex = 0;
  if (normalizedProcessName(tokens[0]) === "env") {
    executableIndex = 1;
    while (
      executableIndex < tokens.length &&
      (tokens[executableIndex].startsWith("-") || tokens[executableIndex].includes("="))
    ) {
      executableIndex += 1;
    }
  }
  const interpreter = normalizedProcessName(tokens[executableIndex] ?? "");
  if (interpreter === null || !INTERPRETER_NAMES.has(interpreter)) {
    return null;
  }
  for (let index = executableIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--" || token.startsWith("-")) {
      continue;
    }
    return normalizedProcessName(token);
  }
  return null;
}

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
  commandLine: string = process ?? "",
  customMatchers: readonly AgentProcessMatcher[] = [],
): Classification {
  if (!complete) {
    return UNKNOWN;
  }
  const normalized = process === null ? null : normalizedProcessName(process);
  if (normalized === null) {
    return UNKNOWN;
  }
  const entrypoint = interpretedEntrypoint(commandLine);
  const agent =
    AGENT_BY_BINARY[normalized] ?? (entrypoint === null ? undefined : AGENT_BY_BINARY[entrypoint]);
  if (agent !== undefined) {
    return { kind: "agent", agent };
  }
  const customByBinary = new Map(
    customMatchers.flatMap((matcher) => {
      const valid = validMatcher(matcher);
      return valid === null ? [] : [[valid.binary, valid.agent] as const];
    }),
  );
  const customCandidate = INTERPRETER_NAMES.has(normalized) ? entrypoint : normalized;
  if (customCandidate !== null && !SHELL_NAMES.has(customCandidate)) {
    const customAgent = customByBinary.get(customCandidate);
    if (customAgent !== undefined) {
      return { kind: "agent", agent: customAgent };
    }
  }
  if (SHELL_NAMES.has(normalized)) {
    return { kind: "idle-shell", agent: null };
  }
  return { kind: "busy", agent: null };
}
