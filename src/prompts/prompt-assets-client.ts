import { invoke } from '../host/bridge';
import type { PromptAssetKind } from './snippet-format';

/** Mirror of the Rust `PromptAsset` payload from `list_prompt_assets`. */
export interface PromptAsset {
  readonly kind: PromptAssetKind;
  /** Qualified as the CLI would address it, e.g. `superpowers:brainstorming`. */
  readonly name: string;
  /** May be "" — a descriptor without a description is still selectable. */
  readonly description: string;
  readonly source: 'global' | 'project' | 'plugin';
}

export interface PromptAssets {
  readonly skills: readonly PromptAsset[];
  readonly subagents: readonly PromptAsset[];
}

export const EMPTY_PROMPT_ASSETS: PromptAssets = { skills: [], subagents: [] };

/** Detection seam — real IPC in production, fakes in tests. */
export interface PromptAssetsClient {
  /** Rejects on IPC failure; the popover degrades to paste-only (spec §12). */
  list(agent: string, cwd: string | null): Promise<PromptAssets>;
}

export function createTauriPromptAssetsClient(): PromptAssetsClient {
  return {
    list(agent, cwd) {
      return invoke<PromptAssets>('list_prompt_assets', { agent, cwd });
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryPromptAssetsClient(
  assets: PromptAssets = EMPTY_PROMPT_ASSETS,
  options: { readonly fail?: boolean } = {},
): PromptAssetsClient {
  return {
    async list() {
      if (options.fail === true) {
        throw new Error('list_prompt_assets failed');
      }
      return assets;
    },
  };
}

/** Shared production client — callers accept an override for tests. */
export const defaultPromptAssetsClient: PromptAssetsClient = createTauriPromptAssetsClient();
