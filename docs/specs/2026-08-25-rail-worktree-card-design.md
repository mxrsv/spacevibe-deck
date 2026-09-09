# The rail's worktree card — design

Date: 2026-08-25
Status: `proposed`. Every visual decision below was taken by the owner in chat
on 2026-08-25 against a live gallery specimen; **nothing is implemented**, the
busy hue is undecided (§7.3), and the model work in §11 is the real cost.
Scope: the rail's view model, its component and its stylesheet — plus, unlike
[the worktree tier](2026-08-25-rail-worktree-tier-design.md) `decided`, new data
the rail does not currently receive (§11). Renderer only by code; Electron-only
in effect for the same reason the tier is (§14).

## 1. The change in one sentence

**The box moves up a tier: a CHECKOUT becomes a card that opens onto its agents,
and the tab tier leaves the rail entirely.**

The specimen is `src/gallery/rail-worktree-cards.tsx` and
`src/gallery/rail-worktree-cards.css`, mounted in the gallery's `navigation`
section as two specimens — the card itself and the colour rule's three
candidates. Both are live components, not drawings; every figure in §10 was
measured off them in Chrome at `--sidebar-w`.

This document supersedes parts of
[the worktree tier spec](2026-08-25-rail-worktree-tier-design.md) `decided`,
which shipped hours earlier on the same day: its §5 sub-header becomes a card,
and its §7 "one left edge, no indentation" survives only for the bare row. It
does **not** supersede that spec's model work — `RailWorktreeGroup`, its
ordering and its empty-group rule are the foundation this builds on, and §11
lists what has to be added to it rather than replaced.

## 2. The delta

| | Today (`decided`, shipped) | Proposed |
| --- | --- | --- |
| Tiers | project → worktree sub-header → tab row → agent leaf rows | project → **worktree card** → agent row |
| The worktree tier is | a bare label with one `+`, no caret, no box (DL-27.23/27.24) | a **card**: a boxed, pressable, expandable object |
| The tab tier | one row per tab, carrying that tab's loudest agent's newest sentence (DL-27.15) | **gone from the rail** |
| Multi-agent tabs | leaf rows inside DL-27.19's neutral frame, riding `data-headless` | every agent in the checkout is a peer row; no frame, no tree |
| What a row says | the agent's newest turn (DL-27.15) | glyph · pane label · **model** pill · loading mark |
| A closed worktree | n/a — the tier never collapsed | mark · name · **branch badge**, then the age, then a segmented agent strip |
| A checkout with nothing running | the sub-header alone (tier spec §6) | the same row minus the card |
| Selection | one row washed on `--tab-active-bg` (DL-21.1, DL-27.22) | the focused agent row keeps its wash **and** the active checkout takes an accent frame |
| State marks | one 14px box per row: red · yellow · spinner · gray (DL-27.3) | a 5px badge on the glyph's corner, plus a loading mark and a rim glow |

The tab tier's disappearance is the load-bearing change. Everything else in this
document is a consequence of it or a treatment on top of it.

## 3. The unit: a card is a checkout, and its rows are panes

Deck's model is **project → worktree → tab → pane**. This collapses the middle
two: a card is a worktree, and its rows are every agent pane running in that
worktree regardless of which tab holds it.

The evidence is in the owner's own mockup. One row reads **`Claude (Split)`** —
that is a *pane* label, not a tab name. A design where a card is a tab has no
reason to distinguish two panes of one agent; a design where a card is a
checkout has to, because two panes of `claude` in one worktree are told apart by
nothing else. Today's rail solves the same problem with the turn text (DL-27.15),
which is exactly the line this design removes.

Two consequences, both deliberate:

- **A tab is no longer addressable from the rail.** Today a rail row *is* a tab
  and clicking it selects that tab. §12 states what a card press and an agent-row
  press each do instead.
- **`RailTabRow` stops being the rail's unit of render.** It is not deleted — the
  model still has to walk tabs to find panes — but nothing on screen corresponds
  to one.

## 4. The card, closed

Three parts, top to bottom.

**The head** is `mark · checkout name · branch badge`, and nothing else.

- The mark is a 9px disc in a 14px box, matching `.asr-row__mark`'s box so a
  spinner could take its place without moving the name. Neutral at rest; the
  **busy** hue when work is moving in this checkout (§7).
- The name is the checkout's **directory basename**, at `--type-body` (12.5px).
- The branch is a **badge** at the trailing edge, on the same row as the name
  (`GitBranch` glyph + branch, `--type-micro`, capped at 132px with ellipsis).

**There is no caret and no age on the head, and neither was a choice.** §10
records the measurement: at 275px the head has 213px for a name and a branch,
and with a caret present every name truncated and two of three branches
truncated too. The caret's 19px is almost exactly the deficit. The reference's
own worktree row carries no caret either — the whole card is the button — so the
disclosure now has **no glyph**. That is a real loss of affordance, named here
rather than glossed, and it was the cheapest thing on the row to give up.

**The meta line** is the age alone, indented 22px to align under the name. It
briefly carried the path and an agent count; the owner cut both — the count is
said again two rows down by `N active`, and the path is derivable from the
checkout name under a header that already names the repository.

**The agent strip** is one segmented bar: per segment, the agent's brand glyph
plus a live mark, divided by full-height 1px rules, **with no agent name**. It
caps at `STRIP_VISIBLE = 3` and folds the rest into a trailing `+N` segment in
`--accent`. The name survives in each segment's `title` beside the state word,
which is DL-27.2's rule that the mark is the fast read and never the only read.

A **compact** card — a closed card while a sibling is open — is the head alone.
It carried an age until the branch badge took the room: `chore/docs-update` is a
124px badge, which left 61px for a name needing 84 and clipped `docs-update` to
`docs-up…`.

## 5. The card, open

A plain **list**, under a right-aligned count, closed by a `New agent` row.

- **No tree.** A stem with rounded elbow branches was built and deleted (§8.4).
- **No frame.** DL-27.19's surrounding hairline is deleted too. What the tree and
  the frame were both saying — *these rows belong to that checkout* — the card's
  own box already says.
- Rows carry their own 5% wash with 2px of the card showing between them, so the
  block reads as items rather than one panel.
- The header is the count alone — `5 active`. It had an `Agents` label and the
  owner cut it (§8.6).

**One agent row** is four tracks: `glyph · name · model pill · loading mark`.

- The **state badge** sits on the glyph's bottom-left corner, not in a leading
  track of its own — the same idiom `gxs-lad__glyph[data-badge]` already uses in
  the simplicity-ladder specimen. Moving it there bought the name 11px.
- The **model pill** is the reference's own trailing slot. §11.2 is where this
  gets expensive: Deck does not know it.
- The **loading mark** sits after the model pill, in a **fixed 12px track that is
  reserved even on rows that draw nothing**. With `auto` the track collapsed on
  an idle row and pulled that row's pill 12px right of the pills above it, so a
  still list read as a ragged right edge.
- The whole row is the button. The reference draws no trailing control, and a
  separate focus glyph on an already-pressable row is an affordance for something
  already pressable.
- The focused agent keeps DL-27.22's wash, one step brighter, and brightens its
  model pill's ink. `aria-current` marks it.

## 6. The bare row — a checkout with nothing running

The card's head row, minus the card: `mark · name · branch badge`, no box, no
meta, no strip. It went guide → rounded elbow → **nothing**, so what places it
under the project is column alignment alone — it shares the head's 14px mark
track and its gap, which is the tier spec's §7 one-left-edge rule surviving in
the one place the card does not cover.

The tier spec's §6 filter is unchanged and still does the work:
`filterRailToWorkspaceHistory` already answers *"open, or in Deck's history"*, so
a sibling checkout the user has never opened stays invisible and one they have
worked in stays reachable with nothing running.

## 7. The colour rule

The owner's ask was literal: *"chúng ta phải có quy định về color"*, after seeing
green on one busy row and purple on another. It was **two faults**, and both are
resolved here rather than left as options.

### 7.1 The rule

**One hue, one meaning, and no hue used twice.**

| Token | Means | Drawn on |
| --- | --- | --- |
| `--gxwc-busy` | the machine is working — `running` **and** `thinking`, one hue | head mark, row badge, loading bars, rim glow, beam |
| `--status-unread` (yellow) | waiting on **you** | row badge, strip dot |
| `--red` | failed | row badge, strip dot |
| `--green` | the **active checkout** — a place, not a state | card frame, that card's branch badge |
| `--accent` | a **count** (`+N`) — nothing any agent is doing | strip tail |
| neutral | idle, done, and every resting surface | resting head mark, washes, hairlines |

### 7.2 Why, precisely

- **Two hues for one category.** `running` was `--green` and `thinking` was
  `--magenta`. They differ in what the agent is doing, not in whether it is your
  turn, so two colours made two rows in one category read as two categories.
- **`--green` was doing double duty.** It was the `running` hue *and* the active
  card's frame, so *"this agent is working"* and *"this is the checkout you are
  in"* were the same colour. This is the fault the owner actually saw. Green now
  means the active checkout and nothing else.

A third instance of the same discipline, applied to a property rather than a
hue: the active card's **background tint is gone and only its border is accent**,
so the *background* says open-or-closed (`--tab-rest-bg` / `--tab-active-bg`) and
the *border* says active.

### 7.3 The busy hue is OPEN

Three candidates are drawn in the gallery's `the colour rule` specimen. They
differ by exactly one `--gxwc-busy` line; everything else is identical, and every
mark that means busy changes with it.

| | Hue | For | Against |
| --- | --- | --- | --- |
| **A** *(specimen default)* | neutral, `--tone` at 62% | Adds **no rule**. DL-27.3 already admits red, yellow and neutral. Colour stays reserved for the two states that want your eyes, and the bars still move | Busy is the most common state and it becomes the quietest ink in the column |
| **B** | `--magenta` | Loudest separation of the three | `--magenta` has been out of chrome since DL-3.6 went neutral (2026-08-17). A rule change, not a token pick |
| **C** | `--cyan` | The same trade, cooler | Nearest of the three to `--accent`, so a busy segment and the `+N` tail sit closer than two unrelated meanings should |

**No recommendation is made here.** The choice is a hue in the eye, which is why
it is drawn rather than argued; §13 keeps it open.

## 8. Motion, and what was built and reversed

A busy agent carries **two** kinds of motion. Both are `no-preference`-gated:
motion is ADDED under `prefers-reduced-motion: no-preference` and never switched
off below it, which is the unread ripple's own convention — so with reduced
motion the marks stand still and remain legible rather than vanishing.

### 8.1 The rim: a static glow plus a travelling beam

- **Part one, always on:** an inset two-part `box-shadow` on the row — a 1px
  hairline plus a **9px blur**, both in the busy hue. Present in every state
  including reduced motion.
- **Part two, the motion:** a `conic-gradient` arc masked to the row's 1px border
  (`mask` + `mask-composite: exclude`, the standard gradient-border trick) whose
  **angle** is animated `0deg → 360deg`, `linear`, 2.6s, forever.

Rotating the element's `transform` would rotate its rounded rectangle and the rim
would stop following the corners, so the **gradient angle** is animated instead —
which requires `@property --gxwc-beam { syntax: "<angle>" }`, because a plain
custom property interpolates discretely and the beam would step rather than
sweep.

**The cost is real and is stated, not glossed:** an animated custom property
re-rasterizes the gradient every frame rather than riding the compositor, so this
is the most expensive loop in the specimen. It is also the only one that can be
perfectly seamless — `linear` over a full turn has no easing and no endpoint, so
0deg and 360deg are the same picture and the loop never visibly restarts.

That seamlessness is the whole point. The rim began as **one** part animating
`opacity` 0.22 → 1 → 0.22 and the owner read it as blinking. Two things caused
that and both are gone: the **amplitude** (a 4.5× swing reads as the rim leaving
and returning, so nothing animates opacity now at all) and a **velocity break at
the peak** (a `0% / 50% / 100%` keyframe set with an ease on each segment
decelerates *into* 50% and accelerates out of it — two visible stops per cycle).

### 8.2 The loading mark: three bars, one shape

Three bars of different heights, `scaleY` on a 150ms stagger, 900ms alternate —
`wschase`'s own technique in `02-shell.css` transposed from opacity to height.
`transform` only, no gradient, no blur.

**One shape for every busy state.** A dotted rotating ring stood beside it for
`thinking` and is deleted: two shapes made a running agent and a thinking one
read as different *kinds* of thing when the only difference is which state they
are in.

The bars appear in **both** card states — in a collapsed card's strip segment and
after the open row's model pill — so an agent looks the same whichever state its
card is in.

### 8.3 The loop budget, measured

| Per busy agent | Loops |
| --- | --- |
| Rim beam | 1 |
| Loading bars | 3 |
| **Total** | **4** |

The gallery specimen runs **14 concurrent loops** as drawn (measured), across a
collapsed card and an open one. The cheapest reduction, if that is too much, is
dropping the bars to a single pulsing bar — 4 loops per agent becomes 2.

### 8.4 Reversals, recorded as history

Everything in this list was built, seen and removed the same day. None of it is
current behaviour, and none of it is parked in the specimen.

| Built | Removed because |
| --- | --- |
| A tree: stem + rounded elbow branches joining the agent rows | Owner: no tree UI. The card's box already says the rows belong to it |
| A shimmer sweep — a 55% gradient translated across each busy row, 1.9s | Owner. It was the second loop saying the same thing; `overflow: hidden` went with it |
| An opacity pulse on the rim, 0.22 → 1 → 0.22 | Owner read it as blinking (§8.1) |
| A dotted rotating ring for `thinking` | Owner: one loading icon for all (§8.2) |
| Two busy hues, green and magenta | Owner (§7.2) |
| An `AGENTS` group label | Owner. Dropping it also sidesteps DL-4.3's closed uppercase exception, which the reference's own casing would have reopened |
| Path and agent count on the meta line | Owner (§4) |
| The head's caret | Forced by measurement (§4, §10) |
| The active card's green background tint | Owner: border only (§7.2) |
| A leading track for the state dot | Owner: badge the glyph's corner (§5) |
| Radius 12px on the card, 8px on rows, 4px on glyphs | Owner: 6px everywhere, then 3px on the two small pills (§9.7) |

## 9. Design language — every fork

[`AGENTS.md`](../../AGENTS.md) `current` lists *"a rule in
`docs/DESIGN-LANGUAGE.md`"* as a fork category. This change touches **eight**
rules across four sections, and two of them are broken for the first time in the
app's history. Each row below carries what it costs and the cheapest way back.

### 9.1 DL-27.15 — the row's line

**Reversed.** The row's one line carries the agent's newest turn, and the owner
asked for that line on 2026-08-17, overriding the rail spec's own §2.6. The card
row carries the pane label and its model; the sentence is gone from the rail
entirely.

*Cost:* `session-tail`'s whole purpose — the per-pane sentence, its two-pass
pairing and its `preferredId` pinning (2026-08-22) — no longer has a consumer in
the rail. That machinery still feeds the tab strip's chips via `tabTail`, so it
does not become dead, but the rail stops being the reason it exists.
*Cheapest revert:* the sentence would have to displace the model pill; there is
no room for both at 275px (§10).

### 9.2 DL-27.19 — the multi-agent frame

**Deleted.** The neutral rounded frame around a multi-agent tab's rows was added
2026-08-20 from the owner's own sketch, after four passes had stripped the tab
tier. With no tab tier there is nothing for it to group.

*Cost:* a rule shipped five days earlier is retired. *Cheapest revert:* it rode
the `data-headless` seam `PANE_TREE_HIDDEN` produces, and that seam is untouched.

### 9.3 DL-27.23 / DL-27.24 — the worktree tier

**Amended, both.** DL-27.23's three tiers become project → worktree → agent.
DL-27.24 is the harder one: *"a worktree group is a label, not a control. It
carries its branch and one launcher; it does not collapse, select or close."*
A card collapses **and** selects.

*Cost:* the tier spec is one day old and its §14 explicitly listed *"collapsing a
worktree group, and the persisted state it would need"* as out of scope. That
scope line is reversed. *Cheapest revert:* none — this is the change.

### 9.4 DL-27.3 — the mark palette

**Amended, four ways.** The rule as written says: `failed` is `--red` · `asked`
is `--status-unread` with the 2026-08-25 radiating halo · `working` **is not a
dot at all**, it is `WorkspaceSpinner` in a 14px box · `done` and `idle` share
one gray dot at `--tone` 45% · every mark occupies ONE fixed 14px box so row
geometry never moves between states.

The card diverges on all five clauses:

1. `working` is drawn as bars + a rim glow + a beam, not as the spinner.
2. `idle` paints **nothing** where the rule paints a gray dot.
3. A fifth state, `thinking`, is introduced — see §11.3, it does not exist.
4. Marks are no longer one 14px box: a 5px badge hangs off a glyph corner and a
   12px bars track sits at the row's tail.
5. The `asked` halo has nowhere to land — the badge is 5px on a glyph corner, and
   the halo is geometrically sized against the rail list's left edge.

*Cost:* the loudest-wins fold (`failed > asked > working > done > idle`) still
applies at the card's head mark, but the card's head only distinguishes
busy-from-not. *Cheapest revert:* keep the badge and re-adopt the spinner for
`working`, which drops §8 entirely.

### 9.5 DL-21.1 — selection

**Broken, on two clauses at once.** The rule reads: *"Selection is a full wash on
`--tab-active-bg`, at `--radius-control`, and nothing else. **No accent bar, no
border, no fill of `--accent`, no shadow.**"* Its one scoped exception
(2026-08-16) is the tab strip's chips taking a **neutral** 1px frame, earned
because a chip floats alone with no list around it.

The active card takes an **accent border**. That is the banned property *and* the
banned colour, on an object that sits in a list — the exact case the exception
was reasoned around.

*Cost:* hue re-enters selection, which is precisely what DL-21.1 exists to
prevent so that hue stays available for state. §7's rule contains the damage by
reserving `--green` for this and nothing else, but the rule itself moves.
*Cheapest revert:* `--hair-strong` instead of green — one `color-mix`. The card
then marks active with the same neutral frame a chip uses, and green leaves the
palette.

### 9.6 DL-1.2 — motion

**Two new scoped exceptions, the third and fourth.** The rule bans infinite
animation and bans motion while the user is idle. The two on the books are
DL-18.11's working spinner and DL-27.3's unread ripple, and **each is one loop**.

- **Third:** the rim beam — one loop per busy agent.
- **Fourth:** the loading bars — three loops per busy agent.

*Cost:* stated in §8.3 — 4 loops per busy agent, 14 in the specimen as drawn.
Unlike both existing exceptions this scales with the number of agents, which is
the thing to decide rather than a detail. Both obey DL-18.11's *shape* (bound to
a state whose removal ends them) and the bars are `transform`-only; the beam is
the one that re-rasterizes.
*Cheapest revert:* drop the bars (−3 per agent) and keep the rim.

### 9.7 DL-1.3 — the `box-shadow` clause

**Broken for the first time in the app's history.**

The clause bans blurred and offset `box-shadow` outright, and permits
`inset 0 0 0 1px` *precisely because it paints no blur and costs no compositing
layer*. The 2026-08-16 amendment that opened `backdrop-filter` for the modal
scrim states that the `box-shadow` clause is **unchanged**. And it is the ground
the unread mark's candidate B — a layered non-blurred glow — was turned down on,
hours earlier on 2026-08-25.

The static rim glow's second line is `inset 0 0 9px`. That is the break.

*Cost:* the app's flat-system claim — *"depth comes from background steps and 1px
hairlines"* — stops being true of chrome. *Cheapest revert:* delete the second
`box-shadow` line. The first is the permitted hairline, the beam is a gradient,
and DL-1.3 is intact again with the rim reduced to a travelling highlight on a
1px frame. **This is the cheapest revert in the whole document and it costs one
line.**

`mask` is used but is not `filter`, so DL-1.3's `filter` clause is untouched.

### 9.8 DL-20.1 — radius

**Broken.** The rule is *"four radius roles, and no fifth picked at a use site …
a value chosen by feel at a use site is not part of this scale."* The specimen
uses **6px** on every box and **3px** on the two small pills. Neither is a rung:
the scale is 2 / 8 / 10 / 12.

Both values came from the owner directly — 6px replacing a round-everything pass
where `--radius-surface` on the card and `--radius-tight` on a 28px row read as
pills at rail width, then 3px for the branch badge and model pill because at
~17px tall a 6px corner is ~35% of the box and reads as a near-pill.

The reasoning is defensible as *one radius at two scales* — corner proportional
to box — and it is worth noting that **6px was `--radius-control`'s own value
until 2026-08-14**. But DL-20.1 as written admits neither, so shipping this
either picks existing rungs or adds a rung and rewrites the rule.
*Cheapest revert:* `--radius-tight` (8px) on boxes, `--radius-flat` (2px) on the
pills. Both are pinned to one variable each, so it is a two-line edit.

### 9.9 DL-4.1 and DL-4.3 — not built, on purpose

Two places where the reference was **not** followed, so no rule moved:

- **DL-4.1** — *"the monospace face belongs to the terminal, and nowhere else."*
  The reference sets the branch badge in monospace. It is drawn in `--ui-font`;
  chrome declares no `--mono` token at all. Making it faithful is one
  `font-family` and a rule change.
- **DL-4.3** — uppercase as a styling device is banned and §16's exception is
  CLOSED. The reference prints `AGENTS`. The label was **dropped** rather than
  either reopening the exception or shipping a sentence-case near-miss.

Both are recorded so that a later "just make it match the reference" does not
reopen a closed rule by accident.

### 9.10 What is NOT touched

DL-27.22 (the focused-agent wash) is **kept**, unchanged, and is the one §27 rule
this design adopts rather than moves. Also untouched: PTY ownership, process
classification, the window coordinator, tab materialization, layout, close/quit
coordination, IPC, the keymap, and any sibling repo. The settings schema is
touched only if §11.2 resolves toward storing a per-pane model.

## 10. Measurements

Every figure was read off the live specimen in Chrome at `--sidebar-w` = 275px.
Card content width is 239px; the head's usable run for name + branch is 213px.

| Measurement | Value | What it decided |
| --- | --- | --- |
| Head run for name + branch | **213px** | With a caret present *every* name truncated and two of three branches did too. The caret's 19px is the deficit — that is why it is gone |
| `ai-terminal` + `feature/ai-terminal` | fits, nothing cut | The design only works for **short** worktree basenames |
| `bench.ai-terminal` + `feature/ai-terminal` | **both truncate** | A checkout named after its project — *the reference's own shape* — does not fit. §13 keeps this open |
| `chore/docs-update` badge | 124px, leaving 61px for a name needing 84 | Why a compact card has no age |
| Three **named** agent chips | needed **218px of 199** | Why named chips became the nameless strip |
| Three strip segments + `+2` | **155px of 239** | The strip fits with room |
| Model pill right edges | identical across all five rows | Why the loading mark's track is a fixed 12px, not `auto` |
| The deleted shimmer sweep | invisible at 11% of `--tone`; needed **26%** | Recorded so nobody re-derives it |
| Concurrent animation loops | **14** in the specimen; 4 per busy agent | §8.3 |
| Radius values in the sheet | exactly two — 6px and 3px — plus `50%` on actual circles | Audited; §9.8 |

## 11. What is NOT designed yet

**This is the real cost of shipping, and it is larger than the CSS.** The
specimen is a hand-built fixture with no model behind it: `CardStatus`,
`CardPane`, `WorktreeCard` and `BareWorktree` are local types in a gallery file,
and `CLUSTER` is a literal. Every gap below has to close before any of §4–§8 can
render from real data.

### 11.1 `RailWorktreeGroup` has no card shape

Today it is `{ key, branch, path, primary, rows: RailTabRow[] }`. The card needs,
at minimum: the checkout's **directory basename** as a field distinct from
`branch` (§3 — the group currently *falls back* to basename when git reports no
branch, which is not the same fact); a **flat list of panes across the group's
tabs**, which means walking `rows[].panes` and flattening; a **live** flag for
the head mark; and an ordering for the flattened panes that does not exist today
(`sortByOpenOrder` orders tabs, not panes across tabs).

### 11.2 There is no per-pane model

`PaneView` is `{ paneId, agent, attention, phase, hasRun, changedAt, focused }`.
**No model.** `RailPaneRow` adds `state`, `message`, `age`. **No model.**

Settings does not close this either. `agentModels` is
`Readonly<Record<string, readonly string[]>>` — the *list of model names the user
declared* per agent id, existing because no CLI enumerates them. It is not
"which model this pane is running". `agentRuntimeDefaults` is
`Record<string, { model, effort }>` — a **default** per agent, not a fact about a
live pane.

The launcher (2026-08-24) *does* choose a model per task. So the honest options
are: (a) thread the launched model down to the pane and expose it on `PaneView`,
which reaches tab materialization — a fork category in its own right; (b) show
the agent's runtime default and accept that it is wrong whenever a launch
overrode it; or (c) drop the pill. **The pill is the reference's own trailing
slot, so dropping it is a visible design change, not a simplification.**

### 11.3 `thinking` does not exist anywhere in Deck

`RailState` is `"failed" | "asked" | "working" | "done" | "idle"`.
`AgentPhase` — what the detector actually produces — is
`"unknown" | "idle" | "working" | "exited"`. **Nothing distinguishes thinking
from working**, at any layer, and no source of that distinction is proposed here.

So `thinking` must be either **derived** (from what? the specimen offers no
answer) or **dropped**. It is worth stating the consequence plainly: **if
`thinking` is dropped, §7.3's question dissolves.** There is then exactly one
busy state, one hue is trivially enough, and the whole two-hues-for-one-category
fault the colour rule was written to fix could never have occurred. That makes
"drop `thinking`" the cheapest resolution of §7.3 as well as of this gap — and it
is the recommendation this section makes, the only one in the document.

### 11.4 `+N` has no rule in the model

`STRIP_VISIBLE = 3` is a constant in a gallery file. Which three? The specimen
takes `panes.slice(0, 3)` — source order. A shipped version needs a stated
precedence, and the obvious candidate is DL-27.3's own loudest-wins fold
(`failed > asked > working > done > idle`) so the three shown are the three worth
seeing. §13 keeps the cap open.

### 11.5 `New agent` has no destination

The row is inert in the specimen. It should reuse the seam the tier spec's `+`
already uses: `onNewTabIn(path)` with the worktree's path, which
`quickPickerWorkspace` ([`events.ts`](../../src/chrome/events.ts#L39) `current`)
already pins and `openQuickAgent` already accepts as a destination overriding
both cwd and workspace tag. **No new prop and no new seam** — this is the one gap
with an off-the-shelf answer.

### 11.6 Collapse needs persisted state

DL-27.24 said a worktree group *"does not collapse"*, so nothing stores which
card is open. `toggleGroup` is keyed on the repository and its state is
window-local. A card's open/closed state is per-checkout and the owner will
expect it to survive a re-render; whether it survives a restart is §13.

## 12. Selecting: what a press does

Not designed, and it must be before implementation, because §3 removed the thing
the rail used to select.

- **The card head** currently toggles open/closed. It does not select. But the
  card also carries an `active` frame, which implies a checkout *can* be
  selected — by what gesture is unstated.
- **An agent row** is a button with `aria-current`. The obvious behaviour is the
  shipped `onFocusPane(index, paneId)`: activate that pane's tab, focus the pane,
  ack it. That seam exists and needs no change.
- **A tab is unreachable.** Today a rail row selects a tab. Nothing in the card
  design does. For a tab holding one agent this is invisible — focusing the pane
  activates the tab. For a tab holding a plain shell beside an agent, the shell
  has no row and no way in from the rail.

## 13. Open questions

1. **The busy hue** — A neutral, B `--magenta`, C `--cyan` (§7.3). Drawn, not
   decided. One line.
2. **Does an open card compact its siblings?** The owner's two mockups disagree:
   image 1 keeps all three lines on every closed card, image 2 drops them to one
   line. **Both are drawn** in the specimen so the choice is visible. This is
   either an accordion behaviour or a mockup inconsistency.
3. **Should the glow be OUTER rather than inset?** *"Around"* reads as outer. It
   had two blockers and one is gone: deleting the shimmer removed
   `overflow: hidden`, so the row no longer clips its own pseudo-elements. The
   remaining blocker is the **2px row gap** — a blur of any useful radius smears
   one row into the next. Going outside now costs only a bigger
   `--gxwc-row-gap`.
4. **Is `+N` capped at 3 correctly, and which three?** §11.4.
5. **Long checkout names.** `bench.ai-terminal` truncates both strings and it is
   the reference's own shape (§10). Options: shorten the name against the project
   header's word, drop the name and let the branch badge be the identity (which
   is what DL-27.23 does today), or accept truncation.
6. **What selects a checkout** (§12).
7. **Does a card's open state persist across restart?** (§11.6)
8. **Does `thinking` survive at all?** (§11.3 — recommendation: no.)

## 14. Host scope

The code is renderer-only, so it runs under both hosts. The **data** is not:
`git_repository` is Electron-only, so under Tauri every scan answers `plain`, a
project has one implicit unlabelled worktree, and there is no branch to put in
the badge. That is the tier spec's §12 parity gap inherited unchanged — a named
gap, not an implied both-hosts claim. Windows is Gate C, as always.

## 15. Verification state

**Everything is gallery-only.** Stated plainly because the evidence class here is
weaker than the change deserves:

- Browser measurement and screenshots of the live specimen, in **both themes**
  (`deck-dark`, `deck-light`) and **both motion modes** (`no-preference`,
  `reduce`).
- Computed-style audits: every radius is one of two tokens or `50%`; `running`
  and `thinking` resolve to the same hue in all three palette columns; the static
  glow is present under reduced motion while the beam is absent; the model pills
  share one right edge; exactly one row is washed; no element overflows and the
  document does not scroll horizontally.
- A click-test of the card toggle.

**Not run, and owed before any completion claim:** `npm test`, `npm run build`,
`npx tsc --noEmit`, `npm run electron:build`, the design-language gate,
`npm run lint` (whose baseline exits 1 on a clean tree, so only new findings
count), a native `npm run electron:dev` pass, and the owner eye review (DL §9.6)
of a **running app** rather than a gallery specimen. No card has ever been
rendered from real data, because there is no real data (§11).

## 16. Risk note for whoever implements this

**This checkout is shared with other sessions.** During the session that built
the specimen, its files were **silently reverted three times** mid-work: the
meta line lost its path and count spans, the `Agents` label disappeared from the
markup, and `.gxwc-agents__head`'s grid rule reverted to a `flex-end` version
that rendered `Agents3 active` with no gap. One reverted revision also rewrote a
doc comment to attribute a decision to the owner that the owner had not made.

Two consequences:

- **Diff against the gallery files before trusting any summary**, including this
  spec. §4–§8 were written from the on-disk files, but the files can move.
- Prefer harness-tracked edits over scripted rewrites. Scripted rewrites through
  a shell were the mechanism that lost content silently in that session, which is
  the hazard the repo's own note on `Edit` over `sed`/`python` already records.

## 17. Out of scope

- **A worktree-scoped ✕.** Inherited from the tier spec's §14. A card is a
  stronger invitation to close a checkout than a bare label was, but it still
  needs a `CloseCoordinator` method and a busy-dialog census over one worktree's
  panes.
- **Dragging cards**, within or between clusters. `rail-order.ts` still orders
  clusters only.
- **Branch metadata** — ahead/behind, uncommitted count, diff size. The
  reference shows `Dirty · +3 · Updated 2m ago` on its worktree row and this
  design draws only the age. Each figure is another git invocation per worktree
  on a cadence this design does not have.
- **Creating a worktree from the card.** `New agent` opens the launcher, which
  already owns the create-worktree subview (2026-08-24).
- **The tab strip.** `tabTail` keeps printing the agent's sentence on chips; this
  changes the rail only.
- **Tauri.**
