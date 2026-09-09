# The rail's worktree tier — design

Date: 2026-08-25
Status: `decided` (owner approved each decision in chat, 2026-08-25)
Scope: renderer only — the rail's view model, its component and its stylesheet.
Both hosts by code, Electron-only in effect (see §12).

## 1. The settled model

Each row below was chosen by the owner during the 2026-08-25 brainstorm. They
are the whole requirement; the rest of this document is what they imply.

| Decision | Choice |
| --- | --- |
| The rail's shape | Three tiers: project → **worktree** → agent row |
| What a worktree group is | A labelled group wrapper, **not** a control |
| Its one affordance | A `+` launcher scoped to that worktree. No caret, no ✕ |
| Which worktrees appear | Live **plus** those in Deck's workspace history |
| Group ordering | Primary checkout first → live worktrees by earliest-open → history-only last |
| Single-worktree projects | The sub-header is **always** printed; no special case |
| Indentation | **None.** All three tiers share one left edge (§7) |

## 2. What is wrong today

The rail has two tiers, project → tab, and it reaches them by discarding a
third it already holds.

[`buildAgentRail`](../../src/ui/agent-rail-model.ts#L584-L597) `current` walks
`group.worktrees` → `worktree.tabs`, pushes every tab into one flat array, and
then calls `sortByOpenOrder` on it. The worktree each tab belongs to survives
only as [`RailTabRow.worktree`](../../src/ui/agent-rail-model.ts#L94) `current` —
a faint suffix, printed **only when the tab is outside the primary checkout**,
because the 2026-08-16 rail spec §2.1 ruled that 46 of 51 repositories would
otherwise carry a word that says nothing.

That ruling was sound for the usage it was written against: one worktree per
project, one or two tabs in it. It does not survive the usage the owner states
now — **several agents per worktree, several worktrees per project**. That
shape renders like this:

```
📁 deck
  ✳ Running the migration…    · main          2m
  ◎ split the tab strip…      · feat/rail-x   1m
  ✳ Indexed 412 files…        · main          5m
  ✦ Ready to run…             · feat/rail-x   3m
```

Two defects, and neither is fixed by adding a branch label:

- **The runs interleave.** Rows are ordered by when their tab was opened, so
  two worktrees' agents alternate. Nothing on screen says which rows share a
  checkout.
- **The branch word repeats per row.** With M agents in a worktree the same
  string is printed M times — the noise §2.1 existed to prevent, arriving by a
  different door.

The tier is not missing from the data. It is missing from the render.

## 3. The model change

One new type sits between the cluster and the rows:

```ts
export interface RailWorktreeGroup {
  /** The worktree's path — unique within a repository, so: list identity. */
  readonly key: string;
  /**
   * The branch, falling back to the directory basename when git reports none
   * (detached, or a branchless checkout). This is `WorktreeRow.name`, whose
   * fallback rule already exists and is unchanged.
   */
  readonly branch: string;
  /** Where the `+` launches. Always the worktree root, never a tab's cwd. */
  readonly path: string;
  /** git lists the main checkout first; that entry is the repository's own. */
  readonly primary: boolean;
  /** This worktree's tabs, `sortByOpenOrder` applied WITHIN the group. */
  readonly rows: readonly RailTabRow[];
}
```

`RailStreamGroup.rows` becomes `RailStreamGroup.worktrees:
readonly RailWorktreeGroup[]`.

**`RailTabRow.worktree` is deleted.** The group above the row says that word
now, and leaving both would print it twice. `whereOf`
([`agent-rail.tsx`](../../src/ui/agent-rail.tsx#L133-L136) `current`), which
composes `project · worktree` for the row's accessible name, is called from
`TabItem`, which gains a `branch` prop supplied by the group rendering it.

**`RailStreamGroup.tabIndexes` stays project-level.** It is what the project
header's ✕ closes with, and §8 keeps that gesture whole.

## 4. Ordering

Three keys, in order:

1. **`primary` first.** git itself lists the main checkout first, and the field
   already records it. It makes `main` a fixed anchor at the top of every
   project rather than a group that drifts as tabs are opened.
2. **Then live worktrees by earliest-open** — the SMALLEST `openedAt` among
   the group's rows, so a group takes the position its oldest tab already had. Rows
   inside a group keep `sortByOpenOrder` exactly as today.
3. **Then history-only groups**, which have no rows and therefore no open
   order. This mirrors the pattern the rail already expresses one tier up:
   live clusters first, remembered clusters after them.

The window-wide open order shared with the tab strip
([`open-sequence.ts`](../../src/lib/open-sequence.ts) `current`,
[`mergeStripOrder`](../../src/lib/strip-order.ts) `current`) is **not** touched. It
orders projects against each other and chips against each other; grouping rows
under a sub-header moves no tab relative to any chip.

## 5. The sub-header

A static line carrying the branch and one control.

- **Not a button.** It does not toggle, select or navigate. DL-19.7 applies: an
  affordance nothing wires is not drawn, so there is no caret and no hit layer.
- **The `+`** mirrors [`.asr-cluster__add`](../../src/ui/agent-rail.tsx#L644-L655)
  `current` exactly — `PlusSquare` at 15px, revealed on hover/focus, DL-27.18 —
  and calls the SAME `onNewTabIn(path)` prop with the worktree's path. No new
  prop, no new seam: `quickPickerWorkspace`
  ([`events.ts`](../../src/chrome/events.ts#L39) `current`) already pins the
  launcher to a path, and `openQuickAgent` already accepts a destination that
  overrides both cwd and workspace tag.
- **Its accessible name** is `New tab in <project> · <branch>`, so two `main`
  groups in two projects are distinguishable by screen reader.

**No ✕.** The close model (DL-27.21, 2026-08-22) is deliberately untouched: a
worktree-scoped close is a new `CloseCoordinator` method and a new busy-dialog
census, and the project header's ✕ already closes secondary worktrees. Named as
a follow-on in §14, not built.

## 6. Empty worktree groups

A group with no rows renders as its header and its `+`, nothing else.

This needs **no new filtering**.
[`filterRailToWorkspaceHistory`](../../src/repositories/repository-model.ts#L158-L172)
`current` already answers exactly this question:

```ts
const worktrees = group.worktrees.filter(
  (worktree) => worktree.tabs.length > 0 || historicalWorktrees.has(worktree.path),
);
```

Its own doc comment states the policy — *"Git discovery supplies metadata; it
does not decide which never-opened siblings become navigation rows"* — and that
policy is honoured rather than reversed: a worktree the user has never opened in
Deck stays invisible, and one they have worked in stays reachable with nothing
running. `buildAgentRail` today discards these entries; it stops discarding
them.

The shape is not new either. It is the rowless remembered cluster the owner
approved on 2026-08-20 (`.asr-cluster__still` — label plus `+`, no caret), one
tier down.

## 7. Layout: one left edge, no indentation

**All three tiers stand on the same left edge.** Text starts at 31px, which
`.asr-cluster__head` already restates as its own grid on purpose:

> *"The project name stands on the SAME left edge as the tab names under it
> (owner, 2026-08-19)."* —
> [`04a-agent-rail.css`](../../src/styles/04a-agent-rail.css#L176-L180) `current`

Indenting the rows under a sub-header would break that owner decision, and it
would be paid for out of the wrong column: `.asr-row--tab` is
`grid-template-columns: 17px minmax(0, 1fr) auto 17px`
([`04b-agent-rail-rows.css`](../../src/styles/04b-agent-rail-rows.css#L21)
`current`), and the `minmax(0, 1fr)` track holds the agent's newest turn — the
row's whole content since DL-27.15 gave it the line. An indent step shortens
every sentence in the rail.

The tiers are separated by **type**, which is how the rail already separates
them: the project name is the strong word; the branch takes
`.asr-row__worktree`'s existing treatment (`--text-faint`, `--type-meta`,
`450` weight), one step quieter than the project and one step quieter again
than a row's sentence. The leading `·` of that class is dropped — it exists to
join a suffix to a preceding word, and the sub-header starts the line.

## 8. What does not change

- **The project header** keeps its folder glyph, name, caret, `+` and ✕, all
  with today's meanings. Its ✕ still closes every tab of the repository,
  secondary worktrees included (DL-27.21).
- **Collapse.** `toggleGroup` stays keyed on the repository, and collapsing a
  project hides its worktree groups with it. No new persisted state, no new
  settings field.
- **Drag reorder.** [`rail-order.ts`](../../src/ui/rail-order.ts) `current` still
  orders clusters by `orderKey`. Worktree groups do not drag (§14).
- **The row's ✕** still closes the pane its row names (DL-27.21).
- **The focused wash** (DL-27.22) still marks at most one row in the whole rail;
  the AND in `paneRows` is unchanged, and nesting does not add a second washed
  row.
- **The multi-agent frame** (DL-27.19) still rides `data-headless`; it is now
  nested one level deeper and needs no markup change.
- **`git_repository`, the scan store and the refresh-on-focus policy.** No new
  IPC, no new git invocation, no change to `WorktreeEntry`.

## 9. Design language

Two new rules in §27, and one amendment.

- **DL-27.23 (new).** The rail has three tiers: project, worktree, agent row.
  Every tab of a project is printed under the worktree it runs in, and a
  worktree group is always labelled — including when a project has exactly one.
- **DL-27.24 (new).** A worktree group is a label, not a control. It carries
  its branch and one launcher; it does not collapse, select or close.
- **DL-27.9/DL-27.12 amended.** The row gives up its worktree suffix: the group
  above it states the checkout, and a row that repeated it would print the word
  once per agent.

The 2026-08-16 rail spec §2.1 (*"worktree named only when it is not
primary"*) is **superseded**, and its §9 line *"Reviving … worktree-first
navigation"* is narrowed rather than reversed: this adds a grouping tier, not a
navigation axis. The rail is still entered by project and still answers "which
agent"; no mode switch and no density grid returns.

## 10. Files

| File | Change |
| --- | --- |
| `src/ui/agent-rail-model.ts` | `RailWorktreeGroup`; `RailStreamGroup.worktrees`; drop `RailTabRow.worktree`; group assembly and ordering in `buildAgentRail` |
| `src/ui/agent-rail.tsx` | Render the sub-header and its `+`; `whereOf` reads the group; the three `group.rows` sites become `group.worktrees` |
| `src/styles/04a-agent-rail.css` | `.asr-wt__head`, `.asr-wt__name`, `.asr-wt__add` — the last two derived from the existing cluster/row classes, not new treatments |
| `src/ui/agent-rail-model.test.ts` | Grouping, ordering, the empty-group case, and that a row no longer carries a worktree word |
| `src/ui/agent-rail.test.tsx` | The sub-header renders, its `+` targets the worktree path, single-worktree projects still print one |
| `scripts/design-language.test.ts` | DL-27.23 / DL-27.24 assertions |
| `docs/DESIGN-LANGUAGE.md` | The two new rules and the DL-27.9/27.12 amendment |
| `src/gallery/sections/*` | A specimen covering two worktrees plus one history-only group |

`repository-model.ts`, `repositories-store.ts`, `repository-client.ts`,
`rail-order.ts`, `close-coordinator.ts` and everything under `electron/` are
**unchanged**.

## 11. The fork

Four fork-listed categories under [`AGENTS.md`](../../AGENTS.md) `current`,
resolved by the owner's approval of §1 in chat on 2026-08-25:

- **A rule in `docs/DESIGN-LANGUAGE.md`** — DL-27.23 and DL-27.24 are new, and
  DL-27.9/DL-27.12 are amended.
- **A frozen decision reversed** — the 2026-08-16 rail spec's §2.1 suffix rule,
  and the narrowing of its §9 out-of-scope line.
- **An R4 seam** — `RailStreamGroup` is the rail's published shape and both
  rails plus the gallery read it.
- **Tab-adjacent routing** — the sub-header's `+` reuses `onNewTabIn` and
  `quickPickerWorkspace` rather than adding a destination path of its own,
  which is what keeps this OUT of tab materialization.

Chosen over two alternatives the owner was offered and declined: a branch
**suffix** on rows and headers (cheap, but leaves the interleaving and the
repetition in place), and worktree-first **sorting** without a sub-header
(reads as grouping, but deviates the rail from the open order it shares with
the tab strip).

NOT touched: PTY ownership, process classification, the window coordinator, tab
materialization, layout, close/quit coordination, IPC, the settings schema, the
keymap, or any sibling repo.

## 12. Host scope

The code is renderer-only, so it runs under both hosts. The DATA is not:
`git_repository` is Electron-only, so under Tauri every scan answers `plain`
and a project renders as one implicit group with no branch. That is today's
Tauri behaviour preserved, not a regression — and it is a named parity gap, not
an implied both-hosts claim.

## 13. Unverified at design time

- No worktree group has been rendered. Every layout figure here is read off the
  current stylesheets, not measured on screen.
- The 31px left edge is quoted from the CSS comment that records the owner's
  2026-08-19 decision; it has not been re-measured under three tiers.
- The rail's height budget with a history-only group per project is unknown. A
  project with several remembered worktrees adds lines that carry no agent.
- Windows is Gate C, as always.

## 14. Out of scope

- **A worktree-scoped ✕.** Needs a `CloseCoordinator` method and a busy-dialog
  census over one worktree's panes; the project ✕ already covers the repository.
- **Collapsing a worktree group**, and the persisted state it would need.
- **Dragging worktree groups** within or between clusters.
- **Creating a worktree from the sub-header.** The `+` opens the launcher, which
  already owns the create-worktree subview (2026-08-24).
- **Branch metadata beside the name** — ahead/behind, uncommitted count, diff
  size. Every comparable harness pairs branch with change volume, and it is the
  obvious phase 2, but each figure is another git invocation per worktree on a
  cadence this design does not have.
- **Tauri.**

## 15. Verification

Automated, all of which must be green and quoted before any completion claim:

- `npm test`, with any failure attributed against a pristine `HEAD` worktree.
- `npx tsc --noEmit` and `npm run electron:build`.
- `npm run build`.
- The design-language gate.
- `npm run lint` — note the baseline exits 1 on a clean tree, so only NEW
  findings count.
- A gallery pass on the REAL `AgentRail`, measuring: three tiers on one left
  edge, one sub-header per worktree, exactly one washed row, and a history-only
  group rendering its `+`.

Owner-side, and owed regardless of the above:

- A native `npm run electron:dev` pass — no worktree has been grouped in a
  running app.
- The owner eye review (DL §9.6).
