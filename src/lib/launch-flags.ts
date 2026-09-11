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
 * **The flags live in each agent's own file** under `agents/`, read off that
 * CLI's `--help` with the version and date written beside them. Left out on
 * purpose: model and effort (their own rows), print and headless flags,
 * session resume/continue/fork, prompts, directories and worktrees (Deck owns
 * the pane's cwd), debug and logging, and opencode's port/hostname (the signal
 * adapter pins the port).
 *
 * **No token is ever dropped.** Whatever no control claims — an unknown flag, a
 * menu value this catalog does not list, a second flag for a control already
 * filled — is kept in `other`, in its original order and spelling.
 */

import type { LaunchFlag } from "./agents/agent-definition";
import { ACTIVE_AGENTS } from "./agents/agent-registry";

export type { LaunchFlag, LaunchFlagOption } from "./agents/agent-definition";

/** Which option each control holds; null is "the CLI's own default". */
export type LaunchFlagValues = Readonly<Record<string, string | null>>;

export interface ParsedLaunchFlags {
  readonly values: LaunchFlagValues;
  /** Every token no control claimed, space-joined, original spelling. */
  readonly other: string;
}

/** Every active built-in's controls, keyed by agent id (`agents/agent-registry.ts`). */
export const LAUNCH_FLAGS: Readonly<Record<string, readonly LaunchFlag[]>> = Object.fromEntries(
  ACTIVE_AGENTS.map((agent) => [agent.id, agent.launchFlags] as const),
);

/**
 * The controls an agent offers; empty for an agent this catalog does not know.
 * `hasOwnProperty`, not plain indexing: the id comes off a typed command, and
 * `LAUNCH_FLAGS["constructor"]` would answer with a function.
 */
export function launchFlagsFor(agentId: string): readonly LaunchFlag[] {
  return Object.prototype.hasOwnProperty.call(LAUNCH_FLAGS, agentId) ? LAUNCH_FLAGS[agentId] : [];
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
