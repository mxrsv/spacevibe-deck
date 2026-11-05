import type { AgentOption } from "../lib/agent-catalog";
import type { LaunchCommandChoices } from "../lib/launch-command";
import type { LaunchCommandOverride } from "../terminal/agent-launch-target";

/** One project the bar can target. The caller sends them most recent first. */
export interface CommandBarProject {
  readonly path: string;
  readonly name: string;
  readonly branch: string | null;
  /** How old the project is, already formatted ("3w"); null while it is recent. */
  readonly age: string | null;
}

/** LCH-6: a run opens at most this many panes. */
export const MAX_PICKED_AGENTS = 4;
/** LCH-5: the filter lists this many matching projects under the bar. */
export const BAR_PROJECT_HITS = 5;

const normalize = (text: string): string => text.trim().toLowerCase();

/** The agents a run can start: the missing ones stay on the bar but never run. */
export function runnableIds(agents: readonly AgentOption[]): readonly string[] {
  return agents.filter((agent) => !agent.missing).map((agent) => agent.id);
}

/**
 * The pick a visit starts with: the wanted agents that can run, in the bar's order of asking,
 * else the first agent that can run, else nothing.
 */
export function resolveDefaultPick(
  wanted: readonly string[],
  agents: readonly AgentOption[],
): readonly string[] {
  const runnable = new Set(runnableIds(agents));
  const kept = wanted.filter((id, at) => runnable.has(id) && wanted.indexOf(id) === at);
  const first = agents.find((agent) => !agent.missing);
  const pick = kept.length > 0 ? kept : first === undefined ? [] : [first.id];
  return pick.slice(0, MAX_PICKED_AGENTS);
}

/**
 * A press on a chip. Plain picks only that agent; shift adds it, or removes it again. The pick
 * never empties and never passes the cap.
 */
export function togglePick(
  picked: readonly string[],
  id: string,
  additive: boolean,
): readonly string[] {
  if (!additive) return [id];
  if (picked.includes(id)) {
    const rest = picked.filter((other) => other !== id);
    return rest.length > 0 ? rest : picked;
  }
  return picked.length >= MAX_PICKED_AGENTS ? picked : [...picked, id];
}

export function runLabel(count: number): string {
  return count > 1 ? `Run ${count}` : "Run";
}

/** The chips a filter leaves: the query meets an agent's name, id or default command. */
export function filterAgents(
  agents: readonly AgentOption[],
  commands: Readonly<Record<string, LaunchCommandChoices>>,
  query: string,
): readonly AgentOption[] {
  const needle = normalize(query);
  if (needle === "") return agents;
  return agents.filter((agent) =>
    [agent.label, agent.id, commands[agent.id]?.default ?? ""].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/** Projects whose name holds the query, in the order given. */
export function matchProjects(
  projects: readonly CommandBarProject[],
  query: string,
): readonly CommandBarProject[] {
  const needle = normalize(query);
  return needle === ""
    ? projects
    : projects.filter((project) => project.name.toLowerCase().includes(needle));
}

/** The projects listed under the bar while a filter is typed: not the one already targeted. */
export function barProjectHits(
  projects: readonly CommandBarProject[],
  query: string,
  currentPath: string | null,
): readonly CommandBarProject[] {
  if (normalize(query) === "") return [];
  return matchProjects(projects, query)
    .filter((project) => project.path !== currentPath)
    .slice(0, BAR_PROJECT_HITS);
}

export interface MatchParts {
  readonly before: string;
  readonly match: string;
  readonly after: string;
}

/** A name cut around the first place the query appears, so the match can be set bold. */
export function matchParts(name: string, query: string): MatchParts {
  const needle = normalize(query);
  const at = needle === "" ? -1 : name.toLowerCase().indexOf(needle);
  if (at < 0) return { before: name, match: "", after: "" };
  return {
    before: name.slice(0, at),
    match: name.slice(at, at + needle.length),
    after: name.slice(at + needle.length),
  };
}

export type EnterAction =
  | { readonly kind: "run" }
  | { readonly kind: "run-agent"; readonly agentId: string }
  | { readonly kind: "pick-project"; readonly path: string };

/**
 * What Enter does outside a button. With an empty filter it runs the pick. With one typed it
 * runs the first matching agent that can run, else switches to the first matching project, else
 * runs the pick.
 */
export function enterAction(
  query: string,
  agents: readonly AgentOption[],
  commands: Readonly<Record<string, LaunchCommandChoices>>,
  hits: readonly CommandBarProject[],
): EnterAction {
  if (normalize(query) === "") return { kind: "run" };
  const agent = filterAgents(agents, commands, query).find((option) => !option.missing);
  if (agent !== undefined) return { kind: "run-agent", agentId: agent.id };
  const project = hits[0];
  return project === undefined ? { kind: "run" } : { kind: "pick-project", path: project.path };
}

/** The command a chip's press types now: the visit's profile pick, else the agent's default. */
export function activeCommand(
  choices: LaunchCommandChoices | undefined,
  pick: string | undefined,
): string | null {
  if (choices === undefined) return null;
  return pick !== undefined && choices.commands.includes(pick) ? pick : choices.default;
}

/**
 * The profile overrides a run carries: one per agent whose pick differs from its default. An
 * agent on its default has no entry, as `launchAgentAtTarget` expects.
 */
export function profileOverrides(
  agentIds: readonly string[],
  commands: Readonly<Record<string, LaunchCommandChoices>>,
  picks: Readonly<Record<string, string>>,
): Readonly<Record<string, LaunchCommandOverride>> {
  const overrides: Record<string, LaunchCommandOverride> = {};
  for (const id of agentIds) {
    const command = activeCommand(commands[id], picks[id]);
    if (command !== null && command !== commands[id]?.default) {
      overrides[id] = { kind: "profile", command };
    }
  }
  return overrides;
}

export interface MenuKeyResult {
  readonly index: number;
  readonly action: "none" | "pick" | "close";
}

/**
 * The project menu's keys. The arrows move the highlight and wrap, Enter picks the highlighted
 * row, Escape closes. Any other key leaves the state alone.
 */
export function reduceMenuKey(index: number, key: string, count: number): MenuKeyResult {
  switch (key) {
    case "ArrowDown":
      return { index: count === 0 ? 0 : (index + 1) % count, action: "none" };
    case "ArrowUp":
      return { index: count === 0 ? 0 : (index - 1 + count) % count, action: "none" };
    case "Enter":
      return { index, action: count === 0 ? "none" : "pick" };
    case "Escape":
      return { index, action: "close" };
    default:
      return { index, action: "none" };
  }
}
