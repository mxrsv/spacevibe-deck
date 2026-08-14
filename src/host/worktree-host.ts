/**
 * Create-worktree — the Electron-only capability the open board's
 * `hostCanCreateWorktrees()` seam (task 15) was left to fill (task 16).
 *
 * `available` reads `window.__deckHost` directly rather than routing through
 * `bridge.ts`'s `invoke`, because that throws when the bridge is missing —
 * exactly the case this flag exists to detect without throwing. The Electron
 * preload is the only place that ever sets the global: Tauri's own build
 * never did (the swap in 5b9305f moved every `src/host/` facade onto this
 * bridge and gave Tauri no equivalent), and neither does a browser-only
 * `npm run dev` preview. One presence check is therefore the exact three-way
 * truth table the board needs — Electron true, Tauri and browser dev false —
 * with no separate Tauri detection required.
 */
import { invoke } from "./bridge";

export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export interface AddWorktreeArgs {
  readonly repoPath: string;
  readonly branch: string;
  readonly destPath: string;
}

export type WorktreeAddErrorCode =
  | "not-a-repository"
  | "branch-exists"
  | "destination-exists"
  | "git-not-found"
  | "unknown";

export type AddWorktreeResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: WorktreeAddErrorCode };

/**
 * Flat payload per R6 — the object literal (not the `args` identifier) is
 * what `scripts/electron-ipc-contract.test.ts` can see the keys of.
 */
export function addWorktree({
  repoPath,
  branch,
  destPath,
}: AddWorktreeArgs): Promise<AddWorktreeResult> {
  return invoke<AddWorktreeResult>("worktree_add", {
    repoPath,
    branch,
    destPath,
  });
}
