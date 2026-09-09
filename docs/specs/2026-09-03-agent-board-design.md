# Agent Board — design

Date: 2026-09-03
Status: `decided` — the direction was chosen by the owner in chat on
2026-09-03 against a reference image — a headless fleet dashboard drawn as a
card grid, a status-counting left nav and a right detail panel — with the
instruction to take its **style and layout only, never its features**. The
three forks this document could not settle alone (§3) were put to the owner
the same day, and later the same day the whole document was grilled with the
owner in two rounds — 24 questions, every recommendation accepted — recorded
in §17 and folded into the sections they touch. **Committed on the owner's
"execute the spec" instruction (2026-09-03, `be03646`) before the owner's
read of the text (D14's residual risk, named)**, and that read has an
object: four design-language amendments entered the ledger (§10) through a
Codex review pass the same afternoon and were NOT put to the owner in the
grilling — DL-1.2 (a fourth spinner exception), DL-3.4 and DL-4.4 (the nav
label's size and tone), DL-21.7 (the card wash) — as did the
`hostHasAgentBoard` predicate and the three-signal store (§4.2); each is a
fork by `AGENTS.md` and stands only once read. **Build state (2026-09-06): both plans are
built.** Part A is the model, store, DL §34 and its gate, the stylesheet, the
four components and a gallery specimen
([plan](../plans/2026-09-03-agent-board-model-and-specimen.md) `building`),
plus the four fixes the owner's eye pass asked for. Part B is the wiring
([plan](../plans/2026-09-04-agent-board-wiring.md) `building`, 17 tasks):
the third strip surface and its chip, ⌘⇧O, the sidebar and dock at width 0,
`agentBoardOpen` and `SessionPane.taskPrompt` in the journal,
`pty_kill_foreground`, and the `acknowledgePane` / `serializePane` /
`paneAlive` / `restartPane` tab-layer seams. Evidence: `npm test` 4436 passed
/ 1 failed (the design-language citation gate at its nine baseline citations,
none of them this work's), both typechecks, `npm run build`,
`npm run electron:build` and `generate:menu:check` green, and a **native
`electron:dev` walk** of §14's acceptance list under an isolated `userData`.
**The owner's eye review is still owed, and one walk step could not be run**:
Restart resuming a real conversation id, because the walk used a
non-billing probe agent that has no session id (§11.11's path is unit-tested
only). Every measurement in this document is a constraint verified against
the specimen, not a figure read off one.
Placement against the freeze: the 2026-09-02 direction
([docs/CONTEXT.md](../CONTEXT.md#finish-the-daily-surfaces-then-ship--2026-09-02)
`decided`) opens no new feature before the rail card, session restore and the
sidebar ship. The Board is a new surface. **This document decides the Board
now; the build was scheduled after that release** — the owner reaffirmed that
placement in the grilling (§17, Q1) — **and later the same day the owner
started the build on `mxrsv/add-board-agent`** ("execute the spec",
2026-09-03 afternoon). Read together: the branch is built now, and
merging or shipping it still waits for the daily-surfaces release; nothing
here asks that pass to carry it.
Tree read: `main` at `57d3f3f` plus its uncommitted tree (the worktree card,
`rail-create-consolidation`, the 2026-09-03 trust audit) — the trust audit's
own convention. This file is written on `mxrsv/add-board-agent`, fast-forwarded
to that `57d3f3f` on 2026-09-03. **The build targets `57d3f3f`, not main's
dirty tree**, and the review of this document (2026-09-03, iteration 1)
found the gap that follows from that: five source files it cites as seams
are MODIFIED in main's uncommitted tree — `agent-rail-model.ts`,
`agent-rail-card-model.ts`, `agent-rail.tsx`, `tab-strip.tsx`, `app.tsx` —
and `subjectWhere` (§5.3) exists only there; three linked documents are
untracked there (the trust audit, the worktree card spec, the Inbox spec),
as is the CONTEXT anchor for the freeze above. So: every seam description
below was read from the dirty tree and re-read against `57d3f3f` by the
review; where the two differ the text says so; the plan re-reads those five
files at plan time; and the Board's model formats its own `where` words
until that work lands (§11.9). Vendoring main's uncommitted work onto this
branch (the `ff5f5a9` precedent) was NOT done — it belongs to other
sessions' in-flight work. Docs are English by R1.
Host: Electron only in effect (§13). Tauri is feature-frozen and lacks every
signal past identity, state and cwd.

## 1. The change in one sentence

**Deck gains a second way to look at live agents — a Board of cards that shows
every agent at once, each card saying who, where and what it is doing without
a click — toggled against the rail, never replacing it.**

The owner's reason, verbatim in intent: most agent-control apps are a sidebar;
Deck's difference is seeing the whole table of agents at once. The three
tiers of looking are **card → right panel → full stage**: a card is the
glance, the panel is a snapshot of the pane's own scrollback beside a reply
box that types straight into its PTY (§7.3 — the live element on loan was the
first draft's shape, and §17 Q16 records why it stepped down to an upgrade),
and the full stage is the terminal Deck has today.

Naming: **Agent Board** is this surface. It is not the **Open Board** (the
start surface, [spec](2026-08-19-open-board-start-surface-design.md)
`decided`) and not the **Prompt Board** (the template popover in
[`prompt-popover.tsx`](../../src/prompts/prompt-popover.tsx) `current`). Three
boards is two too many words; the name is kept because the owner chose it and
because the other two are already in the codebase's comments.

## 2. What the owner decided on 2026-09-03

Recorded here because no repo document held it before this one.

- **Style and layout from the reference; features not.** Dark plane,
  monospace, hairlines, numbered cards, a nav that counts by state, a detail
  panel on the right.
- **Three tiers:** collapsed card → right panel (the real terminal, shrunk,
  plus a reply box writing to the PTY) → full stage.
- **A card uses only data Deck actually has:** name, checkout or cwd, one of
  the five state words, the newest turn, uptime. Model appears only when the
  pairing is certain — which today is never (§8).
- **Deck must keep the launch prompt per pane** so a card can print its task;
  an agent opened by hand has only its tail.
- **Dropped from the reference:** Pause, Duplicate, Add Note, Tags,
  Favorites, Templates, the account row, usage %, context tokens, `step 3/7`
  progress, structured logs. **Kept:** Stop (kill) and Restart (respawn).
- **`asked` is first class:** its card sorts into the top group and changes
  its frame; its panel opens with the reply box focused.
- **Typography is the reference's:** mono everywhere on the Board, a
  near-flat size, hierarchy from weight, case and tone — the owner's words:
  "remember the font and text styles, very important because most of the
  display is text". §9 is that decision and the two DL rules it amends.
- **Colour maps onto `docs/DESIGN-LANGUAGE.md`'s tokens.** No new palette.
- **Three forks, settled the same day** (§3): the Board and the Inbox
  **toggle**; the Board is **opened by hand, remembered, and opens itself only
  at boot**; the left nav is **STATUS, then PROJECTS**.

**Amended in the same day's grilling (§17), on the owner's word:** tier 2
shows the pane's real scrollback as a snapshot, not the element itself (Q16);
Restart **resumes** the conversation rather than relaunching it fresh (Q4);
the Board **never opens itself** — it is remembered, and that is all (Q2); and
a card **outlives its agent** (Q3). The bullets above stand as the morning's
record; the sections below carry the amended shape.

## 3. The three forks, and their answers

### 3.1 Relationship to the Agent Inbox spec — they toggle

[The Agent Inbox spec](2026-09-02-agent-inbox-redesign-design.md) carries
`Status: approved by owner 2026-09-02`; the request for this document called
it a draft. Both are true of different things: the Inbox document is an
approved **mockup-phase** decision surface — three CSS treatments of one
left-rail structure, no production change — and its own §6 defers every
production question to an owner eye review that
`docs/daily/2026-09-02/` does not record as having happened. Its production
shape is therefore undecided, and this document does not decide it.

**Owner's answer: the Board and the Inbox can toggle.** So this document
supersedes nothing. The two are **two views over one model**:

| | Inbox | Board |
| --- | --- | --- |
| Where | the sidebar column, beside the stage | the stage itself |
| Shape | project → worktree → agent, as rows (DL-27.23; the rail already has this hierarchy) | a grid of agent cards plus its own STATUS/PROJECTS nav |
| Unit | agent row | agent card — the same pane |
| Bound by | the Inbox spec, once its eye review picks a treatment | this document |
| Shares | `RailState`, `paneState`'s loudest-wins fold, `agent-rail-model`'s pane projection, `session-tail-store`, DL-27.3's marks, DL-27.22's focus wash | the same, read through a second pure projection (§11) |

One toggle (§4.2) switches between them. Whatever the Inbox review settles
about row treatment binds the rail; nothing in it binds the Board, and the
Board's typography (§9) is **deliberately not** the rail's.

### 3.2 When the Board folds to the rail — by hand, remembered

**Owner's answer: manual toggle, remembered; while the Board holds the stage
the sidebar hides; leaving the Board brings the rail back.** The alternatives
— an automatic flip when the agent count crosses N, the Board replacing the
rail, or both surfaces always side by side — were offered and not taken. The
count-based flip was rejected for the reason the 2026-09-02 entry names: the
fourth agent launching would change the whole window under the user, which is
exactly the "press that does not answer" class of surprise that pass exists
to remove.

**The boot rule went in the grilling (§17, Q2).** The morning's answer also
had the Board open itself at boot when restore brought back ≥ N agent panes,
N unmeasured and assumed 4. Two facts retired it. The rule was written as an
OR with the remembered flag, so a user who had closed the Board and habitually
runs ≥ N agents would have it reopened on every boot — a surprise of exactly
the class the count-based flip was rejected for. And the probe the first draft
owed came back the same day and showed that OR would fire on most boots.

**Concurrency, measured 2026-09-03** — the re-run the first draft asked for.
The script lives outside the repo; its method is recorded here. Window
2026-07-17 → 2026-09-03: 49 observable days, 47 active (Claude transcripts
older than 07-17 are gone to retention). Sources: Claude `~/.claude/projects`
(657 intervals), Codex CLI and Desktop rollouts (273), opencode's SQLite (18).
Sub-agent sessions are excluded (730 Claude, 263 Codex) — including them
lifts the median peak from 5 to 8 and the maximum from 10 to 24, so that
exclusion is the decision that matters. An interval is a session split at
idle gaps over 30 minutes, under 60 seconds dropped; a day's peak is the
sweep-line maximum of overlapping intervals.

| | 49-day window | last 14 days |
| --- | --- | --- |
| daily peak p50 / p75 / p90 / max | 5 / 7 / 8 / 10 | 5 / 7 / 7 / 9 |
| days whose peak is ≥ 2 / ≥ 3 / ≥ 4 / ≥ 5 | 87 % / 79 % / 68 % / 55 % | 93 % / 93 % / 79 % / 64 % |
| active minutes at ≥ 2 / ≥ 3 / ≥ 4 / ≥ 5 | 61 % / 43 % / 28 % / 16 % | 58 % / 42 % / 26 % / 13 % |

The minutes-weighted median level is **2**. Two caveats travel with every
figure: it counts ACTIVE intervals, so it is a floor on open panes (a pane
idle at its prompt for 30 minutes counts as absent), and it is machine-wide
CLI use, not Deck panes. Read for the Board: the moment the Board exists for —
five to seven agents at once — is a daily event for this user, and the "1–3
agents" figure the morning's decision leaned on was wrong; but a threshold on
that peak would have fired on two boots in three, which is why no threshold
survives. N is closed (§11.7).

### 3.3 The left nav — STATUS, then PROJECTS

**Owner's answer: two groups, status first.** Because the rail is hidden
while the Board is up, the Board's own nav has to answer "which project" as
well as "what needs me"; a status-only nav would push projects into the grid
as section headers, and a projects-only nav would repeat the rail the toggle
just hid. §6 is the design.

## 4. The surface: where the Board lives

### 4.1 A stage surface, not a full-window screen

The Board is a **stage surface** of DL-18.8's class: it covers
`.stage__surface` exactly as the document and the browser do, cover-don't-
unmount, one chip on the strip (Phosphor `SquaresFour` plus `Agents`), placed
by when it was opened (DL-18.10), reachable by tab cycling, closed by ⌘W. It
enters through the `SurfaceStrip` seam the browser entered through, and that
seam has to widen for it:
[`composeSurfaceStrip`](../../src/ui/stage-surface-strip.ts) `current` knows
files plus exactly one browser slot, and [`TabStrip`](../../src/ui/tab-strip.tsx)
`current` treats every non-file slot as the browser — so a third surface
kind means a generic surface descriptor in both, not a second special case.
`TabManager` still learns nothing about what the surface IS (the R4 seam
that held for documents and the browser), but the composer and the strip
both change — and so do two more places the "exactly one surface owns the
stage" rule is enforced (review finding M8): App's exclusion effect, which
steps the other surfaces back when a store path activates one directly
([`app.tsx`](../../src/ui/app.tsx) `current`), and
[`browserPanelObscured`](../../src/ui/app-policy.ts) `current`, which must
learn `agentBoardSurfaceActive` so the browser's native `WebContentsView`
is hidden under the Board and cannot paint over it (DL-18.8's own
visual-rule-is-implementation-rule).

Rejected: a DL-11 full-window screen with the 2026-08-19 Settings exemption
(covers the frame row, exits by Back and Escape). It would take the strip
away — the chip, ⌘W and cycling are the Board's cheapest ways in and out —
and it would inherit the exemption's two obligations (the traffic-light
footprint and the window drag region) for a surface the user lives in rather
than visits.

### 4.2 The toggle, the chord, and what it remembers

- `toggle-agent-board` is a registry action — the 43rd row of
  [`ACTION_REGISTRY`](../../src/terminal/action-registry.ts) `current`, which
  holds 42 today with `toggle-markdown-view` at row 35 (the first draft's
  "55th" counted nothing in the tree) — with a menu item (R3: regenerate) and
  a chord. **⌘⇧O / Ctrl+Shift+O** (§17, Q14): `o` is unused in both default
  keymaps ([`default-keymaps.ts`](../../src/terminal/default-keymaps.ts)
  `current`, read 2026-09-03; the letters free on BOTH keymaps are `h`, `l`,
  `o`, `r`, `x` — `q` is macOS Log Out and `z` is redo — and `b`, the first
  draft's choice, is `toggle-explorer` on both). A `CharKeyBinding`, since
  the action has a macOS menu item and a Cocoa accelerator is declared by
  character.
- **Host availability is not free.**
  [`isActionPerformable`](../../src/terminal/action-performable.ts) `current`
  answers true for every action without a predicate, its context carries no
  host axis, and the generated menu includes every registry row that carries
  a `menu` field — which this one does. So the
  action gets a predicate on a new optional `PerformableContext` field,
  `hostHasAgentBoard` (the `surfaceCanToggleView` precedent), read off the
  `__deckHost` presence flag the host facades already use — on Tauri the
  chord is left unconsumed and the chip is never created. The generated
  Tauri menu row still exists and answers nothing; recorded and accepted,
  since Tauri is feature-frozen (§13). A host axis in the registry itself is
  a bigger change this document does not ask for.
- **Three signals, the browser's own shape**
  ([`browser-store.ts`](../../src/browser/browser-store.ts) `current`):
  `agentBoardOpen` (the chip exists), `agentBoardOpenedAt` (its slot in the
  open order) and `agentBoardSurfaceActive` (it holds the stage right now).
  **Not `boardOpen`** — that signal already exists in
  [`events.ts`](../../src/chrome/events.ts) `current` and raises the OPEN
  Board, as do `OverlayTier "board"` and `TIER_RANK.board` in the registry.
  Exactly one of {terminal grid, file surface, browser, Agent Board} owns the
  stage; activating any of the others steps the Board back, as DL-18.8 says
  of the browser.
- Pressing the chord with the Board closed opens it (creating the chip if
  needed). With the Board on the stage it steps back **to the terminal** —
  `toggle-browser`'s own behaviour (deactivate, then `focusActive()`) — not
  to "the previous surface", which nothing stores.
- **The sidebar hides while the Board holds the stage.** Width 0, rail, frame
  row and seam all gone, the strip carrying the traffic-light inset — DL-18.9's
  hidden state, produced transiently rather than by the user. It does NOT
  write `sidebarCollapsed`: a sidebar the user had collapsed stays collapsed
  after the Board steps back, and one they had open comes back. New DL-34.1.
  The mechanism already exists:
  [`sidebarEffectivelyCollapsed`](../../src/ui/app-policy.ts) `current`
  answers collapsed for a window with no live tabs regardless of the setting
  ("the persisted collapse choice is read, never rewritten"), so
  `SidebarVisibilityState` gains one field, `agentBoardActive`, beside
  `liveTabCount`. **`SidebarToggle` is omitted while the Board owns the
  hide** (§17, Q23) — the zero-tabs precedent, where `railAvailable` is false
  and the strip-mounted toggle is not rendered — because a toggle that wrote
  the setting would change nothing visible, and one that overrode the hide
  for a visit would create the side-by-side state the owner declined (§3.2).
  ⌘W, the chord and the chip are the ways back.
- **The dock waits.** DL-18.8 leaves the docked column (explorer, usage,
  sessions) beside a document or browser surface, inset by `--dock-w`; the
  Open Board is the one surface that unmounts it
  ([`dockPaintedOpen`](../../src/ui/app-policy.ts) `current` returns false
  while `boardOpen`). The Agent Board joins that branch (§17, Q22): the dock
  is not painted while the Board holds the stage and keeps its state for the
  return. The alternative — the dock beside the Board's own panel — is two
  trailing columns, and the Board has no relation to the explorer that the
  document has.
- **Boot restoration:** the owner decision and acceptance criteria for this
  paragraph now live in [DECK-33](https://linear.app/mxrsv/issue/DECK-33)
  (decided 2026-09-09). Maintainer constraints live in
  [session restore](../internals/session-restore.md#boot-restore).

### 4.3 A consequence to look at, not a decision made here

While the Board is up, the strip's chips still print `tabTail`'s sentence
(DL-27.15 as amended 2026-08-17) directly above cards printing the same
sentence. That is the same fact twice in one glance. The cheap fix, if the
eye review reads it as doubled, is a DL-18.10 amendment hiding `tabTail` on
chips while a Board surface is active; it is **not** made here, because it
changes a rule for a surface nobody has seen (§17, Q12: the owner chose to
wait for the specimen).

### 4.4 Empty states, and what a reopen forgets

Three cases the first draft left silent (§17, Q10, Q11):

- **Tabs, but no agent panes.** The Board still opens — a press must answer —
  and shows its nav with `All 0` and no `PROJECTS` rows, and in the grid one
  `--text-muted` line, _No agents running_, beside one launcher control that
  calls what the rail's project `+` calls,
  [`openTaskLauncher(workspacePath)`](../../src/ui/app.tsx) `current`, with
  the ACTIVE tab's workspace path (there is always an active tab in this
  case). The chip is not hidden and the chord is not swallowed; an empty
  Board is a true statement.
- **No tabs at all** (review finding M6 — the first draft conflated this with
  the case above). With zero live tabs the Open Board owns the stage
  (DL-27.16), `stripShowsTabs` is false so no chip can render, and
  `toggle-agent-board` is a `scope: "pane"` action like `toggle-browser`,
  blocked under the board-tier overlay by the registry's own rule. **So
  there is no Agent Board without a tab**: the chord does nothing, and a
  restore that yields zero tabs (every cwd dead) ignores `agentBoardOpen` on
  the record and lets the Open Board open as today; the flag is rewritten
  false on the next journal write, since no chip exists to keep it.
- **A filter that yields nothing.** The heading says `0 of 8`, the grid is
  empty, the nav is unchanged — its totals already say where the cards are.
- **⌘W on the chip.** `agentBoardOpen` goes false and the Board's own state
  goes with it: the selection and both filters reset. A reopen starts at
  `All`, nothing selected, panel closed. Only `agentBoardOpen` is remembered
  (§11.3).

## 5. The grid and the card

### 5.1 The unit is a pane

A card is an **agent pane** — the rail's agent row, the same unit
[`paneRows`](../../src/ui/agent-rail-model.ts) `current` produces, whose
predicate is exactly `pane.agent === null → no row` (there is no `busy` term
in it; the first draft's "or a `busy` pane" named nothing). Not a tab, not a
checkout.

**One widening, from the grilling (§17, Q3, Q19): a card outlives its
agent.** A pane whose agent has left — by Stop (§5.6), by the agent's own
exit, by `/exit` typed on the stage — keeps its card, in `idle`, wearing the
departed agent's name, with `Restart` where `Stop` was. Without this, Stop
would make the card vanish (a shell pane has no row) and Restart would have no
button to live on, while the rail went on listing the pane as a shell. The key
is a new projected field, **`PaneView.lastAgent`** (§11.11) — the agent this
pane most recently ran, kept after it leaves — so a card exists iff
`agent !== null || lastAgent !== null`. `hasRun` was the first candidate and
was refused: the tracker sets it on the transition INTO `working`
([`agent-attention.ts`](../../src/terminal/agent-attention.ts) `current`,
`reduceActivity`), so it means _reached working once_ — and a claude killed at
its trust-this-folder dialog, which never reaches `working`, would still lose
its card. `idle` therefore carries one more reading — _the agent is gone_ — which
the name beside it disambiguates; no sixth state word (§8). **And that `idle`
is forced, not read:** the tracker's agent→shell branch latches one inferred
`completed`, which `paneState` folds to `asked`, so without a rule the card
would take the yellow frame, rise to the top group and open a panel whose
reply box §7 has just disabled — the opposite of what Stop means.

> **Amended 2026-09-04, from the gate-1 eye pass (owner-decided).** "No sixth
> state word" above held for the STATE; it left the card saying `idle` while
> offering `Restart`, and the eye pass found a departed card identical to an
> idle one in picture and in accessible name. The card and the panel's `State`
> row now print **`ended`** (`DEPARTED_WORD`,
> [`agent-board-model.ts`](../../src/ui/agent-board-model.ts) `building`) —
> a word in the same `.board-label` treatment, not a state: the projection,
> the sort, the filters and the nav's counts still read `idle`, so no `Ended`
> nav row exists and §8's "the Board invents no state" is untouched.
 The Board
projection reads `agent === null && lastAgent !== null` as `idle` whatever the
latch says (§11.9): the user pressed Stop or the agent left, and nothing needs
their eyes. Cost, named: an agent that CRASHED reads the same, `idle` with a
name — the trust audit's §4.3 already records that a crash has no `failed`
producer, and the Board does not invent one. A pane that never ran an agent —
a plain shell, a test runner — has no card, exactly as it has no rail row. Two
consequences carried on purpose:

- **A `cursor-agent` pane has no card** until process classification learns
  the sixth built-in (trust audit
  [§4.1](../review/2026-09-03-agent-signal-trust-audit.md) — fork-listed, not
  done here).
- A tab holding one agent beside a plain shell shows **one** card; the shell
  is reachable only from the full stage.

### 5.2 Order and number

Cards sort by **state first — the loudest-wins fold `failed > asked > working
> done > idle` DL-27.3 already defines — then by pane ordinal (§11.1)**
within a state. `asked` is therefore the top GROUP, above every working card;
`failed`, once a producer for it exists (§8), stands beside it at the top
rather than below it — red outranks yellow everywhere else in Deck and the
Board does not invert that. Today, with `failed` unreachable, the top row IS
the asked row. The nav's project filter narrows the set; it never reorders it.

**The sort is live, and held while a panel is open (§17, Q5).** State changes
every few seconds on a busy Board (`working → done`), and a card that moves
under the pointer is the same complaint that kept acknowledgement off
selection (§5.5). But a sort that ran only when the Board was reopened would
break the one promise the top row makes — that an `asked` card rises — for
the user who lives on the Board. So the grid re-sorts on every state change
EXCEPT while a card is selected and its panel open: then the order is held,
and the deferred sort runs when the panel closes. A held order shows its
staleness nowhere; frames and words update in place.

**The number is a rank, not a serial (§17, Q6).** The number printed on a
card (`01`, `02`, …) is **not its sort position**: it is the pane's rank among
the window's LIVE cards ordered by pane ordinal — a new `PaneView.ordinal`,
allocated from the window's open-order clock when the pane is created or
adopted (§11.1; `openedAt` exists only on `TabView`, once per tab, and cannot
number the panes inside one). So `07` can legitimately sit first, and the
number changes on exactly one event: an OLDER card closing, when everything
after it shifts down by one — rare, and visible as a whole-row move rather
than a scramble. A state change never touches it, and Restart (§5.6) keeps the
ordinal and therefore the rank. Serials held for life were the first draft and
were refused: after a day of opening and closing panes they read
`09 · 14 · 17 · 23` and the digit keys reached nothing. The number is a
handle: **digit keys `1`–`9` select the card carrying that number, and `0`
the tenth, while the GRID holds focus** (§17, Q7, Q24) — not the nav (a
listbox) and not the reply box, where a digit is text. The eleventh card and
beyond are reached by the arrow keys. (The quick picker's digits are inside a
modal; no collision.)

### 5.3 What a card prints, top to bottom

Every line is one line: no wrapping anywhere on a card, ellipsis at the end,
a path shortened to `~/…`. Type sizes are §9's; every size named here is an
existing rung.

| Row | Content | Treatment |
| --- | --- | --- |
| 1 | DL-27.3's state mark in its 14px box · the state word · the number, trailing | word in the label treatment (§9.4): `--red` for `failed`, `--status-unread` for `asked`, `--text-faint` otherwise; number `--text-faint`, tabular |
| 2 | **the identity** — the DL-14 agent brand mark (`AgentGlyph`, the 15px mark the rail and Recent activity already draw) and then **the agent's name**; for a card whose agent has left, `lastAgent`'s glyph and name (§5.1). There is no per-PANE label in Deck — `PaneView` carries none and the rail's `named` reads the TAB's `customName` — so a user-typed tab name reaches a card by one rule: **a tab holding exactly one agent pane prints its `customName` in place of the agent's name** (the glyph still says which agent); a tab holding several agent panes keeps the agent name on every card and prints the tab name as the last segment of row 3, so three `claude` cards in a tab named `api` read `Claude` / `deck · main · api` rather than `api` three times. Review finding H2, resolved here for the owner's veto | `--type-body`, weight 600, `--text-primary`; glyph 15px, its own track |
| 3 | where — `project · label · branch`, any repeated segment dropped, so a primary checkout reads `deck · main` and a worktree `deck · fix-rail · fix/rail`; a plain folder prints its shortened path; a multi-agent tab's `customName` closes the line (row 2). These are the words main's uncommitted [`subjectWhere`](../../src/ui/agent-rail-card-model.ts) prints from a `MenuSubject` — that function does NOT exist at `57d3f3f` and has no plain-folder clause, so until it lands the Board model formats the line itself from `RailWorktreeGroup` (§11.9) | `--type-meta`, `--text-faint` |
| 4 | what — the **task** (the launch prompt's first line, §11.2) when the pane was started by `launchTask` AND has reached `working` once (`hasRun` — set on the transition into working, not after a turn completes); otherwise the **tail**, the newest turn `session-tail-store` holds | `--type-body`, `--text-muted`; prefixed `Task` or nothing |
| 5 | meta — `up 12m` (uptime, §11.1) · `2m` since the state last changed (`changedAt`) · a **model** figure only when §8's pairing is certain, which is never today, so the slot is absent, not `--` | `--type-meta`, `--text-faint`, tabular; a figure Deck cannot know prints `--` (uptime before §11.1 lands; a pane with no `changedAt`) |

Row 4 prefers the task over the tail because the card's job is "what is it
doing", the tail can be one turn stale by design (§8), and the panel shows
both anyway. **A placed-but-unsent prompt does not print as `Task`** (§17,
Q20): that is the normal state right after a launch, since
`TASK_PROMPT_AUTOSEND` is false (§11.2), and the agent has not received the
text — a card that said it had would be the Board's first lie. Until
`hasRun`, row 4 is the tail, which for a fresh pane is nothing; the panel's
`Task` row carries the prompt with _placed, not sent_ beside it (§7.2). A
card whose pane has neither prints nothing on row 4 rather than inventing
text — the "truthful silence" rule of the
[Inbox mockup plan](../plans/2026-09-02-agent-inbox-mockup.md) (main's
uncommitted tree), kept.

### 5.4 The card's box and frame

- The Board sits on the stage's `--bg`, the deepest plane (DL-18.7). A card
  is a `--tab-rest-bg` wash closed by DL-1.3's inset hairline `--hair`, at
  `--radius-control`. **That wash amends DL-21.7**, which gives the resting
  wash to tab-strip chips alone — and by the rule's own argument: a chip
  floats alone on the stage's `--bg`, where "no wash" reads as _nothing
  here_, and a card floats on that same `--bg`. §10 records it. **Not 6px:**
  the worktree card spec's §9.8 records the radius trap and this surface
  does not repeat it.
- **`asked` and `failed` change the frame** (owner: "đổi viền"): the inset
  hairline takes `--status-unread` or `--red`. DL-27.6 already gives yellow
  the meaning _needs your eyes_ and DL-3.2 gives red _error_; a frame is a new
  place for them, so this is a rule (DL-34.3), not an inference. **The frame
  is the whole `asked` signal on a card:** DL-27.3's radiating ripple stays on
  the rail, where its 13px disc is sized against the list's left edge, and is
  switched off inside `.agent-board` — a card holding it would clip the disc
  on its own hairline, and the yellow frame already says _come and look_ at
  the size of the whole card. So the Board adds ONE loop per working pane
  (the spinner, DL-1.2's fourth exception) and no second one. `working`,
  `done` and `idle` keep the neutral frame; green appears nowhere — DL-3.2
  gives `--green` to _on/enabled/success_ and the worktree card spec's §7 gave
  it to _the active checkout_, so the reference's green-for-running would be
  a third meaning on one hue.
- **Working is motion, not hue:** the mark is DL-27.3's `WorkspaceSpinner`,
  one per working pane — the same budget the rail spends today, and the same
  one-vocabulary-one-geometry argument DL-33.2 made for Recent activity. No
  rim glow, no beam, no bars, so DL-1.3 is untouched — **but DL-1.2 is not**:
  its text closes with "No other surface inherits any of the three", so the
  Board's spinner is a fourth scoped exception to that rule, one loop per
  working pane, ended by the state's removal (§10).
- **Selection is the Board's own, drawn with DL-27.22's token** (§17, Q15).
  The selected card — `selectedPaneId` (§11.3), the pane whose panel is open
  — wears `--tab-active-bg` and `aria-current`; at most one by construction.
  It is NOT `PaneView.focused`: selecting a card neither switches the tab nor
  moves the manager's active pane (§5.5), so the wash reads as _the pane the
  panel is about_, and after tier 3 the two coincide because tier 3 focuses
  that pane. The first draft tied the wash to the logical active pane and
  would have needed a tab-level select seam to move it under the surface;
  the grilling chose the Board-local selection — one signal, no seam. No
  accent border, no second signifier (DL-21.1 untouched).

### 5.5 Pressing a card

The card is a DL-27.1 container with a full-bleed hit layer, because it
holds buttons (§5.6).

| Gesture | Does |
| --- | --- |
| click · Enter · digit | **selects**: sets `selectedPaneId` and opens the panel (§7) for this pane. Board-local: the active tab does not change, no pane is focused, nothing is acknowledged, the keyboard stays in the Board. One act, one signifier |
| double-click · ⌘Enter · `Open in stage` | **tier 3**: `activateForAttention`'s existing path — deactivate the surface, activate the tab, focus the pane, acknowledge — and the terminal takes the stage. The Board's chip stays open, so the chord brings it straight back |
| ↑ ↓ ← → · Home · End | roving focus across the grid |
| Escape | closes the panel; a second Escape steps the Board back to the terminal. A Board rule (DL-34.9) — DL-29.8 governs modals and is not cited |

**Selecting does not acknowledge, because selecting does not focus.**
[`activateForAttention`](../../src/terminal/tab-manager.ts) `current` begins
with `surfaces.deactivate()` — which would close the Board — and ends in
`focusPane`, whose `onPaneFocus` callback is the only place
`tracker.acknowledge` is called; **there is no focus path that does not
ack**, and a `mousedown` on a pane element acks as well
([`pane.ts`](../../src/terminal/pane.ts) `current` binds the listener to the
element itself). So "the cheap build acks on select" — the first draft's
fallback — was never a tier 2 at all: every focus path is tier 3. Selection is
therefore a Board signal and nothing in the tab layer moves for it; an ack
would in any case drop an `asked` card out of the top row the moment the user
opened its panel. The ack fires when the user **answers** — a `sent` outcome
from the reply box (§7.4) — or on tier 3, through an explicit
**`acknowledgePane(paneId)`** seam that does not exist today (§11.4).

### 5.6 The card's actions

A trailing hover column (DL-27.5's fixed column, revealed on hover or focus)
and a `More` menu holding every row for the keyboard:

| Action | Means | Seam |
| --- | --- | --- |
| **Stop** | end the agent process; the pane stays, its shell returns, and the card stays as `idle` wearing the agent's name (§5.1). Offered on a card whose agent is live | **none exists.** [`PtyClient`](../../src/terminal/pty-client.ts) `current` has only `killPty`, which ends the whole session, and Electron's kill signals the foreground group and then kills the pty. Stop is a **new flat IPC channel** — `pty_kill_foreground`: the renderer sends the pane id only; main resolves the foreground process GROUP it already tracks (`foreground.group` — a pid crosses IPC, a pgid does not, and signalling a group member's pid "would hit nothing", `electron/pty/manager.ts`) and sends **SIGHUP, then SIGKILL after `KILL_GRACE_MS` (500 ms)** — exactly the first half of `terminateProcessGroups` in [`macos.ts`](../../electron/platform/macos.ts) `current`, reused rather than a new signal choice, with the shell's own group spared (the second half). On Windows the same half is `taskkill` non-forced then forced ([`windows.ts`](../../electron/platform/windows.ts) `current`), unwitnessed (Gate C). PTY ownership AND an R6 contract, §11.6. Rejected: typing `\x03`, which is the agent's own interrupt (Claude: cancel the turn; twice: exit), not a stop (§17, Q17) |
| **Restart** | **resume** the conversation the pane was having — `claude --resume <id>`, `codex resume <id>`, `opencode -s <id>`, `agy --conversation <id>`; gemini always `--resume latest`; `cursor-agent` and a custom agent relaunch bare — with the pane's recorded launch flags folded in. Offered ONLY on a card whose agent has left (shell back): a live card offers Stop, and Restart appears once the classifier's 2 s poll has seen the shell. The task prompt is NOT re-sent; the ordinal, the selection and the task line are kept (§17, Q4, Q18) | a **composition the plan writes** (§11.10). No runtime "live pane → resume command" exists, but every piece does: `paneSessionIds` in the tail store (the pane's session id at runtime), `launchCommandFor(paneId)`, `buildResumeCommand`, `applyResumeFlags`; the write is what `AgentLauncher.arm` does (`writePty(cmd + "\r")`), but `arm` itself fires once per pane id and is not reused. Agent exit is INVISIBLE to `pty:exit` — the shell lives on — which is why Restart waits for the poll rather than for an event. Relaunching fresh was the first draft and was refused as a destructive act wearing a soft label; a `Start fresh` row may join `More` later (§16) |
| **Open in stage** | tier 3 (§5.5) | `onFocusPane` |
| **Close** | remove the pane, tab following only when it was the last — DL-27.21's own words. **In `More` only, never on the hover column** (§17, Q8): Close beside Stop on a four-button hover column is one mis-press from the wrong destruction | [`closePaneAt`](../../src/terminal/close-coordinator.ts) `current` |

The hover column therefore carries at most three controls — Stop OR Restart
(whichever the card's state admits), `Open in stage`, `More` — and `More`
carries all four rows. Nothing else. Pause, Duplicate, notes, tags and
favourites are the reference's features, not its style (§2).

### 5.7 Geometry to verify, not figures

- Cards fill by `auto-fill` at a **minimum width the specimen decides**; the
  constraint is that row 2's name and row 4's task stay legible at that
  minimum with ellipsis, never wrap.
- Nav (§6) and panel (§7) are columns inside the Board surface, on
  `--sidebar-bg` (the chrome plane, DL-29.6's argument), separated from the
  grid by `--seam-recessed`.
- Below a width the specimen measures, the panel **covers** the grid rather
  than squeezing it, and the nav folds to its counts — DL-11.7's shape, not
  its rule.
- `box-sizing: border-box` on every element given a percentage size and a
  padding (the repo's own trap).

## 6. The left nav — STATUS, then PROJECTS

Two groups in one column, headed by two labels in §9.4's treatment — which
is smaller and fainter than DL-3.4/DL-4.4's group label (title-size,
`--text-muted`), so both rules gain a Board-scoped amendment (§10) rather
than a quiet exception.

**`STATUS`** — `All` · `Asked` · `Working` · `Done` · `Idle`, each with its
count in a trailing tabular column. **`Failed` appears only while some pane is
`failed`.** The trust audit's §4.3 shows `failed` has no producer today — a
crashing agent lands in `asked` — so a permanent `Failed 0` row would print
a state Deck cannot reach as though it were watching for it. DL-19.7's rule
(nothing wired, nothing drawn) applies to a state as it does to a control.

**`PROJECTS`** — one row per **checkout** holding at least one card (a live
agent, or a departed one still carded — §5.1), in the rail's own words
(`subjectWhere`, §5.3) and with its card count. Order is two-level, because
the rail's is: [`rail-order.ts`](../../src/ui/rail-order.ts) `current` orders
PROJECT clusters only (so a drag in the rail reorders the Board's projects
too), and within a project the checkouts take the card model's own worktree
sort — primary first, then live, then open order
([`agent-rail-card-model.ts`](../../src/ui/agent-rail-card-model.ts)
`current`). **Live only:** a remembered checkout with nothing running is the
rail's business (DL-27.16 amended by the remembered tier) and is not a Board
row — a card grid of nothing is not a glance at work.

**Composition.** One status × one project. `All` with no project is the whole
Board. Counts are totals, not filtered — a filter that changed the other
group's numbers would make the nav say two things at once — and the grid's
own heading states the result (`3 of 8`; a result of none is §4.4's empty
grid). Selecting a nav row changes the grid and nothing else: no tab
activates, no pane focuses.

Keyboard: the nav is a listbox; `Tab` moves nav → grid → panel.

## 7. The right panel — tier 2

Opens on select (§5.5); a column at the Board's trailing edge, inside the
surface. Top to bottom:

1. **Title** — the card's row 2 name, `--type-title`, 600.
2. **Key-value block** — label column `--type-meta`, `--text-faint`,
   **sentence-case** (a key is copy and stays under DL-4.3's ban; only the
   `State` row's VALUE takes §9.4's treatment), value column
   `--text-primary`, rows at ~1.5 line-height: `State` (the word **plus the
   tracker's confidence** — `WORKING · inferred` — the one place the
   `explicit | inferred` bit the trust audit says "reaches no pixel" reaches
   one; §11.8), `Checkout`, `Branch`, `Directory` (the pane's cwd, full),
   `Up`, `Changed`, `Task` (the full launch prompt, wrapped here and only
   here; while the pane has not yet run a turn the row carries _placed, not
   sent_ after the text — sentence-case copy, not a `.board-label` use, §17
   Q20), `Last turn` (the tail, wrapped). A row Deck has no value for is
   **absent**, not `--`: `Model` is absent today (§8), `Task` is absent for a
   hand-opened agent.
3. **The scrollback snapshot** — the last N rows of the pane's REAL buffer,
   read through a new read-only `TerminalManager` seam,
   `serializePane(paneId, lines)`, which passes through to the
   `serializeScrollback(lines)` every pane already exposes over the serialize
   addon it loads at construction ([`pane.ts`](../../src/terminal/pane.ts)
   `current`). `lines` is the addon's `scrollback` option — rows ABOVE the
   viewport — and the viewport's own rows always come with it; the panel
   shows the last N rows of the result with trailing blank rows trimmed (N is
   the specimen's; ~40 is the working figure). The addon emits SGR colour
   sequences, so a new pure helper, `src/lib/strip-ansi-sequences.ts`, drops
   every CSI/OSC/ESC sequence before the text is laid out — plain text in
   `--board-font` at `--type-body`, refreshed on a throttle while the pane is
   `working` (the specimen sets it; ~500 ms is the working figure) and on
   every `changedAt` otherwise. Nothing
   moves and nothing is touched: no element leaves its slot, no PTY is
   resized, no second renderer or GPU context exists, and reading at full
   size stays tier 3. **The first draft moved the pane's own xterm element
   into the panel** and scaled it by CSS `transform`; the grilling (§17, Q16)
   stepped that down to an upgrade (§16) on three facts.
   [`layout-engine.ts`](../../src/terminal/layout-engine.ts) `current`
   re-slots every pane element on every `sync` — split, close, ratio commit;
   the zoom overlay is the one parked precedent, and `sync` special-cases it.
   [`pane.ts`](../../src/terminal/pane.ts) `current` runs a `ResizeObserver`
   on `.pane__term` whose debounced `fit()` reaches `resizePty` 90 ms after
   any dimension change, so a loan has to pin the element's pixel size. And a
   source tab's `hide()`/`show()` no longer reach an element parked outside
   its container. A loan that survives all three is a layout-engine change
   with a five-transition return contract; §14.1 had already conceded that a
   CSS-scaled terminal is readable only "as activity", which is what a text
   snapshot gives without any of it. Rejected outright: a second xterm fed by
   a tee of the output (two renderers on one PTY, a scrollback replay, a
   second GPU context per open panel) and resizing the PTY to the panel
   (reflows a live TUI twice per look).
4. **The reply box** — one line growing to four, `--type-body`, mono;
   **Enter sends, Shift+Enter breaks a line** (§17, Q9). It writes through
   the Prompt Board's own gate
   ([`inject.ts`](../../src/prompts/inject.ts) `current`): the text is placed
   in the pane, and Enter follows **only when `submitAllowed` says so AND the
   pane has reached `working` once (`hasRun`)**. The second condition is the Board's own,
   and it is the trap
   [`task-prompt-send.ts`](../../src/terminal/task-prompt-send.ts) `current`
   measured: claude's first-run trust-this-folder menu reads `idle`/`none` to
   the tracker, and a sent Enter would choose its highlighted option.
   `submitAllowed` itself needs the pane alive, still running the agent
   captured when the panel opened, idle, and carrying no latch or only
   `completed`. **That gate refuses `requested`, `warning` and `error` on
   purpose** (a TUI dialog's highlighted option would take the Enter), so the
   outcome differs by what `asked` actually is underneath, and the panel says
   which: a finished-unchecked pane (`completed`) gets the text sent; a pane
   holding a real question (`requested`) gets the text **placed and not
   sent**, the box saying _placed — confirm in the terminal_ with
   `Open in stage` beside it. `busy` and `failed` print the gate's own words.
   **Only a `sent` outcome acknowledges the pane** (§5.5, §11.4). When the
   selected card is `asked`, the panel opens with this box focused (owner
   rule); otherwise focus lands on the panel.
5. **Actions** — `Open in stage` · `Stop` or `Restart` (whichever the state
   admits) · `Close`, §5.6's rows.

No structured log, no step counter, no usage figure (§2). The "log" the
reference draws is, in Deck, the terminal itself — here its last lines.

**The selected pane's lifecycle**, so the panel never shows a thing that is
gone:

- its **agent leaves** — Stop, its own exit, `/exit` on the stage — the card
  stays as `idle` (§5.1), the snapshot shows the shell prompt, `Stop` gives
  way to `Restart`, and the reply box disables (there is no agent to answer);
- the pane **exits** (the shell itself dies) — the panel keeps its rows, the
  snapshot shows `[Session ended]`, the reply box, `Stop` and `Restart`
  disable (a resume needs a live shell; the pane's own press-Enter respawn is
  tier 3), `Open in stage` and `Close` remain;
- its **agent generation changes** (agent label changed, or `hasRun` went
  true → false — the tail store's own forget tells) — the panel follows the
  pane id and re-captures the agent for the inject gate, so a reply can never
  reach the wrong program;
- the pane **closes** or **moves to another window** — the panel closes and
  focus returns to the grid;
- a **filter hides its card** — the panel stays, since selection is not a
  filter, and the grid's heading counts the card as hidden;
- a **send is in flight** — `Stop`, `Restart` and `Close` disable until the
  outcome lands, and a second send is refused.

## 8. What a card may claim — the trust ledger

The [2026-09-03 trust audit](../review/2026-09-03-agent-signal-trust-audit.md)
graded every signal Deck reads off an agent as **C** (contract), **R**
(reverse-engineered) or **H** (heuristic). The Board inherits all of it. A
card draws every tier with one pen — same word, same mark, same frame — and
this document says so rather than promising otherwise: the tier is STATED,
in the panel's `State` row (§7.2) and in every card's accessible name
(`WORKING, inferred`), never as a second mark. (The audit's §7 is a numbered
list, not subsections: "§7.6" here means item 6 of §7. It was renumbered on
2026-09-03 after this document's first draft; references are to its 946-line
version.) Per card field:

| Field | Source · tier | Known to lie | Board treatment |
| --- | --- | --- | --- |
| identity, card exists | `ps` classification · C, plus `lastAgent` (§5.1) once an agent has been classified in the pane | `cursor-agent` is `busy` (§4.1) | no card for it; named in §5.1 |
| `working` | Claude: OSC 9;4 · C on macOS, user-defeatable; every other agent: output streak · H | a static approval prompt reads as finished (§4.8); Windows Claude is H (§4.4) | the word, the spinner; the panel prints `inferred` when it is |
| `asked` | `requested` (OSC 9/777/BEL) · C **with no Claude producer by default**; `completed` fold · C/H | for Claude, every `asked` today is _finished, unchecked_ (§4.2); a crash lands here (§4.3) | **accepted in writing: the top row fills with finished runs, not questions**, until audit §7.6's hook-based producer exists. The asked-first rule stands because a finished run you have not checked IS what DL-27.3 says the word means; making it mean "question" is that producer's job, and it is a prerequisite for the panel's focus-the-reply-box rule to be right more often than not |
| `failed` | OSC 9;4 severity 2 · C, undocumented | no producer (§4.3) | word and red frame specified, dormant; `Failed` nav row omitted while unreachable (§6) |
| tail | transcript/rollout/SQLite · R | one turn stale by design; re-read only on state change (§4.6); pairing is a ranked guess for the first ask (§4.7) | row 4 fallback only; the task leads when known. Audit §7.7 (re-ask once after idle) and §7.8 (send the pane's cwd) are named prerequisites for the Board's tail to be worth its row |
| model | transcript · R, pairing H | withheld from the rail by decision | **absent** everywhere on the Board until pairing is causal (audit §7.5's `claude agents --json`, or §7.6's hooks) |
| cwd | `lsof` · C | tail request uses the TAB's cwd (§4.7) | `Directory` row in the panel prints the pane's |
| uptime | — | does not exist (§11.1) | `--` until it does |
| task | `task-prompt-store` (§11.2) · C for the text; whether the agent RECEIVED it is not observable | a placed prompt is not a sent one | `Task` on the card only once `hasRun` (§5.3); the panel says _placed, not sent_ before that; absent until §11.2 lands |

The reference's `paused`, `draft` and `archived` map to **nothing**: Deck has
five words and four are producible, and the Board invents no sixth — a
departed agent is `idle` with a name (§5.1), not a `stopped`.

## 9. Typography — the Board's own type system

The owner's rule: mono for the whole Board, a near-flat size, hierarchy from
three axes and not from size. This section is that rule mapped onto the
existing tokens, and the two DL rules it has to amend to exist at all.

### 9.1 One face — mono, scoped

`--board-font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
monospace` — the stack §31's rendered document already uses for code
([17-markdown.css](../../src/styles/17-markdown.css) `current`), so it costs
**no bundled file and no dependency** (DL-1.1). It applies to the
`.agent-board` subtree and nothing outside it: the rail, the strip, Settings
and every other chrome surface keep `--ui-font`.

- It **does not read the user's terminal `fontFamily`**. DL-4.1's isolation
  argument — changing chrome typography can never change the terminal, and
  vice versa — survives intact: a user who sets the terminal to Berkeley Mono
  gets a Board in the system mono, and the two never move together.
- Rejected: bundling JetBrains Mono / Geist Mono, the reference's faces. A
  font file is an asset, not a dependency, but it is weight in the bundle, a
  face the terminal does not use, and a DL-1.1 question for one surface.
- **App-wide mono is a separate, unmade decision.** This document scopes the
  face to the Board; the Inbox rail's face is the Inbox review's to decide.

### 9.2 Near-flat size — existing rungs only

| Role | Rung | Where |
| --- | --- | --- |
| panel title | `--type-title` 14px | §7.1 |
| name, task/tail, values, reply box, snapshot | `--type-body` 12.5px | card rows 2 and 4, panel values, §7.3 |
| labels, state word, meta, numbers, nav rows | `--type-meta` 11px | card rows 1, 3, 5; nav; panel labels |

No `--type-micro` and **no new rung**: DL-4.4's ladder and DL-4.5's closed
list are untouched in size. The reference's "12.5–13 body / 11 label /
13–14 name" fits the ladder as it stands.

### 9.3 Hierarchy from three axes

- **Weight** — 600 for the name (card row 2) and the panel title; everything
  else 400. The reference bolds the newest log line; Deck has no log, so
  nothing else is bold.
- **Case and tracking** — group labels (`STATUS`, `PROJECTS`) and the state
  word are uppercase with tracking: §9.4.
- **Tone** — three steps, mapped onto DL-3.4's three tokens with DL-3.5's
  floors intact: `--text-primary` (name, values), `--text-muted` (task/tail),
  `--text-faint` (labels, where-line, meta, number, placeholder). The state
  word alone carries semantic ink when red or yellow (§5.4).

### 9.4 The label treatment — one class, one token

`.board-label` = `--type-meta` · `text-transform: uppercase` ·
`letter-spacing: var(--label-tracking)` · weight 400 · `--text-faint`. Used
for exactly **two** things: the two nav group headings, and the state word —
on a card's row 1 and as the panel's `State` value. The panel's key column is
NOT this class (§7.2): a key is copy, and the amendment below is written so
that it stays copy.

`--label-tracking: 0.06em` is a **treatment token, not a size rung** — it
does not join DL-4.4's ladder and it is not DL-4.5's forbidden second ladder;
it is one property, declared once, so that the value is measured in one
place. Rejected: a `--type-label` size token, which would be the fifth rung
DL-4.5 exists to refuse.

Numbers everywhere on the Board carry `font-variant-numeric: tabular-nums`
(DL-4.2) — under mono the rule calls this "nearly inert", and it stays for
the one case it still covers, `--` aligning with a figure above it.

### 9.5 The two amendments — deliberate this time

The worktree card spec's
[§9.9](2026-08-25-rail-worktree-card-design.md) refused to reopen DL-4.1 and
DL-4.3 for its reference "so that a later 'just make it match the reference'
does not reopen a closed rule by accident". **This is that reopening, on
purpose**, on the owner's 2026-09-03 instruction that the Board's text style
is the point of the Board.

**DL-4.1** — from _the monospace face belongs to the terminal, and nowhere
else_ to **_the monospace face belongs to the terminal and to the Agent Board,
and nowhere else_**. Scoped to the `.agent-board` subtree by `--board-font`.
Why the rule's own argument does not object: it banned mono in chrome because
"mono there reads as terminal output that leaked out of its pane". The Board
is not chrome around a terminal; it is a picture OF the terminals, and the
reference's flat-size hierarchy only works when every glyph shares one advance
width — the numbers, the `--`, the state words line up as columns without a
table. The terminal-font isolation clause is unchanged (§9.1). DL-11.4 (rail
labels are `--ui-font`) is untouched: the Board is not a DL-11 screen and the
rail is not the Board.

**DL-4.3** — the ban on uppercase-as-styling and artificial tracking stays
for copy, and gains a **third exception, the first that IS copy**: the
Board's `.board-label` class, for group headings and state words and nothing
else — no key, no description, no value, no title, no button. The gate
([`design-language.test.ts`](../../scripts/design-language.test.ts)
`current`) gains a `LABEL_TREATMENT_SELECTORS` allowlist beside
`OPTICAL_TRACKING_SELECTORS`, holding exactly `.board-label` — and unlike
the optical list, which exempts NEGATIVE tracking only, this one exempts
BOTH regexes the gate rejects on one branch, `STYLED_UPPERCASE` and
`TEXT_TRACKING` (review finding M7: `text-transform: uppercase` and a
positive `letter-spacing` are refused together, and a tracking-only
allowlist would still fail the class). A second entry amends this rule again. The rule's reasoning — tracking tuned against a mono
advance width costs legibility under a proportional face — is the reason the
exception is safe here: the Board IS mono, which is the width the old
tracking was tuned against.

**DL-4.4** — the casing clause ("keys, group labels … are sentence-case")
gains a cross-reference to DL-4.3's third exception. No size moves.

## 10. Design-language ledger — every rule that moves

| Rule | Moves how | Cost |
| --- | --- | --- |
| DL-4.1 | amended: mono belongs to the terminal **and the Board** | the app has two faces for the first time; scoped by one token |
| DL-4.3 | amended: third exception, `.board-label`, gate allowlist | uppercase copy exists in Deck again, on one class |
| DL-4.4 | amended twice: the casing clause gains DL-4.3's third exception, and the group-label clause (a label heading a list of rows is title-size) gains a Board-scoped exception for `STATUS`/`PROJECTS` at `--type-meta` (§6) | a second group-label size exists, scoped to one surface |
| DL-3.4 | amended: a Board group label is `--text-faint`, not `--text-muted` — the same scoped exception one rule down; DL-3.4 and DL-4.4 moved together in 2026-08-16 and move together here | none beyond DL-4.4's |
| DL-1.2 | amended: a fourth scoped exception, the Board's per-card `WorkspaceSpinner` — one loop per working pane, ended by the state's removal (§5.4). The rule's "No other surface inherits these exceptions" no longer holds as written | the loop count scales with working panes, as the rail's already does |
| DL-21.7 | amended: a Board card carries the resting wash, by the rule's own floating-on-`--bg` argument (§5.4) | "everywhere else, rest means no wash" gains one more place |
| DL-18.9 | cross-reference: a surface may produce the hidden state transiently (DL-34.1), and the strip-mounted toggle is omitted while it does | `sidebarCollapsed` is no longer the only way the sidebar is at width 0 |
| DL-18.10 | the strip gains a third surface kind's chip, and `composeSurfaceStrip` / `TabStrip` are generalized to carry it (§4.1) | none to the rule; a seam change |
| **§34, new** | the Board's rules — 34.1 a stage surface that hides the sidebar without writing the setting, omits the sidebar toggle and leaves the dock unpainted while it holds the stage; 34.2 a card is a pane, and outlives its agent; sorted loudest-first, live, held while a panel is open; numbered by rank among live cards in pane-ordinal order; 34.3 `asked`/`failed` colour the frame, nothing else does; 34.4 selection is the Board's own, drawn with DL-27.22's token, and selecting neither focuses nor acknowledges; 34.5 the label treatment; 34.6 the panel's terminal is a snapshot of the pane's own scrollback — no element moves, no PTY resizes; 34.7 the reply box goes through the inject gate, sends only once the pane has run a turn, and only `sent` acknowledges; 34.8 the nav is STATUS then PROJECTS, live only, totals not filtered; 34.9 Escape closes the panel, then steps the Board back to the terminal; 34.10 Stop leaves the shell and the card, Restart resumes the conversation and exists only once the agent has left, Close lives in `More` | numbered 34 because main's DL ends at §33 (§32 launcher, §33 recent activity; §22 stays reserved) — the fast-forwarded branch carries the same file now |
| DL-1.3, DL-20.1, DL-21.1, DL-27.3, DL-27.22 | **untouched**, and each is cited by the design as the reason a reference feature was NOT taken (rim glow, 6px radius, accent selection, a green busy hue); DL-27.22 lends its token to DL-34.4 and keeps its meaning for the rail | none — recorded so the specimen cannot drift into them |
| DL-29.8 | **not cited**: it governs modals, and the first draft leaned on it for Escape — DL-34.9 is the Board's own rule | none |

## 11. Model work — what does not exist yet

The card spec's §11 pattern: every gap below closes before a card renders
from real data.

### 11.1 Uptime needs a clock, and a card needs an ordinal

`openedAt` is `nextOpenSequence()` — an ordering counter for the strip, not
wall time — and it lives on `TabView`, once per tab. `PaneView.changedAt` is
a timestamp, but of the last state change. Two new `PaneView` fields:

- **`startedAt`** — `Date.now()` recorded when the pane's agent generation
  begins; the attention tracker already detects that boundary (its
  shell→agent branch, where `hasRun` is reset) for the tail store's forget
  rule, so the timestamp is one field written where the tracker already
  writes — **allocated in `agent-attention.ts`**, on `PaneState`, projected
  by `syncViews`. `up 12m` is `now − startedAt`.
- **`ordinal`** — **allocated in `tab-manager`'s `syncViews`**, not in
  `TerminalManager`: a window-scoped `Map<paneId, ordinal>` beside the
  open-sequence clock hands `nextOpenSequence()` to every pane id it sees for
  the first time, in the order the tab layer lists them, and drops an id when
  its pane goes. So `splitActive`, `dockNewPaneAt`, `initFromLayout` (a
  restored layout's panes are numbered in layout order at the first sync) and
  `adoptIntoActiveTab` (an adopted pane is new to this window and gets a new
  number) all get ordinals without the pane layer changing — §12's "no pane
  mounting" holds. It is the sort key within a state and the source of the
  printed rank (§5.2); Restart keeps it (same pane id), a new pane in an old
  tab gets a new one.

### 11.2 The launch prompt is not kept

[`launchTask`](../../src/terminal/tab-manager-types.ts) `current` takes the
prompt, sends it once and forgets it — nothing per pane holds the text: not
`PaneView`, not `TabView`, not the journal's `SessionPane` (`cwd`, `agent`,
`launchCommand` only), and the `TaskPromptTarget` the launch leaves behind is
a process-generation guard with no text in it. A window-scoped
**`task-prompt-store`** — `paneId → { prompt, placedAt }`, a Preact signal
(R5) — is written on `prompt-pending` AND on `sent`; the first is the normal
success, since `TASK_PROMPT_AUTOSEND` is false and a launched prompt is placed
in the agent's composer and not submitted
([`task-prompt-send.ts`](../../src/terminal/task-prompt-send.ts) `current`,
where the trust-this-folder dialog that forced it is recorded). It is dropped
on pane close or generation change. The card prints it as `Task` only once
the pane has run a turn (§5.3); before that the panel alone shows it, marked
_placed, not sent_ (§7.2).

**It persists** (§17, Q21): `SessionPane` gains `taskPrompt`, capped at
4 KiB (longer text is cut at the cap and the cut marked), so a restored pane
— which resumes its own conversation — keeps the task its card was started
with. A journal field, a fork (§12).

### 11.3 Board state per window

`agentBoardOpen`, `agentBoardOpenedAt`, `agentBoardSurfaceActive` (§4.2), the
selected `paneId`, and the nav's status and project filters: window-scoped
signals in a store of their own, the browser store's shape — NOT in
[`events.ts`](../../src/chrome/events.ts) `current`, whose `boardOpen` is
the Open Board's. Only `agentBoardOpen` joins the journal (§4.2); the rest
does not, and all of it resets when the chip closes (§4.4).

### 11.4 Acknowledge without focus

§5.5 needs one operation the tab layer does not have:
`acknowledgePane(paneId)`, the `tracker.acknowledge` call that today lives
only inside the `onPaneFocus` callback
([`tab-manager.ts`](../../src/terminal/tab-manager.ts) `current`), fired by
the reply box's `sent` outcome. A `TabManager` seam addition — R4, a fork
(§12). The first draft also asked for a `selectPaneUnderSurface` that would
switch the tab and move the logical active pane without focus; the grilling
made selection Board-local (§5.4), so that seam is not needed and is not
asked for.

### 11.5 The panel's snapshot

`serializePane(paneId, lines): string | null` on `TerminalManager` — a
read-only passthrough to the pane's own `serializeScrollback(lines)` (the
serialize addon is loaded per pane at construction, and pane detach already
reads it to carry scrollback between windows), answering null for a pane
that is gone. It touches no layout, mounts nothing and resizes nothing; it is
an R4 module gaining a getter, named as a fork (§12) because the module is
load-bearing, not because the change is. The colour stripping is
`strip-ansi-sequences.ts` (§7.3), a pure function with its own tests. The reparenting loan the first draft
designed is recorded under §16 as an upgrade with its three known costs
(§7.3).

### 11.6 Stop

Confirmed absent: `PtyClient` offers `killPty` only, and Electron's kill
ends the session; the only other way to reach the agent is a `\x03` byte
through `write_pty`, which is an interrupt, not a stop. Stop is a new host
operation and a new flat IPC channel, `pty_kill_foreground`, plus the
`PtyClient` method that calls it — the renderer names the pane, main resolves
the foreground group it already tracks (`foreground.group`), SIGHUP then
SIGKILL after `KILL_GRACE_MS` (§5.6), the shell's group spared. PTY ownership
and R6, a fork (§12); the channel joins `CHANNELS` and
`scripts/electron-ipc-contract.test.ts` pins its flat shape. It is the one
place this document adds IPC.

### 11.7 N

Closed. The probe ran on 2026-09-03 (§3.2) and the only rule that needed N
was retired the same day; no number is carried anywhere in the design.

### 11.8 Confidence reaches a pixel

`PaneAttentionSnapshot.confidence` (`explicit | inferred`) is projected onto
`PaneView` — one field — so the panel's `State` row can print it (§7.2). This
is audit §7.2's recommendation taken in its cheapest form: text in the panel,
no new mark, no DL rule about marks.

### 11.9 A second projection, not a second model

`agent-board-model.ts` is a pure function over the rail's own
`AgentRailInput` — `tabs`, `activeIndex`, `scans`, `workspaceHistoryPaths`,
`tails`, `models`, `railOrder`, `now` — plus the task store, the ordinals
and the Board's own selection and filters, producing cards, nav groups and
counts. It is built over `buildAgentRail(...).stream[].worktrees[].panes` —
the `RailCardPane` list the rail already flattens per checkout at `57d3f3f`,
each carrying its `paneId`, `tabIndex` and `paneState` word — joined back to
`PaneView` by `paneId` for the fields a card needs that the rail row does not
carry (`hasRun`, `attention`, `phase`), so nothing private is exported and
the Board and the Inbox can never disagree about a pane's state. The `where`
line is the one place the Board formats for itself at `57d3f3f`: a pure
`boardWhere(project, group, customName)` over the `RailWorktreeGroup` fields
that exist on this branch (`branch`, `path`, `primary`), printing the words
§5.3 states; when main's `subjectWhere` lands, `boardWhere` becomes a call
to it and the reconcile is one function body. So the two views cannot
disagree about a checkout's name either, once that lands — the Inbox spec's "a new mockup-only
`AgentStore` or second copy of production rail rules" is listed under _not
canonical_, and that holds for the Board. The one place the two projections
differ on purpose, in two halves: the Board keeps a departed agent's card and
forces its state to `idle` over the tracker's latched `completed` (§5.1); the
rail keeps neither the row nor that reading.

### 11.10 Restart is a composition

`restartPane(paneId)` on `TabManager`: refuse unless the pane's foreground is
a shell again (`agent === null`, `lastAgent !== null`); take the session id
from **`lastSessionId`** (§11.11) — NOT from `paneSessionIds`, because
[`session-tail-store.ts`](../../src/terminal/session-tail-store.ts)
`current` treats agent→shell as a generation change and its `forget` path
deletes the pane's pairing at exactly that moment (checked 2026-09-03:
`paneGenerationChanged` fires on `previous.agent !== pane.agent`, and `forget`
calls `paneSessions.delete`). The pairing is only ever made for a pane
that had `hasRun` OR was resumed (the store's own rule), so a pane killed
before its first turn — unless restore resumed it — has no id. **With
`lastSessionId === null`, Restart passes `{ kind: "latest" }`**, never
`null`: [`buildResumeCommand`](../../src/lib/agent-resume.ts) `current`
answers a null ref with `forms.bare`, which is the fresh relaunch §17 Q4
refused; `latest` resumes the agent's newest conversation in that cwd, which
for a pane that was killed at its first turn IS its conversation. An agent
whose table has no `latest` form (`cursor-agent`, a custom command) relaunches
bare, and the panel says so. Build the command with `buildResumeCommand` and
fold the pane's recorded flags in with
`applyResumeFlags(…, launchCommandFor(paneId))`
([`launch-command.ts`](../../src/lib/launch-command.ts) `current` — claude
only, by that function's own table); write it as `AgentLauncher.arm` writes
(`writePty(cmd + "\r")`). The tracker's shell→agent branch then resets
`hasRun` and `startedAt` as for any launch. A `TabManager` seam addition —
R4, a fork (§12).

### 11.11 The departed agent

`PaneView.lastAgent: PaneAgent | null` — set from the tracker's shell→agent
branch (the generation boundary §11.1 uses) and kept when the agent leaves;
null for a pane that never ran one. One projected field beside `agent`; the
card predicate (§5.1) and the Restart guard (§11.10) read it. Beside it,
**`lastSessionId: string | null`** — the pane's session id as
`paneSessionIds` last held it, captured by the tail store's own `forget` path
when the generation ends with `agent === null` (the one place that knows both
the id and that it is about to be dropped), so a Restart can name the
conversation the tail store has already stopped tracking. Both are cleared
with the pane, and both are overwritten by the next shell→agent generation.

## 12. Forks — `AGENTS.md` categories this touches

Stop-and-ask categories, each with what is asked:

- **A rule in `docs/DESIGN-LANGUAGE.md`** — DL-4.1 and DL-4.3 amended, §34
  new (§9.5, §10). This is the fork the document exists to put to the owner.
- **Tab layer (R4 modules)** — `acknowledgePane` (§11.4), `restartPane`
  (§11.10) and the read-only `serializePane` (§11.5) on the manager. **No
  pane mounting and no layout-engine change**: the reparenting loan is
  withdrawn to §16.
- **PTY ownership** — `pty_kill_foreground` for Stop (§11.6). The reply box
  and Restart are NOT new PTY ownership: the first writes through the inject
  gate the Prompt Board already writes through, the second writes what
  `AgentLauncher.arm` writes.
- **IPC contract (R6)** — one new flat channel, `pty_kill_foreground`.
  Everything else the Board draws already arrives.
- **Close coordination** — nothing new: `Close` is `closePaneAt`.
- **Session schema and journal** — `agentBoardOpen` on `WindowRecord`, its
  validation and the journal effect's dependencies; `taskPrompt` on
  `SessionPane` (§11.2).
- **Keymap** — a registry action, the ⌘⇧O chord, and one optional
  `PerformableContext` field (`hostHasAgentBoard`); editing the registry is
  not a fork by `AGENTS.md`, but the menu regenerates (R3).

**Not touched:** process classification (the `cursor-agent` gap is named,
not fixed), the window coordinator, the layout engine and pane mounting, the
settings schema (neither the chord nor any threshold becomes a setting),
release configuration, any sibling repo.

## 13. Host scope

**Electron only.** The chip and the chord are omitted on Tauri — not
disabled — the way the host facades already omit a control whose host cannot
answer (`__deckHost` absent; DL-19.7's nothing-wired-nothing-drawn, which
DL-32.5 restates for launcher controls); the generated menu row is the one
dead control, recorded in §4.2: a Tauri pane has identity, state and cwd and
none of tail, model, pairing or `git_repository`'s checkout words, so a Tauri
Board would be a grid of names, and Tauri is feature-frozen anyway. Windows
is Gate C: Claude is heuristic there (§8) and nothing has run.

## 14. Verification this will need

Stated now so the build cannot claim less. In order:

1. **A gallery specimen of the REAL component** — both themes, both motion
   modes, wide and the fold width — and the owner's eye pass on it (the
   repo's show-don't-ask rule for visual choices). Measurements the
   specimen must produce: the card's minimum width at which nothing wraps;
   the snapshot's line count at which the panel still reads as activity;
   exactly one card washed; every label in `.board-label` and no uppercase
   outside it; the empty Board and the empty filter (§4.4); and the
   **contrast of `--red` and `--status-unread` as 11px text ink on
   `--tab-rest-bg`** in both themes — DL-3.5's floors are measured for the
   three `--text-*` tones only, and a semantic hue as text at that size has
   never been measured in Deck.
2. The design-language gate with `LABEL_TREATMENT_SELECTORS`, `npx tsc
   --noEmit`, `npm test`, `npm run build`, `generate:menu:check`.
3. **A native `electron:dev` pass** — the toggle in every layout; the sidebar
   hiding and coming back in both its user states, with no toggle drawn
   meanwhile; the dock unpainted and restored; a card opening its panel with
   the snapshot refreshing while the agent works and the PTY untouched
   (`stty size` in the pane before and after); a reply reaching the agent, and
   a reply to a pane that has not run a turn landing as _placed_; Stop
   leaving a shell AND the card, now `idle` with the name; Restart resuming
   the same conversation (the agent's own session list names the id);
   `asked` sorting first and the sort holding while a panel is open; a card
   number shifting only when an older card closes; the Board remembered
   across a restart and absent on an adopt-boot; and the trust audit's own §8
   live checks, which the Board inherits whole.
4. The owner's eye pass on the running app. Green suites are not the gate
   (2026-09-02).

### 14.5 Measured on the specimen — 2026-09-04

Gate 1's eye pass ran on 2026-09-03
([report](../review/2026-09-03-experience-localhost-5187-agent-board-c9sv5l.md),
verdict `FIX FIRST`), and the figures below are the re-measurement after its
findings were fixed. Driver: `playwright-core` from this worktree against the
gallery specimen, transitions frozen (Chromium interpolates
`background-color` in oklab, so a mid-transition read is a colour neither end
of the animation has).

**§14.1's contrast row, closed.** The state word composited over the card's
own effective background, both themes, resting and selected:

| Theme | Word | Resting | Selected |
| --- | --- | --- | --- |
| dark | `FAILED` | 5.51 | 5.56 |
| dark | `ASKED` | 9.54 | 8.27 |
| dark | neutral | 5.79 | 5.99 |
| light | `FAILED` | 5.69 | 5.85 |
| light | `ASKED` | 4.54 | 4.75 |
| light | neutral | 6.09 | 5.81 |

Every cell clears DL-3.5's 4.5 floor; the worst is light `ASKED` at rest,
4.54, which is the palette's own yellow on the 3% wash and is unchanged by
this work. The three selected cells that failed before (4.32 / 4.30 / 3.43)
took DL-34.4's second ink.

**§5.7's fold width, closed.** Driven on the board's own width, since the
fold is a container query:

| Board | Nav | Panel | Grid | Card | Grid overflow |
| --- | --- | --- | --- | --- | --- |
| 1150 | 200 | static 360 | 558 | 274 | 0 |
| 840 | 200 | static 360 | 248 | 248 | 0 |
| 830 | 200 | **absolute** 360 | 598 | 294 | 0 |
| 610 | 200 | absolute 360 | 378 | 378 | 0 |
| 470 | **44** | absolute 360 | 394 | 394 | 0 |
| 420 | 44 | absolute 360 | 344 | 344 | 0 |

**The rest of §14.1, re-measured the same run.** The hover column and the
rank no longer share pixels (rank x 727.4–741, column x 743–819, a 2px gap)
and the column is `pointer-events: none` while invisible. Tab stops across
the whole surface are **seven** — two nav groups, one grid, the reply box and
three panel actions — where the eye pass counted 27 in the grid alone.
ArrowDown from the nav's `All` row lands on `Failed 1`.

**Still owed:** everything that needs the wired app (§14.3), and the owner's
eye pass on it (§14.4).

## 15. Open questions

Every question the first draft held for veto or measurement was answered in
the grilling (§17). What remains is empirical, decided by an eye or a
specimen, not by this document:

1. **The strip's doubled sentence** (§4.3) — eye review on the specimen.
2. **The specimen's own figures** (§5.7, §14.1) — the fold width and the
   contrast table are **answered** in §14.5 (2026-09-04); the card's minimum
   width stands at the 240px the treatment ships with, and the snapshot's
   line count is still an eye call on a real buffer.

## 16. Out of scope

- The reference's features (§2's dropped list), all of them.
- The Inbox rail's own treatment — the Inbox review's.
- A Board on Tauri; Windows evidence.
- Cross-window: the Board shows this window's panes, as the rail does.
- Multi-select, drag-to-reorder cards, card grouping by anything but the nav.
- Changing any trust tier: audit §7.1, §7.2, §7.6, §7.7 and §7.8 are
  implementation dependencies of the rows that cite them (§8) — scheduled by
  the plan, not built here.
- App-wide mono (§9.1).
- A structured log, turn history, usage or cost per card.
- **The live element on loan** — the pane's own xterm element reparented into
  the panel and CSS-scaled (§7.3). An upgrade candidate once the snapshot has
  been seen, carrying the three costs §7.3 names; not built here.
- A `Start fresh` row (relaunch without resume) and an `Interrupt` row (the
  `\x03` the agents read as cancel) — both nameable later in `More`, neither
  asked for.
- `selectPaneUnderSurface` — the first draft's tab-level select without
  focus; superseded by the Board-local selection (§5.4).

## 17. Grilling record — 2026-09-03

Two rounds put every silent assumption and every open item to the owner, with
a recommendation each; the owner accepted all 24. Facts the rounds relied on
were read from `main` at `57d3f3f` by five read-only probes (keymap and
surfaces, PTY and launcher, focus and mounting, freeze state, concurrency)
and are cited where they land in the text above.

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Build after the daily-surfaces release, or amend the freeze? | After the release; the spec decides now, the build waits |
| Q2 | Board opens itself at boot when ≥ N agents restore? | No. Remembered only; the ≥ N rule and N are gone (§3.2) |
| Q3 | Stop makes the card vanish (a shell pane has no card)? | No. A card outlives its agent, as `idle` with the name, with Restart (§5.1) |
| Q4 | Restart = relaunch fresh, or resume? | Resume the conversation (§5.6) |
| Q5 | Re-sort live, on reopen, or held while selected? | Live, held while a panel is open (§5.2) |
| Q6 | Card numbers hold gaps after a close, or compact? | Compact: the number is a rank among live cards (§5.2) |
| Q7 | Digits past 9? | `1`–`9` plus arrow keys (and `0`, Q24) |
| Q8 | `Close` on the card? | Kept, in `More` only — off the hover column (§5.6) |
| Q9 | Reply box keys, and the first-run dialog trap? | Enter sends, Shift+Enter breaks; Enter only once the pane has run a turn (§7.4) |
| Q10 | Empty Board, empty filter? | Both drawn honestly (§4.4) |
| Q11 | ⌘W then reopen — filters and selection? | Reset; only `agentBoardOpen` is remembered (§4.4) |
| Q12 | The strip's doubled sentence? | Wait for the specimen (§4.3) |
| Q13 | Fast-forward the branch to `main`? | Yes — done 2026-09-03, `57d3f3f` |
| Q14 | Chord, since ⌘⇧B is `toggle-explorer`? | ⌘⇧O / Ctrl+Shift+O (§4.2) |
| Q15 | Selection must not focus (every focus path acks and deactivates the surface)? | Board-local selection; `acknowledgePane` on `sent` (§5.4, §5.5, §11.4) |
| Q16 | Tier 2: the element on loan, or a scrollback snapshot? | Snapshot; the loan is an upgrade (§7.3, §16) |
| Q17 | Stop: a new signal channel, or drop Stop? | `pty_kill_foreground`, one new flat channel (§11.6) |
| Q18 | Restart on a live card too, or only once the agent has left? | Only once the agent has left (§5.6) |
| Q19 | Card-survives key: `hasRun`, or a generation-began bit? | A generation bit — `PaneView.lastAgent` (§11.11) |
| Q20 | Row 4 for a placed-but-unsent prompt? | Tail until `hasRun`; the panel says _placed, not sent_ (§5.3, §7.2) |
| Q21 | Does the task prompt persist through the journal? | Yes, `SessionPane.taskPrompt`, 4 KiB cap (§11.2) |
| Q22 | The dock beside the Board? | The dock waits, the Open Board's own branch (§4.2) |
| Q23 | `SidebarToggle` while the Board owns the hide? | Omitted, the zero-tabs precedent (§4.2) |
| Q24 | `0` for the tenth card? | Yes (§5.2) |
