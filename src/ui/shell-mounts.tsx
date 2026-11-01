/* Named mount points for the shell rebuild (docs/plans/2026-10-22-shell-rebuild.md, P0).
   Each slot renders nothing; the slice that owns it fills the body and its
   stylesheet partial, so `app.tsx` is edited once here and never again. */

/** Stacked sections inside the dock (`src/styles/27-dock-stacked.css`). */
export function DockSections() {
  return null;
}

/** The hunk queue (`src/styles/28-hunk-queue.css`). */
export function HunkQueue() {
  return null;
}

/** The browser's side slot, beside the stage (`src/styles/29-browser-beside.css`). */
export function BrowserSideSlot() {
  return null;
}

/** The attention switcher overlay (`src/styles/30-attention-switcher.css`). */
export function AttentionSwitcher() {
  return null;
}
