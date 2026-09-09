# The explorer's root row and its actions — design

Date: 2026-08-25
Status: `decided` (owner approved each row of §1 in chat, 2026-08-25)
Scope: the explorer tab (`src/files/`), one new Electron-only IPC channel, one
new DL §19 rule and one DL-19.5 amendment.
Host: Electron only. The file surface has no Tauri implementation, and the
create controls gate on the host bridge rather than inheriting that fact (§10).

## 1. The settled model

Each row was chosen by the owner during the 2026-08-25 brainstorm — three of
them after a Codex design review (§13), and the placement row reversed by the
owner after seeing all three candidates drawn (§14). They are the whole
requirement; the rest of this document is what they imply.

| Decision | Choice |
| --- | --- |
| The tree shows its root | A row at depth 0: caret + workspace folder name, **no folder icon** |
| Where the four actions live | On the **root row itself**, as a trailing cluster (candidate C) |
| Whether they hide at rest | **No — always visible.** C's hover-reveal was offered and declined |
| Which actions | New File, New Folder, Refresh, Collapse All. Nothing else |
| How a new entry is named | A small **modal** on the existing `Modal` shell, which amends DL-19.5 (§4.4) |
| Where a new entry is created | The **focused directory**, falling back to the root |
| What Collapse All does | Collapses every child directory and **leaves the root open** |
| Root binding on the new channel | Uses today's boundary as-is; the gap is stated, not fixed (§9) |
| Rename, delete, reveal, drag | **Out of scope** (§12) |

## 2. What is wrong today

The explorer tab renders [`FileTreeView`](../../src/files/ui/file-tree-view.tsx)
`current` and nothing else. Two consequences:

**The tree never says what it is rooted at.** `flattenTree` walks
[`walk(root, 0)`](../../src/files/file-tree.ts#L119-L152) `current` and emits the
root's *children* at depth 0; the root itself is not a `TreeRow` and has no
place in the model. A user with `deck` and `deck-worktree-a` open sees two
columns of `src` / `electron` / `package.json` with nothing distinguishing them.

**Nothing in the panel can create, refresh or collapse.** The tree is
read-plus-open only. `setShowHidden` exists in the store with no caller;
refreshing is entirely at the mercy of `fs.watch`, which
[`tree-refresh.ts`](../../src/files/tree-refresh.ts) `current` already treats as
lossy; and a deep tree can only be collapsed one directory at a time.

## 3. The root row

### 3.1 It is row index 0 of the real model

The root enters `flattenTree` as a `TreeRow` like any other, **not** as separate
DOM above the scroller. Everything in `FileTreeView` is index arithmetic over
one array — the spacer height (`rows.length * ROW_HEIGHT`), the window
(`startIndex`/`endIndex`), the roving `tabIndex`, `scrollIntoView` and every
arrow key. A row rendered outside that array makes all five disagree with what
is on screen.

`flattenTree` gains a `rootExpanded` argument and emits, before its walk:

```
{ path: root, name: basename(root), directory: true,
  depth: 0, expanded: rootExpanded, outOfRoot: false }
```

Children then walk at depth 1. `aria-level` is `depth + 1` already, so the root
is level 1 and its children become level 2 with no further change.

### 3.2 It draws caret + name, no folder icon

That is what the owner's reference shows, and the caret at depth 0 already says
"this is the folder everything is in". `iconForRow` is therefore not consulted
for the root; `chevronForRow` is, unchanged.

The row keeps the tree's own 22px height and `--ui-font` (DL-19) — it is a row
of the tree, not a header above it. Its name is `--text-primary` rather than the
rows' `--text-muted`, which is the one visual difference and the whole reason it
reads as the root.

### 3.3 `rootExpanded` is a new per-workspace field

`expanded: empty` **already means something else** — "every child of the root is
visible, no child directory is open". It cannot be overloaded to mean "the root
is collapsed". `FileSurfaceState` gains `rootExpanded: boolean`, defaulting
`true`, and `EMPTY_SURFACE` with it.

Collapsing the root leaves exactly one row on screen — and that row still
carries the four controls, so a collapsed tree is not a dead end. Loading, empty
and error states keep the root row too: a workspace whose listing failed still
says which folder failed, and can still be refreshed.

### 3.4 Focus moves from index to path

`focusedIndex` is a number today. Creating an entry, refreshing a directory, or
toggling hidden files re-sorts `rows`, so the same index can name a different
file — and §5.3 requires focus to land on a **created** entry, which is an
identity, not a position. The component tracks `focusedPath: string | null` and
derives the index from it each render; a path that has left the tree falls back
to the nearest surviving index, and `null` means index 0 (the root).

## 4. The actions ride the root row

### 4.1 Placement

A trailing cluster at the end of the root row: New File, New Folder, Refresh,
Collapse All, in that order, **always visible**. No second row, no control in
the dock's shared header.

This is the rail's own arrangement — [`.asr-cluster__add`](../../src/styles/04a-agent-rail.css#L245-L267)
`current` hangs a launcher off the project header (DL-27.18) — with the one
difference the owner asked for: the cluster does not hide at rest. C's
hover-reveal was the drawn candidate and was declined, which removes its single
real cost: a column that showed no actions until the pointer arrived.

### 4.2 The control is 17px, and is NOT `.iconbtn`

`.iconbtn` is 24×24. Four of them inside `.file-tree__row` **overflow it by 1px
above and 1px below** — measured on the gallery drawing, 2026-08-25: row height
22, button 24×24, top `-1`, bottom `+1`. That matters more here than it looks:
`ROW_HEIGHT` is the constant every index in `FileTreeView` is computed from, so
the row cannot grow to fit the control. The control shrinks instead.

17×17, `padding: 0`, transparent, `--text-faint`, `--radius-control`, glyph at
`CHROME_ICON` (13px) — `.asr-cluster__add`'s box exactly, because it solves
exactly this problem one row height up. Re-measured after the change: buttons
17×17 with 2.5px clearance top and bottom, every row still 22px, zero horizontal
overflow.

Hover is DL-21.2's neutral wash to `--text-primary`; focus is DL-21.3's 2px
`--accent` outline, inset.

`.iconbtn`'s own missing `padding: 0` reset is therefore **not** inherited here —
but any future `.iconbtn` added to this surface must still declare it locally.

### 4.3 The row becomes a container plus a hit layer

`.file-tree__row` is one clickable `div` today: a click anywhere on it toggles a
directory or opens a file. A cluster of buttons inside it needs the row to stop
being a single hit target — the same shape the rail's leaf took on 2026-08-22
when its ✕ arrived (DL-27.1).

- Each control calls `stopPropagation` on its own click, so pressing New File
  never also toggles the root.
- Keyboard reach follows the roving tabindex rather than fighting it: the
  cluster's buttons take `tabIndex` **0 when the root row is the roving tab
  stop, −1 otherwise**. Tab therefore enters the tree once, lands on the root
  row, and walks into the four controls; it never offers eight tab stops inside
  a list that is meant to be one.
- The row keeps `role="treeitem"`; each button keeps its own `aria-label`.

### 4.4 The new DL rule, and the DL-19.5 amendment

**DL-19.9** — *A docked panel's tab hangs its own actions off the row that names
what it is showing, not in the shared header and not in a row of its own.* The
shared header stays the tab row (DL-19.3, DL-19.7) and never carries a control
belonging to one tab. The actions are a trailing cluster of icon-only controls
on that first row, sized to the row rather than to chrome (§4.2), and visible at
rest. This is DL-27.18's arrangement applied to a docked panel; it adds no
vertical chrome to a column whose floor is 360px wide.

**DL-19.5 is amended.** It currently says a docked panel "does not raise dialogs
of its own", and the naming modal (§5.2) is exactly that:

> A panel does not raise a dialog to report **its own state** — a failure, a
> progress step, an unreadable directory. That is what the status line is for,
> and it is the reason this rule exists: a background event must never steal the
> window. A dialog the **user pressed a control to open** is not that event, and
> may use the shared `Modal` shell (DL §29).

Every existing use of DL-19.5 is untouched: listing errors still go to
[`LoadError`](../../src/ui/controls/load-error.tsx) `current`, and §5.4's create
failures go to the status line, not to a second dialog.

### 4.5 Tooltips

Four icon-only chrome controls with actions, so DL-23.10 binds them: each
carries a §23 `ActionTooltip` on hover and focus and drops any native `title`,
with `aria-label` staying the accessible name. The tooltip prints the **name
only** — none of the four is a keymap action, so there is no chord to show.
`DockTabChip` in the header above is the shape to follow.

### 4.6 The name gives way to the cluster

`.file-tree__name` already truncates with an ellipsis. It gains `min-width: 0`
and the cluster gains `flex-shrink: 0`, so a long workspace name is what
shortens — never the controls. The full name stays the row's accessible name and
its tooltip.

Placing the actions here costs no vertical space at all, which is why the
earlier draft's whole section on keeping a second row from lengthening the
column is gone (§13).

## 5. New File and New Folder

### 5.1 Where the entry is created

The **focused directory**, falling back to the workspace root:

- focus on a directory row → inside it (and the directory is expanded on
  success, §5.3);
- focus on a file row → inside that file's parent;
- focus on the root, or no focus at all → the root.

This is VS Code's rule. The alternative — always the root — was offered and
declined: it is unusable once the user is working deep in a tree.

The modal states the destination as a `--text-faint` line so the answer is never
guessed. That matters more with the controls on the root row than it would have
in a header: the button the user pressed sits on the ROOT's row, and it may well
create somewhere else.

### 5.2 The modal

The shared [`Modal`](../../src/ui/modal.tsx) `current` shell (DL §29): one text
field, a confirm and a cancel, focus on mount, Escape and the scrim both close
it. It follows `SavePresetDialog`'s shape and adds no genre.

The dock stays visible while a browser tab covers the stage, and a native
`WebContentsView` cannot be covered by any DOM layer — so this modal's open
signal joins `browserPanelObscured`, the way `agentQuickPickerOpen` and
`usageConsentOpen` already do. Without it the naming dialog draws *underneath*
the browser view, which this repo has shipped twice and fixed twice.

The field validates as the user types and the confirm stays disabled while the
name is invalid, with the reason printed under the field. The renderer's
validation is a **convenience**, never the boundary — main validates the same
name again (§6.3).

### 5.3 What happens after a successful create

1. The parent directory is re-listed explicitly. `fs.watch` is not trusted to
   deliver it — the repo already treats it as lossy, and a create the user just
   pressed must not depend on a coalesced event.
2. **New Folder:** the parent is expanded if it was not, the new folder's row
   takes focus, and the folder itself starts collapsed.
3. **New File:** the parent is expanded, the new file's row takes focus, and the
   file opens in the workspace's **preview** tab — the same slot a single click
   opens, so creating several files in a row does not fill the strip.
4. **A hidden name while `showHidden` is off** (`.github`, `.env`) would create
   something invisible. The tree turns `showHidden` on for that workspace and
   says so in the status line: `Showing hidden files so .github is visible.`
   Turning it back off is the user's, once a control for it exists — and there
   is none today, which §12 records as a known gap.

### 5.4 Failures

Every failure — EEXIST, an invalid name main rejected, a permission error —
lands on the panel's DL-19.5 status line in `--red`. No second dialog, and the
naming modal closes either way: a modal that survives its own failure has to own
an error state, and the status line already exists.

## 6. The IPC channel

### 6.1 One channel, not two

`create_entry`, Electron-only, flat per R6:

```
{ root: string, parent: string, name: string, kind: "file" | "directory" }
  → { path: string }
```

One channel because authorization, name validation, canonicalization and the
EEXIST mapping are identical for both kinds; only the final syscall differs.
Main builds the destination from `parent + name` and never accepts a composed
path from the renderer.

- `kind: "file"` → `open(destination, "wx")`, then close. `wx` is
  `O_CREAT | O_EXCL`: it fails if anything is already there, **a symlink
  included** — the same reasoning `writeFileAtomically`'s temp file carries.
- `kind: "directory"` → `mkdir(destination, { recursive: false })`.

`EEXIST` from either becomes one message: *An entry with that name already
exists.*

### 6.2 Why neither existing channel was reused

- [`writeTextFile`](../../electron/fs/write.ts#L95-L122) `current` renames over
  its target. It cannot express "fail if it already exists", so New File on it
  would silently truncate a file the user forgot about.
- [`createDirectory`](../../electron/fs/create-directory.ts) `current` is the
  task launcher's, and is wrong here twice: it is **not** bounded to a workspace
  root (any absolute existing parent is accepted), and its `validName` refuses
  every name starting with `.`, so `.github` could not be created. It stays as
  it is; the launcher's needs are not the explorer's.

### 6.3 The name validator

New, not shared with the launcher's. It **accepts** a leading dot and rejects:
the empty string, a name that is not its own trimmed form, `.` and `..`, `/` and
`\`, NUL and every other control character, a trailing dot or space (Windows
strips them), the Windows reserved device names (`CON`, `PRN`, `AUX`, `NUL`,
`COM1`–`COM9`, `LPT1`–`LPT9`, with or without an extension), and anything over
255 bytes.

Windows rules are enforced on **both** platforms. A repository is shared; a name
macOS accepts and Windows cannot check out is a defect the creating machine
should refuse.

### 6.4 The host facade

`src/host/file-create-host.ts`, on
[`workspace-create-host.ts`](../../src/host/workspace-create-host.ts) `current`'s
shape: an `available` boolean read off `__deckHost`, and one `invoke`. The two
create controls are **omitted** where `available` is false — a control that
cannot answer is worse than no control (DL-19.7's own reasoning for an
unserviceable tab). Refresh and Collapse All are renderer-only and always
present, so the cluster never disappears entirely.

## 7. Refresh

Refresh **must not clear the cached listings.** Clearing first destroys the map
`visibleDirectories` reads, so only the root would reload, and it also throws
away the deliberate "keep the last good listing when a reload fails" behaviour.

The operation is:

1. snapshot [`visibleDirectories(workspace)`](../../src/files/file-surface-store.ts#L311-L317) `current`
   — the root plus every expanded directory;
2. call `loadListing` for each entry of that snapshot, keeping the old listings
   in place until each answer lands.

The controller's existing generation counter already discards a stale answer, so
a Refresh racing the watcher's coalescer costs a redundant `list_dir` and
nothing else. The coalescer is **not** reused as the implementation: it exists to
absorb bursts, and a Refresh the user pressed must not be debounced with them.

## 8. Collapse All

`expanded` → the empty set, `rootExpanded` **unchanged**. One press collapses
every child directory and leaves the root open; collapsing the root is the root
caret's own job.

It is a **controller** operation, not a store write: collapsing releases every
descendant watcher, and only the controller can call `refreshWatch()`. A
store-only update would leave those watchers alive until some unrelated
transition happened to fire.

## 9. The path guard, stated rather than fixed

[`resolveRoot`](../../electron/fs/path-guard.ts#L74-L88) `current` accepts any
absolute, non-UNC path that exists — `/` and `$HOME` included — and
[`registerExplorer`](../../electron/ipc/register-explorer.ts#L24-L31) `current`
takes `root` straight off the renderer's payload. So `assertWritableInsideRoot`
proves that `target` is inside the root **the renderer named**, not that the root
is a workspace this window has open.

This is a property of the **existing** explorer channels (`list_dir`,
`read_file`, `write_file`, `stat_files`, `watch_paths`), not something
`create_entry` introduces; the new channel uses the boundary that is already
there. Owner decision, 2026-08-25: **accept and record.** Binding roots to the
owning window means changing every explorer channel's authorization, which is an
R6 contract move and a task of its own. It is in §15's table so it cannot be
mistaken for a boundary that holds.

The exposure is bounded: `wx` and non-recursive `mkdir` cannot overwrite, so the
worst a compromised renderer reaches is creating empty files and directories
wherever the user can write. Deck's renderer loads no remote content — the
browser is a separate `WebContentsView` — so "compromised renderer" is not a
path anything currently opens.

## 10. Host gating

`ExplorerTab` is shared renderer code. "Electron-only by inheritance" describes
where the surface *ships*, not what the component renders, so the create
controls gate on §6.4's `available` flag explicitly rather than assuming no other
host can mount them.

## 11. Testing

Pure functions carry the policy, so most of it is assertable with no DOM:

- `flattenTree` with `rootExpanded` true and false; root at index 0, level 1,
  children at level 2; a collapsed root emitting exactly one row.
- The name validator: the dot-leading accept, and every rejection in §6.3,
  including the Windows reserved names on macOS.
- The refresh scope: the snapshot is taken before any load, and the listings map
  is never emptied.
- Collapse All: `expanded` empty, `rootExpanded` untouched, `refreshWatch`
  called once.
- `create_entry` in main: EEXIST for both kinds, an existing symlink at the
  destination refused, a `parent` outside the named root refused.
- Component: pressing a cluster control does **not** toggle the root row; the
  buttons' `tabIndex` follows the roving tab stop; focus by path survives a
  re-sort; the create controls are absent when the facade reports unavailable.
- Layout, in the browser: every row is still `ROW_HEIGHT`, the cluster's
  controls sit inside the root row with no vertical overflow, and the row has no
  horizontal overflow at the 360px floor.

Gates: `npm test`, `npx tsc --noEmit`, `tsc -p tsconfig.electron.json`,
`npm run build`, `npm run electron:build`, and the design-language gate for
DL-19.9 and the DL-19.5 amendment. A native `electron:dev` pass and the owner's
eye review are **required** before this is claimed to work — nothing here has
been pressed in a running app.

## 12. Out of scope

**Rename, delete, reveal in Finder and drag-and-drop.** Rename and delete are
expensive far beyond their buttons: an open tab's path has to be rekeyed, the
preview slot and the dirty registry updated, the watch set replaced, the session
record rewritten, and deletion needs a destructive confirmation. This slice is
*create plus tree maintenance*, and it is coherent without them.

**A "show hidden files" control.** `setShowHidden` still has no UI; §5.3 turns
the flag on as a side effect of creating a hidden name and there is no way back
short of reopening the workspace. Recorded in §15.

**Per-workspace scroll restoration.** `FileSurfaceState.scrollTop` and
`setScrollTop` exist and are inert — `FileTreeView` keeps its own local scroll
state and never reads or writes the stored one, so scroll leaks between
workspaces when the component survives a `workspacePath` change. The root row
and Collapse All make it more visible; fixing it is not this task. Recorded in
§15.

## 13. The Codex review

A read-only Codex review ran against this design before it was written
(2026-08-25), while candidate A was still the placement. It confirmed the
direction and named nine risks. Eight are answered above: §9 (root binding),
§3.3 (root expansion), §7 (refresh must not clear), §5.1/§5.3 (create target and
post-create contract), §3.1/§3.4 (root in the model, focus by path), §4.4 (the
DL-19.5 conflict, which this design had missed), §8/§10 (watcher ownership and
host gating). The ninth — the inert per-workspace scroll state — is recorded as
a known gap in §15 rather than fixed.

One of its findings **stopped applying** when the owner moved to candidate C:
its risk 7, that a second 26px row inside `.dock-panel__body`'s independent
scroller would yield `100% + 26px`. There is no second row now. The finding it
raised alongside — that `.iconbtn`'s UA padding defect is app-wide — survives in
a different form as §4.2, where the 24px box turned out not to fit the row at
all.

## 14. Rejected alternatives

**A — an explorer-owned 26px action row under the shared header.** The VS Code
shape, and this design's own recommendation until the owner saw the three drawn.
Rejected by the owner: it spends 26px of tree height permanently, and it needed a
nested-scroller fix (§13) that candidate C does not.

**B — the four controls in the shared `dock-panel__header`.** Costs no vertical
space, but [`DockPanel`](../../src/ui/dock/dock-panel.tsx) `current` deliberately
knows nothing about what its tabs contain, and this would give it per-tab
controls. At DL-19.4's 360px floor it also puts eight icon buttons in one row.

**C with the hover-reveal it was drawn with.** The rail's literal arrangement
(DL-27.18), and the reason this design originally ranked C last: at rest the
column shows no actions at all. The owner took the placement and dropped the
reveal, which is what §4.1 records.

**An inline editable row in the tree** for naming, as VS Code does. It means a
virtual row inside the windowing math plus its own focus and error handling; the
owner chose the modal.

**Collapse All also collapsing the root.** One press would empty the column.

## 15. Chưa khớp thực tế

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| An explorer channel's `root` is a workspace this window has open | `current` | **false** | `resolveRoot` accepts any absolute non-UNC existing path and `registerExplorer` takes the renderer's `root` verbatim; the guard proves containment, not authorization. Pre-existing across all explorer channels; accepted by owner decision 2026-08-25 (§9) |
| Hidden files can be shown and hidden from the UI | `decided` | backlog | `setShowHidden` has no caller; §5.3 turns it on as a side effect with no way back (§12) |
| The explorer restores each workspace's scroll position | `current` | **false** | `FileSurfaceState.scrollTop`/`setScrollTop` are never read or written by `FileTreeView`, which keeps its own local state (§12) |
