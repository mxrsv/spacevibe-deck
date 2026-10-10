/** The selected document, inside the Explorer alongside its file list. */
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import {
  activeFileTab,
  activeWorkspace,
  documentFor,
  surfaceFor,
  toggleViewMode,
  viewModeFor,
} from "../file-surface-store";
import { baseName } from "../../lib/path-name";
import { isMarkdownPath } from "../markdown-policy";
import type { FileSurfaceController } from "../file-surface-controller";
import { FileEditor } from "./file-editor";
import { MarkdownView } from "./markdown-view";
import { ViewModeToggle } from "./view-mode-toggle";

export interface FilePanelProps {
  readonly controller: FileSurfaceController;
  readonly workspacePath: string;
  readonly onEmpty?: () => void;
}

export function FilePanel({ controller, workspacePath, onEmpty }: FilePanelProps) {
  const surface = surfaceFor(workspacePath);
  const path = surface.activePath;
  const panel = useRef<HTMLElement>(null);
  const previousPath = useRef(path);
  useLayoutEffect(() => {
    if (path === null && previousPath.current !== null) onEmpty?.();
    previousPath.current = path;
    if (
      path !== null &&
      activeFileTab.value === path &&
      !panel.current?.contains(globalThis.document.activeElement)
    )
      panel.current?.focus();
  }, [path, onEmpty]);
  // Closing the dock releases keyboard ownership, but keeps every buffer.
  useEffect(
    () => () => {
      if (documentFor(activeFileTab.value)?.workspacePath === workspacePath)
        controller.deactivate();
    },
    [controller, workspacePath],
  );
  if (path === null) return null;
  const document = documentFor(path);
  const markdown = isMarkdownPath(path);
  const mode = viewModeFor(path);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      class="file-panel"
      aria-label="File contents"
      onFocusIn={() => {
        if (activeWorkspace.value !== workspacePath) return;
        const currentPath = surfaceFor(workspacePath).activePath;
        if (currentPath !== null && activeFileTab.value !== currentPath)
          controller.activateFile(workspacePath, currentPath, false);
      }}
      onFocusOut={(event) => {
        const root = event.currentTarget;
        const next = event.relatedTarget as Node | null;
        if (next === null) {
          // Replacing Markdown with Monaco removes the focused child during
          // commit. Let layout park focus before deciding it left the panel.
          queueMicrotask(() => {
            if (
              root.isConnected &&
              activeFileTab.value === path &&
              !root.contains(globalThis.document.activeElement)
            )
              controller.deactivate();
          });
        } else if (activeFileTab.value === path && !root.contains(next)) {
          controller.deactivate();
        }
      }}
    >
      <header class="file-panel__header">
        <select
          class="file-panel__files"
          aria-label="Open files"
          value={path}
          onChange={(event) => controller.activateFile(workspacePath, event.currentTarget.value)}
        >
          {surface.tabs.map((tab) => (
            <option key={tab.path} value={tab.path}>
              {baseName(tab.path)}
              {documentFor(tab.path)?.dirty ? " •" : ""}
            </option>
          ))}
        </select>
        {markdown && <ViewModeToggle mode={mode} onToggle={() => toggleViewMode(path)} />}
        <button
          type="button"
          class="file-panel__action"
          disabled={!document?.dirty || document.file?.readOnly}
          onClick={() => void controller.savePath(path)}
        >
          Save
        </button>
        <button
          type="button"
          class="file-panel__action"
          onClick={() => void controller.closePath(workspacePath, path)}
        >
          Close
        </button>
      </header>
      <div class="file-panel__content">
        {markdown && mode === "rendered" ? (
          <MarkdownView path={path} controller={controller} />
        ) : (
          <FileEditor path={path} controller={controller} />
        )}
      </div>
    </section>
  );
}
