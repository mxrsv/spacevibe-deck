/**
 * Reading a local image the rendered view wants to draw (design 2026-08-23 §6).
 *
 * Two existing channels, **no new IPC** — which is what keeps design §9's
 * "no contract in `scripts/electron-ipc-contract.test.ts` moves" true:
 *
 *  - `workspace_for_path` answers CONTAINMENT, main-process side, through
 *    `resolveInsideRoot` — the explorer's own guard. The renderer's
 *    `classifyImage` already refused anything that resolves outside the root,
 *    but the renderer is not the trust boundary, and this is the same
 *    main-process answer a ⌘+click on an agent-printed path gets.
 *  - `read_image_as_data_url` carries the bytes, with its own extension
 *    allowlist and 1 MB cap.
 *
 * `read_file` — which design §6 named — cannot serve this: `looksBinary`
 * refuses any file with a NUL byte in its first 8 KiB, which is every PNG,
 * JPEG and WebP. The picture therefore arrives as a `data:` URL rather than
 * the design's blob URL: equivalent, with no revoke lifecycle to leak, and the
 * shape the logo and sidebar-banner stores already run on.
 *
 * Nothing here ever reaches the network. A remote URL never gets this far —
 * `classifyImage` turned it into a placeholder before the parse finished.
 */
import { invoke } from "../host/bridge";
import { workspaceForPath } from "../host/external-apps-host";

export interface MarkdownImageSource {
  /** A data URL for `path`, or null when it may not or cannot be shown. */
  read(path: string, workspaceRoot: string): Promise<string | null>;
}

export const defaultMarkdownImageSource: MarkdownImageSource = {
  async read(path, workspaceRoot) {
    const root = await workspaceForPath(path, [workspaceRoot]);
    if (root === null) {
      // Either the host declined containment, or there is no host at all
      // (Tauri, where this surface does not exist). Both mean "do not draw".
      return null;
    }
    try {
      const dataUrl = await invoke<string>("read_image_as_data_url", { path });
      return typeof dataUrl === "string" && dataUrl.length > 0 ? dataUrl : null;
    } catch {
      // An unreadable or over-cap image leaves the alt text standing, which is
      // what an `<img>` with no `src` already shows.
      return null;
    }
  },
};
