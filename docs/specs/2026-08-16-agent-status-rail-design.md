# Agent status rail — design

Status: `decided` (owner approved the shape in the gallery on 2026-08-16; not
implemented in the app yet).

Replaces the repository → worktree rail
([`RepositoryRail`](../../src/ui/repository-rail.tsx) `current`, design
[2026-08-13](2026-08-13-repository-worktree-rail-design.md) `decided`) with a
rail whose unit is **a live agent**, not a checkout.

## 1. Why the unit changes

The old rail is shaped like the repository layout. A probe of this machine's
own Claude/Codex corpus on 2026-08-16 (1145 user-opened sessions since
2026-03-30, 1032 of them in the last 30 days) says the owner does not work
that way:

| Measure                                               | Value           | Consequence for the rail                            |
| ----------------------------------------------------- | --------------- | --------------------------------------------------- |
| Repositories with exactly one working directory       | 46 of 51        | A worktree row is the exception, not the spine      |
| Real worktrees in the whole corpus                    | 4               | Worktree cannot be the top-level unit               |
| Projects touched per hour                             | median 2, p90 4 | The rail shows a handful of live things, not a tree |
| New session lands on a different project              | 56%             | Switching is constant                               |
| That project is in the last 3 / 5 touched             | 75% / 88%       | A flat recency list beats a tree                    |
| Session returns to a project already touched that day | 83%             | The rail is a resume surface, not a browser         |
| Median gap between two touches of one project         | ~8 minutes      | Glance-and-return, not read-and-navigate            |

The owner, asked what they look for after stepping away, named two things:
_which agent just finished or is asking me something_, and _the overall picture
of what is running_. Both are agent questions. Neither is a directory question.

The corpus is CLI sessions machine-wide, so it describes work rhythm, not
in-Deck clicks; Deck ships no telemetry and none is proposed here.

## 2. What the rail is

One list. A pinned `Needs you` block on top when anything wants the user,
everything else underneath in recency order. **No mode switch** — the owner
named the mode toggle in the earlier variants as the thing that felt wrong.

One row per **tab**. A tab is a pane layout, so its agents appear as marks
inside the row, and a disclosure unfolds them into rows of their own.

```
Needs you                    2
▸ deck                ✳◎✦  2m  ●     ← tab row: project, agent marks, age, state
  Ready to run the migration…        ← the newest turn in the loudest pane
  bench · blind-vote-hardening 5m ○  ← worktree named only when it is not primary
─────────────────────────────────
  deck · release-hardening  3m  ◐
  academy               ◎▣✦+1 12m ◐
Open workspace
```

Expanded:

```
▾ deck                ✳◎✦  2m
    ✳ claude                  ●
      Ready to run the migration on 14…
    ◎ codex                   ◐
      split the tab strip into two…
    ✦ gemini                  ○
      Indexed 412 files, nothing to change.
```

### 2.1 The row

Two lines. Line one is identity and state: agent marks · project name ·
optional worktree suffix · age · status mark at the right edge. Line two is
the head of the newest turn.

- **Project** is the workspace's own name. **Worktree** is a suffix, rendered
  only when the tab is not in the repository's primary checkout. 46 of 51
  repositories would otherwise carry a word that says nothing.
- **Age** is `changedAt` from the pane snapshot, rendered as a short relative
  string, tabular figures.
- **The status mark** carries the state alone. **There is no status word in
  the row**; the word survives in `title` and in the row's accessible name, so
  the shape is the fast read and never the only read.
- **The message line** is trimmed by layout (`text-overflow: ellipsis`), never
  by slicing the string — the full sentence stays in the DOM.
- **Agent chips**: three, then `+N`. Each chip badges itself only when its own
  pane is `asked` or `done`; a dot per chip for every state turns the strip
  into confetti. Every chip is clickable — see §2.2.

### 2.2 What a click does

Four targets, four destinations. This is the whole reason the rail is worth
building: every visible thing is a way back to a specific pane.

| Click target                    | Destination                                       |
| ------------------------------- | ------------------------------------------------- |
| The row itself                  | The tab, at whichever pane was last focused in it |
| An agent chip in the row        | **That agent's pane**, focused directly           |
| A pane row in the expanded list | **That agent's pane**, focused directly           |
| The `+N` chip                   | Expands the row (the same as the disclosure)      |
| An archived row                 | Resumes that workspace                            |

Focusing a pane means: activate its tab, focus the pane inside it, and
acknowledge its attention — the path `onFocusAttention` already walks for the
attention rail, reused rather than reinvented.

**The pane answers back.** On arrival the target pane's border rings for
**1.5s** and fades out. Without it the rail sends focus into a grid of
identical panes and the user has to re-find the thing they just asked for;
1.5s is long enough to catch the eye and short enough not to become decor.

Two design-language rules stand in the way and are amended for this, not
ignored:

- **DL-1.2** caps animation at 300ms. The ping is not a state change — it is a
  locator, a different genre, and 300ms is below the threshold where an eye
  that was looking elsewhere can catch it. §26 carries the exception, scoped to
  this one effect.
- **DL-1.3** bans blurred/offset `box-shadow` outright; the app is a flat
  system. So the ring is **not** a glow: it is an inset hairline
  (`box-shadow: inset 0 0 0 2px var(--accent)`, the form DL-1.3 explicitly
  permits) on an overlay whose **opacity** is what animates — `opacity` is on
  DL-1.2's allowed-property list, `box-shadow` is not.

The effect is `pointer-events: none`, never blocks input, and is skipped
entirely under `prefers-reduced-motion` (by scope, per §9's checklist).

Shape, as built and eye-approved in the gallery on 2026-08-16: opacity 0 → 1
over the first 12% of the 1500ms, held to 70%, then out. The owner reviewed the
rendered effect and kept 1.5s.

**Structural consequence:** the row cannot be a single `<button>`, because a
chip inside it must be its own control and a button inside a button is not
operable. The row is a container with a full-bleed hit layer behind it; the
chips and the disclosure sit above that layer as real buttons, and the inert
text spans pass their clicks through to it.

### 2.3 The disclosure

A sibling control in the row's left gutter, not a child of the row — a button
nested inside a button is not operable. It appears only when the tab runs more
than one agent; the gutter stays reserved either way so every project name
starts on one line. Open state is per row.

While a row is open, its own message line is hidden: the per-agent rows carry
the turns, so the folded line would only repeat one of them.

### 2.4 The stream is clustered by project

**Amendment, 2026-08-16, after the rail shipped.** §2 above says "one list" and
"one row per tab", and the row prints its project name. Running it revealed
what the §1 corpus could not: those measurements counted PROJECTS (median 2 an
hour), never TABS PER PROJECT. Four tabs open on one workspace printed the same
word four times, and recency scattered the copies down the list — the name was
the loudest thing in every row and the least informative.

So the stream is grouped: **the project name is printed once, above its tabs**,
and a row inside a labelled cluster names the tab instead — the user's name for
it, else the agents running in it, else `shell`.

This is not the worktree-first tree §9 rules out, and the difference is
enforceable rather than stylistic:

- The header is a **label, not a row**: no state mark, no age, no disclosure,
  nothing to press. Nothing about the click contract in §2.2 changes.
- **The worktree stays a suffix on the row.** It never becomes a level.
- **A cluster of one prints no header.** Most projects have exactly one tab —
  the §1 corpus is the reason — so a header apiece would double the rail's
  height to repeat what the row already says.
- **Clusters are ordered by their newest tab**, the same recency the rows
  inside them use. Nothing is ordered by name.
- **The pinned block is never clustered.** It is a queue of answers owed, and a
  header there would push an urgent row below a name. A project can therefore
  appear both pinned and clustered at once; a pinned row is a job and a
  clustered row is a place, so neither copy is a duplicate of the other.

The same pass fixed the line under the row. Tier 3 is still unbuilt, so §5's
fallback stands — but a tab nobody renamed derives its title from its own
workspace path, which made the "newest turn" a second printing of the project
name, once under the row and once under every pane inside it. **The fallback
line is now printed only when a person typed that title**; otherwise the row is
one line high until a real turn exists to put there.

Carried by `DL-27.9`.

### 2.5 The pinned block is gone, and nothing reorders itself

**Amendment, 2026-08-16, later the same day.** §2 above opens with "a pinned
`Needs you` block on top when anything wants the user, everything else
underneath in recency order". Both halves of that sentence are void; the owner
asked for the change from a screenshot of the shipped rail.

- **No pinned block.** Every tab of a project sits under that project's header,
  whatever its state, so a project is printed in exactly one place. The block
  had lifted an actionable tab out of its cluster, which meant a project with
  one asking tab and two quiet ones printed its name twice — and §2.4's own
  finding was that the project name was already the loudest and least
  informative word in the rail. The state mark carries the urgency where the
  tab already is.
- **`needsYou`, `needsYouCount` and `onFocusAttention` leave the rail.** §5's
  "kept and re-bound" note applies to the count button, which no longer exists.
  Nothing about the ATTENTION feature is lost: `focus-next-attention` (⌘⇧A,
  View menu) still walks to the next waiting pane through the same
  `runAttentionFocus` preflight, and the rail's chips and pane rows still land
  on an exact pane (§2.2).
- **Order is when things were opened, not when they last changed.** A cluster
  sits where its oldest tab put it; a row sits where it was opened. The key is
  the window's own open clock, shared with the tab strip. Recency ordering had
  the list moving under the pointer every time an agent changed state, which is
  the opposite of a resume surface (§1).
- **The age moved to a second line, leading it**, with the turn beside it when
  there is one. On the name line it sat between the agent chips and the state
  mark and split them with a number. This pushes the hover actions (§6) onto
  that line's trailing end, in reserved space — the trailing pair on the name
  line is now 10px wide, and the actions must never cover a chip, which is a
  target rather than a readout.

Carried by `DL-27.10`, which also amends `DL-27.5` and voids one sentence of
`DL-27.9`.

## 3. State model

The tracker already produces everything the rail needs.
[`PaneAttentionSnapshot`](../../src/terminal/agent-attention.ts#L38-L57)
`current` carries `phase`, `attention`, `agentLabel`, `unread` and `changedAt`;
[`AgentAttentionSummary`](../../src/terminal/agent-attention.ts#L78-L86)
`current` carries the per-tab rollup;
[`TabView`](../../src/terminal/tabs-store.ts#L18-L40) `current` already exposes
`workspacePath`, `agents`, `agentBusy`, `unread` and `attention`.

| Pane snapshot            | Rail state | Mark              | Colour             |
| ------------------------ | ---------- | ----------------- | ------------------ |
| `attention: "requested"` | `asked`    | filled dot + halo | `--yellow`         |
| `attention: "completed"` | `done`     | hollow dot        | `--accent`         |
| `attention: "error"`     | `failed`   | filled dot        | `--red` (DL-3.2)   |
| `attention: "warning"`   | `asked`    | filled dot + halo | `--yellow` (owner) |
| `phase: "working"`       | `working`  | turning open arc  | `--text-primary`   |
| otherwise                | `resting`  | hairline ring     | `--hair-strong`    |

`failed` is **not** allowed to read as `resting`. A crashed agent outranks an
asking one wherever the two are compared — inside a folded row's precedence,
and nowhere else since §2.5 removed the pinned block.

It carries **no word beside its mark** — the owner chose colour alone on
2026-08-16, keeping every row in the rail identical in shape. The known cost:
red and yellow side by side are harder to tell apart at a glance than a word
would be. Two things carry the difference instead, and the implementation must
not weaken either: the message line under a failed row is the failure itself
(`Command exited with code 1`), and `title` plus the accessible name still say
`failed` in words.

Precedence when a tab folds its panes into one row: `failed` > `asked` >
`done` > `working` > `resting`.

`unread` does **not** get its own mark in v1. It already drives the tab strip's
badge, and a second unread signifier in the rail would be DL-21.6's "two
signifiers for one state" mistake in a new place. Revisit only if the owner
asks for it after living with the rail.

## 4. Decisions taken 2026-08-16

Recorded because each reverses or narrows something already written down.

1. **The stage strip scopes by project, not by worktree.** The 2026-08-15
   resolved fork ("sidebar mode's `TabStrip` follows the selected
   `RepositoryRail` worktree") is amended: the unit becomes the repository.
2. **Rename / recolour / close move to hover buttons on the row**, replacing
   the old rail's dedicated controls. The owner chose hover over a context
   menu.
3. **All three tiers ship together**, message line included, rather than
   landing the rail first and the conversation tail later.
4. **`asked` is `--yellow`.** DL-3.2 currently assigns roles to `--green` and
   `--red` only; yellow is used by the unread badge and the warning attention
   mark without a rule. This spec legitimises it rather than quietly reusing
   it — see §7.
5. **No status word in the row at all**, and **no `you:` / agent label** on
   the message line: the sentence is the content, the attribution was noise.
6. **`warning` folds into `asked`.** Both mean "come look"; the palette stays
   three marks wide (red, yellow, quiet) rather than four.
7. **Archived workspaces are quiet rows at the bottom of the stream** (§8),
   chosen over sending resume to the Open board.

## 5. What changes, file by file

### Tier 1 — the rail

- **New** `src/ui/agent-rail.tsx`: the component, ported from
  [`src/gallery/agent-status-rail.tsx`](../../src/gallery/agent-status-rail.tsx)
  `current`. Gallery CSS does not come with it; chrome styling goes into
  `src/styles.css` under the new DL section.
- **New** `src/ui/agent-rail-model.ts`: pure projection from `TabView[]` +
  pane snapshots + repository scans into rail rows. Testable without a DOM,
  the way [`repository-model.ts`](../../src/repositories/repository-model.ts)
  `current` already is.
- [`src/ui/app.tsx`](../../src/ui/app.tsx#L1247-L1290) `current`:
  `sidebarNavigation` renders the new rail. Existing callbacks
  (`onSelectTab`, `onCloseTab`, `onOpenWorkspace`, `onRenameTab`,
  `onSetTabColor`, `onFocusAttention`, `onResumeWorktree`) are kept and
  re-bound; the prop contract does not change, which keeps the revert to one
  line.
- `RepositoryRail` and `WorkspaceSidebar` stay in the tree, out of the shell,
  until the rail passes its native pass — the repo's own precedent for parked
  UI.

### Tier 1b — the strip seam

- [`activeWorktreeTabIndexes`](../../src/repositories/repository-model.ts#L330-L355)
  `current` gains a sibling, `activeRepositoryTabIndexes`, which returns every
  tab in the active tab's repository group rather than in its worktree.
- [`src/ui/tab-strip.tsx`](../../src/ui/tab-strip.tsx#L84-L135) `current`
  calls it at both sites (the visible projection and the popover guard) and
  renames the prop `scopeToActiveWorktree` → `scopeToActiveRepository`.
- File-tab chips do not pass through this filter and are unaffected.

### Tier 1c — the focus ping

- The ring is an overlay inside the pane slot, not a border on it: the pane
  already owns `.pane-slot.is-active .pane` styling
  ([`src/styles.css`](../../src/styles.css#L1789-L1814) `current`) and the
  locator must not fight the active-pane treatment or reflow the terminal.
- Mount it keyed by a focus counter, so asking for the same pane twice replays
  the ring — an animation only restarts when its element is new.
- `src/styles.css` carries the keyframes inside the existing
  `prefers-reduced-motion: no-preference` scope.

### Tier 2 — per-pane rows

- The tracker knows each pane's state; the renderer only receives the per-tab
  rollup. A per-tab pane projection (`paneId`, `agent`, `attention`, `phase`,
  `changedAt`) is published alongside `tabViews`.
- A pane row **and an agent chip** both activate that exact pane, reusing the
  focus path `onFocusAttention` already uses. Both need the pane id, which is
  why the per-tab pane projection above is a tier-1 dependency and not a
  tier-2 nicety.

### Tier 3 — the message line

- **New IPC channel** `session_tail`: flat arguments (R6), registered in
  [`scripts/electron-ipc-contract.test.ts`](../../scripts/electron-ipc-contract.test.ts)
  `current` in the same task that adds it.
- Pane → session mapping reuses
  [`electron/resume/resolve.ts`](../../electron/resume/resolve.ts) `current`,
  the resolver `resume_lookup` already uses for session restore.
- The main process reads the session file **backwards to the last message
  record** — a codex rollout ends in event records, so a naive tail returns
  bookkeeping, not a sentence.
- The renderer refreshes a pane's tail when that pane's snapshot `revision`
  changes, never on a timer.
- Coverage: claude and codex are the two that certainly work. opencode is
  investigated during implementation. gemini, agy and declared agents fall
  back to **the tab title**, which is what the row shows today.

### Tier 4 — rules and docs

- `docs/DESIGN-LANGUAGE.md`: new **§26** (§25 is History rows) for this row
  genre, carrying three amendments in one section:
  - **DL-3.2** gains `--yellow`: _an agent is waiting on you_, one step below
    `--red`'s failure. Never decoration.
  - **DL-1.2**'s 300ms cap gains one scoped exception: the 1500ms focus ping,
    a locator rather than a state change. Nothing else in the app inherits it.
  - **DL-1.3** is _not_ amended. The ping stays an inset hairline; the ban on
    blurred and offset shadows holds, and the spec records that a real glow was
    considered and refused.
- `AGENTS.md`: amend the 2026-08-15 TabStrip fork, record this one.
- `docs/CONTEXT.md`: the completion entry, with evidence.

## 6. Hover actions

Rename, recolour and close are revealed by hover and focus alike; they are
keyboard reachable through the row's own focus, and the row keeps its
accessible name unchanged. **Amended by §2.5:** they used to swap in over the
age + mark pair at the name line's right edge. The age has left that line, so
they sit at the meta line's trailing end instead, in space it reserves at rest
— the actions must never cover an agent chip, which is a target rather than a
readout, and reserving on `:hover` alone would be a reflow.

## 7. The yellow rule

DL-3.2 gives `--green` and `--red` roles and says nothing about `--yellow`,
while `--status-unread` and `.attn-mark--warning` already paint with it. The
DL amendment reads: _`--yellow` means only "an agent is waiting on you" —
attention that a person must answer, one step below `--red`'s failure. Never
decoration._

## 8. Archived workspaces

The old rail could resume a workspace with no open tab; a tab-shaped rail has
no row to hover. **Archived workspaces render as quiet rows at the
bottom of the stream**, below the live ones, with a resting mark and their
last known project name — pressable to resume. This matches the 83%
same-day-return measurement: yesterday's project is a likely next destination,
not an archive to be dug out of the Open board. Owner-approved
2026-08-16. They carry no message line: no live pane has said anything.

## 9. Out of scope

- Tauri. Electron only; no Tauri implementation is planned.
- Non-agent panes (shells, test runners) as rows. The rail answers "which
  agent"; a `vitest` row is noise. They still count toward a tab's pane count.
- Any telemetry.
- Reviving the mode switch, the density grid, or worktree-first navigation.

## 9a. Working alongside a parallel session

A second session is editing this repository (2026-08-16). The owner chose to
proceed anyway, so the plan commits in small, independently revertable steps
and touches `app.tsx` in exactly one task rather than across several.

## 10. Verification

`npm test && npm run build && npm run generate:menu:check`, plus
`npm run electron:build` once tier 3 touches `electron/`.

Automated checks do not establish native visual correctness. **Sequencing
gate: tier 1 gets a native `npm run electron:dev` pass and the owner's eye
review before tier 3 starts.** Full scope was approved; that does not make the
rendered-UI gate optional, and it is cheaper to discover a wrong rail before
the backend work than after.

## 11. Open questions

| Question                                                                    | Owner          | Blocking                           |
| --------------------------------------------------------------------------- | -------------- | ---------------------------------- |
| Does opencode store a readable conversation file?                           | implementation | Tier 3 only                        |
| Does a red mark with no word read as failure at a glance?                   | owner          | No — revisit after the native pass |
| Long worktree names truncate at 276px; middle-ellipsis, own line, or leave? | owner          | No                                 |

## 12. Implementation status

**The gallery specimen is complete and owner-approved (2026-08-16)**: row
shape, state marks, the yellow/accent split, per-row disclosure, clickable
agent chips, worktree suffix, the mounted-in-the-window-shell view, and the
1.5s focus ping against a real pane grid. It lives in
[`src/gallery/agent-status-rail.tsx`](../../src/gallery/agent-status-rail.tsx)
`current` and is reachable at `npm run prototype:gallery` → navigation.

**Nothing is implemented in the app.** No file under `src/ui/`,
`src/repositories/`, `src/terminal/` or `electron/` has changed, no
`session_tail` channel exists, and the specimen's conversation lines are
seeded strings. Approval covers the design, not a shipped rail.
