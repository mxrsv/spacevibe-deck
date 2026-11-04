import { buildRail } from "../repositories/repository-model";
import type { RepositoryScan } from "../repositories/repository-client";
import type { TabView } from "./tabs-store";
import { lastRows, stripAnsiSequences } from "../lib/strip-ansi-sequences";

/**
 * What a phone is told about this window's tabs (mobile spec MOB16-18): the rail's own grouping
 * (`buildRail`, so the phone and the rail name a project and a checkout the same way) with each
 * open pane's title, agent, phase, attention and last line. Pure: every fact about a live pane
 * arrives through `MobileTreeInputs`, so the projection is tested without a terminal.
 *
 * Main merges every window's tree, overlays its own pane mirror on phase and attention, and
 * sanitises every string again before a phone sees it; nothing here is trusted on arrival.
 */
export interface MobileTreePane {
  readonly paneId: number;
  readonly title: string;
  readonly agent: string | null;
  readonly agentLabel: string | null;
  readonly phase: "unknown" | "idle" | "working" | "exited";
  readonly attention: "none" | "completed" | "requested" | "warning" | "error";
  readonly attentionSince: number | null;
  readonly lastLine: string;
  readonly lastOutputAt: number | null;
}

export interface MobileTreeReport {
  readonly projects: readonly {
    readonly name: string;
    readonly path: string;
    readonly checkouts: readonly {
      readonly name: string;
      readonly path: string;
      readonly branch: string | null;
      readonly panes: readonly MobileTreePane[];
    }[];
  }[];
}

export interface MobileTreeInputs {
  readonly tabs: readonly TabView[];
  readonly activeIndex: number;
  readonly scans: ReadonlyMap<string, RepositoryScan>;
  /** The pane's screen as plain rows, or "" when unknown. */
  readonly screenText: (paneId: number) => string;
  readonly lastOutputAt: (paneId: number) => number | null;
  readonly agentLabel: (agentId: string) => string | null;
}

/** A phone's row shows one line; the protocol caps it at 200 characters. */
export const LAST_LINE_MAX = 200;
/** Rows read from the bottom of a pane to find its last non-empty one. */
const LAST_LINE_SCAN_ROWS = 12;

/** The last non-empty row of a pane's text, ANSI stripped and cut for a list row. */
export function lastNonEmptyLine(screen: string): string {
  const rows = lastRows(stripAnsiSequences(screen), LAST_LINE_SCAN_ROWS).split("\n");
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!.trim();
    if (row !== "") return Array.from(row).slice(0, LAST_LINE_MAX).join("");
  }
  return "";
}

export function buildMobileTree(input: MobileTreeInputs): MobileTreeReport {
  const groups = buildRail({
    tabs: input.tabs,
    activeIndex: input.activeIndex,
    scans: input.scans,
    collapsed: new Set(),
    archivedPaths: new Set(),
  });
  const projects: MobileTreeReport["projects"][number][] = [];
  for (const group of groups) {
    const checkouts: MobileTreeReport["projects"][number]["checkouts"][number][] = [];
    for (const worktree of group.worktrees) {
      const panes: MobileTreePane[] = [];
      for (const tab of worktree.tabs) {
        for (const pane of input.tabs[tab.index]?.panes ?? []) {
          const agentLabel = pane.agent === null ? null : input.agentLabel(pane.agent);
          panes.push({
            paneId: pane.paneId,
            title: tab.customName ?? agentLabel ?? "Shell",
            agent: pane.agent,
            agentLabel,
            phase: pane.phase,
            attention: pane.attention,
            attentionSince:
              pane.attention === "none" || pane.changedAt === 0 ? null : pane.changedAt,
            lastLine: lastNonEmptyLine(input.screenText(pane.paneId)),
            lastOutputAt: input.lastOutputAt(pane.paneId),
          });
        }
      }
      if (panes.length > 0) {
        checkouts.push({
          name: worktree.name,
          path: worktree.path,
          branch: worktree.branch,
          panes,
        });
      }
    }
    if (checkouts.length > 0) {
      projects.push({ name: group.name, path: group.repositoryPath, checkouts });
    }
  }
  return { projects };
}

export interface ProjectChoiceReport {
  readonly name: string;
  readonly path: string;
  readonly checkouts: readonly { name: string; path: string; branch: string | null }[];
}

/**
 * The folders a phone may open an agent in: each workspace Deck remembers, folded by repository
 * with every checkout git reports (so a worktree is choosable even with nothing open in it).
 */
export function buildProjectChoices(
  workspaces: readonly { readonly path: string; readonly scan: RepositoryScan }[],
  label: (path: string) => string,
): ProjectChoiceReport[] {
  const byKey = new Map<string, ProjectChoiceReport>();
  for (const { path, scan } of workspaces) {
    if (scan.kind !== "repository") {
      byKey.set(`plain:${path}`, {
        name: label(path),
        path,
        checkouts: [{ name: label(path), path, branch: null }],
      });
      continue;
    }
    if (byKey.has(scan.key)) continue;
    const checkouts = scan.worktrees
      .filter((worktree) => !worktree.bare && worktree.prunable === null)
      .map((worktree) => ({
        name: worktree.branch ?? label(worktree.path),
        path: worktree.path,
        branch: worktree.branch,
      }));
    const primary = scan.worktrees.find((worktree) => !worktree.bare)?.path ?? scan.root;
    byKey.set(scan.key, { name: label(primary), path: primary, checkouts });
  }
  return [...byKey.values()];
}

/**
 * The agents a phone may open: installed and enabled, with an id the protocol accepts. An id is the
 * agent's label (built-ins, custom agents) or `custom:<slug>`, so spaces are fine; what the phone
 * refuses is an empty id, one over 64 characters, edge whitespace or a control character.
 */
export function isPhoneAgentId(id: string): boolean {
  if (id.length === 0 || id.length > 64 || id !== id.trim()) return false;
  for (const char of id) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}

export function phoneAgentChoices(
  options: readonly { readonly id: string; readonly label: string; readonly missing: boolean }[],
): { id: string; label: string }[] {
  return options
    .filter((option) => !option.missing && isPhoneAgentId(option.id))
    .map((option) => ({ id: option.id, label: option.label }));
}
