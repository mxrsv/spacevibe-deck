# Tabbed dock panel

Status: `decided` (owner, 2026-11-03, by eye on the mock `~/scratch/spacevibe-deck/dock-redesign/index.html`, block F).
Supersedes LAY-6's stacked sections for the dock behind the `agentDock` switch; LAY-9, LAY-10 and AC-3 of
[the agent-first shell layout](2026-10-22-agent-first-shell-layout.md) still hold.

## Problem

The stacked dock puts Changes, Usage, Files and History in one scroll. One tall body (65 changed
files) pushes every section below it out of reach, and the column carries more functions than a
320px strip can show calmly.

## Requirements

- **DOCK-1 Views replace the body.** The dock shows exactly one view at a time. Changes, Usage and
  History (and Files until DOCK-6 lands) are **fixed icon buttons** at the left of one strip. They are
  present whenever the dock is open, in a fixed order, with a tooltip each; the selected one is pressed.
  Selecting a view replaces the whole body; nothing is stacked.
- **DOCK-2 One body owns the height.** The body fills the column below the strip and scrolls inside
  itself. No view can push another out of reach, and the column itself does not scroll.
- **DOCK-3 Availability.** Changes appears only where git changes are readable, History only where
  sessions can be listed (the same gates as today). The selected view survives focus moving between
  agents; if it becomes unavailable the dock falls back to the first available view.
- **DOCK-4 Reveal.** Every existing path that reveals a dock tab (the explorer, usage and sessions
  chords, sidebar tool rows, command palette entries) selects the matching view and opens the dock.
- **DOCK-5 Space and Ask.** `In this space` is removed from the dock: the rail lists the same agents.
  The Ask banner moves to the rail (DOCK-9).
- **DOCK-6 Documents as tabs.** A file opened from Changes or the file tree becomes a tab after the
  fixed icons, behind a divider. Only the file tabs scroll horizontally. A single click opens or
  replaces the preview tab, a double click or the first edit keeps it (the existing preview slot). The
  active tab shows a close ×. A `+` button opens the file picker. Right-click offers Close, Close
  others, Close to the right, Close all. The file body is the editor with the project file tree in a
  pane on its right (search, refresh, ignored entries dimmed, a dot on folders holding changes),
  toggled from the breadcrumb row; the pane is hidden by default when the dock is narrower than 560px.
- **DOCK-7 Breadcrumb row.** A file tab has a row with its path (each folder clickable), an open-in
  split button, a wrap toggle and the tree toggle. The Changes view has a row with the scope and the
  totals `N files +a −d`. No count or badge sits on a tab.
- **DOCK-8 Changes view.** Changes lists the changed files with a status mark, name and `+a −d`;
  pressing a file opens its diff exactly as today. Whether the diff moves inside the dock is DOCK-10.
- **DOCK-9 Ask on the rail.** The `needs-input` detail and its action show on the agent's rail row, and
  the dock banner is deleted. It lands with the dock rather than in a PR of its own (owner,
  2026-11-03).
- **DOCK-10 Diff in the dock.** The Changes view is one scrolling stack of per-file cards. Each card
  has a sticky header (a chevron that folds the file, the status mark, the file name, `+a −d`) and a
  body of unified hunks with three lines of context; a file's diff loads only when its card nears the
  viewport. The file name opens the real file as a tab (DOCK-6); the chevron or the rest of the header
  folds. The optional tree pane (a toggle in the Changes row, off by default) lists the same files and
  a press scrolls to that card without opening anything. The stack uses a small in-repo line diff
  over the two texts the diff column already reads (`HEAD` and the working copy): no Monaco instance
  per file and no new dependency. Binary, too-large and unreadable files show a one-line note instead
  of hunks. The separate diff column stays for the legacy dock only.
- **DOCK-11 Width.** The dock keeps its resize grip and, below 1360px, its edge handle and sheet. A
  view must stay usable at 320px; the file tree pane is the part that gives way.
- **DOCK-12 Type.** Mono type appears only in the editor, the diff and the terminal. File names, paths
  in lists, totals and `+a −d` are the UI sans with tabular numerals.

## Acceptance

| ID | Check |
| --- | --- |
| AC-1 | With `agentDock` on, the dock shows the strip and one body; selecting each icon swaps the body and leaves the others unmounted (a folded Usage still polls nothing). |
| AC-2 | A 65-file Changes list scrolls inside the body at 1280×800 with the dock open; the strip never moves. |
| AC-3 | Each revealing chord selects its view and opens the dock, including from a closed dock. |
| AC-4 | With `agentDock` off the legacy dock is unchanged. |
| AC-5 | No PTY, IPC, persistence or tab-materialization change; the file surface store keeps its API. |
| AC-7 | A 65-file Changes stack mounts no more than the cards near the viewport (the rest are headers only) and the line diff of two fixed texts yields the expected hunks, including insert-only, delete-only and no-change files. |
| AC-6 | `scripts/` and `src/styles/` policy suites, lint and the tests beside each changed file pass at every stage. |

## Out of scope

Turning the switch on by default, removing the legacy dock, the rail's Ask display beyond DOCK-9, and
any change to the diff column's own behaviour before DOCK-10 is decided.
