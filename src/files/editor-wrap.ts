/**
 * Whether the file editor wraps long lines: the dock breadcrumb's wrap toggle (DOCK-7).
 * Window-scoped (R5) and not a setting, like the view modes: it is a reading choice for the
 * files on screen, and one editor instance serves every file tab, so it holds across tabs.
 */
import { signal } from "@preact/signals";

export const editorWordWrap = signal(false);

export function toggleEditorWordWrap(): void {
  editorWordWrap.value = !editorWordWrap.value;
}
