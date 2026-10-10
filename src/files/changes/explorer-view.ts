/**
 * Which side of the Explorer is showing: the file tree or the Changes list
 * (variant A, spec decision 8). Window-scoped (R5), not persisted: the tree is
 * where a window starts.
 */
import { signal } from "@preact/signals";

export type ExplorerView = "files" | "changes";

export const explorerView = signal<ExplorerView>("files");
