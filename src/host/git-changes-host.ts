/**
 * The Changes list's read, as the renderer sees it (plan 2026-10-10-changes-list).
 *
 * `file-create-host.ts`'s shape: an `available` boolean read off `__deckHost`
 * and one `invoke`. Electron only — Tauri and browser previews omit the
 * Explorer's Changes entry point instead of implementing a second host
 * (DL-19.7's rule for a host that cannot serve).
 *
 * The reply types mirror `electron/git/changes.ts`, which owns them; the two
 * sides are separate compilations, so the mirror is the contract (R6).
 */
import { invoke, listen, type UnlistenFn } from "./bridge";

export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export type ChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked";

export interface ChangeEntry {
  /** Relative to the root, `/`-separated. */
  readonly path: string;
  readonly status: ChangeStatus;
  readonly oldPath: string | null;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
  readonly counted: boolean;
}

export interface ChangesSnapshot {
  readonly kind: "changes";
  readonly branch: string | null;
  readonly detached: boolean;
  readonly oid: string | null;
  readonly initial: boolean;
  readonly entries: readonly ChangeEntry[];
  readonly omitted: number;
  readonly totals: { readonly added: number; readonly removed: number };
}

export type ChangesFailureKind =
  "not-repository" | "git-missing" | "timeout" | "overflow" | "failed";

export interface ChangesFailure {
  readonly kind: ChangesFailureKind;
  readonly message: string;
}

export type ChangesReply = ChangesSnapshot | ChangesFailure;

/** Never rejects on the main side: every failure is a typed reply. */
export function readChanges(root: string): Promise<ChangesReply> {
  return invoke<ChangesReply>("git_changes", { root });
}

/**
 * Replaces this window's one watched checkout; `null` releases it. Rejects for a
 * root the host cannot resolve, like `watch_paths`.
 */
export function watchChanges(root: string | null): Promise<void> {
  return invoke<void>("git_changes_watch", { root });
}

/** "Read again" for the watched checkout. The payload names the root only. */
export function listenChanged(handler: (root: string) => void): Promise<UnlistenFn> {
  return listen<{ readonly root: string }>("git:changed", (event) => handler(event.payload.root));
}
