import { invoke } from "../host/bridge";
import { openUrl as openUrlWithDefaultApp } from "../host/shell-host";
import type { OpenEditorRequest } from "../lib/editor-command";

/** Backend seam for terminal links — Tauri IPC in production, fakes in tests. */
export interface LinkClient {
  /**
   * Absolute path of every candidate that is an existing file, index-aligned
   * with `paths` (a candidate that is not a file comes back as null).
   */
  resolvePaths(cwd: string, paths: readonly string[]): Promise<(string | null)[]>;
  /** Send validated editor intent to the native launch boundary. */
  openEditor(request: OpenEditorRequest): Promise<void>;
  /** Hand an http/https URL to the default browser. */
  openUrl(url: string): Promise<void>;
}

export function createTauriLinkClient(): LinkClient {
  return {
    async resolvePaths(cwd, paths) {
      if (paths.length === 0) {
        return [];
      }
      return invoke<(string | null)[]>("resolve_paths", {
        cwd,
        paths: [...paths],
      });
    },
    openEditor(request) {
      return invoke("open_editor", { request });
    },
    openUrl(url) {
      return openUrlWithDefaultApp(url);
    },
  };
}

/** In-memory adapter for unit tests — no Tauri. */
export function createMemoryLinkClient(
  options: { readonly files?: readonly string[] } = {},
): LinkClient & {
  readonly openedEditor: OpenEditorRequest[];
  readonly openedUrls: string[];
} {
  const files = new Set(options.files ?? []);
  const openedEditor: OpenEditorRequest[] = [];
  const openedUrls: string[] = [];
  return {
    openedEditor,
    openedUrls,
    async resolvePaths(cwd, paths) {
      return paths.map((path) => {
        const full = path.startsWith("/") ? path : `${cwd}/${path}`;
        return files.has(full) ? full : null;
      });
    },
    async openEditor(request) {
      openedEditor.push(request);
    },
    async openUrl(url) {
      openedUrls.push(url);
    },
  };
}

/** Shared production client — factories accept an override for tests. */
export const defaultLinkClient: LinkClient = createTauriLinkClient();
