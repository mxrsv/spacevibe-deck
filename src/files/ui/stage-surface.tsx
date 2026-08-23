/**
 * The document ON the stage — spec §4.2's other half, landed 2026-08-14.
 *
 * Until then the editor was parked in a `__preview` block at the bottom of
 * `ExplorerPanel`, which made its real mount condition
 * `dockOpen && activeFileTab !== null`: closing the file tree also took
 * the open document away and disposed Monaco with it. Here the only condition
 * is `activeFileTab`, so ⌘⇧B hides the tree and nothing else, and switching
 * the tree off and on again no longer costs an editor teardown.
 *
 * A component rather than JSX inline in `App` for one reason: `App` has no
 * render harness in this repo (see `closeSettingsPanel`'s comment for the same
 * call), so anything written inline there is untestable. This is the seam that
 * makes "opening a file puts an editor on the stage" assertable — and makes it
 * structurally impossible for `dockOpen` to creep back into the condition.
 *
 * Since 2026-08-23 it also decides WHICH of the two views a markdown file gets
 * (design 2026-08-23 §3): `MarkdownView` when the path is markdown and the
 * mode is `rendered`, `FileEditor` unchanged otherwise. The choice is made
 * here rather than inside `FileEditor` so neither component knows the other
 * exists, and so flipping the mode UNMOUNTS Monaco for that tab instead of
 * leaving an editor alive behind a hidden div.
 *
 * The toggle sits at this level too, above both mounts: it is one control that
 * must be present in both modes, and source mode is exactly where the way back
 * matters.
 *
 * It renders the layer only; the rectangle it occupies (and the insets that
 * keep it clear of the docked panels) is `.stage__surface` in styles.css.
 */
import { activeFileTab, toggleViewMode, viewModeFor } from "../file-surface-store";
import { isMarkdownPath } from "../markdown-policy";
import type { FileSurfaceController } from "../file-surface-controller";
import { FileEditor } from "./file-editor";
import { MarkdownView } from "./markdown-view";
import { ViewModeToggle } from "./view-mode-toggle";

export interface StageSurfaceProps {
  readonly controller: FileSurfaceController;
}

export function StageSurface(props: StageSurfaceProps) {
  const path = activeFileTab.value;
  if (path === null) {
    return null; // a terminal tab holds the stage
  }
  const markdown = isMarkdownPath(path);
  const mode = viewModeFor(path);
  return (
    <div class="stage__surface">
      {markdown && <ViewModeToggle mode={mode} onToggle={() => toggleViewMode(path)} />}
      {markdown && mode === "rendered" ? (
        <MarkdownView path={path} controller={props.controller} />
      ) : (
        <FileEditor path={path} controller={props.controller} />
      )}
    </div>
  );
}
