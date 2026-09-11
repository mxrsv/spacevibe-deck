/**
 * The launch flags each built-in agent offers as controls in Settings → Agents,
 * and the parse/compose pair that maps them onto a command line. Pure.
 *
 * **Storage is still the command string** (`launch-profile.ts`, 2026-08-19).
 * This module is a view over that string: `parseLaunchFlags` reads which
 * controls a command already sets, `composeLaunchFlags` writes the command
 * back. The owner asked for per-agent controls on 2026-09-11 (DECK-63); storing
 * the options semantically instead was turned down because it re-creates the
 * per-flag modelling the string format removed, and a hand-typed command would
 * then need a migration to survive.
 *
 * **Every flag was read off that CLI's own `--help` on the owner's machine on
 * 2026-09-11**, the rule `runtime-catalog.ts` follows: claude 2.1.268, codex
 * 0.154.0, opencode 1.18.30, agy 1.1.13, gemini 0.55.1. Left out on purpose:
 * model and effort (their own rows), print and headless flags, session resume/continue/fork, prompts, directories and
 * worktrees (Deck owns the pane's cwd), debug and logging, and opencode's
 * port/hostname (the signal adapter pins the port).
 *
 * **No token is ever dropped.** Whatever no control claims — an unknown flag, a
 * menu value this catalog does not list, a second flag for a control already
 * filled — is kept in `other`, in its original order and spelling.
 */

/** One value a control can hold. `forms[0]` is written; every form is read. */
export interface LaunchFlagOption {
  readonly value: string;
  readonly label: string;
  readonly forms: readonly (readonly string[])[];
}

/** One control. A `toggle` has exactly one option: on means its flag is present. */
export interface LaunchFlag {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  readonly kind: "toggle" | "menu";
  readonly options: readonly LaunchFlagOption[];
}

/** Which option each control holds; null is "the CLI's own default". */
export type LaunchFlagValues = Readonly<Record<string, string | null>>;

export interface ParsedLaunchFlags {
  readonly values: LaunchFlagValues;
  /** Every token no control claimed, space-joined, original spelling. */
  readonly other: string;
}

const toggle = (
  id: string,
  label: string,
  desc: string,
  ...forms: readonly (readonly string[])[]
): LaunchFlag => ({ id, label, desc, kind: "toggle", options: [{ value: "on", label, forms }] });

const option = (
  value: string,
  label: string,
  ...forms: readonly (readonly string[])[]
): LaunchFlagOption => ({ value, label, forms });

/** A `--flag value` option, also read as `-x value` when the CLI has a short form. */
const valued = (flags: readonly string[], value: string, label: string): LaunchFlagOption =>
  option(value, label, ...flags.map((flag) => [flag, value]));

const CLAUDE_MODE = ["--permission-mode"];
const CODEX_SANDBOX = ["--sandbox", "-s"];
const CODEX_APPROVAL = ["--ask-for-approval", "-a"];
const AGY_MODE = ["--mode"];
const GEMINI_APPROVAL = ["--approval-mode"];

export const LAUNCH_FLAGS: Readonly<Record<string, readonly LaunchFlag[]>> = {
  claude: [
    {
      id: "permissions",
      label: "Permissions",
      desc: "How Claude Code asks before it acts.",
      kind: "menu",
      options: [
        option("skip", "Skip all checks", ["--dangerously-skip-permissions"]),
        valued(CLAUDE_MODE, "acceptEdits", "Accept edits"),
        valued(CLAUDE_MODE, "auto", "Auto"),
        valued(CLAUDE_MODE, "bypassPermissions", "Bypass permissions"),
        valued(CLAUDE_MODE, "manual", "Manual"),
        valued(CLAUDE_MODE, "dontAsk", "Don't ask"),
        valued(CLAUDE_MODE, "plan", "Plan"),
      ],
    },
    toggle("ide", "Connect to IDE", "Attach to the IDE on startup when exactly one is open.", [
      "--ide",
    ]),
    toggle("verbose", "Verbose", "Override the verbose setting from config.", ["--verbose"]),
  ],
  codex: [
    toggle(
      "bypass",
      "No approvals or sandbox",
      "Skip every approval and run commands without a sandbox.",
      ["--dangerously-bypass-approvals-and-sandbox"],
    ),
    toggle("approveForMe", "Auto review", "Route approval requests through automatic review.", [
      "--approve-for-me",
    ]),
    {
      id: "sandbox",
      label: "Sandbox",
      desc: "Where model-generated commands may write.",
      kind: "menu",
      options: [
        valued(CODEX_SANDBOX, "read-only", "Read only"),
        valued(CODEX_SANDBOX, "workspace-write", "Workspace write"),
        valued(CODEX_SANDBOX, "danger-full-access", "Full access"),
      ],
    },
    {
      id: "approval",
      label: "Approval policy",
      desc: "When Codex stops to ask before running a command.",
      kind: "menu",
      options: [
        valued(CODEX_APPROVAL, "on-request", "On request"),
        valued(CODEX_APPROVAL, "never", "Never"),
      ],
    },
    toggle("search", "Web search", "Let the model search the web without asking.", ["--search"]),
    toggle("inline", "Inline mode", "Keep terminal scrollback instead of an alternate screen.", [
      "--no-alt-screen",
    ]),
  ],
  opencode: [
    toggle("auto", "Auto-approve", "Approve permissions that are not explicitly denied.", [
      "--auto",
    ]),
    toggle("pure", "Without plugins", "Run without external plugins.", ["--pure"]),
    toggle("mini", "Minimal interface", "Start the minimal interactive interface.", ["--mini"]),
  ],
  agy: [
    toggle("skip", "Skip permissions", "Approve every tool request without asking.", [
      "--dangerously-skip-permissions",
    ]),
    {
      id: "mode",
      label: "Mode",
      desc: "How the agent works through a session.",
      kind: "menu",
      options: [valued(AGY_MODE, "accept-edits", "Accept edits"), valued(AGY_MODE, "plan", "Plan")],
    },
    toggle("sandbox", "Sandbox", "Run with terminal restrictions.", ["--sandbox"]),
  ],
  gemini: [
    {
      id: "approval",
      label: "Approval",
      desc: "Which actions Gemini runs without asking.",
      kind: "menu",
      options: [
        option("yolo", "Everything", ["--yolo"], ["-y"], ["--approval-mode", "yolo"]),
        valued(GEMINI_APPROVAL, "auto_edit", "Edits only"),
        valued(GEMINI_APPROVAL, "plan", "Plan (read only)"),
      ],
    },
    toggle("sandbox", "Sandbox", "Run tools inside a sandbox.", ["--sandbox"], ["-s"]),
    toggle("trust", "Trust folder", "Trust the current folder for this session.", ["--skip-trust"]),
  ],
};

/** The controls an agent offers; empty for an agent this catalog does not know. */
export function launchFlagsFor(agentId: string): readonly LaunchFlag[] {
  return LAUNCH_FLAGS[agentId] ?? [];
}

/** One matchable word, remembering which command token it came from. */
interface Part {
  readonly text: string;
  readonly source: number;
}

/** `--flag=value` is read as two words but can only be claimed whole. */
function partsOf(tokens: readonly string[]): readonly Part[] {
  return tokens.flatMap((token, source) => {
    const match = /^(--?[^=]+)=(.*)$/.exec(token);
    return match === null
      ? [{ text: token, source }]
      : [
          { text: match[1], source },
          { text: match[2], source },
        ];
  });
}

/** Whether `form` matches at `at` and ends exactly on a token boundary. */
function matchesAt(parts: readonly Part[], at: number, form: readonly string[]): boolean {
  const end = at + form.length;
  if (end > parts.length || !form.every((word, index) => parts[at + index].text === word)) {
    return false;
  }
  return end === parts.length || parts[end].source !== parts[end - 1].source;
}

interface Claim {
  readonly flagId: string;
  readonly value: string;
  readonly length: number;
}

/** The longest form any still-empty control can claim at `at`, or null. */
function claimAt(
  parts: readonly Part[],
  at: number,
  flags: readonly LaunchFlag[],
  values: LaunchFlagValues,
): Claim | null {
  let best: Claim | null = null;
  for (const flag of flags) {
    if (values[flag.id] !== undefined) {
      continue;
    }
    for (const choice of flag.options) {
      for (const form of choice.forms) {
        if (matchesAt(parts, at, form) && (best === null || form.length > best.length)) {
          best = { flagId: flag.id, value: choice.value, length: form.length };
        }
      }
    }
  }
  return best;
}

/** Read which controls a command sets. The first word, the binary, is skipped. */
export function parseLaunchFlags(agentId: string, command: string): ParsedLaunchFlags {
  const tokens = command.trim().split(/\s+/).slice(1);
  const parts = partsOf(tokens);
  const flags = launchFlagsFor(agentId);
  let values: LaunchFlagValues = {};
  const other: string[] = [];
  let at = 0;
  while (at < parts.length) {
    const claim = claimAt(parts, at, flags, values);
    if (claim !== null) {
      values = { ...values, [claim.flagId]: claim.value };
      at += claim.length;
      continue;
    }
    const source = parts[at].source;
    other.push(tokens[source]);
    while (at < parts.length && parts[at].source === source) {
      at += 1;
    }
  }
  const filled = Object.fromEntries(flags.map((flag) => [flag.id, values[flag.id] ?? null]));
  return { values: filled, other: other.join(" ") };
}

/** Write the command back: binary, controls in catalog order, then `other`. */
export function composeLaunchFlags(
  agentId: string,
  values: LaunchFlagValues,
  other: string,
): string {
  const known = launchFlagsFor(agentId).flatMap((flag) => {
    const choice = flag.options.find((candidate) => candidate.value === values[flag.id]);
    return choice === undefined ? [] : choice.forms[0];
  });
  return [agentId, ...known, other.trim()].filter((word) => word !== "").join(" ");
}
