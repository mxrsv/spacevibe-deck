---
run_id:        g5ws46
profile:       change
scope:         worktree
reviewed_at:   2026-08-31T14:05:00+07:00
source_kind:   working-tree
head_sha:      ad03f16122576a056e3d154dd03a40885edada2d
dirty:         true
tree_digest:   0c9c50156b958a3a09fd1609f2296e7fc0a91a36
---

# Review — `rail-card-menu-agents-and-naming`

**Objective reviewed.** Fix the three defects the owner found on the Electron rail's
per-checkout worktree card (openspec change
`openspec/changes/rail-card-menu-agents-and-naming`, 2026-08-30/31): the actions menu
never rendered its `Run <agent>` group (now a three-state group keyed on
`agentsResolved`); the menu's `Actions for …` / `Runs in …` header repeated the card
6px away and two glyphs collided with others in the same column; and a primary
checkout's card head reprinted the project name (it now names its branch, with
`whereOf` and `headerDestination` dropping repeated segments).

## ⚠️ The tree moved during this review

`tree_digest` was `33c746ef27b92dad986c75f313a8a141eedab90c` when the reviewers were
dispatched and `0c9c50156b958a3a09fd1609f2296e7fc0a91a36` when this report was written,
~10 minutes later. `agent-rail-card-model.ts`, `agent-rail-model.ts`,
`worktree-card-menus.tsx`, `app.tsx`, `worktree-card-strip.tsx` and
`04d-rail-card-menus.css` all carry mtimes between 13:45 and 14:00 — i.e. they were
being edited *while* the reviewers read them. This checkout is shared with concurrent
sessions (see `AGENTS.md` known traps).

Consequence, stated rather than glossed: the three reviewers did not all see one tree.
`tests` and `security-code` read at ~13:55–13:59; `correctness` re-verified both of its
finding sites at 14:03 and reports its findings **against the live tree**. Per the
freshness rules this report is already stale for `/review-release` purposes the moment
the next edit lands — it classifies evidence, it does not freeze it.

A second consequence matters more for reading the findings below: **`tasks.md` §6.4 is
badly stale.** It lists twelve findings as "NOT this change's — reported not fixed", but
`correctness` observed eleven of the twelve already repaired in the live tree
(6.4.1, 6.4.2, 6.4.3, 6.4.5, 6.4.6, 6.4.7, 6.4.8, 6.4.9, 6.4.10, 6.4.11, 6.4.12), and
`tests` independently confirmed three of them from the code's own 2026-08-31 comments.
The known-debt cap in the dispatch briefs was therefore applied to work that is no
longer debt — findings 2 below is capped lower than its intrinsic risk for that reason,
and is flagged accordingly.

## Coverage

| Reviewer | Status | Reason |
|---|---|---|
| correctness | ran | All four evidence steps on the untracked `worktree-card-*` / `agent-rail-card-model.ts` files (whole-file reads) plus diff + enclosing scope + callers + tests for the rail-card hunks of `agent-rail-model.ts`, `agent-rail.tsx`, `app.tsx`, both CSS files and the gallery registry. Its closing coverage line was truncated in transit past `section-registry`; nothing it named as unread is a manifest file. |
| tests | ran | Read `agent-rail-card-model.ts`, `worktree-card-row.tsx`, `worktree-card-menus.tsx` and all four related suites in full; ran the scoped suite — **205/205 passed** in 18.8s across `agent-rail-card-strip` (11), `agent-rail-model` (77), `agent-rail-card-naming` (10), `worktree-card-menus` (7), `worktree-card` (30), `agent-rail` (70). Did not read `worktree-card-strip.tsx`'s measurement code in depth (pre-existing §6.4.3 territory). |
| security-code | ran | gitleaks (exit 0, no leaks) over a scoped copy of all 22 changed/new files; semgrep `p/default` (exit 0) over the 9 changed `.ts`/`.tsx` files — 2 hits, both pre-existing `console.error` template literals in `app.tsx` updater code, outside this change's lines. All untracked manifest files read whole; all tracked ones read via `git diff HEAD`. |

**Out of scope by decision.** The working tree carries ~95 dirty files; this review was
scoped by the user to the openspec change only. Not reviewed, and named per W3 so the
omission is visible rather than silent: the quick-launch / launcher work, recent-activity,
session-journal and `electron/pty/spawn.ts`, the explorer root-row change, and
`marketing/landing-prototype/install.sh` + `install.ps1` — **that last pair is a
`curl | sh` bootstrap and deserves its own security pass in the session that owns it.**

## Findings

Ranked by severity, then confidence. **No blockers.**

### 1. `code/rail-card/repository-path-falls-back-to-linked-worktree`

```yaml
key:        code/rail-card/repository-path-falls-back-to-linked-worktree
severity:   medium
confidence: high
evidence:   src/ui/agent-rail-model.ts:647-650  (repositoryPath = find(primary)?.path ?? worktrees[0]?.path ?? "")
            src/repositories/repository-model.ts:169-171  (filterRailToWorkspaceHistory keeps only worktrees with open tabs or in workspace history)
            src/ui/worktree-card-menus.tsx:526-537  (createBranch(group.repositoryPath))
impact:     A NEW defect in the 2026-08-31 repair for [prev 6.4.8] — not a re-derivation of it.
            `group.worktrees` reaching `buildAgentRail` has already been filtered, so a repository
            whose primary checkout has no open tab and is not in Deck's workspace history is dropped
            from the array. `find(primary)` is then undefined and `repositoryPath` silently becomes
            the first surviving LINKED worktree's path — exactly the value 6.4.8 was fixed to stop
            passing. `Create branch from here` prefills `quickWorktreeForm.setRepo()` with that
            worktree, so `suggestWorktreeDest` proposes a destination beside the worktree again.
            The reproduction shape is this repo's own setup: work only inside
            `spacevibe-deck-worktrees/rail-worktree-card` and never open the main checkout.
action:     Resolve the repository path from the UNFILTERED scan (the `RepositoryScan`'s own first
            non-bare entry — the same source `repository-model.ts:287` already uses for `group.name`)
            rather than from the post-filter `group.worktrees`. Keep the `worktrees[0]?.path` fallback
            only for the `plain` kind, which is the case its comment actually describes.
```

This is the headline: it is the one finding that is **this change's own new defect**
rather than inherited debt or a coverage gap.

### 2. `tests/rail-card/2026-08-31-behavior-fixes-untested`

```yaml
key:        tests/rail-card/2026-08-31-behavior-fixes-untested
severity:   medium
confidence: high
evidence:   src/ui/worktree-card-menus.tsx:142-155  (Escape moved to capture phase + stopPropagation)
            src/ui/worktree-card-menus.tsx:609-628  (focus returns to the pre-open activeElement on unmount)
            src/ui/worktree-card-menus.tsx:274-280  (noun = count === 1 ? "agent" : "agents")
            grep -rn "SegmentMenu" src/ui/*.test.* -> empty
impact:     Three real behavior changes dated 2026-08-31 in the code's own comments ship with zero
            regression coverage. The Escape fix is the one that matters: before it, one press both
            closed the menu AND reached the agent running behind it (xterm's target-phase handler sent
            `\x1b` first). Nothing would catch a revert. `SegmentMenu` is not rendered by ANY test file.
action:     Add a capture-phase Escape test proving the terminal below does not receive the key; a
            focus-return-on-close test; and a `SegmentMenu` render test asserting singular vs plural
            in its aria-label.
```

**Severity note.** `tests` capped this at `medium` under the dispatch brief's
known-debt rule (it maps to `[prev 6.4.6]`, `[prev 6.4.10]`, `[prev 6.4.11]`), and
explicitly said the intrinsic risk is higher. That cap was applied on a false premise —
`tasks.md` §6.4 says these are unfixed, but they are fixed, so they are this change's
behavior and not inherited debt. **Read this as `high`.**

### 3. `tests/rail-card/resize-observer-structurally-unexercised`

```yaml
key:        tests/rail-card/resize-observer-structurally-unexercised
severity:   medium
confidence: high
evidence:   src/ui/worktree-card-menus.tsx:98-106  (if (typeof ResizeObserver === "undefined") return;)
            src/ui/worktree-card.test.tsx:318-338  (the note -> agent rows transition test)
            vite.config.ts — no ResizeObserver polyfill in the `test` block
impact:     The tasks §6.2 fix cannot execute in jsdom: the guard is always true, so the observer is
            never constructed by any test in the suite. The existing transition test proves the DOM
            swap happens but never places the menu near `innerHeight` and never asserts `top`/`left`
            after the swap — it would pass identically with the fix removed. This is the literal
            "asserted by prose, not by test" case: the menu growing past the viewport bottom near the
            screen edge is exactly the bug 6.2 claims to fix, and nothing guards it.
action:     Stub `global.ResizeObserver` in the test file (or assert the fallback `measure()`
            placement math directly), then assert the computed `top` does not fall past a mocked
            `window.innerHeight` after the note -> rows swap.
```

`correctness` separately verified the fix itself is **correct** — guard before
construction, `observer.disconnect()` on the same effect, `[rect]` deps re-arming it,
`SegmentMenu` inheriting it via the shared hook, and no observer loop (fixed widths,
capped `max-height`, and the equality bail in `setPlace` absorbing the initial
delivery). The defect is the absent test, not the code.

### 4. `tests/rail-card/agents-resolved-wiring-untested`

```yaml
key:        tests/rail-card/agents-resolved-wiring-untested
severity:   medium
confidence: medium
evidence:   src/ui/app.tsx:1844, 1850  (railCardActions: agentsResolved, onManageAgents)
            src/ui/app.test.tsx — zero references to WorktreeCard / cardActions / agentsResolved
impact:     Every existing test proves `actionGroups` / `CardActionsMenu` behave correctly GIVEN a
            correct `agentsResolved` prop. Nothing proves `App` threads the live `agentsProbed.value`
            signal in rather than a stale or hardcoded value — which is the whole defect this change
            exists to fix. Confidence is medium because `app.tsx` is large, shared, and mid-edit by
            concurrent sessions, so this may be knowingly deferred integration coverage.
action:     One `app.test.tsx` case that flips `agentsProbed.value` and asserts the card's `+` menu
            shows the pending note vs the agent rows accordingly — the pattern the launcher's own
            `agentsResolved` already has.
```

### 5. `code/rail-card/detached-head-primary-reprints-the-project-name`

```yaml
key:        code/rail-card/detached-head-primary-reprints-the-project-name
severity:   low
confidence: high
evidence:   src/repositories/repository-client.ts:16  (WorktreeEntry.branch is string | null)
            src/repositories/repository-model.ts:294  (name: entry.branch ?? workspaceLabel(entry.path))
            src/ui/agent-rail-model.ts:664  (branch: worktree.name — the null fallback is absorbed here)
            src/ui/agent-rail-card-model.ts:207  (checkoutLabel returns group.branch for a primary group)
            src/ui/worktree-card.tsx:139 + src/ui/worktree-card-row.tsx:50-58  (the two readers)
impact:     A boundary the new naming rule cannot reach — not a regression, since the pre-change head
            printed the same duplication. On a detached HEAD (bisect, a checked-out tag, mid-rebase)
            git reports no branch, so `RailWorktreeGroup.branch` IS the folder basename, which for the
            primary checkout IS the project name. The head then prints `spacevibe-board` directly under
            a cluster header reading `spacevibe-board` while its badge asserts `Primary` — the
            capability spec's own scenario ("the string appears exactly once in the rendered cluster")
            fails. Worse for assistive tech: `whereOf` dedups [project, project, project] down to the
            bare project, so the card's accessible name and tooltip lose the checkout identity
            entirely and read identically to the header's.
action:     Carry `WorktreeRow.branch`'s nullability into `RailWorktreeGroup` — a `detached: boolean`,
            or keep `branch: string | null` and let `name` hold the fallback — so `checkoutLabel` can
            answer with the folder name plus a `Detached` role badge instead of silently re-printing
            the project.
```

## The three applied fixes (tasks §6.1–6.3), verified

- **6.1 — confirmed.** One copy of the `232px …` comment above `.asr-pop--actions`
  (`src/styles/04d-rail-card-menus.css:83-92`).
- **6.2 — code correct, untested.** See finding 3.
- **6.3 — works, but its comment misdescribes the mechanism.** `headerDestination`
  (`src/ui/agent-rail.tsx:223-229`) produces the right string, but the "`path` and
  `branch` are both `""`" case it documents **never occurs**: `RailWorktreeGroup.branch`
  is `worktree.name`, and for a plain group with no `workspacePath` that is
  `groupTabs[0]?.label ?? "Unknown"` (`repository-model.ts:246`) — never `""`. The
  branch that actually fires is `checkout === group.project`, because a plain group's
  project name is the same string. Not filed as a finding; recorded so the comment is
  not trusted as a description of the guard.

## Minor items

**correctness:** the new focus-return races the action it just ran, but every row's
action awaits before focusing, so the pane wins; `useDismiss`'s deps include a
per-render `onClose`, so its three document listeners are removed and re-added on every
rail re-render while a menu is open; `BareCheckout` hardcodes `data-shell="false"` on
both branches under a comment claiming it distinguishes shell-only checkouts (the
distinction moved to `entries.length === 0`, so the attribute is dead);
`useSurfacePlacement` still never re-reads its anchor `rect`, so a window resize leaves
a menu placed against a card that has moved; `CardStrip`'s hover timer has no unmount
cleanup (harmless — ≤140ms).

**tests:** the note row's `role="none"` is unasserted (tests check tag name only); task
4.3's glyph-uniqueness claim is verified by import removal rather than a test, and
`DeckIcon` is stubbed in every card suite so no test setup *could* tell `GitFork` from
`GitBranch`; task 6.3's named regression has no dedicated fixture — both new
`agent-rail.test.tsx` cases (883, 899) use a real git scan, never a `plain` or
empty-path project.

**security-code:** none.

## Notes routed to other profiles

- `openspec/changes/` now lives beside `docs/specs/` + `docs/plans/` with no `AGENTS.md`
  D3 entry — a contracts/docs question for `/review-health`, and the design doc already
  names it as accepted-for-this-change.
- `tasks.md` §6.4's staleness (eleven of twelve items fixed but recorded as unfixed) is
  a docs-drift item; it is reported here only because it distorted this review's own
  severity capping.
- `role="none"` on the pending note inside `role="menu"`, and the `+` segment and the
  menu both carrying the accessible name `Actions for <where>`, are a11y/user-flow calls
  for `/review-experience`.
- `agent-rail.test.tsx` was flagged in the design as asserting the pre-2026-08-27
  `<span role="img">` strip; the scoped run passed 70/70, so that concern appears
  resolved, but it was not audited as such.

## What this review does not establish

No gate was run beyond the scoped Vitest suite (205/205) and the two security scanners —
this repo's standing rule is that gates run only when the owner asks, and `tasks.md`
§5.3 already recorded a full pass. Nothing here was seen in a running app: tasks §5.2 is
partial and §5.4 (owner eye review on `npm run electron:dev`) is still open and still
blocking any "done" claim, on a surface whose 2026-08-27 predecessor never had a host
pass either.
