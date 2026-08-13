# Repository → Worktree rail — Design

Date: 2026-08-13 · Status: proposed, pending owner approval
Target host: **Electron only**. Nothing here ships on Tauri.
Source context: [redesign program handoff](../plans/2026-08-13-redesign-program-handoff.md)
`current` · phase 1 of its remaining-phase table.

## Goal

Deck's left region becomes two tiers: a **repository**, and the **worktrees**
under it. Each worktree row carries what the user actually navigates by — which
one is running something, and which one wants attention.

Deck knows none of this today. A workspace is a folder path and nothing else:
`tabs-store` carries `workspacePath` as a plain string, `workspaces.json`
remembers a flat list of them, and the only git anywhere in the product is
`git_branch` (`electron/git.ts`), a decorative per-pane label that fails to
`null`. A user running four worktrees of one repository sees four unrelated
rows that happen to have similar names.

**Non-goals.** Creating, removing, pruning, locking or switching worktrees.
Branch operations of any kind. `git status` decoration. Multi-account or remote
repositories. Opening a worktree that has no tab yet — that is §7.1, a fork.

## 1. Reading git: at which layer, and how

### 1.1 The layer is the main process, behind one channel

The renderer has no filesystem and no child processes, so a git read is a main
process job either way. The choice that matters is **granularity**, and it is
made once here: the unit of a read is a **repository**, not a workspace, not a
pane, and not a tick.

One new channel, `git_repository`, payload `{ path }`. It answers with a
complete scan of the repository that contains `path`, or with a refusal. It is
the only git the rail uses.

This deliberately does not extend `git_branch`. That command answers a
different question (what is this pane's cwd on) at a different cadence (per
pane, per poll) and its answer is decoration. Overloading it would put a
repository-wide scan on a per-pane poller — the single most expensive mistake
available here.

### 1.2 Two commands, both bounded

```
git -C <path> rev-parse --path-format=absolute --git-common-dir --show-toplevel
git -C <path> worktree list --porcelain
```

The first yields the repository's **identity**. `--git-common-dir` is the same
absolute path for the main checkout and for every linked worktree, which is
exactly the key the rail needs: two workspaces belong to the same repository
if and only if their common dir matches. Deriving identity from the toplevel
instead would make every worktree its own repository, which is the bug this
whole feature exists to remove.

The second yields the worktree set. `git worktree list --porcelain` reads
`.git/worktrees/*` and the main checkout's HEAD — it does not walk the working
tree, so its cost is proportional to the **number of worktrees**, not to the
size of any of them. That is what makes the read cheap enough to do on demand.

`git status` is not run, here or anywhere in this design. Its cost is
proportional to the working tree and it is the obvious next thing somebody will
reach for when asked to show "dirty" in the rail. It is out of scope on cost,
not on usefulness.

### 1.3 Fail-closed, in the strong sense

Every failure mode collapses to one refusal value. The list is not
hypothetical — each of these happens:

| condition                             | result                            |
| ------------------------------------- | --------------------------------- |
| `git` not installed / not on `PATH`   | `{ kind: "plain", reason }`       |
| path is not inside a repository       | `{ kind: "plain", reason }`       |
| path does not exist any more          | `{ kind: "plain", reason }`       |
| permission denied on `.git`           | `{ kind: "plain", reason }`       |
| git hangs (network-backed FS, lock)   | `{ kind: "plain", reason }` @ 4 s |
| porcelain output in an unknown shape  | `{ kind: "plain", reason }`       |

"Fail-closed" here means **closed toward the current product**, not closed
toward an error surface. A path Deck cannot resolve as a repository renders as
what Deck already renders today: a plain folder row that works. Navigation is
the one surface that must never be able to fail into a state the user cannot
get out of, so this design gives it no failure state at all — only a less
informative success.

Three properties make that real rather than intended:

- **`execFile`, never a shell.** Arguments are an argv array. A workspace path
  is user data and a worktree path comes out of git's own output; neither is
  ever concatenated into a command line.
- **A timeout on every call** (4 s, matching `git_branch`), and a bounded
  `maxBuffer`. A repository on a stalled network mount cannot wedge the rail.
- **The parser is total.** `parseWorktreePorcelain` returns entries for the
  records it understands and drops the rest; it has no throwing path. An
  unrecognised attribute in a future git release costs a field, not the list.

### 1.4 Cheap, stated as budget

- One scan per repository, **deduplicated by common dir**. Four worktrees of
  one repository open in four tabs cost one scan, not four.
- Scans are serialised per repository: a second request while one is in flight
  joins the first.
- No polling loop, no timer, no watcher (§2). DL §1's founding constraint —
  consume as few machine resources as possible — is why this is a budget and
  not an implementation note.

## 2. Tracking change

Explicit invalidation, not observation. The rail rescans on:

1. startup, once per distinct repository behind an open workspace;
2. a workspace opening or closing;
3. the window regaining focus (`document.visibilitychange` → visible);
4. the repository header's own refresh action.

(3) is the one that carries the weight. Worktrees are created and removed by
the user in a terminal — frequently in one of Deck's own panes — and the moment
they come back to the window is precisely when the list is stale and looked at.

**A `.git` watcher is deliberately not built.** git rewrites files under `.git`
during every fetch, commit, index refresh and gc; a watcher there produces a
continuous wakeup stream to keep a list current that changes a few times a day.
That trade is the opposite of DL §1. It is recorded here so the next session
does not rediscover it as an omission — it is a decision.

## 3. Where state lives

**Derived git facts are never persisted.** The worktree list, branches, HEADs
and states are read at launch and held in memory. Persisting them would create
a second truth that is wrong every time the user touches git outside Deck, and
the read is cheap enough that a cache buys nothing.

**User intent is persisted**, in a new `repositories.json` through the existing
`Store` facade — `store_load` / `store_get` / `store_set` / `store_save`, no new
channel:

```jsonc
{ "version": 1, "repositories": [{ "root": "/abs/path", "collapsed": false }] }
```

That is the whole schema. Collapse state is the only thing in it, because it is
the only thing in the rail the user decides rather than git.

**`workspaces.json` is not touched.** Not read for this, not written by this,
not migrated. See §4.

## 4. Migrating the flat workspace model

There is no migration, and that is the design, not an omission.

The rail is **derived** from what already exists. Each open tab's
`workspacePath` is resolved through §1's scan to a repository key; tabs sharing
a key group under one repository header; a tab whose path resolves to `plain`
renders in its own group as a folder, exactly as today.

Three properties follow, and all three are the reason for choosing derivation:

- **Nothing is lost if the rail is reverted.** No store was rewritten, so
  reverting the component reverts the feature.
- **Nothing is lost if git is unavailable.** A machine without git shows the
  flat list Deck has always shown.
- **No migration code exists to be wrong.** The failure mode of a one-shot
  store rewrite is a user's workspace list mangled on the release that shipped
  it, and the Electron cutover is already a clean install with no migration
  path (`AGENTS.md`). Adding one here would contradict that decision.

## 5. When a worktree disappears from disk

git's own vocabulary already distinguishes the cases, and the rail keeps them
apart rather than flattening them into "gone":

| git says                        | rail shows                             | can open |
| ------------------------------- | -------------------------------------- | -------- |
| `prunable gitdir file points to non-existent location` | `missing` | no |
| `locked [reason]`               | `locked`, reason in the row's title    | yes      |
| entry absent from the list      | row disappears on the next scan        | —        |
| repository root itself gone     | whole group renders `unavailable`      | no       |

Three rules govern all of them:

- **Deck never prunes.** `git worktree prune`, `remove`, and `unlock` are
  destructive and are not offered by a navigation rail. A `missing` row is
  reported, not repaired.
- **A row with an open tab never vanishes.** If a worktree is deleted from disk
  while its tab is open, the row stays, marked `missing`, so the running
  session keeps a place in the navigation it was reached through. Removing the
  row would strip a live tab of its only handle.
- **A `missing` row is inert, not hidden.** Hiding it makes the tab
  unreachable; leaving it live invites opening a path that is not there.

## 6. The surface

```
Repositories                       ← eyebrow, --text-faint (DL-3.4)
▾ ▣ spacevibe-deck                 ← repository header: mark, name, refresh
  ● main            primary        ← worktree row: state dot, name, badge
    main · ~/Development/…         ← branch, then path (DL-3.4 ladder)
  ● redesign/phase-1-2      ◐       ← activity: ring while an agent is busy
▸ ▣ spacevibe-bench                ← collapsed
+ Open workspace                   ← the existing new-tab path, unchanged
```

- The rail occupies `DesktopChrome`'s existing `sidebarNavigation` slot and
  keeps its callback contract: `onSelectTab`, `onCloseTab`, `onNewTab`,
  `onRenameTab`, `onSetTabColor`, `onFocusAttention`. It is a different
  presentation of the same navigation, which is what keeps it out of R4's
  load-bearing seams.
- **Selection uses DL-11.2's signifier** — a 2px left accent bar plus a 4%
  `--fg` wash — because that is what "active item in a nav rail" already means
  everywhere in this app. The gallery direction restyles it, as it restyles
  every other surface; that restyle is a proposal (spec 2 §6), not this
  component's shipped look.
- **Worktree state dot.** `--green` only for running (DL-3.2), `--magenta` for
  attention, `--text-faint` for idle, and `missing` is a hollow ring rather
  than a fourth colour. Colour is not the only carrier: every state also names
  itself in the row's accessible label.
- **Icons** come from `DeckIcon` (DL-14.1) at `RAIL_ICON`/`CHROME_ICON`
  (DL-14.2). No glyph characters.
- **No uppercase** anywhere, including the eyebrow (DL-4.3). The gallery
  fixture's uppercase eyebrow is a violation this spec's implementation
  removes.

### 6.1 Worktree state, and where each value comes from

| state       | source                                                      |
| ----------- | ----------------------------------------------------------- |
| `working`   | the tab's `agentBusy` — already in `tabs-store`             |
| `attention` | the tab's attention summary, when actionable                |
| `ready`     | a tab is open on this worktree and is idle                  |
| `idle`      | git lists the worktree; no tab is open on it                |
| `missing`   | git lists it `prunable`, or its path no longer resolves     |

Nothing in that table is invented for the rail. Four of the six values are
already rendered by `WorkspaceSidebar` today; the rail regroups them.

## 7. Forks — owner approval required, not taken here

**7.1 Opening a worktree that has no tab.** The obvious next click. It is
`AGENTS.md`'s **tab materialization** fork: materializing a tab from a path the
user never chose a layout or an agent for is a decision about what Open means,
not a call site. Until it is approved, an `idle` worktree row is a **readout** —
DL-17.3's precedent, where a control that cannot be pressed loses its border
rather than gaining a disabled pill. Opening still goes through the Open board,
which owns materialization today.

**7.2 Replacing `WorkspaceSidebar` in the `sidebarNavigation` slot.** Taken, and
flagged. The slot's contract is unchanged and `WorkspaceSidebar` stays in the
tree with its tests, so reverting is one line in `app.tsx`. Recorded because the
redesign's left region is this rail (owner decision 4 in the handoff) and a rail
nobody can see decides nothing.

**7.3 R6 / handoff §3.3 — one more `ipc-contract` violation.**
`scripts/ipc-contract.test.ts` requires every `invoke` in `src/` to name a
`#[tauri::command]`. Measured on `e3c3a2e`, it is red at **31** violations, not
the 17 the handoff records — the handoff's count predates the browser panel's 8
and the file explorer's 6. `git_repository` is Electron-only, so it makes 32.

The alternative — writing a Rust counterpart — is worse on two counts:
`AGENTS.md` freezes Tauri features precisely so nothing is implemented twice,
and a Rust command added here would carry no runtime evidence. Deciding what
that gate should do on a two-host tree is the R6 decision handoff §3.3 already
names; this spec adds one row to it and does not resolve it.

## 8. Verification

- `parseWorktreePorcelain` against real `git worktree list --porcelain` output:
  main + linked, detached HEAD, bare, locked, prunable, and trailing-garbage.
- `scanRepository` refusals: no git, not a repo, missing path, timeout.
- The pure view-model builder: grouping by common dir, plain folders, state
  precedence, a `missing` worktree that still has an open tab.
- The rail component: selection, close, popover parity with `WorkspaceSidebar`.
- Gates: `npm test`, `npm run build`, `npm run generate:menu:check`,
  `npm run electron:build`, plus the design-language, gallery-entry and
  icon-system suites.
- **Eye review on a screenshot** (DL §9.6), gallery and packaged Electron.

## 9. Assumptions and open items

- **Assumed:** `--path-format=absolute` is available. It landed in git 2.31
  (2021). Older git falls through to `plain` rather than misreporting, so the
  assumption degrades instead of breaking.
- **Assumed:** a user's repository count is small (units, not hundreds). The
  design is O(repositories) per invalidation with no pagination.
- **Open:** §7.1, which is most of what makes the rail worth having.
- **Open:** whether the repository header should offer worktree creation. It is
  the natural home and it is a write path; not proposed.
- **Open:** submodules are not distinguished from worktrees. They do not appear
  in `git worktree list`, so they render as plain folders — correct-ish by
  accident, and untested.
- **Untested:** Windows. Path comparison uses the absolute strings git returns;
  drive-letter case and UNC paths are unverified, and this repo has no Windows
  hardware (Gate C).

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                    | Intent     | Status       | Evidence                                                                          |
| ---------------------------------------- | ---------- | ------------ | --------------------------------------------------------------------------------- |
| The rail replaces the workspace model    | `proposed` | `partial`    | Presentation only; `workspacePath` is still the tab's identity — §4               |
| A worktree can be opened from the rail   | `proposed` | `backlog`    | §7.1 is a fork; `idle` rows are readouts until it is approved                      |
| The design is verified on both platforms | `proposed` | `unverified` | macOS/Linux only; §9 records the Windows path questions, Gate C has no machine     |
