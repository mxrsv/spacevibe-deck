# Changes list: specimens, git status channel and the list in the Explorer (lane A, slice 1)

Record: **Approved 2026-10-10** (owner: "Duyệt theo đề xuất" — every item below as recommended).
It runs in Claude Code cloud sessions (owner, 2026-10-10): the Operating contract's Cloud run paragraph
overrides "Where it runs" and the merge steps. This plan is the implementing agent's authorization.
Spec: [Explorer and Changes](../specs/2026-10-10-explorer-and-changes.md) — CHG1–CHG5; decisions
1–9; open decisions 1 (form), 2 (recursive watch) and 3 (counts only); Forks and constraints.
Base revision: `main` `da657e63` or later. Lane B (`feat/explorer-reveal`, slice 3) edits the same
Explorer view in parallel and merges first; this lane rebases on it before merging.
Canonical path: this file, committed on `main` at the owner's request (2026-10-10) although
`docs/plans/` is gitignored.
Host: two new channels and one event, Electron only. The frozen Tauri host omits the Changes
entry point through the facade's `available` flag — no Rust, no second implementation.
Prior thinking: [2026-09-24 Changes panel](2026-09-24-changes-panel.md) task 1 (its
`agent-rail.md:317` is `:415` today). Not in this plan: slice 2 (DIFF1–5); coloured counts unless
C9 is ticked; a telemetry `surfaces` counter for Changes (it changes the backend contract).

## Problem

After a turn the owner wants the Explorer to show what the checkout changed against `HEAD`,
current within a second. Deck runs no `git status`, its watcher is non-recursive, and nothing
turns "a pane stopped working" into a refresh. Decision 8 picks the form by eye first.

## Facts this plan starts from (code read at `8d96f827`; only docs moved to `da657e63`)

- **Spawning git.** [`git.ts:13-19`](../../electron/git.ts): `execFile`, argv, `windowsHide`, 4 s.
  [`worktrees.ts:22-24,71-89`](../../electron/worktrees.ts): 1 MiB `maxBuffer`, null on failure.
  [`git/worktree.ts:17-19,103`](../../electron/git/worktree.ts): 10 s inspect timeout, `LC_ALL=C`,
  `GIT_TERMINAL_PROMPT=0` so errors classify in any locale. None passes `--no-optional-locks`.
- **"No `git status`" is claimed three times**: [`agent-rail.md:415`](../internals/agent-rail.md),
  [`worktrees.ts:4`](../../electron/worktrees.ts) and `worktrees.ts:231`. Decision 6 names only the
  first; all three are rewritten in the channel's commit (D8).
- **Channels.** [`channels.ts:12-183`](../../electron/ipc/channels.ts), events `:186-217`, feed
  the preload allowlists ([`preload.ts:11-36`](../../electron/preload.ts)); git handlers are in
  [`register-services.ts:42-48`](../../electron/ipc/register-services.ts). `root` travels with
  every call ([`register-explorer.ts:6-9`](../../electron/ipc/register-explorer.ts)), checked by
  [`path-guard.ts`](../../electron/fs/path-guard.ts) `resolveRoot` (`:74`) / `resolveInsideRoot`
  (`:96`); keys are pinned as [`electron-ipc-contract.test.ts:218-232`](../../scripts/electron-ipc-contract.test.ts)
  pins `create_entry`. [`register-dev-servers.ts:81-95`](../../electron/ipc/register-dev-servers.ts)
  releases per sender and is one line at `main.ts:426`; the explorer watcher uses `main.ts:327`.
- **Watcher.** [`watch.ts`](../../electron/fs/watch.ts): non-recursive by design (`:7-9`), replace
  not add (`:10-12`), 256 dirs / 2,048 files (`:35-36`), a `WatchFs` test seam (`:66-85`), 40 ms
  coalesce (`:89`) plus 100 ms in the renderer ([`file-surface.md:84-90`](../internals/file-surface.md)).
- **Measured 2026-10-10** — Electron 43.7.5's Node 24.21.0 (`ELECTRON_RUN_AS_NODE=1`), git 2.51.0,
  macOS, recursive `fs.watch` on a scratch repository's root:
  - plain `git status --porcelain=v2` → 3 events (`.git/index.lock`, `.git/index` ×2); with
    `--no-optional-locks` → 0. Without the flag every read triggers the next.
  - 500 writes over 20 files → 27 events (FSEvents coalesces); 5,000 new files under
    `node_modules/` → 5,002 in ~0.3 s; one commit → 27 under `.git/`.
  - **Linked worktree:** `git add` + `git commit` there → **0** events under its root; all 9 land in
    `git rev-parse --absolute-git-dir` = `<repo>/.git/worktrees/<name>`, outside the root. Deck
    opens worktrees as tabs, so one root watch cannot meet CHG3.
- **Output shapes** (fixtures): porcelain v2 `-z` prints `# branch.oid (initial)` when unborn,
  `2 R. … R100 new\0old\0`, `? path`; `diff --numstat -z HEAD` prints `-\t-\tpath` for binary and
  `0\t0\t\0old\0new\0` for a rename; paths are top-level-relative, not `-C`-relative. The empty
  tree is `git hash-object -t tree --stdin` on empty stdin (no write; differs under SHA-256).
- **Explorer.** `App` passes [`file-create-host.ts:14-16`](../../src/host/file-create-host.ts)'s
  `available` as `canCreate` beside `workspacePath={activeWorkspace.value}` (`app.tsx:206,2616-2620`).
  [`explorer-tab.tsx`](../../src/files/ui/explorer-tab.tsx) is the DL-19.5 status line (`:49-57`)
  over `FileTreeView`, cleared on workspace change (`:36-40`) — **one** signal shared with create
  failures ([`file-surface-store.ts:137-159`](../../src/files/file-surface-store.ts)). The root is
  row 0 of a fixed-22px virtual list (`file-tree-view.tsx:50`, [`file-surface.md:64`](../internals/file-surface.md))
  with four 17px controls ([`tree-root-actions.tsx`](../../src/files/ui/tree-root-actions.tsx)); a
  click opens the preview tab, `openFile(…, false)` (`file-tree-view.tsx:180`).
  [`file-surface-controller.ts`](../../src/files/file-surface-controller.ts) is 768/800 lines
  (focus reconcile `:411-418`, installed at `app.tsx:758-763`); this slice only calls `openFile`.
- **Turn end and visibility.** `AgentPhase` = `unknown | idle | working | exited`
  ([`agent-activity.ts:53`](../../src/terminal/agent-activity.ts)), per pane as `PaneView.phase` in
  the window-scoped `tabViews`, tabs carrying `workspacePath` ([`tabs-store.ts:40,135,212`](../../src/terminal/tabs-store.ts)).
  Precedent for an `effect` on `tabViews` with debounce, one in flight and a queued rerun:
  [`session-tail-store.ts:88,97-103,639-642`](../../src/terminal/session-tail-store.ts).
  [`repositories-store.ts:255-266`](../../src/repositories/repositories-store.ts) refreshes on
  `visibilitychange` and `focus`; its `repositoryScans` (`:29`) already says `plain` or
  `repository` per workspace without running status. Prompt-ready is not used (spec, Evidence).
- **Design language: the tiers split merged during drafting** (`fb03b2b3`..`da657e63`). Numbers
  are stable; Part I invariants (§1–4, §7, §20, §21, minus rules marked _(pattern)_) are forks,
  Part II patterns (§19 included) are rewritten with the code after eye review, and specimens are
  not bound by patterns ([`AGENTS.md:55-70`](../../AGENTS.md)). Read at `da657e63`: DL-3.2
  (`:108`, invariant), DL-4.2 (`:143`), DL-21.1 (`:228`) and DL-21.8 (`:248`, invariants);
  DL-19.5 (`:734`, one status line, `--red` for failure, no dialog), DL-19.7 (`:742`, an
  unservable tab is omitted), DL-19.8 (`:751`), DL-19.9 (`:755`, a tab's actions on its first
  row, never in the shared header), DL-23.10 (`:802`).
- **Peers.** Four worktrees are alive (high-dependency-fixes, landing-demo-loop, release-2.9.0,
  settings-polish); [`AGENTS.md:145`](../../AGENTS.md) allows three. The pre-push hook unsets
  `git rev-parse --local-env-vars` (`.githooks/pre-push:54`): a temp-repo test that inherits
  `GIT_DIR` rewrites this repository.

## Operating contract

**Decided — do not re-ask.** Spec decisions 1–9, CHG1–5, every item below once ticked, and the
DL text the owner approves together with the specimen pick.

**Decide alone, then record** one line with the reason under "Decided alone" in the handoff:
file names (the paths named in the tasks are proposals); parser structure; status and numstat in
parallel or not; keyboard model (roving tabindex like the tree); icons and sizes inside DL
scales; skipping a re-render on an unchanged reply; the detached-HEAD label; other failure text
(first stderr line); how the E2E fixture becomes a tab (seed scratch `workspaces.json`, or stub
`dialog.showOpenDialog` via `electronApp.evaluate`); test shape; deleting code left without
callers. Never write "Needs owner decision" for these.

**Hard stops — the only reasons to stop and ask:**
1. **Task 0's eye review**, by design: send the screenshots, write the handoff, end the session.
   The reply names a variant and approves the DL text listed for it; a pick without that text
   approval still stops the DL part.
2. Any change to PTY ownership, process classification, the window coordinator, tab
   materialization, layout or close/quit coordination. Outside new modules, the main side may
   change only `channels.ts`, the comments at `worktrees.ts:4,231`, the contract test, and one
   import plus one call in `main.ts` beside `registerDevServers()`; the window-closed handler
   (`main.ts:305-330`) stays untouched — release goes through the sender.
3. A DL invariant change beyond approved text (C9 is the only one posed). §19 patterns are
   rewritten for the chosen variant in the same change as the code — Task 0's pick is the eye
   review. Never delete a `**DL-N.M**` marker.
4. `file-surface-controller.ts` needing any edit, or crossing 800 lines.
5. A watcher library or any new dependency.
6. Any git command that writes — no `add`, `commit`, `checkout`, `stash`, `reset`, `update-index`,
   `hash-object -w`; every spawn carries `--no-optional-locks`; nothing typed into a pane (CHG5).
7. A red gate from another session's change: attribute in the handoff, never fix. Known:
   `tab-strip.test.tsx` and `tab-bar.test.tsx` fail on pristine `main` since `13648bef`; flakes
   `search-bar`, `prompt-popover`, `codex-integration` EPIPE.

On a hard stop: commit what is green, write the blocker and two or three options with a
recommendation in the handoff, and end the session.

**Where it runs.** Its own worktree, from the primary checkout:
`git worktree add ../../spacevibe-deck-worktrees/changes-list -b feat/changes-list main`, then
`npm install` inside it; Sonnet implementing agent. At start: `git status --porcelain` there,
`git worktree list` (C11), and `git log --oneline da657e63..main -- docs/DESIGN-LANGUAGE.md`
(re-map DL citations if it moved again). Lane B also edits `explorer-tab.tsx`,
`file-tree-view.tsx` and `tree-root-actions.tsx`; it merges first. Never `electron:dev`.
`prototype:gallery` is 127.0.0.1:5175 `--strictPort` (`package.json:20`); if taken, serve from
the worktree on a free port and confirm the server's cwd first. Task 0's eye review ends the
first session, so `changes-list` may stay alive overnight: the reason is "waiting on the
owner's specimen pick", recorded in the handoff as AGENTS.md asks.

**Cloud run (owner, 2026-10-10).** Overrides "Where it runs", C11, C12 and the merge steps.
- The session runs in a Claude Code cloud environment on a fresh clone of `origin/main`, which
  holds this plan, the spec and the DL tiers split. Work on branch `feat/changes-list` (or the branch the
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
- Task 0's eye review: push the specimens, open a draft PR named for the pick it waits on,
  send the screenshots, then stop. The next session continues on the same branch.
- C3's recursive watch is macOS and Windows only, so a Linux run cannot show the near-real-time
  flows (E2E walk 2–4). They stay owed on macOS before merge; unit tests with the injected
  watcher and clock still cover the scheduler.
- A hard stop ends the session with the handoff committed on the branch and the blocker
  stated in a draft PR.

**Commits.** One per task (Task 0 twice: specimens before the gate, spec record after),
`git commit -- <paths>` with `git add -- <new>` first, conventional with a scope; never
`git add -A` / `-a` / `stash` / `reset` / `clean`. Messages end with
`Claude-Session: https://claude.ai/code/session_01B4qsKNiJbtJ46sLaxbUxKZ`.

**Gates (owner, 2026-10-09).** Before every push: tests beside each changed file, lint on them,
and the `scripts/` and `src/styles/` suites — the `.githooks/pre-push` set, never `--no-verify`.
Full `npm test`, `npm run build` and `electron:build` are CI's job and reported unrun, except
`npm run electron:build` in the worktree for the E2E gate (Task 5). Report each gate as passed /
failed / unrun with its last output lines.

**Done.** Every task ticked; gates reported; spec Delivery slices row 1 `Done` with date, commits
and this plan's link; decision 8 and open decisions 1–2 answered; the three "no `git status`"
claims rewritten in the channel's commit; `CHANGELOG.md` Unreleased entry on `main`; handoff
written. Then draft slice 2's plan for owner approval — not its code.

## Approve with this plan (one batch)

Each item has one recommendation; the owner ticks or overrides once.

- [x] **C1. Channel shape.** (a) `git_changes {root}`: branch, comparison, entries, totals and
  `omitted` in one reply (main merges status, numstat, untracked counts); `git_changes_watch
  {root}` replaces this sender's one watched checkout (`null` releases); event `git:changed
  {root}` only says "read again"; the renderer owns all scheduling. (b) Two reads, `git_status`
  and `git_numstat` — two round trips that can disagree. (c) Main reads on its watch events and
  pushes — a second scheduler. **Recommended (a):** one snapshot, one fake-timer-testable scheduler.
- [x] **C2. Bounds.** (a) Per git command a 10 s timeout (`git/worktree.ts`'s inspect bound: status
  walks the tree, and a cold cache on a large repository passes `git_branch`'s 4 s) and a 16 MiB
  `maxBuffer` (~100k records); `--untracked-files=all`; at most 500 entries per reply plus an
  `omitted` count; untracked lines counted in main for at most 200 files of ≤ 2 MiB each
  (`MAX_EDITABLE_BYTES`, `looksBinary` from [`file-content.ts`](../../src/files/file-content.ts)),
  others "not counted"; a `maxBuffer` overflow gets its own message, since no count survives it.
  (b) The precedent's 4 s / 1 MiB / 200 entries. (c) Stream stdout through `spawn` to count past
  any buffer — more code for a case the message covers. **Recommended (a).**
- [x] **C3. Watching — answers open decision 2, and amends it.** (a) Node's recursive `fs.watch` on
  the root, macOS and Windows only (Linux's implementation walks every directory; Deck does not
  ship there), **plus one non-recursive watch on `--absolute-git-dir` when it lies outside the
  root** (the linked-worktree measurement). Under the root's `.git/` keep `index`, `HEAD`,
  `packed-refs`, `refs/**`, drop `objects/`, `logs/`, `worktrees/`, `*.lock`; the git-dir watch
  keeps `index` and `HEAD` only; a `null` filename counts as a change. At most one `git:changed`
  per 100 ms per sender; held only while the list is shown and the window visible. (b) Root watch
  only — a worktree commit shows only at focus or turn end. (c) No watch — CHG3 fails.
  **Recommended (a);** ticking it adds the git-dir watch to open decision 2's text.
- [x] **C4. Scheduler numbers.** Every trigger — watch event, a pane leaving `working`, focus or
  becoming visible, list shown, Refresh — feeds one pure scheduler with an injected clock.
  (a) Trailing debounce 150 ms; max wait 1,000 ms from a burst's first trigger (a long
  `npm install` still reads once a second); a read starts no sooner than 1,000 ms after the
  previous read started *and* one previous-duration after it ended; one in flight, and a trigger
  during it runs exactly one more. Focus, list shown and Refresh skip the debounce, not the
  in-flight rule. Expected: an edit in ~0.3–0.5 s; 500 writes → ≤ 3 reads; a prompt that rewrites
  the index per command → one gated read each. (b) 300 ms / 2 s — misses CHG3 under load. (c) No
  max wait — a continuous writer starves the list. **Recommended (a).**
- [x] **C5. Hidden means nothing runs.** (a) Window hidden (`visibilitychange`), list not shown, or
  a tab with no workspace: release the watch (`root: null`), cancel timers, drop triggers, start
  no read; one read on return. (b) Keep the watch, skip only reads — a recursive handle on a tree
  nobody looks at. **Recommended (a).**
- [x] **C6. Unhappy states (CHG2, CHG4) and the shared status line.** (a) Not a repository: entry
  disabled with the tooltip "Not a git repository", read from `repositoryScans` (no status run);
  a shown root that stops being one says so on the status line. No commit: compare against the
  empty tree, header "No commits yet" in faint ink. Git missing (`ENOENT`), timeout: red status
  line, last good list kept. Overflow: C2's message. One message at a time — a transient create
  failure wins while up, then the git message returns; `ExplorerTab` picks between two signals.
  (b) Hide the entry for non-repositories — DL-19.7's "omit" is about the host, and a hidden entry
  cannot say why. (c) Overwrite `explorerStatus` — a create failure and a timeout erase each
  other. **Recommended (a).**
- [x] **C7. A workspace below the repository's top level.** (a) Scope with `-- .` from the root,
  map paths from the top level into the root, drop any `resolveInsideRoot` refuses. (b) Show the
  whole repository — paths no file channel may read. (c) Refuse and ask for the top level.
  **Recommended (a).**
- [x] **C8. Selecting an entry before slice 2.** (a) Open the working-tree file in the preview tab,
  `openFile(root, path, false)`, as a tree click does; a deleted entry is shown, not pressable;
  slice 2 replaces the press with the diff column. (b) Nothing — rows that look pressable and are
  not. (c) Reveal the row in the tree — needs lane B's reveal and fights variants A and B.
  **Recommended (a).**
- [x] **C9. Count colour (DL-3.2; open decision 3, counts only).** (a) Neutral: `+N −M` in muted
  ink, tabular (DL-4.2); status as a short mark with its word in the tooltip; open decision 3
  waits for slice 2. (b) Tick now a scoped amendment of the DL-3.2 invariant (a fork; the tick
  is the answer) letting counts use `--green` / `--red`, text approved in the reply.
  **Recommended (a):** colour belongs with the diff, and (a) ships nothing to revert.
- [x] **C10. Tauri.** The Explorer's file channels already have no Tauri counterpart
  ([`file-surface.md:7-8`](../internals/file-surface.md)). (a) Omit the entry point on Tauri and
  in the browser preview through `git-changes-host.ts`'s `available`, as `canCreate` does.
  (b) Disable it with a tooltip. **Recommended (a):** DL-19.7's rule for a host that cannot serve.
- [x] **C11. Worktree cap.** `AGENTS.md:145` allows three live worktrees; four exist and the lanes
  make six. (a) A same-day exception for `changes-list` and `explorer-reveal`, each removed at its
  merge. (b) The owner first removes stale ones (`release-2.9.0` is a detached checkout of
  `963f1bf2`) — still five. (c) Lane A waits for lane B's slot.
  **Recommended (a).**
  **Superseded by Cloud run:** no local worktree; the lane pushes its branch and opens a PR.
- [x] **C12. Merge and push** (aligned with lane B's H10). Ticking authorizes, after green gates
  and after lane B merged: rebase on `main`, fast-forward `main`, remove the worktree, delete the
  branch, `CHANGELOG.md` Unreleased entry on `main`. No tag, release or version bump. Local
  `main` holds 17 commits that are not this lane's (dev servers, the DL tiers split, the spec);
  a push publishes them too. (a) Push `main` with them. (b) Fast-forward local `main` only; push
  once the owner clears those commits. (c) Push this lane alone on `origin/main` — moves both
  lanes' base. **Recommended (b);** tick (a) to authorize the whole push.
  **Superseded by Cloud run:** no local worktree; the lane pushes its branch and opens a PR.
## Tasks

### 0. Three specimens and the eye-review gate (feat(gallery), then docs(specs))
- [ ] One lazy section `changes-specimens`, registered last in the worktree's
  `section-registry.ts` (the primary checkout's copy holds another session's uncommitted rows;
  never touch it), never imported by shipping code (R7). Fake data in its own module: a
  checkout on `feat/changes-list` with 8 entries (3 modified, 1 added, 1 renamed with old path,
  1 deleted, 1 untracked, 1 binary) and totals, plus a clean state and a red status-line state.
  The tree is the real `ExplorerTab` over an inert client, as in
  [`explorer-tree-section.tsx:1-21`](../../src/gallery/sections/explorer-tree-section.tsx);
  only list rows are drawn. Each variant in its bold form (patterns do not bind specimens), minimal
  text, names in tooltips, and a card line per DL rule it amends or retires; an invariant it would
  break is labelled a fork on the card:
  - **A — Files / Changes switch** at the Explorer's head; the Changes side carries `+42 −7`, and
    while shown it replaces the root row's name and actions. Amends DL-19.9 (the first row names
    one of two views), DL-19.7 too if it moves into the dock header; active side takes DL-21.1.
  - **B — collapsible Changes section** above the tree, its header row carrying branch, totals and
    Refresh; collapsed it is one 22px row. Amends DL-19.9 (a second action-bearing row) and the
    root-is-row-0 model (`file-surface.md:64`): two scroll regions in a 360px column.
  - **C — "changed only" filter**, a fifth 17px root-row control pruning the tree to changed files
    and their ancestors, with status and counts on those rows. Amends DL-19.9 (five controls at
    360px); painting its on state would break the DL-21.8 invariant (a fork). **It contradicts the
    spec:** decision 1 (no git markers on tree rows) and Out of scope ("filter-in-tree") need
    rewording if C wins.
- [ ] Headless playwright-core screenshots of the worktree's gallery: each variant populated at
  360px and 520px column width, plus clean and error states at 360px, to session scratch. Send
  them with one line per variant, then **stop** (hard stop 1).
- [ ] After the reply: spec decision 8 answered and open decision 1 closed, with the approved DL
  text; remove or park (out of `GALLERY_SECTIONS`) the unchosen specimens as told.
- Acceptance: three variants render at both widths without horizontal overflow; the owner has the
  screenshots; the pick is in the spec.

### 1. Read channel (feat(git))
- [ ] `electron/git/changes.ts` `readChanges(root)`, never rejecting: `resolveRoot`; one
  `rev-parse --show-toplevel --absolute-git-dir --show-prefix` (also the not-a-repository probe);
  `status --porcelain=v2 -z --branch --untracked-files=all -- .`;
  `diff --numstat -z --no-ext-diff --no-textconv <HEAD | computed empty tree> -- .`; bounds per
  C2, paths per C7, flags per hard stop 6 plus `windowsHide`, `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`
  and the inherited env minus the `--local-env-vars` names. The repository's own config (`core.fsmonitor`,
  hooks) is not overridden, as in the user's prompt. Total parser: an unknown record costs itself.
  Reply `changes` (branch, detached, initial, entries, omitted, totals) or one of
  `not-repository` / `git-missing` / `timeout` / `overflow` / `failed` with a message.
- [ ] `CHANNELS.gitChanges = "git_changes"` with an Electron-only comment like `channels.ts:30-37`,
  `{ root }` in the new `register-changes.ts`; contract test pins `["root"]`. Rewrite the three
  "no `git status`" claims: the rail still runs none; the Changes list runs a bounded, read-only one.
- [ ] `changes.test.ts` on temp repositories with an explicit env free of `GIT_*`: every CHG1
  status, staged plus unstaged on one file, unborn, subdirectory root, non-repository, git
  missing / timeout / overflow via an injected runner, odd paths (spaces, newlines, non-ASCII),
  and the index's mtime unchanged by a read.
- Acceptance: CHG1's fixture acceptance is a test; the only git verbs are `rev-parse`, `status`,
  `diff` and `hash-object` without `-w`.

### 2. Watch channel (feat(git))
- [ ] `electron/git/changes-watch.ts`: a registry keyed by sender id, `replace(sender, root|null)`,
  C3's watches, filters and throttle, an injected watch function and clock (the `WatchFs` shape);
  `fs.watch` failures (EMFILE, ENOSPC, vanished root) degrade to no watch, logged once. Windows is
  unverified: a recursive handle on a worktree root may block `git worktree remove` while shown.
- [ ] `CHANNELS.gitChangesWatch = "git_changes_watch"` `{ root }`, `EVENTS.gitChanged =
  "git:changed"` `{ root }` to that sender only; released as `register-dev-servers.ts:81-95`
  does; contract test pins both.
- [ ] Tests: replace closes old watches, `null` and a destroyed sender release; each C3 keep/drop
  path; 5,000 events within 100 ms emit once; an out-of-root git-dir `index` event emits; an
  unresolvable root throws `PathOutsideWorkspaceError` like `watch_paths`.
- Acceptance: `git diff --stat main -- electron/ scripts/` shows only the new modules, their tests
  and hard stop 2's files.

### 3. Renderer facade, scheduler and triggers (feat(changes))
- [ ] `src/host/git-changes-host.ts` (`available`, `readChanges`, `watchChanges`,
  `listenChanged`; precedents `file-create-host.ts`, `file-client.ts:99-101`) and
  `src/files/changes/`: the C4 scheduler, a store per root (last good reply, message, reading
  flag), and the C4/C5 triggers — the turn-end `effect` on `tabViews` (a pane of a tab whose
  `workspacePath` is the shown root leaves `working`; panes in other windows are left to the
  watch and focus), `visibilitychange` / `focus`, and the show/hide lifecycle.
- [ ] Fake-timer tests for every C4 and C5 rule, including 500 triggers over 1 s → ≤ 3 reads,
  hidden → zero reads with the watch released (CHG3's test), and a `working → idle` pane in
  another workspace → no read. Signal effects land a frame late; tests wait a frame.
- Acceptance: CHG3's numbers hold under fake timers.

### 4. The list in the Explorer (feat(explorer))
- [ ] The chosen variant as shipping UI, `src/files/ui/changes-list.tsx`: header (branch, totals,
  comparison in the tooltip), rows (name, directory, status, counts or "binary"), `omitted`
  footer, CHG4's empty state, Refresh (DL-23.10), keyboard reach, and C6, C8, C9, C10 as ticked.
  Wired through `ExplorerTab`, `App` passing the facade's `available` as it does `canCreate`;
  controller untouched. Apply the approved DL text; `scripts/design-language.test.ts` passes.
- [ ] Tests beside for each state above, create-failure precedence on the status line, and the
  press (preview tab; deleted entry not pressable).
- Acceptance: a gallery shot of the shipping list at 360px shows no overflow; it replaces the
  specimen.

### 5. E2E, docs, spec and merge (docs(file-surface), docs(specs), docs(changelog))
- [ ] `npm run electron:build` in the worktree; a scratch wrapper calls
  `app.setPath("userData", <scratch>)` before requiring `dist-electron/electron/main.cjs`;
  `_electron.launch({ env })` puts a scratch `git` shim first on `PATH` that logs each call and
  sleeps past the timeout while a marker file exists (main never rewrites `PATH` — only PTY
  shells are login shells, `electron/platform/macos.ts:33` — so the shim reaches `execFile`); a
  scripted scratch fixture holds every CHG1 status and one linked worktree.
- [ ] Walk and record: (1) list equals `git status` + numstat; (2) an edit shows within 1 s of the
  write; (3) 500 writes → ≤ 3 `status` calls in the shim log; (4) a commit in the linked worktree
  empties its list with no focus change; (5) minimized → no shim calls; (6) non-repository →
  entry disabled with tooltip; (7) `.git` renamed while shown → "Not a git repository" on the
  status line; (8) timeout → red line, last list kept; (9) `PATH` without git → git-missing
  message; (10) clean → empty state. Screenshots to scratch.
- [ ] A short "Changes list" section in [`file-surface.md`](../internals/file-surface.md) (the two
  watches and why, the lock loop, the scheduler's bounds, status-line precedence); one sentence in
  [`getting-started.md:104`](../user/getting-started.md) (D12); the spec per Done.
- [ ] Merge per C12 after lane B; handoff; draft slice 2's plan.

## Handoff
- 2026-10-10: plan drafted at `8d96f827`, DL citations re-mapped to `da657e63`; no code, no
  worktree. Waiting on the owner: the C1–C12 batch. Task 0 starts once it is approved.
