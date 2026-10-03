/**
 * Spaces (DL §35): a space IS a terminal tab, named by its workspace folder
 * until the user gives it a name of its own.
 *
 * A pure projection over `tabViews`, in the order the caller already shows
 * terminal tabs in — the strip's merged order, scoped to the active repository
 * in sidebar mode — so ⌘1–9, cycling and the marks can never disagree about
 * which space is "the third one". No new owner: a tab's `workspacePath` is
 * fixed for its life, which makes it a stable default name, and the user's own
 * name is the tab's (`TabView.name`, journaled with it).
 */
import type { PaneAgent } from "../../lib/process-info";
import type { RepositoryScan } from "../../repositories/repository-client";
import { worktreeForPath } from "../../repositories/repository-model";
import { MAX_TAB_NAME_LENGTH, NO_PANES, type TabView } from "../../terminal/tabs-store";
import { paneState, type RailState } from "../agent-rail-model";
import type { SpaceGroup } from "./space-order";

/** What a pane is in a space's miniature: an agent's rail state, or a shell. */
export type SpacePaneState = RailState | "shell";

export interface SpacePane {
  readonly paneId: number;
  readonly agent: PaneAgent | null;
  readonly state: SpacePaneState;
}

export interface Space {
  /** Owner index in `tabViews` — the coordinate `selectTab` takes. */
  readonly tabIndex: number;
  /** `TabView.key`, the identity a render keys on. */
  readonly key: number;
  /** The workspace folder's own name, or `~` for a tab with no workspace. */
  readonly folder: string;
  /** The name the user gave the space (`TabView.name`); null while unnamed. */
  readonly name: string | null;
  /** 1-based position among spaces sharing one workspace; null when alone. */
  readonly index: number | null;
  /** The workspace path as the tab holds it; null for a workspace-less tab. */
  readonly path: string | null;
  /**
   * The project the space belongs to (the rail's `orderKey`): a repository and
   * its worktrees are one, a plain folder stands alone. Strip capsules and
   * shelf sets group by this, never by `path`.
   */
  readonly group: string;
  /** The project's printed name. */
  readonly groupLabel: string;
  /** The checked-out branch, when a repository scan knows it (Electron only). */
  readonly branch: string | null;
  readonly panes: readonly SpacePane[];
  /** Panes with an agent in them, present or departed. */
  readonly agentCount: number;
  /** `asked` + `failed` — the Board's "needs me" (DL-34.11). */
  readonly needsCount: number;
  /** The `failed` share of `needsCount`, which is red, not yellow (DL-3.2). */
  readonly failedCount: number;
  readonly current: boolean;
}

export interface SpaceInput {
  readonly tabs: readonly TabView[];
  /** Owner indexes in display order; indexes with no tab are skipped. */
  readonly order: readonly number[];
  readonly activeIndex: number;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  /**
   * Owner index → project, from `spaceLayoutFromRail`. A tab without an entry
   * is its own folder's project, which is how a plain folder reads anyway.
   */
  readonly groups?: ReadonlyMap<number, SpaceGroup>;
}

/** The folder a space is called by: the last segment of its path. */
export function folderName(path: string | null): string {
  if (path === null) return "~";
  const segments = path.split(/[\\/]+/).filter((segment) => segment !== "");
  return segments[segments.length - 1] ?? path;
}

/**
 * The name a space gets when an agent launch creates it (DL-35.3): its folder
 * and the agent, `spacevibe-deck · Claude Code`. Inside the 40-character cap
 * the folder gives way, not the agent, because the agent is what tells two
 * spaces on one folder apart.
 */
export function autoSpaceName(folder: string, agentLabel: string): string {
  const suffix = ` · ${agentLabel}`;
  const room = MAX_TAB_NAME_LENGTH - suffix.length;
  if (folder.length + suffix.length <= MAX_TAB_NAME_LENGTH) return folder + suffix;
  return room > 1 ? `${folder.slice(0, room - 1)}…${suffix}` : agentLabel;
}

function pathKey(path: string | null): string {
  return path ?? "";
}

function branchOf(path: string | null, scans: ReadonlyMap<string, RepositoryScan>): string | null {
  if (path === null) return null;
  const scan = scans.get(path);
  if (scan?.kind !== "repository") return null;
  const worktree = worktreeForPath(
    scan.worktrees.map((entry) => entry.path),
    path,
  );
  return scan.worktrees.find((entry) => entry.path === worktree)?.branch ?? null;
}

function spacePanes(tab: TabView): readonly SpacePane[] {
  return (tab.panes ?? NO_PANES).map((pane) => {
    const agent = pane.agent ?? pane.lastAgent ?? null;
    return { paneId: pane.paneId, agent, state: agent === null ? "shell" : paneState(pane) };
  });
}

/** Every space in `order`, named, indexed, counted. */
export function buildSpaces(input: SpaceInput): readonly Space[] {
  const tabs = input.order.flatMap((tabIndex) => {
    const tab = input.tabs[tabIndex];
    return tab === undefined ? [] : [{ tab, tabIndex }];
  });
  const keys = tabs.map(({ tab }) => pathKey(tab.workspacePath));
  return tabs.map(({ tab, tabIndex }, at) => {
    const key = keys[at];
    const shared = keys.filter((other) => other === key).length > 1;
    const position = keys.slice(0, at).filter((other) => other === key).length + 1;
    const panes = spacePanes(tab);
    const project = input.groups?.get(tabIndex) ?? {
      key: `plain:${key}`,
      label: folderName(tab.workspacePath),
    };
    return {
      tabIndex,
      key: tab.key,
      folder: folderName(tab.workspacePath),
      name: tab.name,
      index: shared ? position : null,
      path: tab.workspacePath,
      group: project.key,
      groupLabel: project.label,
      branch: branchOf(tab.workspacePath, input.scans),
      panes,
      agentCount: panes.filter((pane) => pane.agent !== null).length,
      needsCount: panes.filter((pane) => pane.state === "asked" || pane.state === "failed").length,
      failedCount: panes.filter((pane) => pane.state === "failed").length,
      current: tabIndex === input.activeIndex,
    };
  });
}

/** Where a space is: its folder, then its index when it has one. */
export function spaceAddress(space: Pick<Space, "folder" | "index">): string {
  return space.index === null ? space.folder : `${space.folder} ${space.index}`;
}

/** What a space is called: its name, else its address (DL-35.3). */
export function spaceLabel(space: Pick<Space, "folder" | "index" | "name">): string {
  return space.name ?? spaceAddress(space);
}

/** `3 agents · 1 needs you`, the count line shared by the card and the shelf. */
export function spaceCounts(space: Pick<Space, "agentCount" | "needsCount">): string {
  const agents = `${space.agentCount} ${space.agentCount === 1 ? "agent" : "agents"}`;
  return space.needsCount > 0 ? `${agents} · ${space.needsCount} need you` : agents;
}

/**
 * The colour a space's needs-you takes (DL-35.3): red when any pane failed —
 * DL-3.2's failure — else yellow when one asked, else none.
 */
export function needsTone(
  space: Pick<Space, "needsCount" | "failedCount">,
): "failed" | "asked" | null {
  if (space.failedCount > 0) return "failed";
  return space.needsCount > 0 ? "asked" : null;
}

/** Consecutive spaces of one project, in order — the strip draws one capsule per run. */
export function runsByGroup(spaces: readonly Space[]): readonly (readonly Space[])[] {
  return spaces.reduce<readonly (readonly Space[])[]>((runs, space) => {
    const last = runs[runs.length - 1];
    return last !== undefined && last[0].group === space.group
      ? [...runs.slice(0, -1), [...last, space]]
      : [...runs, [space]];
  }, []);
}

/** Columns of a space's miniature: the smallest square grid that holds it. */
export function miniColumns(paneCount: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(paneCount)));
}
