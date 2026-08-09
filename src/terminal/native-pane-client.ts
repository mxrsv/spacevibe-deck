import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NativeTerminalAppearance } from "./native-appearance";

export interface NativePaneBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export interface NativePaneClient {
  /**
   * Native windows paint above the WebView. This is the single global gate
   * that prevents them from being revealed while a board/modal covers panes.
   */
  setOccluded(occluded: boolean): Promise<void>;
  spawnAlacritty(
    cwd: string | null,
    appearance: NativeTerminalAppearance,
  ): Promise<number>;
  updateAlacritty(
    id: number,
    bounds: NativePaneBounds,
    visible: boolean,
  ): Promise<void>;
  focusAlacritty(id: number): Promise<void>;
  killAlacritty(id: number): Promise<void>;
  applyAlacrittyAppearance(
    id: number,
    appearance: NativeTerminalAppearance,
  ): Promise<void>;
  performAlacrittyAction(id: number, action: NativeTerminalAction): Promise<void>;
  listenFocus(handler: (id: number) => void): Promise<UnlistenFn>;
}

export type NativeTerminalAction =
  | "copy"
  | "paste"
  | "search"
  | "search-next"
  | "search-previous"
  | "clear"
  | "page-up"
  | "page-down"
  | "scroll-top"
  | "scroll-bottom";

export function createTauriNativePaneClient(): NativePaneClient {
  let epoch = 0;
  let desiredOccluded = true;
  let occlusionRequest: Promise<void> = Promise.resolve();
  return {
    setOccluded(occluded) {
      if (occluded === desiredOccluded) {
        return occlusionRequest;
      }
      desiredOccluded = occluded;
      epoch += 1;
      occlusionRequest = invoke("set_alacritty_occluded", {
        epoch,
        occluded,
      });
      return occlusionRequest;
    },
    spawnAlacritty(cwd, appearance) {
      return invoke<number>("spawn_alacritty", { cwd, appearance });
    },
    updateAlacritty(id, bounds, visible) {
      return invoke("update_alacritty", { id, bounds, visible, epoch });
    },
    focusAlacritty(id) {
      return invoke("focus_alacritty", { id, epoch });
    },
    killAlacritty(id) {
      return invoke("kill_alacritty", { id });
    },
    applyAlacrittyAppearance(id, appearance) {
      return invoke("apply_alacritty_appearance", { id, appearance });
    },
    performAlacrittyAction(id, action) {
      return invoke("perform_alacritty_action", { id, action });
    },
    listenFocus(handler) {
      if (!("__TAURI_INTERNALS__" in globalThis)) {
        return Promise.resolve(() => {});
      }
      return listen<{ id: number }>("native-terminal:focus", (event) => {
        handler(event.payload.id);
      });
    },
  };
}

export const defaultNativePaneClient = createTauriNativePaneClient();

export function createMemoryNativePaneClient(
  nextId = 0x8000_0000,
): NativePaneClient & {
  readonly sessions: Set<number>;
  readonly spawnedCwds: Array<string | null>;
  readonly updates: Array<{
    id: number;
    bounds: NativePaneBounds;
    visible: boolean;
  }>;
  readonly occlusionUpdates: boolean[];
  readonly occluded: boolean;
  emitFocus(id: number): void;
} {
  const sessions = new Set<number>();
  const spawnedCwds: Array<string | null> = [];
  const updates: Array<{
    id: number;
    bounds: NativePaneBounds;
    visible: boolean;
  }> = [];
  const focusHandlers = new Set<(id: number) => void>();
  const occlusionUpdates: boolean[] = [];
  let occluded = true;
  return {
    sessions,
    spawnedCwds,
    updates,
    occlusionUpdates,
    get occluded() {
      return occluded;
    },
    async setOccluded(next) {
      if (next !== occluded) {
        occluded = next;
        occlusionUpdates.push(next);
      }
    },
    async spawnAlacritty(cwd) {
      const id = nextId;
      nextId += 1;
      sessions.add(id);
      spawnedCwds.push(cwd);
      return id;
    },
    async updateAlacritty(id, bounds, visible) {
      updates.push({ id, bounds, visible });
    },
    async focusAlacritty() {},
    async killAlacritty(id) {
      sessions.delete(id);
    },
    async applyAlacrittyAppearance() {},
    async performAlacrittyAction() {},
    async listenFocus(handler) {
      focusHandlers.add(handler);
      return () => {
        focusHandlers.delete(handler);
      };
    },
    emitFocus(id) {
      for (const handler of focusHandlers) {
        handler(id);
      }
    },
  };
}
