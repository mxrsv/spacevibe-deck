/**
 * The renderer's facade over the repository scan channel.
 *
 * Shaped like every other `src/host/*` facade: one thin `invoke` wrapper, so
 * the pure modules beside it stay host-free and unit-testable and the payload
 * key is written in exactly one place — which is what
 * `scripts/electron-ipc-contract.test.ts` parses.
 *
 * Design: `docs/specs/2026-08-13-repository-worktree-rail-design.md` §1.1.
 */
import { invoke } from "../host/bridge";

export interface WorktreeEntry {
  readonly path: string;
  readonly head: string | null;
  readonly branch: string | null;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: string | null;
  readonly prunable: string | null;
}

export type RepositoryScan =
  | {
      readonly kind: "repository";
      /** Absolute `--git-common-dir`: identical across a repository's worktrees. */
      readonly key: string;
      readonly root: string;
      readonly worktrees: readonly WorktreeEntry[];
    }
  | { readonly kind: "plain"; readonly reason: string };

export interface RepositoryClient {
  scan(path: string): Promise<RepositoryScan>;
}

export const defaultRepositoryClient: RepositoryClient = {
  scan: (path) => invoke<RepositoryScan>("git_repository", { path }),
};
