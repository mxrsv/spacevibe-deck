import { useSignal } from "@preact/signals";
import { useLayoutEffect, useRef } from "preact/hooks";
import { invoke } from "../host/bridge";
import { canResolveDroppedPaths, droppedFilePaths } from "../host/window-host";

interface WorkspaceDropOptions {
  readonly enabled: boolean;
  readonly onSelect: (path: string) => void | Promise<void>;
  readonly onError: (message: string | null) => void;
}

/** Scoped to the board; external paths are verified by the host before selection. */
export function useWorkspaceDrop(options: WorkspaceDropOptions) {
  const dragging = useSignal(false);
  const checking = useSignal(false);
  const current = useRef(options);
  current.current = options;
  const epoch = useRef(0);
  useLayoutEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  // Signal setters are stable; only availability invalidates an in-flight drop.
  /* oxlint-disable react-hooks/exhaustive-deps -- signal setters are stable; only availability invalidates the drop */
  useLayoutEffect(() => {
    if (!options.enabled) {
      epoch.current += 1;
      dragging.value = false;
      checking.value = false;
    }
  }, [options.enabled]);
  /* oxlint-enable react-hooks/exhaustive-deps */

  // A host that cannot resolve paths leaves the drop untouched, so the
  // window-level handler and the Open folder fallback behave as before.
  function containsFiles(event: DragEvent): boolean {
    return (
      canResolveDroppedPaths() && Array.from(event.dataTransfer?.types ?? []).includes("Files")
    );
  }

  async function selectDrop(event: DragEvent): Promise<void> {
    if (!containsFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragging.value = false;
    if (!current.current.enabled || checking.value) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length !== 1) {
      current.current.onError("Drop one folder at a time.");
      return;
    }
    const token = ++epoch.current;
    checking.value = true;
    current.current.onError(null);
    const isCurrent = () => token === epoch.current && current.current.enabled;
    try {
      const paths = droppedFilePaths(files);
      if (paths.length !== 1) {
        current.current.onError("Couldn't read that folder — use Open folder instead.");
        return;
      }
      const flags = await invoke<unknown>("dirs_exist", { paths });
      if (!isCurrent()) return;
      if (!Array.isArray(flags) || flags.length !== 1 || typeof flags[0] !== "boolean") {
        throw new Error("Invalid directory validation response");
      }
      if (!flags[0]) {
        current.current.onError("Drop an existing folder, not a file.");
        return;
      }
      await current.current.onSelect(paths[0]);
    } catch (error) {
      console.warn("Workspace drop failed:", error);
      if (isCurrent())
        current.current.onError("Couldn't open that folder — try again or use Open folder.");
    } finally {
      if (token === epoch.current) checking.value = false;
    }
  }

  return {
    available: canResolveDroppedPaths(),
    dragging: dragging.value,
    checking: checking.value,
    isChecking: () => checking.value,
    handlers: {
      onDragOver(event: DragEvent) {
        if (!containsFiles(event)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer)
          event.dataTransfer.dropEffect = current.current.enabled ? "copy" : "none";
        dragging.value = current.current.enabled && !checking.value;
      },
      onDragLeave(event: DragEvent) {
        const target = event.currentTarget as HTMLElement;
        if (!(event.relatedTarget instanceof Node) || !target.contains(event.relatedTarget)) {
          dragging.value = false;
        }
      },
      onDrop(event: DragEvent) {
        void selectDrop(event);
      },
    },
  };
}
