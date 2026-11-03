import type { FileSurfaceController } from "../../files/file-surface-controller";
import { surfaceFor } from "../../files/file-surface-store";
import { hasTab } from "../../files/preview-slot";

/**
 * Close `paths` one at a time through the controller's own close, which asks before discarding
 * unsaved work. A refused prompt leaves its tab open and ends the run, so "Close all" cannot
 * quietly skip a file the user chose to keep.
 */
export async function closeGuarded(
  controller: FileSurfaceController,
  root: string,
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    await controller.closePath(root, path);
    if (hasTab(surfaceFor(root).tabs, path)) {
      return;
    }
  }
}

/** The tabs a context-menu action closes, given the tab it was raised on. */
export function closeTargets(
  action: "one" | "others" | "right" | "all",
  paths: readonly string[],
  at: string,
): readonly string[] {
  const index = paths.indexOf(at);
  switch (action) {
    case "one":
      return [at];
    case "others":
      return paths.filter((path) => path !== at);
    case "right":
      return index === -1 ? [] : paths.slice(index + 1);
    case "all":
      return paths;
  }
}
