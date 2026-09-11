/**
 * Launch profiles: the commands Deck types into a pane when it opens an agent.
 * Pure — no signals, no host, no DOM.
 *
 * **A profile IS a command line.** The owner's reference (2026-08-19) is a flat
 * list of commands you type yourself — `codex --dangerously-bypass-approvals-
 * and-sandbox`, `claude --plan` — not a form of enums per agent. An earlier
 * version of this module stored SEMANTIC options and composed them; that made
 * every flag a modelling exercise and put four controls between the user and a
 * command they already knew how to write. This one stores the string.
 *
 * The safety rule that made the enums attractive has not gone away, so it is
 * enforced directly instead: `AgentLauncher.arm` writes this string VERBATIM
 * into a live interactive shell, so anything a shell would act on is refused
 * at the door — `;` `|` `&` `$` backticks, redirects, quotes, newlines. What
 * survives is what a command and its flags are actually made of. A user who
 * needs a pipeline can still write a wrapper script and declare that as a
 * custom agent; they cannot smuggle one through this field.
 *
 * The agent a profile belongs to is DERIVED from its first word, never stored
 * beside it: two fields would let a profile claim `claude` while typing
 * `codex`.
 *
 * Not called "preset" in code on purpose — `Preset` already means a pane
 * layout (`src/lib/preset-schema.ts`) — even though the surface says Presets.
 */

import { agentBinary } from "./agent-catalog";

export const LAUNCH_PROFILE_ID_PREFIX = "lp:";

/** Upper bound on a stored command. Long enough for real flags, short enough
 *  that a paste accident cannot fill a prompt. */
export const LAUNCH_COMMAND_MAX = 200;

/**
 * What a launch command may contain: the characters real binaries, flags,
 * paths and model names are made of, plus the spaces between them.
 *
 * Everything a shell interprets is excluded by construction. Deliberately
 * absent, each for its own reason:
 *
 * - `; | & \n` — command separators; one of these turns a launch into two.
 * - `$` and backtick — substitution; the pane would run whatever they expand to.
 * - `> <` — redirects, which could truncate a file on launch.
 * - `' " \` — quoting and escaping, whose only purpose here would be to smuggle
 *   one of the above past a naive reader.
 * - `( ) { } [ ] * ?` — subshells and globs.
 */
const COMMAND_SAFE = /^[A-Za-z0-9 _.,:@+=/-]+$/;

/** One launch command the user declared. */
export interface LaunchProfile {
  /** Stable `lp:<slug>` id. Minted once, never re-derived from the command. */
  readonly id: string;
  /** The full command line, e.g. `claude --permission-mode plan`. */
  readonly command: string;
}

/**
 * Why a command is refused, or null when it is fine. The message is written to
 * be read by the person who typed it, not by a developer.
 */
export function commandProblem(command: string): string | null {
  const trimmed = command.trim();
  if (trimmed === "") {
    return "type a command";
  }
  if (trimmed.length > LAUNCH_COMMAND_MAX) {
    return `commands stay under ${LAUNCH_COMMAND_MAX} characters`;
  }
  if (!COMMAND_SAFE.test(trimmed)) {
    return "a command may only use letters, digits, spaces and . , : @ + = _ - /";
  }
  return null;
}

/** Whether a stored value is a usable launch command. */
export function isLaunchCommand(value: unknown): value is string {
  return typeof value === "string" && commandProblem(value) === null;
}

/**
 * `COMMAND_SAFE` without the space: one runtime value — a model id, a
 * reasoning effort — is appended to a command as a single flag argument, so a
 * space in it would not be one argument but two.
 */
const RUNTIME_VALUE_SAFE = /^[A-Za-z0-9_.,:@+=/-]+$/;

/**
 * Whether a stored runtime value is one shell-safe argument. Lives here beside
 * `COMMAND_SAFE` rather than in the settings form, because the form is not the
 * only way a value arrives: `settings.json` is a file the user can edit, and
 * what a launch types has to be decided where the value is read, not where it
 * happened to be typed.
 */
export function isRuntimeValue(value: unknown): value is string {
  return typeof value === "string" && RUNTIME_VALUE_SAFE.test(value);
}

/**
 * The agent a command launches — its first word. Derived, never stored: a
 * profile cannot then claim one agent while typing another's binary.
 */
export function commandAgentId(command: string): string {
  return agentBinary(command);
}

/** The flags a command carries, or "" — everything after the binary. */
export function commandFlags(command: string): string {
  const trimmed = command.trim();
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1);
}

function slugify(command: string): string {
  return command
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function createLaunchProfileId(command: string, existing: readonly LaunchProfile[]): string {
  const base = slugify(command) || "command";
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

/** Every profile whose command launches this agent, in declared order. */
export function profilesForAgent(
  agentId: string,
  profiles: readonly LaunchProfile[],
): readonly LaunchProfile[] {
  return profiles.filter((profile) => commandAgentId(profile.command) === agentId);
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

/**
 * The preset an agent launches with: its starred one, else the first it owns.
 * The same order `agentLaunchCommand` resolves, so the preset the Command
 * field edits is the one a launch types.
 */
export function effectiveLaunchProfile(
  agentId: string,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): LaunchProfile | null {
  const starred = findLaunchProfile(defaults[agentId] ?? null, profiles);
  if (starred !== null && commandAgentId(starred.command) === agentId) {
    return starred;
  }
  return profilesForAgent(agentId, profiles)[0] ?? null;
}

/**
 * Why a command cannot replace this agent's own, or null. A command for
 * another binary is refused here rather than saved: `resolveLaunchCommand`
 * would skip it, and the row would go on printing something the user did not
 * type.
 */
export function agentCommandProblem(agentId: string, command: string): string | null {
  const problem = commandProblem(command);
  if (problem !== null) {
    return problem;
  }
  return commandAgentId(command) === agentId ? null : `the command must start with ${agentId}`;
}

/** The two settings a command edit writes, always together. */
export interface AgentCommandSettings {
  readonly launchProfiles: readonly LaunchProfile[];
  readonly defaultLaunchProfiles: Readonly<Record<string, string>>;
}

/**
 * Replace the command an agent launches with. The caller has already passed a
 * non-empty `command` through `agentCommandProblem`.
 *
 * - Empty removes the effective preset and its star, so the launch falls to
 *   the next preset the user wrote or to the catalog's command.
 * - A command another preset already holds stars that preset rather than
 *   minting a duplicate — `add()` refuses duplicates for the same reason.
 * - Otherwise the effective preset is rewritten in place, keeping its id, or a
 *   new one is created when the agent has none. Either way it ends up starred.
 */
export function withAgentCommand(
  agentId: string,
  command: string,
  profiles: readonly LaunchProfile[],
  defaults: Readonly<Record<string, string>>,
): AgentCommandSettings {
  const current = effectiveLaunchProfile(agentId, profiles, defaults);
  const trimmed = command.trim();
  if (trimmed === "") {
    return {
      launchProfiles:
        current === null ? profiles : profiles.filter((profile) => profile.id !== current.id),
      defaultLaunchProfiles: Object.fromEntries(
        Object.entries(defaults).filter(([agent]) => agent !== agentId),
      ),
    };
  }
  const existing = profiles.find((profile) => profile.command === trimmed);
  if (existing !== undefined) {
    return {
      launchProfiles: profiles,
      defaultLaunchProfiles: { ...defaults, [agentId]: existing.id },
    };
  }
  if (current !== null) {
    return {
      launchProfiles: profiles.map((profile) =>
        profile.id === current.id ? { ...profile, command: trimmed } : profile,
      ),
      defaultLaunchProfiles: { ...defaults, [agentId]: current.id },
    };
  }
  const id = createLaunchProfileId(trimmed, profiles);
  return {
    launchProfiles: [...profiles, { id, command: trimmed }],
    defaultLaunchProfiles: { ...defaults, [agentId]: id },
  };
}

/**
 * Drop-not-repair, the same discipline `validateCustomAgents` uses: a command
 * nobody vetted would otherwise be typed into a live shell.
 */
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
    if (!isLaunchCommand(source.command)) {
      continue;
    }
    seen.add(source.id);
    result.push({ id: source.id, command: source.command.trim() });
  }
  return result;
}

/**
 * The agent → default profile map. A mapping is kept only when it points at a
 * profile that exists AND whose command launches that agent: a dangling
 * default would otherwise silently launch the bare binary while Settings
 * showed a starred row.
 */
export function validateDefaultLaunchProfiles(
  raw: unknown,
  profiles: readonly LaunchProfile[],
): Readonly<Record<string, string>> {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [agentId, profileId] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof profileId !== "string") {
      continue;
    }
    const profile = findLaunchProfile(profileId, profiles);
    if (profile !== null && commandAgentId(profile.command) === agentId) {
      result[agentId] = profileId;
    }
  }
  return result;
}
