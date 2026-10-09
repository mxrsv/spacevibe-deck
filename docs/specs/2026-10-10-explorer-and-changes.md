# Explorer and Changes

Date: 2026-10-10
Status: Draft — direction set in the owner interview of 2026-10-09/10; the
[open decisions](#open-decisions) gate the slices that need them.
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: `main` at `f1fa8fb1` (2026-10-10). Plans under `docs/plans/` are gitignored and exist
only in the primary checkout.
Host: every new host channel (git, file list, trash, rename) is Electron only and degrades on
the frozen Tauri host through an `available` flag, never a second implementation. The
Explorer itself is Electron only — its file channels have no Tauri counterpart
([file-surface.md](../internals/file-surface.md)) — so every slice is effectively Electron only.
Parent: [Deck product improvements](2026-10-06-deck-product-improvements.md), rank 9
(Read-only Changes). That record keeps the cross-surface priority order; this one owns the
requirements of Changes and of the Explorer improvements, and carries CHANGES1–3 forward.

## Purpose

When an agent finishes a turn, the owner checks what it changed before committing it, without
leaving Deck: which files changed and the diff of each, read beside the agent's terminal. The
same queue closes the Explorer gaps that get in the way of supervising agents. Deck stays
read-only towards git and never types into a pane on the user's behalf.

## Decisions so far (owner, 2026-10-09 and 2026-10-10)

1. **Moment of use: right after an agent finishes a turn**, before the owner commits. Changes is
   a review step, not a browsing aid, so git markers on tree rows are not part of this spec.
2. **Comparison: every uncommitted change against `HEAD`**, accumulated across turns. Turned
   down: the delta of the last turn only, which needs a snapshot taken at turn start that
   nothing in Deck records today.
3. **The changed-file list lives inside the Explorer**, not in a fourth dock tab. This
   supersedes task 2's placement in the
   [2026-09-24 Changes panel plan](../plans/2026-09-24-changes-panel.md).
4. **A diff opens in a temporary column docked directly left of the Explorer**, narrowing the
   terminal grid, and closes on demand. Turned down: a real pane in the terminal grid (a
   PTY-less pane in the layout is an R4 fork and turns a glance into a permanent pane) and
   covering the stage like a file tab (it hides the agent terminal being checked).
5. **Every Explorer gap from the 2026-10-09 research goes into this one spec** as ordered
   slices (owner, 2026-10-10).
6. **Deck may run `git status`** (owner, 2026-10-10), bounded and with visible errors (CHG2).
   Slice 1 rewrites the three places that say no `git status` runs —
   [internals/agent-rail.md](../internals/agent-rail.md) and two comments in
   [worktrees.ts](../../electron/worktrees.ts) — in the same change.
7. **The list updates in near real time** (owner, 2026-10-10, asking "có thể làm realtime
   không?"): a file change in the checkout reaches the list within about a second, not only at
   turn end (CHG3).
8. **The list's form is chosen from three gallery specimens** (owner, 2026-10-10), built before
   slice 1's code: (A) a Files / Changes switch in the Explorer's header, (B) a collapsible
   Changes section above the tree, (C) a "changed only" filter on the tree itself. Picking C
   rewords decision 1 (no git markers on tree rows) and the "filter-in-tree" exclusion under
   [Out of scope](#out-of-scope). **Answered 2026-10-10: A**, the Files / Changes switch (owner,
   after the specimens in the gallery's `changes specimens` section). Turned down: B (a second
   action-bearing row and two scroll regions in a 360px column) and C (rewords decision 1 and
   would break DL-21.8 if its on state were painted). The DL-19.9 / DL-19.7 / DL-21.1 text for A
   waits for the owner's approval before the UI lands.
9. **Delivery runs as two lanes in parallel** (owner, 2026-10-10); see
   [Delivery slices](#delivery-slices).

## Requirements and acceptance criteria

### Changes list

- **CHG1** (CHANGES1): The Explorer shows the changed files of the checkout it is rooted at,
  with the branch, the comparison (uncommitted against `HEAD`) and the total added/removed line
  counts visible. Each entry shows its name,
  its directory, its status (modified, added, deleted, renamed with the old path, untracked)
  and its own counts; a binary file says so instead of counts. Acceptance: on a fixture
  repository holding every status, the entries and counts match `git status` and
  `git diff --numstat HEAD`, untracked files counting every line as added.
- **CHG2** (CHANGES2): Git reads are bounded in time and in entry count. Past the cap the list
  says how many entries it is not showing. Not a repository, a repository with no commit yet,
  git missing and a timeout each produce a distinct message on the Explorer's status line
  (DL-19.5): never a dialog, never a silently empty list. A repository with no commit compares
  against the empty tree.
- **CHG3** (decision 7): While the list is shown and the window is visible, a file change
  anywhere in the checkout, or a change to its index or `HEAD`, reaches the list within about a
  second. A burst of writes coalesces into one read, and at most one read runs at a time.
  Because file watching drops events on every platform, the list also refreshes when a pane in
  that checkout leaves `working`, when the window regains focus, and from a Refresh control.
  Nothing polls, and no git read runs while the window is hidden or the list is not shown.
  Acceptance: on a fixture repository, an edit appears in the list within one second of the
  write; a burst of 500 writes causes a bounded number of reads, not one per write; a test
  proves no read while hidden.
- **CHG4**: A clean checkout shows an explicit empty state, not a blank list. A folder git does
  not know hides the Changes entry point, or disables it with a tooltip saying why.
- **CHG5** (CHANGES3): Nothing stages, commits, pushes, merges, reverts or discards, and nothing
  is typed into any pane. Sending feedback to an agent is a separate, later decision.

### Diff column

- **DIFF1**: Selecting a changed file opens its diff in a column docked directly left of the
  Explorer. The terminal grid shrinks by the column's width and panes resize around it
  (DL-19.1). The column closes from its × and from Esc **only while focus is inside the
  column**: Esc in a terminal keeps reaching the agent CLI, which uses it to interrupt.
- **DIFF2**: Both sides are read-only and syntax-coloured with the language set the editor
  already loads. The column shows one unified diff when narrow and the two sides next to each
  other when wide, and folds long unchanged runs. No new dependency.
- **DIFF3**: The column's header names the file, its status, its counts and its position in
  the list ("2/5"). Keys move to the next or previous file and the next or previous change;
  the bindings must not shadow an existing Deck chord or a readline key a terminal needs.
- **DIFF4**: Each case has its own representation: binary, over the file-content limits Deck
  already applies, deleted (old side only), added or untracked (new side only), renamed (old
  and new path), and a failed read. The old side comes from `HEAD` through the same
  containment rules as every other file read.
- **DIFF5**: When the list refreshes, an open diff refreshes with it. If the selected file is no
  longer changed, the column says so instead of closing under the user.

### Explorer improvements

- **EXP1**: A control shows and hides dot-entries, and its state is visible. Today showing them
  turns on only as a side effect of creating a dot-file, and nothing turns it back off. The
  control fits the root row at the dock's 360px minimum.
- **EXP2**: The tree marks the active document's row with DL-21.1's selection wash and expands
  its parent directories when the active document changes, including after a ⌘+click on a
  terminal path. It never takes keyboard focus from the editor or a terminal.
- **EXP3**: A row's context menu offers Copy path, Copy relative path, Reveal in Finder (the
  platform's file manager), and Insert relative path into the focused pane, which types the
  path without pressing Enter. The menu is reachable from the keyboard.
- **EXP4**: A chord opens a quick-open finder over the checkout's files with fuzzy matching;
  choosing a file opens it in the preview tab. Inside a repository the file set respects
  `.gitignore`; elsewhere it is a capped walk. No new dependency for matching.
- **EXP5**: Move to Trash and Rename on a row. Rename never overwrites an existing entry, keeps
  open tabs and their unsaved edits attached to the renamed file, and leaves ⌘Q still asking
  about them. Both stay inside the workspace root. Acceptance: renaming an open dirty file
  keeps its edits, and quitting still asks about it.
- **EXP6**: Entries git ignores are hidden or dimmed ([open decision 5](#open-decisions)), using
  git's own answer rather than a matcher library. The fixed hidden list stays for folders git
  does not know.
- **EXP7**: Dragging a row onto a terminal pane inserts its path, quoted when needed, without
  pressing Enter. The drop must not reach the Open board's workspace drop.

## Delivery slices

Two lanes run in parallel, each in its own worktree; inside a lane the slices run in order,
one plan and one session each. **Lane A** is the specimens of decision 8, then slices 1 and 2.
**Lane B** is slices 3 and 4. Slices 5, 7, 6 and 8 follow, in that order, once both lanes have
merged. Each slice's plan is approved by the owner before its code starts. Every slice adds a
surface, command or interaction, so each falls under the E2E gate in
[AGENTS.md](../../AGENTS.md).

The lanes share files: lanes A and B both edit the Explorer's view, and slices 1 and 5 both add
IPC channels to the same registry and contract test. Lane B's slice 3 is the smaller change and
merges first; lane A rebases on it. The file-surface controller has 32 lines left under the
800-line cap, so neither lane adds to it.

| Slice                                | Requirements | Host                          | Plan | Status      |
| ------------------------------------ | ------------ | ----------------------------- | ---- | ----------- |
| 1. Git status channel + Changes list | CHG1–5       | Electron; hidden on Tauri     | [changes-list](../plans/2026-10-10-changes-list.md) | Approved 2026-10-10, runs in the cloud |
| 2. Diff column                       | DIFF1–5      | Electron                      | —    | Not started |
| 3. Hidden-files toggle + reveal      | EXP1–2       | Electron                      | [explorer-hidden-and-reveal](../plans/2026-10-10-explorer-hidden-and-reveal.md) | Approved 2026-10-10, runs in the cloud |
| 4. Row context menu                  | EXP3         | Electron                      | —    | Not started |
| 5. Quick open                        | EXP4         | Electron                      | —    | Not started |
| 6. Move to Trash and Rename          | EXP5         | Electron                      | —    | Not started |
| 7. Git-ignore-aware tree             | EXP6         | Electron; fixed list on Tauri | —    | Not started |
| 8. Drag a row into a terminal        | EXP7         | Electron                      | —    | Not started |

Changes comes first because it is what the owner asked for. The Explorer slices follow the
research's value-against-cost rank. Slice 7 reuses slice 5's file listing. Slice 8 touches R4
seams and needs its own cross-boundary verification.

## Open decisions

Answered 2026-10-10: the refresh trigger (decision 7), running `git status` (decision 6) and
the list's form (decision 8, variant A).

1. **The list's form (decision 8).** Closed 2026-10-10: A, a Files / Changes switch in the Explorer's head.
2. **Watching the checkout recursively (CHG3).** The current watcher is non-recursive by design
   ([watch.ts](../../electron/fs/watch.ts): "nothing here needs it"). Near-real-time Changes
   needs one recursive watch on the checkout's root, held only while the list is shown and the
   window is visible, with Node's built-in `fs.watch` and no watcher library. Recommended: yes,
   confirmed with slice 1's plan.
3. **Diff colours.** DL-3.2 reserves `--green` for success and `--red` for danger. Recommended:
   a scoped amendment that lets added and removed lines and counts use them. Every tool surveyed
   colours a diff, and a diff without colour is slow to read.
4. **A second docked column.** DL §19 describes one docked column holding tabs. The diff column
   is a second, transient one with its own seam, header and width, and it shrinks the grid
   exactly as the dock does. Since 2026-10-10 §19 is a DL _pattern_, rewritten with the code
   after the owner's eye review rather than a fork. It stays a fork under
   [AGENTS.md](../../AGENTS.md) only if slice 2 has to change pane layout modules; slice 2's
   plan settles which.
5. **Ignored entries (EXP6): hide or dim.** Recommended: hide them, and let EXP1's control
   reveal them as well. Seven of the top-level folders in the owner's 2026-10-09 screenshot
   (`dist-electron`, `dist-electron-app`, `dist-gate-m`, …) are ignored build output.
6. **Move to Trash confirmation (EXP5).** Recommended: no dialog, because the Trash is
   recoverable; the status line names what was moved.
7. **The quick-open chord on Windows and Linux (EXP4).** ⌘P is free on macOS; `Ctrl+P` is
   readline's history key in a terminal.

## Forks and constraints

- Layout: the diff column narrows the terminal grid and resizes PTYs (open decision 4).
- Watching: CHG3's recursive watch reverses the watcher's non-recursive design for one root
  (open decision 2). A watcher library stays a fork, and none is proposed.
- Design language (two tiers since 2026-10-10): DL-3.2 is an invariant, so open decision 3 is
  a fork. §19 is a pattern (open decision 4). EXP2's selection mark falls under §21's
  invariants: matching the tree row's corner may conflict with DL-21.1 and DL-20.1, and slice
  3's plan poses that choice.
- No new dependency. A fuzzy-matching or ignore-matching library would be a fork; none is
  proposed.
- IPC payloads are a contract (R6): new channels join the contract test, and a change to the
  directory listing's payload for EXP6 does too.
- EXP5's rename touches the dirty-file registry that the quit census reads. If the slice 6 plan
  finds it needs close/quit coordination, it stops and asks.
- EXP7 changes drop handling in the tab and terminal managers (R4) and needs its own plan with
  cross-boundary verification.
- The file-surface controller is at 768 of 800 lines; new Explorer behaviour goes in new
  modules.

## Evidence

- Code facts checked against the baseline on 2026-10-10:
  - The Explorer is rooted at the active tab's workspace ([app.tsx](../../src/ui/app.tsx),
    the `setActiveWorkspace` effect), and a tab carries exactly one workspace
    ([glossary](../internals/glossary.md)). A worktree opened as a tab therefore roots the
    Explorer at that worktree.
  - `setShowHidden` has one caller, the create path in
    [file-surface-controller.ts](../../src/files/file-surface-controller.ts) (line 513).
  - ⌘P is unbound; only ⌘⇧P is (`toggle-prompts`,
    [default-keymaps.ts](../../src/terminal/default-keymaps.ts)).
  - `monaco-editor` is pinned at 0.56.0, and its diff editor ships in the same package.
  - The attention tracker's phases are `unknown`, `idle`, `working` and `exited`
    ([agent-attention.ts](../../src/terminal/agent-attention.ts)). The shell's prompt-ready
    event marks a CLI exiting to the shell, not a turn ending, so CHG3 does not use it.
  - The dock is clamped to 360–720px; the grid's right edge follows `--dock-w`.
- External research, 2026-10-09 (three read-only subagents; the reports lived in session
  scratch and are not kept):
  - Diff from git, not from the agent's own edit stream. Cursor's agent-only view goes stale
    when edits happen outside it; this comes from a forum report and is low confidence
    ([forum](https://forum.cursor.com/t/all-changes-show-stale-agent-changes-and-disregard-user-changes/144331)).
    Warp's review updates live, including outside edits
    ([Warp](https://docs.warp.dev/code/code-review)).
  - VS Code switches between side-by-side and inline diffs at 900px by default
    ([VS Code](https://code.visualstudio.com/docs/sourcecontrol/staging-commits)).
  - Next/previous file and change keys follow lazygit
    ([keybindings](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md)).
    Claude's desktop app and Conductor open their diff with ⌘⇧D
    ([Claude](https://code.claude.com/docs/en/desktop.md),
    [Conductor](https://conductor.build/docs/reference/diff-viewer)).
  - A `+N −M` chip opens the review in Claude's desktop app, Warp and
    [Superset](https://docs.superset.sh/diff-viewer). Codex offers several comparison scopes,
    including the last turn ([Codex](https://learn.chatgpt.com/docs/code-review.md?surface=app)).
  - Zed made agent-diff-over-buffer opt-in after users objected
    ([Zed](https://zed.dev/docs/ai/agent-panel)).

## Out of scope

Staging, committing, pushing, reverting hunks, PR creation and conflict UI; a per-turn diff;
comparing a worktree against `main` or another base branch; git markers on tree rows; a line
comment sent to an agent (task 3 of the 2026-09-24 plan, which needs its own agreed target and
delivery behaviour); multi-select, compact folders and filter-in-tree; a Tauri implementation
of any new host channel.
