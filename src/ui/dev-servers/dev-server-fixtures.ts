import type { DevServerRow, DevServerSnapshot } from "../../dev-servers/dev-server-types";
import type { RepositoryScan, WorktreeEntry } from "../../repositories/repository-client";
import { buildView, type DevServerItem } from "./dev-server-model";
import { subjectFor } from "./dev-server-scope";

/** Test fixtures for the dev servers surface; nothing here ships. */

export const NOW = 1_800_000_000_000;

export function row(over: Partial<DevServerRow> = {}): DevServerRow {
  return {
    id: "a",
    instanceToken: "token-a",
    workspacePath: "/real/deck",
    displayRoot: "/w/deck",
    port: 5173,
    bindings: [{ family: "IPv4", address: "127.0.0.1" }],
    sharedEndpoint: false,
    observedAt: NOW,
    liveness: "running",
    stoppedAt: null,
    protocol: "http",
    url: "http://127.0.0.1:5173/",
    identificationError: null,
    ...over,
  };
}

export function snapshot(
  rows: readonly DevServerRow[],
  over: Partial<DevServerSnapshot> = {},
): DevServerSnapshot {
  return {
    generation: 1,
    sequence: 1,
    observedAt: NOW,
    capability: { available: true },
    completeness: "complete",
    metadata: "complete",
    rows,
    diagnostics: [],
    rootDiagnostics: [],
    ...over,
  };
}

export function worktree(path: string, branch: string | null): WorktreeEntry {
  return { path, head: null, branch, bare: false, detached: false, locked: null, prunable: null };
}

/** A repository whose main checkout is `/w/deck` and whose second worktree is `/w/deck-redesign`. */
export function deckScans(): ReadonlyMap<string, RepositoryScan> {
  const scan: RepositoryScan = {
    kind: "repository",
    key: "/w/deck/.git",
    root: "/w/deck",
    worktrees: [worktree("/w/deck", "main"), worktree("/w/deck-redesign", "redesign")],
  };
  return new Map<string, RepositoryScan>([
    ["/w/deck", scan],
    ["/w/deck-redesign", scan],
  ]);
}

/**
 * A project opened through a symlink: the tab says `/tmp/p/alpha`, but git (and so the
 * scan) reports the realpath `/private/tmp/p/alpha`. A linked worktree sits beside it.
 */
export const SYMLINKED = {
  tab: "/tmp/p/alpha",
  primary: "/private/tmp/p/alpha",
  linked: "/private/tmp/p/alpha-wt",
} as const;

export function symlinkedScans(): ReadonlyMap<string, RepositoryScan> {
  const scan: RepositoryScan = {
    kind: "repository",
    key: `${SYMLINKED.primary}/.git`,
    root: SYMLINKED.primary,
    worktrees: [worktree(SYMLINKED.primary, "main"), worktree(SYMLINKED.linked, "wt")],
  };
  return new Map<string, RepositoryScan>([[SYMLINKED.tab, scan]]);
}

/** The view item the active checkout would list for one row. */
export function itemOf(over: Partial<DevServerRow> = {}): DevServerItem {
  const scans = deckScans();
  return buildView(snapshot([row(over)]), "worktree", subjectFor("/w/deck", scans), scans, NOW)
    .items[0];
}
