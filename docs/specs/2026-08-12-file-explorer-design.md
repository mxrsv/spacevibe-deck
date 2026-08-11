# File Explorer — Design

Date: 2026-08-12 · Status: decided, pending user approval
Target host: **Electron only**. Nothing here ships on Tauri.
Source context: [electron migration design](2026-08-11-electron-migration-design.md)
`decided` · [electron MVP plan](../plans/2026-08-11-electron-mvp.md) `building`.

## Goal

A docked file tree on the right side of the Deck window, scoped to the active
workspace, from which clicking a file opens it as a **tab beside the terminal
tabs** — editable and saveable, with Monaco as the editor.

The reason it belongs in Deck at all: Deck runs agent CLIs, and the loop the
user is actually in is _ask an agent to change something, then read what it
changed_. Today that loop leaves the app. This closes it without turning Deck
into an IDE.

**Non-goals for this document:** an implementation plan; a file search /
go-to-symbol surface; git status decoration in the tree; diff view; multi-root
workspaces; a terminal-side "reveal in explorer" command. Each is a plausible
next feature and none is in v1.

## 1. Placement in the queue

Explorer lands **after the Electron MVP closes** — that is, after T18 (the
manual pass) and T19 (packaging) in the MVP plan. It sits in the Electron-only
feature queue beside the token usage dashboard and pane-detach Phase B.

It is explicitly **not** folded into the MVP's "Done when". The MVP's job is
parity: run what Tauri already runs. Adding a new feature to that bar would
grow a scope that is already 10,504 lines of Rust rewritten in TypeScript and
verified only by a smoke run.

**Standing risk inherited, not created here:** Gate C (Windows process
semantics) is still open with no machine to close it, and an abort there can
still make the whole `electron-migration` branch sunk cost — this feature with
it. That is recorded in [`AGENTS.md`](../../AGENTS.md) and is not re-litigated
by this spec.

## 2. Where the state lives, and where it does not

### 2.1 One explorer per workspace

Every piece of explorer state is keyed by **`workspacePath`**: the tree's root,
which directories are expanded, the scroll position, and the set of open file
tabs.

`workspacePath` is already the right key and already exists. A tab fixes it at
Open and never re-derives it from a pane's live CWD, so a `cd` inside an agent
session cannot move the tree under the user's hands
([`tab-manager.ts`](../../src/terminal/tab-manager.ts) `current`, `TabEntry`).
Several terminal tabs may share one workspace; they share one explorer, and
switching between them changes nothing in the panel.

A surface whose `workspacePath` is `null` (a bare `newTab()`, or a pre-0.2.2
restored tab) gets an empty panel that says why, and offers to pick a folder.
It does **not** silently fall back to `$HOME` — a tree rooted at the home
directory is not a mistake the user would notice before scrolling it.

### 2.2 Not persisted, and not shared across windows

Explorer state is **per window, in memory, and gone on restart.**

This corrects the assumption stated during brainstorming that two windows on
the same workspace would share one set of file tabs. Two reasons overrode it:

- Deck deliberately has **no session restore** — a normal window always opens
  on the Open board ([`app.tsx`](../../src/ui/app.tsx) `current`). Persisting
  file tabs would make them the only restored UI state in the app.
- Sharing live state across windows needs a cross-window sync channel for a UI
  list, and multi-window settings consistency is _already_ a named blocking
  major in the Electron design. Adding a second consumer to an unsolved problem
  is how it stays unsolved.

Consequence, stated rather than buried: the **same file can be open in two
windows at once**, and Deck does not merge their edits. The last save wins, and
the second window learns about it through the external-change bar in §5 — which
is machinery this feature needs anyway. Accepted.

Two things _are_ persisted, as ordinary settings: the panel's width and whether
it opens by default.

### 2.3 A separate store, beside `TabManager` — not inside it

File tabs live in their own module store, and the tab strip renders the union
of two sources.

The alternative — teaching `TabView` about a second kind of tab — was rejected
on where the cost of being wrong lands. `syncViews()` rebuilds `tabViews` from
the process poll every 2 s, so a tab with no PTY must survive a rebuild whose
entire input is process information. `TabManager` is a load-bearing R4 seam
that was just ported to a new host and has not yet been through its manual
pass. Putting the first new feature inside it means a bug there is
indistinguishable from a port bug.

The seam is narrow on purpose: `TabManager` gains no knowledge of files, and
the file store gains no knowledge of PTYs. The chrome components (`TabBar`,
`WorkspaceSidebar`) and `App` are the only places that see both.

## 3. The panel

A **docked column on the right of the `.window` grid** — a real grid column,
not an overlay. It never floats over the stage, and the stage's terminals resize
around it rather than being covered.

- Default width 260px, user-resizable by dragging its inner edge, clamped to a
  min and max. Width persists in settings.
- Toggled by **⌘⇧B / Ctrl+Shift+B**, plus a View-menu item.
  `b` is verified unused in both keymaps
  ([`action-registry.ts`](../../src/terminal/action-registry.ts) `current`), so
  one chord works on both platforms. `⌘⇧E` was the first choice and was dropped
  on evidence: `Ctrl+Shift+E` is already `toggle-expand` on the Windows keymap,
  and the repo's escape hatch for that collision (`Ctrl+Alt+Shift+…`) buys a
  four-modifier chord for no gain when a free letter exists.
- The action is registered in `action-registry.ts` and the menu item is
  **generated** from it — R3 holds, the registry is edited and
  `npm run generate:menu` produces the output.
- Present in **both** chrome layouts (horizontal `TabBar` and vertical
  `WorkspaceSidebar`). In sidebar layout the window has a navigation column on
  the left and the explorer on the right; that is deliberate and is the reason
  the panel is a grid column rather than something layered onto the stage.

### 3.1 What the tree shows

- Directories first, then files, each alphabetical, case-insensitive.
- Expand/collapse by click on the row; keyboard arrows navigate and expand.
- **Excluded by default:** `.git`, `node_modules`, `dist`, `target`, and
  dot-entries, from a single named constant. A "show hidden" toggle reveals
  dot-entries.
- **`.gitignore` is deliberately not parsed in v1.** Doing it properly needs a
  matcher dependency, which is a fork, and doing it badly is worse than the
  fixed list. Named as a known gap, not an oversight.
- **Symlinks are not traversed out of the root.** A link resolving outside
  `workspacePath` renders as a leaf and does not open. Same instinct as the
  rejected-root guard in the links port.
- Rows are virtualized. A 10k-file directory is normal in the repos Deck is
  pointed at, and rendering it as DOM is the difference between a panel and a
  freeze.

## 4. File tabs

### 4.1 Preview tab, promoted on intent

Clicking a file opens it in the workspace's **preview slot** — one tab, name
rendered in italic. Clicking another file replaces its contents. The tab is
promoted to an ordinary kept tab when the user shows intent: **double-click in
the tree, or the first edit**. A promoted tab stays; the next click opens a
fresh preview beside it.

One preview slot per workspace. Kept tabs accumulate.

If the preview slot holds unsaved changes it is already promoted by definition
(the first edit promotes it), so replacing a preview never discards work.

### 4.2 Where they render, and what that costs

File tabs render in the same strip as terminal tabs. The strip shows **all
terminal tabs, followed by the file tabs of the active surface's workspace.**

The consequence is worth naming: switching to a terminal tab in a _different_
workspace swaps which file tabs are visible. That is what "one explorer per
workspace" means once file tabs are peers in a shared strip. It is the direct
cost of §2.1 and it is accepted.

### 4.3 Keyboard

- **⌘1..9 address terminal tabs only.** File tabs open and close constantly; if
  they took digit slots, the digits would renumber under the user several times
  a minute. The repo has accepted moving digit keys once before (the Antigravity
  row reorder) — that was a single static change, not per-click churn.
- **⌘⇧] / ⌘⇧[** cycle every surface in the strip, file tabs included. That is
  the keyboard path to a file tab.
- **⌘W** on a file tab closes the file tab. There is no pane to close.
- **⌘S** saves. It is a new action in the registry, scoped so it does nothing
  when no file tab is active.
- **⌘⇧T** (reopen tab) reopens closed **terminal** tabs only. The closed-tab
  snapshot is built around respawning a layout of shells; a file has nothing to
  respawn.

### 4.4 Editing

Monaco, mounted imperatively into a DOM node — the same shape as `Pane` wrapping
xterm, so the pattern already exists in this codebase.

- Theme colors come from the same `deriveChromeColors` / `resolveTheme` path the
  terminals use, so the editor is not a differently-themed rectangle.
- **Size cap: files above 2 MB open read-only with a stated reason.** Binary
  content (a NUL byte in the first block) is refused with a stated reason.
  Both are cheap to specify and expensive to discover by hanging the renderer.
- Read as UTF-8. Invalid UTF-8 opens read-only. CRLF is detected on load and
  **preserved on save**; the file's existing line ending is never silently
  rewritten.
- Saving reuses the atomic write already implemented for the store (temp file
  plus rename), with one addition: **symlinks are resolved before writing**, so
  a save replaces the target rather than the link.

## 5. When the agent writes the file underneath you

This is the common case in Deck, not an edge case.

| Tab state | File changes on disk | Behavior                                                               |
| --------- | -------------------- | ---------------------------------------------------------------------- |
| Clean     | changed              | Reload silently, keep scroll and cursor position                       |
| Clean     | deleted              | Mark the tab as gone; keep it open showing the last content, read-only |
| Dirty     | changed              | Show a bar: _Reload_ (discard mine) / _Keep mine_ — never auto-decide  |
| Dirty     | deleted              | Show a bar: _Save again_ / _Close_                                     |

Watching uses Node's built-in `fs.watch` — **no watcher dependency.** Scope is
bounded: open file tabs, plus the directories currently expanded in the tree,
non-recursively. Watching a repo recursively is what makes file watchers
expensive, and nothing here needs it.

**Named risk:** `fs.watch` is inconsistent across platforms — duplicate events,
missed events, and no reliable recursion outside macOS/Windows. Mitigation is a
cheap fallback rather than a dependency: re-`stat` open files on window focus and
on tab activation, and reconcile. If that proves insufficient in the manual pass,
adding a watcher library is a fork to raise then, not to pre-approve now.

## 6. Unsaved work and the three ways out

Deck has three exits, and **all three must respect a dirty file** — not just
⌘Q. Missing one is the most likely defect in this feature.

1. **⌘Q** — quit
2. **Closing a window** — its own flight, separate from quit
3. **Closing a file tab** — ⌘W or the tab's ×

The quit and window-close censuses are computed in the **main process**,
deliberately, so a wedged renderer cannot make ⌘Q unanswerable. Dirty state,
however, lives in Monaco — in the renderer. The bridge:

- The renderer pushes a **dirty-registry delta** to main on every clean→dirty
  and dirty→clean transition, keyed by window label and absolute path.
- Main folds that registry into the existing census, so the census stays
  answerable from main alone. The invariant that motivated main-side ownership
  is preserved.
- **Window death clears that window's dirty entries**, exactly as pane routes
  are cleared. Otherwise a renderer that dies mid-edit leaves main permanently
  believing a file is unsaved, and ⌘Q asks a question about a window that no
  longer exists.
- A dirty registry that disagrees with reality fails **toward asking**, never
  toward discarding.

One dialog, not two: when both a busy agent and unsaved files exist, the guard
names both in a single confirmation. Two sequential dialogs on ⌘Q is worse than
either alone. `ConfirmCopy` and `confirmClose`
([`close-guard.ts`](../../src/terminal/close-guard.ts) `current`) grow a second
input for this.

## 7. Invariants to re-audit

Every one of these currently assumes _a tab is a grid of PTY panes_. Each must
be given an explicit answer, and none may be answered by accident:

| Site                         | Question                                                                                                                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allPaneIds()`               | Feeds both the quit census and the update guard. A file tab contributes no panes — verify it contributes no _phantom_ pane either.                                                                                          |
| `PaneInfoPoller`             | Must not poll for a surface with no PTY.                                                                                                                                                                                    |
| `statusInfo`                 | With a file tab active: path relative to the workspace, line:col, encoding/EOL. Branch stays. Pane count is absent, not zero-with-a-label.                                                                                  |
| Attention rail               | `focusNextAttention` / `hasActionableAttention` scan tabs; file tabs are never candidates.                                                                                                                                  |
| `closeTab` busy guard        | Terminal tabs guard on busy processes; file tabs guard on dirty. Same dialog family, different input.                                                                                                                       |
| "Last tab closes the window" | Redefined as **last _surface_**. A window may hold only file tabs.                                                                                                                                                          |
| `movePaneToNewWindow` (⌘⇧M)  | File tabs do not participate. The transfer transaction is built around handing over a PTY, and there is none. From a file tab, ⌘⇧M is a no-op with a message — the same shape as the already-resolved one-pane-window fork. |
| `focusActive()`              | Must focus the editor when a file tab is active, not a hidden pane.                                                                                                                                                         |
| Prompt Board gating          | `promptsDisabled` currently reads `tabViews.length === 0`; it must read "no terminal pane focused", or the board will offer to paste into an editor.                                                                        |
| `applySettings`              | Theme changes must reach Monaco as well as xterm.                                                                                                                                                                           |
| Both layouts                 | Every behavior above holds in `TabBar` _and_ `WorkspaceSidebar`.                                                                                                                                                            |

## 8. Design language — new §15 (approved R2 fork)

A permanently docked panel is a surface class `docs/DESIGN-LANGUAGE.md` does not
have. §11 covers a full-window screen and §13 an anchored popover; neither
describes a column that lives in the grid alongside the stage. Approved as a
fork on 2026-08-12.

- **DL-15.1** A docked panel is a **column of the `.window` grid**, never an
  overlay. Surface `--chrome-1`, separated by a 1px `--hair` border on the stage
  side. No shadow (DL-1.3) — depth comes from the background step, as with
  `.wsbar`.
- **DL-15.2** The panel owns its own scrolling. Resizing it never causes the
  stage or the window to scroll.
- **DL-15.3** Data rows in a panel are 22px, `--ui-font`, one fixed indent token
  per depth level. Hover is a 4% `--fg` wash; selection is a 2px left accent bar
  plus the wash — the same signifier as DL-11.2 and DL-5.1, so "selected" reads
  identically everywhere.
- **DL-15.4** **A data row keeps its content's real casing.** DL-4.1's lowercase
  rule governs chrome labels the app authors; a file name is data the app
  reports, and lowercasing it would be wrong, not stylish.
- **DL-15.5** File-type icons are a **second icon vocabulary** beside §14's
  Lucide set, permitted only in a docked panel's data rows.
  **Recommended: rendered monochrome at `--text-faint`**, taking the row's color
  when selected. Colored per-type icons are the familiar look, but §3's color
  roles are strict and each hue there already means something; a palette of file
  types would spend those meanings on file extensions. If colored icons are
  wanted, that is a DL-3 exception to take explicitly.
- **DL-15.6** A panel has one hairline-separated header row carrying its title
  and at most two actions. It is a row, not a toolbar.

## 9. Dependencies (approved fork)

Three, all approved on 2026-08-12:

| Dependency           | For        | Note                                                |
| -------------------- | ---------- | --------------------------------------------------- |
| **Monaco**           | the editor | The single largest addition this repo has ever made |
| a virtual list       | the tree   | Small; §3.1 explains why it is not optional         |
| a file-type icon set | tree rows  | Governed by DL-15.5                                 |

Not added: no watcher library (§5 uses `fs.watch`), no gitignore matcher
(§3.1), no syntax highlighter beyond Monaco's own.

**Monaco's cost, stated up front.** Deck's renderer bundle is 180.40 kB gzip
today. Monaco with its workers is roughly an order of magnitude larger. Two
requirements follow, both binding:

- Monaco is **lazily imported on the first file tab**, so app startup and the
  time-to-first-pane are unchanged for a user who never opens a file.
- The language set is **explicitly enumerated**, not "all of them".

The measured figures are recorded when the work lands. A result far outside
expectation is a re-decision, not a footnote — the same standard the Electron
spec sets for binary size.

## 10. Gate M — Monaco boots in the packaged app

**Before any explorer UI is written**, prove Monaco loads and its workers start
in a _packaged_ Electron build, not only under `electron:dev`.

This is not caution for its own sake. The MVP has already been bitten twice by
exactly this class, and both bugs produced _silence_: Vite emitted absolute asset
paths that 404 under `file://` and gave a blank window with nothing on stderr,
and a CommonJS/ESM mismatch killed the host on `exports`. Monaco loads workers
through `new Worker(new URL(...))`, which is the same resolution path under the
same `base: "./"` — with a CSP in front of it.

Gate M passes when a packaged build opens a file, highlights it, edits it and
saves it. It fails loudly rather than degrading: if Monaco cannot be made to
work in the packaged app, the editor engine decision reopens (§9) rather than
the feature shipping in a form that only works in dev.

## 11. Testing

Pure logic, unit tested — this is most of the feature:

- tree model: sort order, expand/collapse, exclusion list, symlink-out-of-root
- preview-tab promotion rules (§4.1)
- the external-change decision table (§5) as a table-driven test
- the dirty registry: transitions, window-death clearing, fail-toward-asking
- path safety and the workspace-root bound
- encoding and line-ending detection, and CRLF preservation on save

Crossing IPC — the contract test catches shape mismatches on the new channels
automatically, and it is the gate that already caught `offer_transfer` sending
`targetLabel` where the host destructured `label`.

Manual pass, because nothing above proves it:

1. Open a workspace, toggle the panel, expand into a deep directory
2. Click a file → preview tab, italic; click another → it replaces
3. Double-click → promoted; edit → dot appears
4. Have an agent rewrite a clean open file → it reloads, scroll held
5. Have an agent rewrite a _dirty_ open file → the bar appears, both branches
6. ⌘S → the agent sees the new content
7. ⌘W on a dirty tab, close the window with a dirty tab, ⌘Q with a dirty tab —
   **all three ask**
8. ⌘Q with a busy agent _and_ a dirty file → **one** dialog naming both
9. Two windows on one workspace, same file open in both → last save wins, the
   other window's bar appears
10. Switch to a terminal tab in another workspace → tree and file tabs swap
11. Both chrome layouts
12. A 10k-file directory does not freeze the panel
13. A 50 MB file and a binary file both refuse with a reason

## 12. Assumptions and open items

- **Assumed:** Monaco coexists with xterm in one renderer without focus or
  keyboard-capture conflicts. Untested. Both capture keys aggressively, and
  Deck's keymap sits above them. Gate M's edit step is the first evidence.
- **Assumed:** the theme tokens Deck derives map onto a Monaco theme closely
  enough to look like one app. Untested.
- **Open:** whether the panel should also be dockable left. Deferred — DL-15.1
  is written so the answer is a CSS column choice, not a rewrite.
- **Open:** git status decoration in the tree. `electron/git.ts` already exists
  for the status bar's branch, so the data is nearby. Out of v1 on scope, not on
  difficulty.
- **Open:** measured bundle size and cold-start impact of Monaco (§9).
- **Inherited, unresolved:** Gate C. An abort there ends this feature with the
  branch it lives on.
