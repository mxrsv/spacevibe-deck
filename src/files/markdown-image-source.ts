/**
 * Reading a local image the rendered view wants to draw (design 2026-08-23 §6).
 *
 * Electron authorizes reads against roots selected through its native folder
 * picker, then applies the explorer's realpath containment guard. Tauri keeps
 * its frozen legacy command behind the same renderer containment preflight.
 *
 * `read_file` — which design §6 named — cannot serve this: `looksBinary`
 * refuses any file with a NUL byte in its first 8 KiB, which is every PNG,
 * JPEG and WebP. The picture therefore arrives as a `data:` URL rather than
 * the design's blob URL: equivalent, with no revoke lifecycle to leak, and the
 * shape the logo stores already run on.
 *
 * Nothing here ever reaches the network. A remote URL never gets this far —
 * `classifyImage` turned it into a placeholder before the parse finished.
 */
import { invoke } from "../host/bridge";
import { available as electronAvailable, workspaceForPath } from "../host/external-apps-host";

export interface MarkdownImageSource {
  /** A data URL for `path`, or null when it may not or cannot be shown. */
  read(path: string, workspaceRoot: string): Promise<string | null>;
}

export const defaultMarkdownImageSource: MarkdownImageSource = {
  async read(path, workspaceRoot) {
    if (!electronAvailable) {
      const root = await workspaceForPath(path, [workspaceRoot]);
      if (root === null) return null;
      try {
        const dataUrl = await invoke<string>("read_image_as_data_url", { path });
        return typeof dataUrl === "string" && dataUrl.length > 0 ? dataUrl : null;
      } catch {
        return null;
      }
    }
    try {
      const authorized = await invoke<boolean>("activate_image_workspace_root", {
        root: workspaceRoot,
      });
      if (!authorized) return null;
      const dataUrl = await invoke<string>("read_workspace_image_as_data_url", { path });
      return typeof dataUrl === "string" && dataUrl.length > 0 ? dataUrl : null;
    } catch {
      // An unreadable or over-cap image leaves the alt text standing, which is
      // what an `<img>` with no `src` already shows.
      return null;
    }
  },
};
