# Navigation rail refresh (treatment D)

Date: 2026-10-06
Status: Active — every open decision answered 2026-10-07; slices 1–2 merged, slices 3–5 run
in order under the [Delivery slices](#delivery-slices) queue.
Owner checkout: `/Users/kyantran/Documents/Development/spacevibe-workspace/spacevibe-deck`
Baseline: written against `main` at `72b525e5` (2026-10-06); slices 3–5 start from `origin/main`
after slices 1–2 (`0a6fa105`). Plans under `docs/plans/` are gitignored and exist only in the
primary checkout.
Host: renderer-only (Electron and the frozen Tauri fallback); no new host command.
Parent: [Deck product improvements](2026-10-06-deck-product-improvements.md), ranks 1–2
(navigation and needs attention). That record keeps the cross-surface priority order; this
one owns the requirements of the navigation slice it selected.

## Purpose

Make one primary navigation path answer "where am I, and which agent needs me" without
reading every row. The slice restructures the rail, the space strip's identity line and the
placement of global tools. It reuses existing rail state, attention state, tab names and
actions; it adds no agent registry, task store or notification system.

## Decisions so far (owner, 2026-10-06)

Taken from the HTML review of four treatments (Now, A attention-first, B project-first,
C slim shell) and a fifth, D, built from the review's recommendation:

1. **B is the base.** The rail is a flat tree, project › checkout › session row. Card-in-card
   nesting goes.
2. **C's full breadcrumb moves to the strip:** project › branch › space › session.
3. **Needs attention stays a popover** opened from a count chip on the strip, not a block at
   the top of the rail (treatment A was turned down: it duplicates rows and reorders the rail
   as states change).
4. **C becomes the rail's collapsed mode**, not a separate shell.
5. Keep three behaviours from the review: observed vs inferred vs stale stay distinguishable;
   Sessions separates Focus / Resume exact / Latest fallback; creating a worktree never starts
   an agent.

6. **Row leading edge: badge + quiet logos** (owner, 2026-10-06, chosen from six drawn
   candidates). The status mark sits on the corner of the agent logo, and logos of rows that
   do not need the user lose their brand colour. Turned down: status + logo as two columns
   (46px before the text, CLI named twice), status only (CLI identity only in words), the
   72% badge (easy to skip while scanning — the owner's objection), the large badge alone
   (every logo stays coloured, so the needs-you rows do not stand out) and status at the
   right edge (the eye has to leave the text column to scan for attention).
7. **Task label source (RAIL3)** (owner, 2026-10-07): the tab name; for an unnamed tab, the
   session's first user prompt — the only "title" Deck reads (Claude Code and Codex only); otherwise the agent label. Never an
   invented name.
8. **Project header count (RAIL2)** (owner, 2026-10-07): the needs-you count, red when any
   failed, takes the slot DL-27.27 gives the running-agent count. The running count leaves
   the header.
9. **Tools return to the rail (TOOLS1)** (owner, 2026-10-07): an icon row with tooltips at the
   rail's foot, reversing the hidden `Tools` footer (§28, 2026-08-17). Pane actions leave
   `More` for the pane header.
10. **Shipped as-is** (owner, 2026-10-07): slices 1–2 merged before their eye review. Their PRs'
    "Needs owner decision" items (badge size, quiet opacity, age source, narrow-width cost)
    stand as shipped unless the owner raises one; later slices do not reopen them.
11. **ATT-D3 leaves this queue** (owner, 2026-10-07): nothing retains a closed pane's attention, and a
    store for it sits on the close seam (an AGENTS.md fork). It needs its own spec.

## Requirements and acceptance criteria

IDs map to the parent's NAV1–3 and ATT1–3 where noted.

### Rail tree

- **RAIL1** (NAV1): Each project shows its checkouts by branch (worktrees marked), and each
  checkout lists its session rows. The checkout holding the focused pane is visibly current.
- **RAIL2**: A project header carries one count of sessions needing the user; it turns red
  when any of them failed. No count when nothing needs the user.
- **RAIL3**: A session row leads with a short task label, then a secondary line with what the
  agent is doing or asking. Several sessions of one CLI in one checkout remain distinguishable
  at the dense setting without hovering.
  Today's row ([`CardAgentRow`](../../src/ui/worktree-card-row.tsx)) is logo · text · model
  pill · trailing status cell (`CardLoad` bars while working, `CardMark` dot otherwise) · close.
  The folded card's strip already badges `CardMark` on the logo's corner at 5px (DL-27.21).
- **ROW1**: The row's state dot moves from the trailing cell onto the logo's corner, reusing
  the strip's badge mechanism at a larger, row-specific size (final size set at eye review;
  the 5px strip size is what the owner judged easy to skip). The ring stays legible on hover
  and on the focused row. Working keeps its trailing bars (DL-27.25's motion exception),
  so a working row carries no dot — one state signal per row, as today.
- **ROW2**: Rows needing the user (`asked`, `failed`) keep the logo's full ink; every other
  row's logo goes quiet. Colour images quiet by `opacity`, single-colour ink marks (Codex,
  Copilot, Grok, Kimi, Droid) by `--text-faint` ink, letter avatars stay as they are — no
  `filter` (DL-1.3). A quiet ink mark must read clearly apart from a full one.
- **ROW3**: Row text is unchanged (DL-27.15: tab name + sentence, or the agent label); the
  tooltip and accessible name keep the agent label and state word.
- **ROW4**: Reduced motion keeps every mark still; state is never carried by colour alone —
  failed, asked and ended keep their distinct fills or shape and their state words.
- **RAIL4**: Each checkout offers "New agent here" that opens the launcher **on that
  checkout**. The launcher's destination line shows Split only when the focused pane belongs
  to that checkout; otherwise it shows New space, and the launch does what the line said.
- **RAIL5** (NAV2): Selecting a row focuses that exact pane, switching space if needed; a
  pane outside the visible layout is never selected into an undrawn state.

### Strip identity and spaces

- **STRIP1** (NAV1): The strip prints project › branch › space › session for the focused pane,
  truncating from the least specific end at narrow widths.
- **STRIP2**: Space marks keep the rail's two inks — yellow for needs you, red for failed —
  instead of today's red for every needs-you state. The data already separates them
  ([`needsTone`](../../src/ui/spaces/space-model.ts)); only the paint is single-colour.
- **STRIP3**: Space marks show only the current project's spaces; other projects are reached
  through the rail. Ships with the rail tree, not before it.

### Needs attention popover (ATT1–3)

- **ATT-D1**: The chip shows the needs-you count and opens a short list of failed, asked
  (explicit and inferred) and finished-unchecked sessions, each with reason, place and age.
  Working, idle and unknown are counted in the footer, never listed.
- **ATT-D2** (ATT1): Choosing an entry focuses its exact pane and acknowledges only that
  entry. Esc closes the popover.
- **ATT-D3** (ATT1) — moved out of this spec (decision 11): A stale entry (pane closed) offers Resume of **that exact session** and
  Dismiss; it never silently focuses another pane or opens a generic list.
- **ATT-D4** (ATT3): No approve/deny or reply controls. ⌘⇧A keeps its meaning.

### Collapsed mode

- **COLLAPSE1**: A rail control collapses the tree to a column of project avatars with
  needs-you badges; an avatar opens a flyout with that project's checkouts and session rows.
  The strip breadcrumb stays, so identity survives collapse.
- **COLLAPSE2** (NAV3): Collapse/expand is keyboard reachable, keeps the focused pane and
  honours reduced motion.

### Tools and pane actions

- **TOOLS1** (NAV2): Global tools (Sessions, Usage, Files, Prompts, Browser, Settings) live in
  one place in the rail, separate from pane actions. Every existing shortcut keeps working.
- **TOOLS2**: Pane actions (split, expand, close) live on the pane header and in `More`;
  `More` no longer mixes them with global tools.

### Review coverage (NAV3)

- **REVIEW1**: Owner review covers sparse and dense agent lists, a narrow window, keyboard
  traversal (Tab, ↑/↓, Enter, ⌘1–9, ⌘⇧A), focus visibility and reduced motion, in the dev app
  rather than only the HTML mock.

## Delivery slices

The slices run strictly in order, one plan and one session each. The first row not `Done` is
the next work; its plan carries an Operating contract that is the agent's authorization, so a
session starts from that plan without asking again what it decides.

| Slice | Requirements | Plan | Status |
| --- | --- | --- | --- |
| 1. Row badge + quiet logos, two-ink space marks | ROW1–4, STRIP2 | [rail-row-badge](../plans/2026-10-06-rail-row-badge.md) | Done — PR #39, 2026-10-07 |
| 2. Needs attention popover | ATT-D1, D2, D4 | [attention-popover](../plans/2026-10-06-attention-popover.md) | Done — PR #40, 2026-10-07 |
| 3. Rail tree, breadcrumb, per-checkout launch | RAIL1–5, STRIP1, STRIP3 | [rail-tree](../plans/2026-10-07-rail-tree.md) | **Next** — plan approved 2026-10-07, ready to run |
| 4. Collapsed mode | COLLAPSE1–2 | written when slice 3 is Done | Queued |
| 5. Tools and pane actions | TOOLS1–2 | written when slice 4 is Done | Queued |

A session that finishes a slice sets its row to `Done` with the date and commits, then drafts
the next slice's plan with its Operating contract for owner approval; it does not start that
slice's code in the same session.

## Open decisions

None. Answered 2026-10-07 as decisions 7–11. **Mission Control** stays hidden
([`MISSION_CONTROL_BUTTON_HIDDEN`](../../src/ui/toolbar/deck-toolbar.tsx)); no slice restores
its button.

## Forks and constraints

- DL rules touched: §27 (rail rows and marks), §28 (rail footer), §35 (strip marks). ROW1–2
  amend **DL-27.21** (state and close share the trailing cell) and add the quiet-logo rule.
  Each is a fork under [AGENTS.md](../../AGENTS.md); the owner chose the direction on
  2026-10-06, and the rule text is approved with each implementation plan.
- **Earlier owner decisions this spec reverses** — each needs an explicit yes before its
  slice ships:
  - ROW1 reverses DL-27.21's agent-card-row clause, "the leading agent glyph carries no
    state badge" (2026-09-09). The owner's 2026-10-06 choice of badge + quiet logos is that
    reversal; the plan restates it in the amended rule text.
  - STRIP2 reverses DL-35.3's "no yellow on the spaces" (owner, 2026-09-29).
  - STRIP3 reverses DL-35.3's every-workspace marks (owner, 2026-09-28); approved 2026-10-07 with the slice 3 plan.
  - ATT-D1's chip brings back an aggregate needs-you control, which DL-27.26 removed from the
    sidebar (owner, 2026-09-21); the chip sits on the strip, not the sidebar.
  - RAIL2's needs-you count takes the slot DL-27.27 gives the running-agent count
    (owner, 2026-09-28).
  - TOOLS1 reverses the hidden rail footer (§28, 2026-08-17).
  - Answered 2026-10-06: the owner approved the reversals slices 1–2 need (DL-27.21 row
    badge, DL-35.3 yellow, DL-27.26 strip chip) with their plans' DL text.
  - Answered 2026-10-07: DL-27.27 (decision 8) and §28 (decision 9) are reversed; each
    slice's plan carries the rule text for approval with the plan.
- The HTML mock drew today's row as status + logo on the left; the real row is logo on the
  left with status trailing. ROW1's benefit is therefore where attention reads (on the logo,
  beside the name) and the quiet-logo contrast, not width saved.
- Not touched: PTY ownership, tab materialization, layout or close/quit coordination. If
  STRIP2 or RAIL5 needs a change there, stop and ask.
- Reuse [rail model](../../src/ui/agent-rail-model.ts) states and
  [attention](../../src/terminal/agent-attention.ts) confidence; the
  [notifier](../../src/terminal/agent-notifier.ts) policy is unchanged.
- Current behaviour to replace or keep is described in
  [internals/agent-rail.md](../internals/agent-rail.md); approved launcher behaviour in
  [space workflow refinements](../plans/2026-10-03-space-workflow-refinements.md) (card =
  Split, ⊕ = New space) stays.

## Evidence

- HTML mock, not committed: `docs/plans/2026-10-06-navigation-rail-mock/index.html` in the
  primary checkout (gitignored; Treatment `D · Recommended`, `Row` → `Badge + quiet logos`),
  screenshots in its `shots/` (`p1-d.png` is the chosen layout, `p1-row-badgeQ.png` the
  chosen row). It is a static specimen: it
  proves no runtime behaviour, data source or performance.
- Rail, strip, toolbar and launcher facts come from a read-only pass over the baseline
  checkout ([agent rail](../../src/ui/agent-rail.tsx),
  [space bar](../../src/ui/spaces/space-bar.tsx),
  [toolbar](../../src/ui/toolbar/deck-toolbar.tsx),
  [launcher](../../src/launcher/agent-launch-page.tsx)).

## Out of scope

Unified search, launcher redesign beyond RAIL4's entry point, prompt-at-launch, transcript
search, Settings, approve/deny from the popover, and any new execution capability.
