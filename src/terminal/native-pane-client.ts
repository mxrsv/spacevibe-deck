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
  return {
    spawnAlacritty(cwd, appearance) {
      return invoke<number>("spawn_alacritty", { cwd, appearance });
    },
    updateAlacritty(id, bounds, visible) {
      return invoke("update_alacritty", { id, bounds, visible });
    },
    focusAlacritty(id) {
      return invoke("focus_alacritty", { id });
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
  return {
    sessions,
    spawnedCwds,
    updates,
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
