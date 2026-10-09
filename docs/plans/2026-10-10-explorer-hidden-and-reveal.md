# Explorer hidden-files toggle and active-document reveal (lane B, slice 3)

Record: **Approved 2026-10-10** (owner: "Duyệt theo đề xuất" — every item below as recommended).
It runs in Claude Code cloud sessions (owner, 2026-10-10): the Operating contract's Cloud run paragraph
overrides "Where it runs" and the merge steps. This plan is the implementing agent's authorization.
Spec: [Explorer and Changes](../specs/2026-10-10-explorer-and-changes.md) — EXP1, EXP2, Delivery
slices row 3, decision 9. Slice 4 (EXP3) is the next slice in this lane, with its own plan.
Base revision: local `main` `da657e63` (`origin/main` `963f1bf2` is 17 commits behind).
Canonical path: this file, committed on `main` at the owner's request (2026-10-10) although
`docs/plans/` is gitignored.
Host: renderer only, no host command, no IPC shape change. Ships in both bundles; observable
only on Electron (first fact).

## Problem

Dot-entries appear only as a side effect of creating one, and nothing hides them again. Opening
a document (tree click, strip chip, ⌘+click on a terminal path) leaves the tree as it was: no
row is marked and its folders stay collapsed.

## Facts this plan starts from (code at `8d96f827`; DL and peers re-read at `da657e63`)

- **Tauri never lists the tree.** File channels are Electron only
  ([file-surface.md:6-8](../internals/file-surface.md)); `list_dir` is registered in
  `electron/ipc/channels.ts` and absent from `src-tauri/src`, so on Tauri the tree is a root row
  plus `LoadError` and this slice has nothing to act on.
- **`showHidden`** is per workspace, per window, in memory (`file-surface-store.ts:14,53`);
  `setShowHidden` (`:327`) has one caller, the create path (`file-surface-controller.ts:508-517`),
  whose comment calls the missing off control "a known gap"; `closeWorkspaceSurface` (`:565-582`)
  drops it. `EXCLUDED_NAMES` beats `showHidden` (`file-tree.ts:34-58`).
- **The filter is part of the watch scope.** `visibleDirectories` derives from rows that read
  `showHidden` (`store:374-394`), and only the controller may call `refreshWatch()`
  ([file-surface.md:73-75](../internals/file-surface.md), controller `:212-223`). A successful
  `loadListing` restates it (`:235`); `refreshTree` re-lists every visible directory (`:469-477`);
  `toggleDirectory`/`toggleRoot` list on demand and restate it (`:447-467`). The controller is
  768/800 lines and the spec bars both lanes from adding to it; a new interface method would also
  touch `fakeController` (`file-tree-view.test.tsx:21`), `dock-panel.test.tsx` and the gallery.
- **Two path spellings.** `list_dir` joins names onto the realpath'd directory
  (`electron/fs/read.ts:136,152`) and ⌘+click paths are realpath'd (`electron/links.ts:74`); the
  root key keeps the renderer's spelling (`electron/fs/workspace-for-path.ts:1-13`). Under a
  symlinked root (macOS `/tmp`) no row path starts with `workspacePath`.
- **Active document.** `activeFileTab` is the file on the stage, null while a terminal holds it
  (`store:292,515-517`); opening or activating sets it with `activeWorkspace` (`:477-479,507-511`);
  the workspace's `activePath` (`:59`) outlives the stage. ⌘+click calls `fileController.openFile`
  (`app.tsx:1035-1072`), which focuses the editor (`controller:435`). `ExplorerTab` mounts only
  while the dock shows the explorer (`app.tsx:2615-2620`).
- **Tree view** (`file-tree-view.tsx`, 384 lines): 22px rows windowed by index (`:50,280-284`).
  Its only scroll-to-row code is the keyboard/create effect, which ends in `.focus()`
  (`:110-139`, fed by `pendingTreeFocus` `:152-160`); `scrollIntoView` appears only in comments.
  Rows have no selection state; `14-dock.css:281-283` defers the selected icon ink.
- **Root cluster** (`tree-root-actions.tsx`, 130 lines): four 17px controls, the create pair
  omitted without `create_entry` (`:93-129`), tooltips with no chord (`:54-56`); tests pin the
  label arrays (`tree-root-actions.test.tsx:25-44`). Dock floor 360px (`settings-schema.ts:296`);
  five controls need 89px and the name ellipsizes first (`14-dock.css:287-295`).
- **DL.** The tiers rewrite merged mid-draft (`fb03b2b3`, `c2e2bfc9`, `da657e63`): IDs kept,
  present tense, no dates or amendment history (`DESIGN-LANGUAGE.md:24-27`). §20/§21 are
  invariants (forks); §19 is a pattern, rewritten with the code once the owner has seen the
  result (AGENTS.md:62-72). DL-19.9 (`:755-759`) is the cluster, DL-19.4 (`:726`) the floor.
  DL-21.1 (`:228-234`) puts selection "at `--radius-control`" but lets the chip's wash follow its
  `--radius-tab`; DL-20.1 (`:197-215`) gives `--radius-tab` to "any control with a text label that
  is 28px tall or less". The tree's hover is a square full-bleed wash (`14-dock.css:245-268`).
  DL-21.3 (`:238`): focus composes with either wash; DL-21.8 (`:248-251`) covers only an
  `.iconbtn` that toggles a surface; DL-23.1/23.10 (`:766,802`): tooltip content. R2 (AGENTS.md:151-153) limits
  citations; `scripts/design-language.test.ts` rejects one the rulebook lacks.
- **Peers.** Four worktrees are alive (`high-dependency-fixes`, `landing-demo-loop`,
  `release-2.9.0`, `settings-polish`); AGENTS.md:145 caps it at three. `origin/main..main` is 17
  commits that are not this slice: dev servers `3361c201`..`38c5e8c1` (their handoff: "not
  pushed", eye review open), `f1fa8fb1`, the spec, and the three DL commits.

## Operating contract

**Decided — do not re-ask.** The spec's decisions, every ticked item below, the approved DL text.

**Decide alone, then record** one line each under "Decided alone" in the handoff: Phosphor
glyphs, module/hook names, test shapes, whether `src/gallery/sections/explorer-tree-section.tsx`
draws a marked row, how the E2E fixture is opened, commit order inside a task, and whether
`docs/user/getting-started.md` "Files" needs a sentence.

**Hard stops — the only reasons to stop and ask:**
1. A change to PTY, window, tab, layout or close/quit modules, or to any file outside
   `src/files/**`, `src/styles/14-dock.css`, the gallery explorer section, `docs/DESIGN-LANGUAGE.md`,
   `docs/internals/file-surface.md`, `docs/user/getting-started.md`, `CHANGELOG.md` and the spec's
   row 3; `src/ui/app.tsx`, `src/terminal/**`, `electron/**` and `src-tauri/**` stay untouched.
2. A DL change beyond the approved text and the ledger row, or a test that passes only by
   deleting a DL marker.
3. `file-surface-controller.ts` gains a line or an interface method (H7's rewording must not grow
   it); crossing 800 lines is a stop in every case.
4. A red gate from another session (attribute it in the handoff, do not fix it), or one from this
   slice that cannot be fixed inside it.
5. A new dependency, action id, chord, settings key or IPC change.
6. Touching the primary checkout's `git status` (other sessions' files) beyond this plan and
   task 5's merge steps.

On a hard stop: commit what is green, write the blocker and 2–3 options with a recommendation in
the handoff, end the session.

**Where it runs.** Its own worktree, created by the implementing session (Sonnet):
`git worktree add ../../spacevibe-deck-worktrees/explorer-reveal -b feat/explorer-reveal main`,
then `npm install` inside it. Lane A (`feat/changes-list`) edits the Explorer view in parallel;
this slice merges first and lane A rebases on it, so keep the diff small and never reformat
shared Explorer files. DL citations here are mapped to `da657e63`; if
`git log da657e63..main -- docs/DESIGN-LANGUAGE.md` shows anything at start, re-read DL and
re-map them before coding.

**Cloud run (owner, 2026-10-10).** Overrides "Where it runs", H9, H10 and the merge steps.
- The session runs in a Claude Code cloud environment on a fresh clone of `origin/main`, which
  holds this plan, the spec and the DL tiers split. Work on branch `feat/explorer-reveal` (or the branch the
  cloud session was given). No local worktree and no absolute paths: this committed file is the
  canonical plan. `docs/plans/` is gitignored, so update the handoff with `git add -f` and commit
  it on the branch with the slice.
- Finish by pushing the branch and opening a PR against `main`. Never push to `main` and never
  fast-forward it; the owner merges, lane B's PR before lane A's. The PR description carries
  the proposed `CHANGELOG.md` Unreleased line; the entry itself is written on `main` at merge
  time (AGENTS.md).
- The pre-push hook still runs on every push. The environment is Linux: if Electron cannot
  launch (try `xvfb-run` first), report the E2E gate **unrun with the reason**, say in the PR
  description that it is owed before merge, and do not mark the slice `Done`. Screenshots go to
  the owner through the session (SendUserFile when available), never into the repo.
- A hard stop ends the session with the handoff committed on the branch and the blocker
  stated in a draft PR.

**Commits.** One per task; `git add -- <new>` then `git commit -- <paths>`; conventional scope;
never `git add -A`/`-a`/`stash`/`reset`/`clean`. Every message ends with
`Claude-Session: https://claude.ai/code/session_01B4qsKNiJbtJ46sLaxbUxKZ`.

**Gates (owner rule 2026-10-09).** Before pushing, exactly what `.githooks/pre-push` runs: oxlint
and prettier on the changed files, then `npm test -- scripts/ src/styles/ <tests beside changed
files>`; never `--no-verify`. Full `npm test`, `npm run build` and `electron:build` are CI's job,
reported unrun, except the `electron:build` the E2E gate needs. Known flakes, attributed and
rerun once: `search-bar` timeout, `prompt-popover` "Errors 1", `codex-integration` EPIPE. The
**E2E gate** (task 4) covers Electron only, although the code also ships to Tauri.

**Done.** Tasks ticked; gates reported passed/failed/unrun with last lines; spec row 3 `Done` with
date and commits (committed on `main`); a DL "Chưa khớp thực tế" row, `building` until the owner's
eye review; handoff written. Then draft nothing else.

## Approve with this plan (one batch)

- [x] **H1. The control.** (a) A fifth 17px control in the root cluster between New folder and
  Refresh (Refresh and Collapse all keep their pixels): constant label "Show hidden files",
  `aria-pressed`, glyph `EyeSlash` hidden / `Eye` shown, no wash, name-only tooltip, no chord, no
  menu entry; shown where the host cannot create, like Refresh. (b) Slice 4's context menu or
  `More` — state invisible, fails EXP1. (c) A chord (⌘⇧. as in Finder) — new action id. (d) The
  dock header — DL-19.9 bars it. Recommended: **(a)**.
- [x] **H2. Persistence.** (a) As today: per workspace, per window, in memory; closing the
  workspace's last surface resets it. (b) A persisted global setting — new settings key. (c)
  Persisted per workspace — a persistence-contract change. Recommended: **(a)**; nothing found
  argues for persisting it.
- [x] **H3. "The active document".** (a) `activeFileTab`, when its document belongs to the tree's
  workspace; nothing is marked while a terminal holds the stage, because the mark then names what
  the stage shows. (b) The workspace's `activePath` — stays marked behind the grid. (c) Mark by
  (b), reveal by (a). Recommended: **(a)**.
- [x] **H4. When the reveal runs.** (a) On every change of the active document, once when the tree
  mounts with one (it never opens the dock), and again when Show hidden files turns on. It scrolls
  only while the row is off-screen, instantly; a plain re-render never re-runs it, so a later
  scroll or collapse stands; a newer document cancels one in flight; focus and the roving tab stop
  never move. (b) As (a) but skipped after a recent user scroll — a timing heuristic tests cannot
  pin. (c) Only from a Reveal control or chord — EXP2 says "when the active document changes".
  Recommended: **(a)**.
- [x] **H5. Documents the tree cannot show** (outside the root, under an excluded name, a dot-path
  with the filter off). (a) No mark, no expansion, no status text, no filter change; under H4 (a),
  turning hidden files on then reveals a dot-path. (b) Turn the filter on, as create does, and say
  so. (c) Mark the nearest visible ancestor. Recommended: **(a)**: the strip chip names the
  document, EXP1 makes the filter the user's, and it adds no text (owner's minimal-text rule).
- [x] **H6. Mark geometry** (DL-21.1 vs DL-20.1, see Facts). (a) The wash on the row's full-bleed
  box at `--radius-tab`, the hover taking the same corner (one declaration on `.file-tree__row`),
  reading DL-20.1 as governing, as DL-21.1 does for the chip. (b) Square full-bleed like today's
  hover — an exception to DL-21.1, a fork. (c) `--radius-control` — the pill DL-20.1 prevents, and
  the DL test fails it on the row's block. (d) A 4px inset — moves geometry the absolute rows
  assume. Recommended: **(a)**; if the owner reads DL-21.1 as binding, (a) is a §21 fork.
- [x] **H7. Creating a dot-entry under the filter.** (a) Keep the flip and its status line; the
  control now shows and undoes it; reword the stale comment (controller `:508-511`) without
  adding lines. (b) Drop the flip — the created entry would be invisible (design §5.3.4). (c) Keep
  the flip, drop the text. Recommended: **(a)**.
- [x] **H8. The §19 text below and its eye review.** §19 is a pattern, so the text is no fork;
  AGENTS.md:68-70 rewrites it with the code once the owner has seen the result. (a) The text lands
  with the code, gallery and E2E screenshots go in the handoff, the merge stays same-day and a DL
  ledger row keeps the eye review owed (every recent slice's shape). (b) Hold the merge until the
  owner has seen the screenshots; lane A waits. Recommended: **(a)**; tick (b) to gate the merge.
- [x] **H9. Worktree cap** (see Peers). (a) Allow this one over the cap: it lives under a day and
  is removed at merge. (b) The owner retires one first (`release-2.9.0`, detached at
  `origin/main`'s tip). (c) The primary checkout — collides with lane A and the dirty tree.
  Recommended: **(a)**.
  **Superseded by Cloud run:** no local worktree; the lane pushes its branch and opens a PR.
- [x] **H10. Merge and push.** Ticking authorizes, after green gates: rebase on `main`, fast-forward
  `main`, `git worktree remove`, branch delete. A push also publishes the 17 commits under
  "Peers", and `pre-push` tests beside all 71 files they touch (the known `tab-strip`/`tab-bar`
  reds are not among them, checked); a red there is another session's — attribute and stop.
  (a) Push `main` with them. (b) Fast-forward local `main` only; push once the owner clears those
  commits. (c) Rebase this slice onto `origin/main` and push it alone — moves lane A's base.
  Recommended: **(b)**; tick (a) to authorize the whole push.
  **Superseded by Cloud run:** no local worktree; the lane pushes its branch and opens a PR.
### DL text to approve

Present tense, no dates (`DESIGN-LANGUAGE.md:24-27`). Append to DL-19.9:

> The explorer's cluster is New file and New folder (omitted when the host cannot create), Show
> hidden files, Refresh and Collapse all: 89px at DL-19.4's floor, and the root's name truncates
> first. Show hidden files is a toggle: `aria-pressed` carries its state and its glyph shows it
> (`EyeSlash` hidden, `Eye` shown), with no wash; its tooltip is the name alone.
> Why: the wash is DL-21.1's selection signifier, and a filter is not a selection.

Add after DL-19.9:

> - **DL-19.10** The explorer marks the document on the stage. While a file tab holds the stage,
>   the row with that document's path carries DL-21.1's wash at `--radius-tab` (DL-20.1's 28px
>   clause; hover takes the same corner), its name and icon take `--text-primary`, and it is
>   `aria-selected`; DL-21.3's ring composes with it. When the document changes, the tree opens
>   the folders above it and scrolls only as far as the row needs, never moving keyboard focus or
>   the roving tab stop and never opening the dock. A document outside the root, under an
>   excluded name, or a dot-path while hidden files are off marks nothing and changes no filter.
>   While a terminal holds the stage no row is marked.

## Tasks

### 1. Hidden-files toggle (feat(explorer))
- [ ] `TreeRootActions` takes `showHidden` + `onToggleHidden` and renders H1; `FileTreeView` wires
  it as `setShowHidden(ws, !showHidden)` then `controller.refreshTree(ws)`, restating the watch
  scope with zero controller lines. Same commit: the DL-19.9 text, `tree-root-actions.tsx:1-3`,
  `file-surface.md:71` ("four" → five, plus the toggle), H7's rewording; new comments cite DL only
  where R2 asks.
- [ ] Tests: `tree-root-actions.test.tsx` — five labels in order, three without create;
  `aria-pressed` and glyph follow the prop; no chord; a press does not reach the row.
  `file-tree-view.test.tsx` — the flip shows/hides `.env`, never `.git`; Enter on the control does
  not toggle the root; `refreshTree` is called once.

### 2. Reveal model (feat(explorer))
- [ ] New pure `src/files/tree-reveal.ts` (beside `tree-focus.ts`; task 3 imports it): the next
  step for a document path from listings, `expanded`, `rootExpanded`, `showHidden` and listing
  errors — `done`, `open root`, `expand <dir>`, `wait` or `none`. It walks the loaded listings
  level by level, taking the visible entry whose path equals the document or prefixes it followed
  by `/` or `\`, and never compares against `workspacePath`. Hidden, excluded, out-of-root and
  failed listings answer `none`.
- [ ] `tree-reveal.test.ts`: root `/tmp/ws` with entries `/private/tmp/ws/...`; Windows
  separators; collapsed root; cached-but-collapsed and unlisted ancestors; dot-path with the filter
  off and on; `node_modules`; outside the root; an ancestor already in `expanded` is never
  returned (`toggleDirectory` toggles, so returning it would collapse it).

### 3. Mark and reveal in the tree (feat(explorer))
- [ ] `FileTreeView` (or a small hook beside it) applies H3/H4: it keeps a reveal target and runs
  task 2's step through the existing `controller.toggleRoot`, `toggleDirectory` and
  `ensureListing`; on `done` it scrolls by index arithmetic as `:122-135` does — no `focus()`, no
  `pendingTreeFocus`, no `scrollIntoView`. The row gets `is-active` + `aria-selected`;
  `14-dock.css` gets the wash and H6's corner. Same commit: DL-19.10 and one "active document"
  line in `file-surface.md`'s Explorer section.
- [ ] Tests (expansion needs a real `createFileSurfaceController` over a stub client, as the
  gallery section builds one; `fakeController`'s `vi.fn` never expands): the mark follows
  `activeFileTab` and clears for a terminal; a deep document expands its ancestors and its row
  lands in the window; `document.activeElement` and the roving `tabIndex` row are unchanged; a
  later user collapse stays collapsed; a second document cancels the first; turning hidden files
  on reveals a dot-path.

### 4. E2E gate (no commit; evidence in scratch)
- [ ] `npm run electron:build` in the worktree; a scratch wrapper calls
  `app.setPath("userData", <scratch>)` before requiring `dist-electron/electron/main.cjs`, driven by
  `playwright-core` `_electron.launch`; never `electron:dev` or the owner's userData. Seed
  `workspaces.json` as `electron/shoot.ts:27-44` does with a fixture under `/tmp` (a symlinked
  root on macOS) holding `.env`, `.github/workflows/ci.yml`, `node_modules/x/i.js`,
  `src/a/b/deep.ts` and a 200-file directory so the target starts off-screen. Plain shell panes
  only, no agent CLI.
- [ ] Flows, each reported: (1) five controls at the 360px floor, screenshot; (2) toggle by pointer
  and keyboard — dot-entries come and go, `.git`/`node_modules` never; (3) a tree click marks the
  row; (4) ⌘+click an `echo`ed `deep.ts` path with `a`, `b` collapsed — they expand, the row is
  marked and in view, and `document.activeElement` is in the editor, not a `.file-tree__row`;
  (5) strip chips move the mark, a terminal tab clears it; (6) ⌘+click with the dock closed, then
  open it — reveal on mount; (7) a dot-path with the filter off follows H5; (8) creating `.x` under
  the filter follows H7. A flow the agent cannot drive (e.g. the xterm link) is reported unrun
  with the reason, never replaced by a store poke. Screenshots stay in scratch.

### 5. Merge (on `main`, per H10)
- [ ] Rebase on `main` (rerun the gates if it moved) and fast-forward `main`. Commit the
  `CHANGELOG.md` Unreleased entry, spec row 3 (`Done`, date, commits) and the DL ledger row on
  `main` with `git commit -- <paths>`. If H10 (a): push from the slice's worktree with HEAD
  detached at the final `main` (`git push origin main`), never from the primary checkout, whose
  untracked gallery files the policy suites would read (AGENTS.md:98-109). Then remove the
  worktree, delete the branch, write the handoff.

## Handoff
- 2026-10-10: drafted at `8d96f827`; the DL tiers rewrite merged mid-draft, so DL citations, the
  DL text and the peer facts were re-mapped at `da657e63`. No code, no worktree. Waiting on owner:
  H1–H10.
