# The worktree card's strip becomes reachable — design

Date: 2026-08-27
Status: `decided` and **BUILT 2026-08-27** on the owner's "implement this spec".
Every visual decision in §3.1 was taken by the owner in chat on 2026-08-27
against a live gallery specimen; §3.2's four are promoted by that approval, as
is §11.1's fork resolution (`TabManager.splitInWorkspace`). §15's three open
questions were settled at build time and are answered at the foot of this
document. The gallery section is PARKED (`unread-mark-variants` precedent) —
its files stay as the drawn record, its registry entry is gone, because a
"per-pane — what ships" control column stopped being current the moment this
shipped. §13's evidence list describes the SPEC's own gallery pass and is left
as written; the build's evidence is in `AGENTS.md`'s drift table.
Scope: the closed card's agent strip, two new popovers, the rail's card model,
and one fix to the production stylesheet (§9). Renderer-only by code; the
actions menu degrades on Tauri (§12).

## 1. The change in one sentence

**A closed worktree card's agent strip stops being a picture and becomes the
way into that checkout: its segments group by agent, they press and hover, and
a trailing `+` opens an actions menu scoped to the checkout.**

The specimen is [`src/gallery/sections/strip-actions-variants.tsx`](../../src/gallery/sections/strip-actions-variants.tsx),
its model half [`strip-actions-model.ts`](../../src/gallery/sections/strip-actions-model.ts),
and [`strip-actions-variants.css`](../../src/gallery/sections/strip-actions-variants.css),
registered in the gallery as `closed-strip actions`. Every figure in §10 was
measured off it in Chrome at the rail's real 276px width.

This document builds on
[the worktree card spec](2026-08-25-rail-worktree-card-design.md) `decided` and
reverses one line of it: that spec's §4 describes the strip as a preview, and
[`worktree-card.tsx`](../../src/ui/worktree-card.tsx) `current` says so in
`CardStrip`'s own comment — *"the strip is a preview, not a set of controls"*.
It is a set of controls now.

## 2. The delta

| | Today (`current`, shipped) | Proposed |
| --- | --- | --- |
| A segment is | one PANE, capped at three by `stripSegments` | one **agent kind**, `×N` when it holds several panes |
| A segment presses | nothing — `<span role="img">` | `onFocusPane(tabIndex, paneId)`; a merged segment presses its loudest |
| A segment hovers | a native `title` | the **segment menu**: the panes behind it, each a DL-13.3 row |
| `+N` | a count, inert | the same menu, listing exactly what it hides |
| The fold | `STRIP_VISIBLE = 3`, a fixed count | folds by measured width; the `+` never folds |
| Create, on a closed card | **nowhere** — `New agent` exists only when the card is open | the strip's **last segment**, a `+` |
| That `+` opens | n/a | the **actions menu**: run an agent, split, branch, Finder, terminal |
| A right-click on the card | nothing | the same actions menu |
| Reaching a quiet agent | open the card, then read the list | one hover |

## 3. What is settled, and by whom

### 3.1 Owner-settled, 2026-08-27, against the live specimen

1. **Segments group by agent kind.** *"chúng ta nên chia theo agents, ví dụ nếu
   Claude có 2 agents trở lên thì gộp chúng lại để hiển thị."*
2. **Create lives at the strip's end**, not in the card head — chosen as
   candidate B of §11's three, after the head's measured cost (§10).
3. **The segment menu** is what a segment raises — *"chốt options này"*, on the
   segment-menu column, over the checkout menu and the inline expansion (§11).
4. **The actions menu exists**, raised by pressing the `+` or right-clicking the
   card, with the row set from the owner's own reference image.
5. **That menu is small and placed right** — *"Popover cho font size nhỏ lại và
   size của popover nhỏ lại, hiển thị placement right."*
6. **Its radius matches the card, not DL-13.1** — *"tại sao popover lại dùng
   border radius lớn như vậy?"* (§8.4).

### 3.2 Decided by this document; owner approval of the spec promotes them

1. **The fold is width-aware** (§6), not a fixed count.
2. **`New split here` stays a row** and is the one fork this work opens (§11.1).
3. **The project header's `+` is relabelled**, not removed (§7.4).
4. **Quick Launch is untouched**, and the card's `+` stops reaching it (§7.5).

## 4. A segment is an agent kind

`stripSegments` sorts panes loudest-first and shows the top three. With two
Claudes in a checkout that spends two identical-looking segments on one agent,
and the sixth pane is behind a number.

`groupSegments` folds panes by `agent` first, then ranks the GROUPS by their
loudest pane using `outranks` — DL-27.3's own fold (`failed > asked > working >
done > idle`, ties by recency). A group renders as one segment: the agent's
glyph, the loudest pane's state dot, and `×N` when `N > 1`.

**The cost, stated rather than argued: a merged segment wears ONE state mark.**
A checkout running a failed Claude beside a working one shows `failed` and says
nothing about the other until the menu opens. That is the trade the owner took,
and it is why §5's menu is not a convenience — it is the only place the full
truth is told.

`×N` takes `--text-muted`, never `--accent`: `+N` already spends the accent on a
count of HIDDEN agents, and two counts in one bar must not read as the same kind
of number. This one names what the segment IS; that one names what it is not
showing.

## 5. The segment menu

Hovering a segment raises the panes **behind that segment** — one shape, three
cases:

| Case | What it raises |
| --- | --- |
| A merged `Claude ×2` | its two panes, under a `2 Claude agents` caption |
| A single-pane segment | that one pane, plus an explicit `Focus pane` row |
| The `+N` tail | exactly the panes it hides, under `N more in this checkout` |

Rows are the production `.asr-card__row` — the card's own agent row, reused
rather than restated, so the glyph, the state dot, the model pill, the hover
wash and DL-27.21's ✕ all arrive for free. Press = `onFocusPane`, ✕ =
`onClosePane`. The model pill stays conditional on `pane.model !== ""`, mirroring
`CardAgentRow`: production withholds the model wherever the pane/session pairing
is heuristic, and a menu that invented one would be the guess the row refuses.

The single-pane case needs the `Focus pane` row because a one-row list IS the
segment — without it the menu would say nothing the segment did not. **This is
the accepted cost of the chosen shape**, drawn in the gallery before it was
chosen.

### 5.1 Mechanics the drawing does not have

The specimen positions the menu `absolute` inside a local anchor and opens it
with no delay. A shipped version needs four things the drawing skips, listed
here so implementation does not inherit the drawing:

- **`position: fixed` off the trigger's rect.** `.asr-rail__list` is a scroll
  container with `overflow-x: hidden`; a menu rendered inside it is clipped on
  the left and scrolls away from its own segment. The precedents are
  [`tooltipAnchor`](../../src/ui/controls/action-tooltip.tsx) `current` and
  [`MenuAnchor`](../../src/ui/toolbar/toolbar-overflow-menu.tsx) `current`.
- **Hover intent plus a pointer bridge** across the gap, or travelling into the
  menu closes it.
- **Pin by `paneId`.** `groupSegments` re-ranks on every render, so a state
  change mid-hover can reorder or evict the hovered segment. The menu is bound
  to the segment's key; when that key leaves the shown set, the menu closes.
- **Close on scroll**, since a `fixed` surface does not follow its anchor.

### 5.2 Keyboard

A segment becomes a `<button>`, so Tab reaches it and focus raises the same
menu hover does. The native `title` comes off — DL-23.10's precedent, since a
`title` never appears on keyboard focus. Every state word survives in the
accessible name (DL-27.2: the mark is the fast read and never the only read).

## 6. The fold

With a `+` occupying a segment, the strip's budget matters. §10 measures it at
**220px**, and three folds were drawn against a six-kind checkout:

| Fold | With a merged `×2` | With no merge |
| --- | --- | --- |
| `STRIP_VISIBLE = 3` | 3 kinds + `+3` + `+`, 192px — fits | 3 kinds + `+3` + `+`, 173px — **47px wasted** |
| No cap | 6 kinds + `+`, **44px cut** | 6 kinds + `+`, **24px cut** |
| By width | 3 kinds + `+3` + `+`, 192px | **4 kinds** + `+2` + `+`, 210px |

**Recommended: fold by width.** It equals the fixed cap when a merged segment
is present and shows one more agent when none is, because it measures the room
instead of counting. Its rule is that **the `+` never folds** — a launcher that
vanishes when a checkout gets busy is missing exactly when it is wanted; agents
fold into `+N` instead.

The specimen ESTIMATES segment widths from measured constants (39px a segment,
+21px for `×N`, 30px the `+`, 31px the tail), running ~7px conservative. **A
shipped version should measure rather than estimate**, or the estimate becomes a
second source of truth beside the stylesheet.

## 7. Create, and what it opens

### 7.1 The gap

A closed card with agents in it has **no create path pinned to its own
checkout**. `New agent` exists only while the card is open; `BareCheckout` only
covers a checkout with nothing running. The nearest control is the project
header's `+`, which resolves through
[`groupPath`](../../src/ui/agent-rail.tsx) `current` to `worktrees[0]` — always
the primary checkout, silently.

### 7.2 Where it goes

The strip's last segment, **after** the `+N` tail so the bar reads *agents →
more agents → create*. The strip is `width: fit-content`, so the `+` spends
strip width and never head width — §10 measures the head alternative as the one
that pays.

### 7.3 What it opens

The actions menu (§8), not Quick Launch. A right-click anywhere on the card
opens the same menu; `worktree-agent-stack.tsx` already carries that gesture in
the older rail, so it is not new to this codebase.

### 7.4 The project header's `+`

It stays, and its label changes to name the checkout it actually targets. Today
it says `New tab in <project>` and opens the primary checkout without saying so;
with every checkout carrying its own launcher, the honest wording is what keeps
the two from reading as the same control. **Not removed** — a project with one
checkout would otherwise lose its launcher when its card is open.

### 7.5 Quick Launch

Untouched. `⌘T` and the stage strip's `+` remain its entry points. **The loss,
named: the card's `+` no longer reaches Quick Launch in one press** — it reaches
the actions menu, whose agent rows launch directly instead. Anyone wanting the
full composer uses `⌘T`.

## 8. The actions menu

Header, three groups, footer — the owner's reference, mapped onto seams that
already exist.

| Row | Seam | Host |
| --- | --- | --- |
| `Run <agent>` × N | `openQuickAgent(agent, destination)` | both |
| `New split here` | **fork** — see §11.1 | both |
| `Create branch from here` | `worktree_add` | Electron |
| `Open in Finder` | `open_in_app` + catalog `finder` (`opensFolder: "as-is"`) | Electron |
| `Open terminal here` | `open_in_app` + catalog `terminal`/`iterm2`/`ghostty` | Electron |

**No new IPC.** That is the finding that makes this menu cheap: every channel it
needs is already in `CHANNELS`, and the external-app catalog already declares
both a `finder` entry and terminal entries with folder behaviour.

### 8.1 Two departures from the reference

1. The reference names the checkout twice — `Actions for X` over
   `Runs in: X · Worktree`. The menu is anchored to that card, so the second
   line spends its width on the fact the card does not already show: **the
   branch**. The badge still says `Worktree` or `Primary`, which is
   `group.primary`.
2. An agent row's detail is its **default model** where `agentModels` carries
   one and **the command it will run** where it does not. The reference mixes a
   model, a vendor and a restatement of the scope; only the first is a fact the
   row can promise, and the third is what the footer already says.

Detail lines drop the words *"this worktree"* the reference repeats on nearly
every row — the footer states the scope once, and at 232px those words were what
pushed two details into an ellipsis (§10).

### 8.2 Size and placement

232 × 396px, title `--type-meta` (11px, weight 600) over detail `--type-micro`
(10.5px, `--text-faint`), 36px rows, 18px glyph track. The pair is separated by
weight and ink rather than size — DL-4.4 already records exactly that pairing
for the Recent activity block. **Nothing goes below `--type-micro`**: the ladder
has four rungs and DL-4.5 forbids inventing a fifth.

Placed to the **right** of the card, top-aligned, 6px away. That is not taste:
the rail is a 276px column on the window's left edge, so a menu hanging BELOW
covers the rail — the other checkouts, and the card being acted on. To the right
it covers the stage, and the card stays visible beside it.

**A flip is required and not drawn.** When the window is narrow or the sidebar
has been dragged wide, `left + 232px` can pass the viewport; the fallback is the
same menu on the card's left.

### 8.3 Rows are two lines, which is a new genre

`ToolbarOverflowMenu` (DL §23) is one line: icon, label, chord. DL-13.3 says a
popover is made of §5 rows, which are single-line too. **A two-line menu row is
not covered by any rule** and has to be written down before it ships (§11.2).

### 8.4 The radius

DL-13.1 gives every popover `--radius-surface` (12px), and every shipping
popover takes it. That rule was written for surfaces floating over the STAGE.
These hang off a 260px card in a 276px column, where the rail already settled
the question on 2026-08-25: `--asr-card-radius` is **6px** because
`--radius-surface` on the card *"read as pills at rail width"*, and every corner
in that sheet collapsed to one value. A 12px popover hanging off a 6px card is
rounder than the thing it belongs to. **Both popovers take 6px.**

Full-bleed rows then need `overflow: hidden` on the menu, or the first and last
rows' hover wash squares off its corners.

## 9. A latent production bug this must fix

[`.asr-card__strip`](../../src/styles/04c-rail-worktree-card.css) `current`
pairs `margin-left: 22px` with `max-width: 100%`. The percentage resolves
against the card's 242px content box, not against the 220px the margin leaves —
so a strip wider than 220px clamps at 242px and **hangs 22px past the card**,
where `.asr-rail__list`'s `overflow-x: hidden` cuts it without reporting
anything (AGENTS.md, Known traps).

Today's cap of 3 keeps every strip under 162px, so it is unreachable. The `+`
segment and a wider fold are what reach it. **`max-width` becomes
`calc(100% - 22px)` in the same change.**

## 10. Measurements

Chrome, `deck-dark`, rail at 276px, card 260px, content box 242px.

| Measured | Value |
| --- | --- |
| Strip budget (242px content box − 22px indent) | **220px** |
| Strip, per-pane, cap 3 (today) | 143px |
| Strip, grouped, cap 3, with `+` | 192px |
| Strip, grouped, uncapped, 5 kinds, with `+` | 236px — **16px past the budget** |
| Strip, width-fold, 6 kinds no merge, with `+` | 210px |
| Segment widths | plain 36–39px · merged +21px · `+` 30px · `+N` 31px |
| Card head, name column, today | 166px box for 106px of text |
| Card head, name column, with a head `+` | 143px |
| `bench.ai-terminal` (109px of text), today | 95px box — **already clipped by 14px** |
| `bench.ai-terminal`, with a head `+` | 72px box — **clipped by 37px** |
| `bench.ai-terminal`, with a strip `+` | 95px — **identical to today** |
| Actions menu | 232 × 396px, 36px rows, 8 rows + 4 separators |
| Actions menu, Tauri | 232 × ~326px, 5 rows + 3 separators |
| Segment menus | 89px (2 rows) · 78px (1 row + `Focus pane`) |

## 11. Forks and DL amendments

### 11.1 The one fork: `New split here`

`split-row` and `split-column` act on the **active pane**, and this card's
checkout may not own it. Doing it honestly is materialize-then-split, which is
`TabManager`'s business — the `launchTask` precedent from the task-launcher
spec, where the manager owns materialize → readiness → one injection because
pane ids must not leave the terminal layer. **This is tab materialization, a
fork-listed category.** The resolution proposed here: `TabManager` gains a
`splitInWorkspace(path)` that materializes a tab in that checkout if none
exists, then splits it; the rail passes a path and receives a boolean, exactly
as `onNewTabIn` already does.

The alternative offered and not taken: rename the row `New shell here` and route
it through `onNewTabIn`, which is unambiguous and needs no new seam — but it
answers a different question than the owner's reference asked.

### 11.2 DL rules that move

| Rule | Change |
| --- | --- |
| **DL-13.1** | its 12px `--radius-surface` is scoped to stage-level surfaces; a popover anchored to the rail takes the card's radius (§8.4) |
| **DL §13** | admits a **hover-raised** popover — the rule is a click contract (`aria-expanded`, `role="dialog"`, Esc / outside-click) and DL §23's hover surface carries no actions, so the segment menu fits neither |
| **DL §13** | admits a **two-line menu row** (icon · title · detail), which no existing rule covers (§8.3) |
| **DL-27.3** | the fold now ranks agent KINDS, not panes; `×N` and `+N` are two different counts in one bar and take different inks (§4) |
| **DL-23.10** | applied, not amended: the segment's native `title` comes off when it becomes a button |
| **DL-19.7** | applied, not amended: Electron-only rows are omitted on Tauri, never shown inert |

### 11.3 Rejected candidates, with the measurement that killed each

- **The checkout menu** (one popover listing every pane, raised from any
  segment): it read identically whichever segment was pointed at, so the strip's
  segmentation bought nothing at the moment it was used.
- **Inline expansion** (the segment grows in place to `glyph · name · ✕`):
  cheapest by far — no DL amendment, no fixed positioning, no hover bridge, no
  scroll-close — and it lost on two things it can never do: reach the panes
  behind `+N`, and offer a ✕ on a merged segment, since one control cannot close
  two panes without asking which and the strip has no room to ask.
- **A `+` in the card head** (a reserved 15px `PlusSquare` after the branch
  badge): costs 23px of the name column. An ordinary name does not notice, but
  the design's own failing case — `bench.ai-terminal` beside
  `feature/ai-terminal`, already clipped by 14px with no `+` at all — goes to
  37px of clipping (§10).

## 12. Host parity

The strip, its grouping, its press, the segment menu and the fold are
renderer-only and reach **both hosts**. The actions menu reaches both hosts as a
surface, with three rows omitted on Tauri (`worktree_add` and `open_in_app` are
Electron-only), which leaves the agent rows and the split row working there —
launching an agent into a destination needs no Electron-only host.

A project git does not know renders through `FlatEntries`, which has no card and
therefore no strip; that is every project under Tauri, since `git_repository` is
Electron-only. **The card path is Electron-only in practice**, and this change
does not alter that.

## 13. What the evidence does and does not prove

Gallery-only. `npx tsc --noEmit` clean over every file this touches,
`npm run build` green, **zero `gxsa-` strings in `dist/`** (R7: gallery code
never enters the shipping bundle), the design-language gate 19/19, Prettier
clean, oxlint zero errors, and every figure in §10 measured in Chrome against
the specimen.

**Not proven, and owed:**

- No file under `src/` outside `src/gallery/` has been touched. Nothing here
  runs in the app.
- `deck-dark` only. No light-theme pass.
- No `electron:dev` or `tauri dev` run, and no owner eye review of the running
  app.
- Windows is Gate C, as always.
- The width-fold is an ESTIMATE in the specimen (§6); the shipped one must
  measure.
- The flip for the right-placed menu (§8.2) is not drawn.

## 14. Model work

| Moves to | What |
| --- | --- |
| `agent-rail-card-model.ts` | `groupSegments`, the width-aware fold, `displayAgent` (currently module-private there as `agentDisplayName`, and a merged segment is the first thing that ever needed to NAME an agent kind rather than a pane) |
| `agent-rail-card-model.ts` | `stripSegments` grows a panes-behind lookup, or the menu re-derives the fold on every hover |
| `worktree-card.tsx` | segments become buttons; the `+` segment; the two popovers; the `onContextMenu` |
| `04c-rail-worktree-card.css` | the `+` segment, `×N`, both popovers' surfaces, and §9's `max-width` fix |

## 15. Open questions

1. **Does the segment menu close on press, or stay for a second action?** The
   drawing closes on nothing — it is hover-driven. A press focuses a pane, which
   moves the keyboard away; leaving the menu up afterwards is probably wrong,
   but it has not been decided.
2. **Does the actions menu belong on the OPEN card too?** Today the `+` segment
   exists only while the card is closed, and an open card has `New agent`. Two
   launchers with different vocabularies in one component is a smell.
3. **Should the project header's `+` open the actions menu as well**, scoped to
   the primary checkout? §7.4 only relabels it.

## Chưa khớp thực tế

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| The closed strip is a preview, not a set of controls | `deprecated` | reversed here | [worktree card spec §4](2026-08-25-rail-worktree-card-design.md) `decided` and `CardStrip`'s own comment |
| A popover takes `--radius-surface` | `current` | narrowed here | DL-13.1; §8.4 scopes it to stage-level surfaces |
| `STRIP_VISIBLE = 3` is the fold | `current` | replaced here | §6 |
| The strip cannot overflow its card | `current` | **false** | §9 — latent since the strip shipped, unreachable only because of today's cap |

## 16. Settled at build time (2026-08-27)

- **§15.1 — the segment menu closes on press.** Focusing a pane moves the
  keyboard to it, and a surface that outlives that is a menu hovering beside a
  terminal the user is typing in. ✕ does NOT close it: closing one of two panes
  leaves a menu that still has something to say.
  **Amended 2026-09-02 (owner, live report): this holds for a press that
  FOCUSES a pane — a single-pane segment, or a row inside the menu. A merged
  `×N` segment and the `+N` tail no longer focus anything on press: they PIN
  the menu open.** §4's "a merged segment presses its loudest" was a guess made
  on the user's behalf, and it closed the hover menu under a pointer that could
  not re-raise it — `pointerenter` does not fire again while the pointer stays
  inside the segment — so with two Codex agents a press could never choose one
  and read as "nothing but a blink". A pinned menu survives the pointer leaving
  and goes on Escape, an outside press, a second press on its segment, a pane
  chosen from it, or its segment leaving the shown set; hovering another
  segment re-targets it and drops the pin. DL-13.7 carries the same amendment.
- **§15.2 — the actions menu is closed-card only, as drawn.** An open card
  keeps `New agent`. The smell the question names is real and left standing
  rather than resolved by inventing a second placement nobody has seen.
- **§15.3 — the project header's `+` is relabelled only**, per §7.4. It says
  `New tab in <project> · <primary checkout>` now; it does not raise the
  actions menu.
- **Placement applies to BOTH surfaces**, not just the actions menu: right of
  the trigger, top-aligned, 6px away, flipping left when it would pass the
  viewport and clamping against the bottom. §8.2's argument — the rail is a
  276px column on the window's left edge, so a menu hanging below covers the
  rail — does not depend on which of the two menus it is.
- **The menus join `browserPanelObscured`.** Both are placed over the stage,
  where the browser tab's `WebContentsView` is a native layer above the
  renderer; without it they draw underneath it, the defect ⌘T had until
  `agentQuickPickerOpen` joined that policy on 2026-08-16.
- **`splitInWorkspace` on an empty checkout materializes and STOPS**, rather
  than also splitting the tab it just made. §11.1 says "materializes a tab in
  that checkout if none exists, then splits it"; a fresh tab's single pane is
  already the pane the row promised, and splitting it too would spawn a second,
  unasked-for shell.
- **`Create branch from here` reuses Quick Launch's create-worktree subview**,
  prefilled with the card's repository. §8's table names `worktree_add` and no
  form; inventing an inline naming form beside an existing, validated one would
  be a second way to write the same three fields. Quick Launch is otherwise
  untouched (§7.5).
