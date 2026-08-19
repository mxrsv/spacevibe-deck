/**
 * Launch profiles: named, reusable MODE selections for the agent CLIs Deck
 * launches. Pure — no signals, no host, no DOM.
 *
 * The load-bearing rule is that a profile stores SEMANTIC options, never a
 * flag string. `AgentLauncher.arm` writes its command verbatim into an
 * interactive shell, so anything stored here would be executed as typed. Every
 * option is therefore a closed enum, a boolean, or a single token matching
 * `LAUNCH_TOKEN` — and `src/lib/launch-command.ts` is the only module allowed
 * to turn them into a command line.
 *
 * `options.kind` IS the agent id: one field rather than a separate `agentId`,
 * so a profile can never claim one agent while carrying another's options.
 *
 * Not called "preset" on purpose — `Preset` already means a pane layout
 * (`src/lib/preset-schema.ts`).
 */

/**
 * Agents whose flags are public and stable enough to model. `gemini` and `agy`
 * are deliberately absent — neither has a mode this repo models, so both stay
 * bare — and a custom agent already carries its own full command line.
 */
export const LAUNCH_PROFILE_AGENTS = [
  "claude",
  "codex",
  "opencode",
  "cursor-agent",
] as const;

export type LaunchProfileAgentId = (typeof LAUNCH_PROFILE_AGENTS)[number];

/** `claude --permission-mode` choices, verbatim from its `--help`. */
export const CLAUDE_PERMISSION_MODES = [
  "plan",
  "manual",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
] as const;

export type ClaudePermissionMode = (typeof CLAUDE_PERMISSION_MODES)[number];

/** `codex --sandbox` choices, verbatim from its `--help`. */
export const CODEX_SANDBOXES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type CodexSandbox = (typeof CODEX_SANDBOXES)[number];

/** `codex --ask-for-approval` choices, verbatim from its `--help`. */
export const CODEX_APPROVALS = ["untrusted", "on-request", "never"] as const;

export type CodexApproval = (typeof CODEX_APPROVALS)[number];

/** `cursor-agent --mode` choices, verbatim from its `--help` (2026-08-19). */
export const CURSOR_MODES = ["plan", "ask"] as const;

export type CursorMode = (typeof CURSOR_MODES)[number];

export interface ClaudeLaunchOptions {
  readonly kind: "claude";
  /** `--model`; null leaves the CLI's own default. */
  readonly model: string | null;
  /** `--permission-mode`; null leaves the CLI's own default. */
  readonly permissionMode: ClaudePermissionMode | null;
}

export interface CodexLaunchOptions {
  readonly kind: "codex";
  /** `-m/--model`. */
  readonly model: string | null;
  /** `-s/--sandbox`. */
  readonly sandbox: CodexSandbox | null;
  /** `-a/--ask-for-approval`. */
  readonly approval: CodexApproval | null;
  /**
   * `--dangerously-bypass-approvals-and-sandbox`. When on, `sandbox` and
   * `approval` are NOT composed: the CLI ignores them once approvals and the
   * sandbox are both skipped, and a row printing all three would misdescribe
   * what actually runs.
   */
  readonly bypass: boolean;
}

export interface CursorLaunchOptions {
  readonly kind: "cursor-agent";
  /** `--model`, e.g. `gpt-5` or `sonnet-4-thinking`. */
  readonly model: string | null;
  /** `--mode`: `plan` (read-only planning) or `ask` (Q&A). */
  readonly mode: CursorMode | null;
  /**
   * `-f/--force`: allow commands unless explicitly denied. The long form is
   * what gets composed — `--yolo` is documented as an alias of this, and one
   * spelling per behaviour keeps the printed row honest.
   */
  readonly force: boolean;
}

export interface OpencodeLaunchOptions {
  readonly kind: "opencode";
  /** `-m/--model`, in opencode's `provider/model` form. */
  readonly model: string | null;
  /** `--agent`, one of the user's own opencode agents. */
  readonly agent: string | null;
  /** `--auto`: auto-approve permissions that are not explicitly denied. */
  readonly auto: boolean;
}

export type LaunchOptions =
  | ClaudeLaunchOptions
  | CodexLaunchOptions
  | OpencodeLaunchOptions
  | CursorLaunchOptions;

export interface LaunchProfile {
  /** Stable `lp:<slug>` id. Minted once, never re-derived from the name. */
  readonly id: string;
  readonly name: string;
  readonly options: LaunchOptions;
}

export const LAUNCH_PROFILE_ID_PREFIX = "lp:";
export const LAUNCH_PROFILE_NAME_MAX = 32;

/**
 * What a single option token may contain. The same reasoning as
 * `PROBE_SAFE` in `agent-catalog.ts`: everything a shell acts on is excluded,
 * because this token is interpolated into a line typed at a live prompt.
 */
const LAUNCH_TOKEN = /^[A-Za-z0-9._/-]{1,64}$/;

const FALLBACK_SLUG = "profile";

export function isLaunchOptionToken(value: unknown): value is string {
  return typeof value === "string" && LAUNCH_TOKEN.test(value);
}

export function hasLaunchProfiles(
  agentId: string,
): agentId is LaunchProfileAgentId {
  return (LAUNCH_PROFILE_AGENTS as readonly string[]).includes(agentId);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createLaunchProfileId(
  name: string,
  existing: readonly LaunchProfile[],
): string {
  const base = slugify(name) || FALLBACK_SLUG;
  const taken = new Set(existing.map((profile) => profile.id));
  const first = `${LAUNCH_PROFILE_ID_PREFIX}${base}`;
  if (!taken.has(first)) {
    return first;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${LAUNCH_PROFILE_ID_PREFIX}${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/** Why a name is refused, or null when it is fine. */
export function profileNameProblem(
  name: string,
  others: readonly LaunchProfile[],
): string | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "a name is required";
  }
  if (trimmed.length > LAUNCH_PROFILE_NAME_MAX) {
    return `names stay under ${LAUNCH_PROFILE_NAME_MAX} characters`;
  }
  return others.some((profile) => profile.name === trimmed)
    ? "that name is already used"
    : null;
}

export function profilesForAgent(
  agentId: string,
  profiles: readonly LaunchProfile[],
): readonly LaunchProfile[] {
  return profiles.filter((profile) => profile.options.kind === agentId);
}

export function findLaunchProfile(
  id: string | null,
  profiles: readonly LaunchProfile[],
): LaunchProfile | null {
  if (id === null) {
    return null;
  }
  return profiles.find((profile) => profile.id === id) ?? null;
}

function optionalToken(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return isLaunchOptionToken(value) ? value : undefined;
}

/** `undefined` = present but not a boolean; absent reads as `false`. */
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return false;
  }
  return typeof value === "boolean" ? value : undefined;
}

function optionalChoice<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/**
 * Drop-not-repair, the same discipline `validateCustomAgents` uses: an
 * option nobody understands would otherwise be carried into a live shell.
 * `undefined` from the helpers above means "present but wrong" and sinks the
 * whole profile; `null` means "absent", which is a legal value.
 */
export function validateLaunchOptions(raw: unknown): LaunchOptions | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const model = optionalToken(source.model);
  if (model === undefined) {
    return null;
  }
  if (source.kind === "claude") {
    const permissionMode = optionalChoice(
      source.permissionMode,
      CLAUDE_PERMISSION_MODES,
    );
    if (permissionMode === undefined) {
      return null;
    }
    return { kind: "claude", model, permissionMode };
  }
  if (source.kind === "codex") {
    const sandbox = optionalChoice(source.sandbox, CODEX_SANDBOXES);
    const approval = optionalChoice(source.approval, CODEX_APPROVALS);
    // `bypass` arrived after the field set was already on disk, so ABSENT is
    // legal and reads as off — the behaviour every stored codex profile had.
    // A present-but-wrong value still sinks the profile.
    const bypass = optionalBoolean(source.bypass);
    if (
      sandbox === undefined ||
      approval === undefined ||
      bypass === undefined
    ) {
      return null;
    }
    return { kind: "codex", model, sandbox, approval, bypass };
  }
  if (source.kind === "cursor-agent") {
    const mode = optionalChoice(source.mode, CURSOR_MODES);
    const force = optionalBoolean(source.force);
    if (mode === undefined || force === undefined) {
      return null;
    }
    return { kind: "cursor-agent", model, mode, force };
  }
  if (source.kind === "opencode") {
    const agent = optionalToken(source.agent);
    if (agent === undefined || typeof source.auto !== "boolean") {
      return null;
    }
    return { kind: "opencode", model, agent, auto: source.auto };
  }
  return null;
}

export function validateLaunchProfiles(raw: unknown): readonly LaunchProfile[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: LaunchProfile[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const source = entry as Record<string, unknown>;
    if (typeof source.id !== "string" || seen.has(source.id)) {
      continue;
    }
    if (typeof source.name !== "string" || source.name.trim() === "") {
      continue;
    }
    const options = validateLaunchOptions(source.options);
    if (options === null) {
      continue;
    }
    seen.add(source.id);
    result.push({ id: source.id, name: source.name, options });
  }
  return result;
}

/**
 * The agent → default profile map. A mapping is kept only when it points at a
 * profile that exists AND belongs to that agent: a dangling default would
 * otherwise silently launch the bare binary while Settings showed a name.
 */
export function validateDefaultLaunchProfiles(
  raw: unknown,
  profiles: readonly LaunchProfile[],
): Readonly<Record<string, string>> {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [agentId, profileId] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (typeof profileId !== "string") {
      continue;
    }
    const profile = findLaunchProfile(profileId, profiles);
    if (profile !== null && profile.options.kind === agentId) {
      result[agentId] = profileId;
    }
  }
  return result;
}
