import { invoke } from "./bridge";

/** Electron-only; Tauri and browser previews do not install this bridge. */
export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export interface CreateWorkspaceResult {
  readonly path: string;
}

/** Flat payload per the renderer/main IPC contract. */
export function createWorkspace(parent: string, name: string): Promise<CreateWorkspaceResult> {
  return invoke<CreateWorkspaceResult>("create_directory", { parent, name });
}
