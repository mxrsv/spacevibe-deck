/**
 * The desktop's project → checkout → pane tree as the phone sees it (design §6), with parsers that
 * sanitise every string the desktop supplied for display. Counts are bounded so a hostile or
 * buggy desktop cannot make the phone build an unbounded list.
 */
import { displayText } from "./display-text";
import { isRecord, isSafeNonNegative, oneOf, parseList } from "./validate";

export const PANE_PHASES = ["unknown", "idle", "working", "exited"] as const;
export const PANE_ATTENTIONS = ["none", "completed", "requested", "warning", "error"] as const;
export type PanePhase = (typeof PANE_PHASES)[number];
export type PaneAttention = (typeof PANE_ATTENTIONS)[number];

export interface TreePane {
  readonly paneId: number;
  readonly title: string;
  readonly agent: string | null;
  readonly agentLabel: string | null;
  readonly phase: PanePhase;
  readonly attention: PaneAttention;
  /** Ms epoch the current attention began. */
  readonly attentionSince: number | null;
  /** Last non-empty screen row, ANSI stripped, at most 200 characters. */
  readonly lastLine: string;
  readonly lastOutputAt: number | null;
}
export interface TreeCheckout {
  readonly name: string;
  readonly path: string;
  readonly branch: string | null;
  readonly panes: readonly TreePane[];
}
export interface TreeProject {
  readonly name: string;
  readonly path: string;
  readonly checkouts: readonly TreeCheckout[];
}
export interface Tree {
  readonly projects: readonly TreeProject[];
}
export interface ProjectChoice {
  readonly name: string;
  readonly path: string;
  readonly checkouts: readonly { name: string; path: string; branch: string | null }[];
}

export const TREE_LIMITS = { projects: 200, checkouts: 200, panes: 400, choices: 200 } as const;
const NAME_MAX = 200;
const PATH_MAX = 1024;
const LINE_MAX = 200;
/** Longer raw strings are refused outright instead of being scanned and cut. */
const RAW_TEXT_MAX = 64 * 1024;
const AGENT_ID = /^[A-Za-z0-9._-]{1,64}$/;

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= RAW_TEXT_MAX ? displayText(value, max) : null;
}

function nullableText(value: unknown, max: number): string | null | undefined {
  return value === null ? null : (text(value, max) ?? undefined);
}

function nullableTime(value: unknown): number | null | undefined {
  return value === null ? null : isSafeNonNegative(value) ? value : undefined;
}

export function parseTreePane(value: unknown): TreePane | null {
  if (!isRecord(value) || !isSafeNonNegative(value.paneId)) return null;
  const title = text(value.title, NAME_MAX);
  const lastLine = text(value.lastLine, LINE_MAX);
  const phase = oneOf(PANE_PHASES, value.phase);
  const attention = oneOf(PANE_ATTENTIONS, value.attention);
  const agentLabel = nullableText(value.agentLabel, 64);
  const attentionSince = nullableTime(value.attentionSince);
  const lastOutputAt = nullableTime(value.lastOutputAt);
  const agent =
    value.agent === null
      ? null
      : typeof value.agent === "string" && AGENT_ID.test(value.agent)
        ? value.agent
        : undefined;
  if (
    title === null ||
    lastLine === null ||
    phase === null ||
    attention === null ||
    agentLabel === undefined ||
    attentionSince === undefined ||
    lastOutputAt === undefined ||
    agent === undefined
  ) {
    return null;
  }
  return {
    paneId: value.paneId,
    title,
    agent,
    agentLabel,
    phase,
    attention,
    attentionSince,
    lastLine,
    lastOutputAt,
  };
}

function parseCheckout(value: unknown): TreeCheckout | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, NAME_MAX);
  const path = text(value.path, PATH_MAX);
  const branch = nullableText(value.branch, NAME_MAX);
  const panes = parseList(value.panes, TREE_LIMITS.panes, parseTreePane);
  return name === null || path === null || branch === undefined || panes === null
    ? null
    : { name, path, branch, panes };
}

function parseProject(value: unknown): TreeProject | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, NAME_MAX);
  const path = text(value.path, PATH_MAX);
  const checkouts = parseList(value.checkouts, TREE_LIMITS.checkouts, parseCheckout);
  return name === null || path === null || checkouts === null ? null : { name, path, checkouts };
}

export function parseTree(value: unknown): Tree | null {
  if (!isRecord(value)) return null;
  const projects = parseList(value.projects, TREE_LIMITS.projects, parseProject);
  return projects === null ? null : { projects };
}

function parseChoiceCheckout(
  value: unknown,
): { name: string; path: string; branch: string | null } | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, NAME_MAX);
  const path = text(value.path, PATH_MAX);
  const branch = nullableText(value.branch, NAME_MAX);
  return name === null || path === null || branch === undefined ? null : { name, path, branch };
}

export function parseProjectChoice(value: unknown): ProjectChoice | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, NAME_MAX);
  const path = text(value.path, PATH_MAX);
  const checkouts = parseList(value.checkouts, TREE_LIMITS.checkouts, parseChoiceCheckout);
  return name === null || path === null || checkouts === null ? null : { name, path, checkouts };
}

export function parseProjectChoices(value: unknown): ProjectChoice[] | null {
  return parseList(value, TREE_LIMITS.choices, parseProjectChoice);
}

export function parseAgentChoices(value: unknown): { id: string; label: string }[] | null {
  return parseList(value, 64, (item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !AGENT_ID.test(item.id)) return null;
    const label = text(item.label, 64);
    return label === null ? null : { id: item.id, label };
  });
}
