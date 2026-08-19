/**
 * The agent catalog: what Deck can launch, and how a stored choice becomes a
 * command line. Pure — no signals, no Tauri, no DOM.
 *
 * The load-bearing invariant is that a built-in agent's id, its binary name
 * and its command are the SAME string. `lastAgent` in workspace recents has
 * been storing bare binary names since long before user-declared agents
 * existed, so keeping ids identical for the built-ins means every entry
 * already on disk resolves unchanged and there is no migration to get wrong.
 */

/** An agent the user declared: a display name plus a full command line. */
export interface CustomAgent {
  /** Stable `custom:<slug>` id. Generated once, never re-derived from label. */
  readonly id: string;
  readonly label: string;
  /** The command typed into the pane, arguments included. */
  readonly command: string;
}

export interface BuiltinAgent {
  /** Also the binary name and the bare command — see the module comment. */
  readonly id: string;
  readonly label: string;
  /**
   * The command Deck launches this agent with out of the box, flags included.
   *
   * This is a RECOMMENDATION shipped with the app, not a user setting: a fresh
   * install shows it immediately and can launch it without anyone typing a
   * flag. A user preset for the same agent replaces it; nothing merges.
   *
   * Several of these skip the agent's own confirmation prompts, which is the
   * point — Deck exists to run agents that keep working — but it is also why
   * every one of them is spelled out on screen rather than hidden behind a
   * label, and why the row can be disabled.
   *
   * Absent = launch the bare binary.
   */
  readonly defaultCommand?: string;
  /** Where to read about it. Opened by the row's ↗ control. */
  readonly url: string;
}

/** Process identity sent with `pty_info` for one declared agent. */
export interface AgentProcessMatcher {
  readonly binary: string;
  readonly agent: string;
}

/** Recognised out of the box; always probed, whatever the user declared. */
export const BUILTIN_AGENTS: readonly BuiltinAgent[] = [
  {
    id: "claude",
    label: "Claude Code",
    defaultCommand: "claude --dangerously-skip-permissions",
    url: "https://claude.com/claude-code",
  },
  {
    id: "codex",
    label: "Codex",
    defaultCommand: "codex --dangerously-bypass-approvals-and-sandbox",
    url: "https://developers.openai.com/codex/cli",
  },
  // No flag: opencode's `--auto` is opt-in per session and its prompts are
  // already coarse enough that skipping them is not the default anyone wants.
  { id: "opencode", label: "OpenCode", url: "https://opencode.ai" },
  // Google's successor to Gemini CLI. Gemini CLI keeps its place below it
  // rather than being dropped: paid Code Assist licences still reach the
  // service, and every `lastAgent` on disk holding "gemini" must keep
  // resolving. Order here is reach, not history — it decides both the chip
  // order and the digit key that opens each one.
  {
    id: "agy",
    label: "Antigravity",
    defaultCommand: "agy --dangerously-skip-permissions",
    url: "https://antigravity.google",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    defaultCommand: "gemini --yolo",
    url: "https://github.com/google-gemini/gemini-cli",
  },
  // Appended on 2026-08-19 (owner-approved fork: this list reaches process
  // classification). LAST on purpose — order is the digit-key contract in
  // AgentQuickPicker and the Open board, so appending leaves every existing
  // key on the agent it already opened. The id is the binary name, as it is
  // for every built-in; note it is `cursor-agent`, not `cursor`.
  {
    id: "cursor-agent",
    label: "Cursor",
    // `--force` is the long form; `--yolo` is documented as its alias.
    defaultCommand: "cursor-agent --force",
    url: "https://cursor.com/cli",
  },
];

export const CUSTOM_ID_PREFIX = "custom:";

/** Upper bound on a probed binary name; also enforced in Rust. */
export const PROBE_NAME_MAX = 128;

/** Upper bound on a display label — long enough to name a tool, short enough for a chip. */
export const AGENT_LABEL_MAX = 32;

const FALLBACK_SLUG = "agent";

/**
 * Characters a name may carry into the discovery probe. macOS discovery
 * interpolates the name into `sh -ilc "command -v <name>"` (macos.rs), so this
 * set deliberately excludes everything a shell acts on — whitespace, `;`, `&`,
 * `|`, `$`, backticks, quotes, redirects, globs, braces. What remains is what
 * real binary names and paths are made of.
 */
const PROBE_SAFE = /^[A-Za-z0-9._~+/-]+$/;

/** Whether a name may be handed to the discovery probe. */
export function isProbeSafeName(name: string): boolean {
  if (name.length === 0 || name.length > PROBE_NAME_MAX) {
    return false;
  }
  return PROBE_SAFE.test(name);
}

/**
 * The binary a command line runs: its first token. Only this part is ever
 * probed; the arguments go into the user's own shell untouched, which is what
 * typing them by hand would do.
 */
export function agentBinary(command: string): string {
  const trimmed = command.trim();
  if (trimmed === "") {
    return "";
  }
  return trimmed.split(/\s+/)[0];
}

/**
 * How a command's binary is matched against a discovery result. `command -v`
 * answers with a resolved absolute path, so a declared `~/bin/agent.sh` and the
 * reported `/Users/dev/bin/agent.sh` only ever agree on the last segment —
 * `probe_key` in agents.rs is the same function on the Rust side.
 */
export function binaryKey(command: string): string {
  const binary = agentBinary(command);
  const cut = Math.max(binary.lastIndexOf("/"), binary.lastIndexOf("\\"));
  return cut === -1 ? binary : binary.slice(cut + 1);
}

/**
 * Dynamic process matchers for user-declared agents. Two declarations may
 * share a binary, but process inspection cannot distinguish their arguments,
 * so the first declaration is the stable display identity for that process.
 *
 * `agent` is the LABEL, and it comes back as the identity every consumer of a
 * classification reads — which is why a label may not be spelled like a
 * built-in id. `labelProblem` in `agents-section.tsx` is where that is refused.
 */
export function agentProcessMatchers(
  customAgents: readonly CustomAgent[],
): readonly AgentProcessMatcher[] {
  const seen = new Set<string>();
  return customAgents.flatMap((agent) => {
    const binary = binaryKey(agent.command);
    if (seen.has(binary)) {
      return [];
    }
    seen.add(binary);
    return [{ binary, agent: agent.label }];
  });
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A stable id for a new agent, unique among `existing`. The `custom:` prefix
 * keeps this id from ever colliding with a built-in one, whatever the label
 * slugifies to — so a label near a built-in's name, "claude-2" say, is fine
 * here. The label ITSELF is a separate matter: it travels as the process
 * identity, so `labelProblem` refuses one spelled exactly like a built-in id.
 */
export function createCustomAgentId(label: string, existing: readonly CustomAgent[]): string {
  const base = slugify(label) || FALLBACK_SLUG;
  const taken = new Set(existing.map((agent) => agent.id));
  const first = `${CUSTOM_ID_PREFIX}${base}`;
  if (!taken.has(first)) {
    return first;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${CUSTOM_ID_PREFIX}${base}-${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

export function isBuiltinAgentId(id: string): boolean {
  return BUILTIN_AGENTS.some((agent) => agent.id === id);
}

/**
 * The command line an agent id launches, or `null` when nothing declares it —
 * a stale `lastAgent` pointing at an agent the user deleted lands here.
 */
export function resolveAgentCommand(
  id: string,
  customAgents: readonly CustomAgent[],
): string | null {
  if (isBuiltinAgentId(id)) {
    return id;
  }
  const custom = customAgents.find((agent) => agent.id === id);
  return custom?.command ?? null;
}

/**
 * What an agent launches with when the user has written no preset for it: the
 * catalog's shipped recommendation for a built-in, the declared command line
 * for a custom agent, and null for an id nothing knows.
 *
 * `resolveAgentCommand` above stays the BARE form — `MaterializeIntent`'s
 * explicit `launchCommand: null` means "the binary and nothing else", and that
 * promise is what it answers.
 */
export function catalogLaunchCommand(
  id: string,
  customAgents: readonly CustomAgent[],
): string | null {
  const builtin = BUILTIN_AGENTS.find((agent) => agent.id === id);
  if (builtin !== undefined) {
    return builtin.defaultCommand ?? builtin.id;
  }
  return customAgents.find((agent) => agent.id === id)?.command ?? null;
}

/** One selectable agent, in the order the board offers them. */
export interface AgentOption {
  /** The `AgentChoice` this option stands for. */
  readonly id: string;
  readonly label: string;
  /** The resolved binary path, or the declared command line. */
  readonly detail: string;
  /** Declared, but its binary was not among the discovered ones. */
  readonly missing: boolean;
}

/**
 * The agent row: built-ins actually found on `$PATH`, then every declared
 * agent. A declared agent stays in the list when its binary is gone — a chip
 * that vanishes because a tool was uninstalled reads as lost data, so it is
 * marked instead. One function so the board's chips and every other caller
 * agree on membership AND order (digit keys depend on that order).
 */
export function agentOptions(
  detected: readonly { readonly name: string; readonly path: string }[],
  customAgents: readonly CustomAgent[],
  disabledAgents: readonly string[] = [],
): readonly AgentOption[] {
  const paths = new Map(detected.map((agent) => [agent.name, agent.path]));
  // Settings' Enabled/Disabled switch is the ONLY thing that takes an agent
  // out of the pickers — a built-in cannot be deleted, since the next probe
  // finds it again. It is applied HERE rather than at each picker because this
  // function is also what fixes the digit keys: filtering downstream would
  // leave a disabled agent holding its number.
  const off = new Set(disabledAgents);
  const options: AgentOption[] = [];
  for (const builtin of BUILTIN_AGENTS) {
    const path = paths.get(builtin.id);
    if (path !== undefined && !off.has(builtin.id)) {
      options.push({
        id: builtin.id,
        label: builtin.label,
        detail: path,
        missing: false,
      });
    }
  }
  for (const agent of customAgents) {
    // The same switch, applied to a declared agent. Settings only offers it on
    // built-in rows today, but the field is an id list, not a built-in list —
    // honouring it here is what keeps a stored id from meaning two things.
    if (off.has(agent.id)) {
      continue;
    }
    options.push({
      id: agent.id,
      label: agent.label,
      detail: agent.command,
      missing: !paths.has(binaryKey(agent.command)),
    });
  }
  return options;
}

/**
 * Binary names to hand the discovery probe: every built-in, plus each declared
 * agent's binary. Unsafe names are dropped here and dropped again in Rust —
 * the frontend is not the trust boundary.
 */
export function probeNames(customAgents: readonly CustomAgent[]): readonly string[] {
  const names = BUILTIN_AGENTS.map((agent) => agent.id);
  const seen = new Set(names);
  for (const agent of customAgents) {
    const binary = agentBinary(agent.command);
    if (!isProbeSafeName(binary) || seen.has(binary)) {
      continue;
    }
    seen.add(binary);
    names.push(binary);
  }
  return names;
}
