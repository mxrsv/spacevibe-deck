# Agent Board — model, treatment and specimen — plan, part 3 of 5: the stylesheet and the card (Tasks 7–8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Read [part 1](2026-09-03-agent-board-model-and-specimen.md) first — goal, architecture, the spec link and the Global Constraints every task below inherits. Tasks are numbered across the five parts.

---

### Task 7: `19-agent-board.css` and the gate assertions

**Files:**
- Create: `src/styles/19-agent-board.css`
- Modify: `src/styles.css` (append `@import "./styles/19-agent-board.css";` after the launcher import)
- Modify: `scripts/design-language.test.ts` (extend the DL-34 test)
- Test: `scripts/design-language.test.ts`

**Interfaces:**
- Produces the class contract Tasks 8–11 render against: `.agent-board`, `.agent-board__nav`, `.agent-board__main`, `.agent-board__heading`, `.agent-board__grid`, `.agent-board__empty`, `.agent-board__panel`, `.board-label`, `.board-nav__group`, `.board-nav__row`, `.board-nav__count`, `.board-card` (+ `[data-state]`, `[aria-current="true"]`, `[data-departed]`), `.board-card__hit`, `.board-card__state`, `.board-card__num`, `.board-card__glyph`, `.board-card__name`, `.board-card__where`, `.board-card__what`, `.board-card__meta`, `.board-card__actions`, `.board-card__menu`, `.board-panel__title`, `.board-panel__kv`, `.board-panel__key`, `.board-panel__value`, `.board-panel__snapshot`, `.board-panel__reply`, `.board-panel__notice`, `.board-panel__actions`.

- [ ] **Step 1: Extend the failing gate test** — add to the `DL-34 agent board` test body:

```ts
    const index = readFileSync(STYLESHEET, "utf8");
    expect(index).toContain('@import "./styles/19-agent-board.css";');
    // DL-34.5: one face over the subtree, from the token.
    expect(css).toMatch(/\.agent-board\s*\{[^}]*font-family:\s*var\(--board-font\)/s);
    // DL-4.3's third exception, on exactly this class.
    expect(css).toMatch(/\.board-label\s*\{[^}]*text-transform:\s*uppercase/s);
    expect(css).toMatch(/\.board-label\s*\{[^}]*letter-spacing:\s*var\(--label-tracking\)/s);
    // DL-34.3: the frame carries state; the rail's ripple is off on the Board.
    expect(css).toMatch(/\.board-card\[data-state="asked"\]\s*\{[^}]*var\(--status-unread\)/s);
    expect(css).toMatch(/\.agent-board \.asr-row__mark\[data-state="asked"\]::after\s*\{[^}]*animation:\s*none/s);
    // DL-1.3: no blurred shadow anywhere in the sheet.
    const board = readFileSync(join(ROOT, "src/styles/19-agent-board.css"), "utf8").replace(CSS_COMMENT, "");
    expect(board).not.toMatch(/box-shadow:\s*(?!inset 0 0 0 1px)/);
```

- [ ] **Step 2: Run** — `npx vitest run scripts/design-language.test.ts -t "DL-34"` → FAIL on the import.

- [ ] **Step 3: Write the stylesheet** `src/styles/19-agent-board.css`:

```css
/* ── The Agent Board (DL §34) ─────────────────────────────────────────────
   A stage surface: a STATUS/PROJECTS nav, a grid of cards, a detail panel.
   One face over the subtree (DL-34.5, DL-4.1 amended), sizes from the DL-4.4
   ladder only, hierarchy from weight, case and tone. Every colour is a token;
   every radius is `--radius-control` (DL-20.1). No blurred shadow (DL-1.3). */

.agent-board {
  /* DL-34.5 / DL-4.1: the one place chrome is monospace. */
  font-family: var(--board-font);
  font-size: var(--type-body);
  color: var(--text-primary);
  background: var(--bg); /* DL-18.7: the stage is the deepest plane. */
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: clip;
}

.agent-board[data-panel="open"] {
  grid-template-columns: 200px minmax(0, 1fr) 360px;
}

/* DL-4.3's third exception: two nav headings and the state word. */
.board-label {
  font-size: var(--type-meta);
  font-weight: 400;
  text-transform: uppercase;
  letter-spacing: var(--label-tracking);
  color: var(--text-faint);
}

/* ── nav ── */
.agent-board__nav {
  background: var(--sidebar-bg); /* DL-29.6: the chrome plane. */
  border-right: 1px solid var(--seam-recessed);
  padding: 12px 8px;
  box-sizing: border-box;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.board-nav__group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.board-nav__group > .board-label {
  padding: 0 8px 6px;
}

.board-nav__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--type-meta); /* DL-34.5: nav rows sit on the meta rung (spec §9.2). */
  text-align: left;
  cursor: default;
  transition: background-color var(--duration) var(--ease); /* DL-21.5 */
}

.board-nav__row:hover {
  background: var(--state-hover-bg); /* DL-21.2 */
}

.board-nav__row[aria-selected="true"] {
  background: var(--tab-active-bg); /* DL-21.1 */
}

.board-nav__row:focus-visible {
  outline: 2px solid var(--accent); /* DL-21.3 */
  outline-offset: -2px;
}

.board-nav__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-nav__count {
  font-size: var(--type-meta);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums; /* DL-4.2 */
}

/* ── main ── */
.agent-board__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 12px 16px;
  box-sizing: border-box;
  gap: 12px;
  overflow-y: auto;
}

.agent-board__heading {
  font-size: var(--type-meta);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.agent-board__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
  align-content: start;
}

.agent-board__empty {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-muted);
}

/* ── card (DL-34.2, DL-34.3, DL-34.4) ── */
.board-card {
  position: relative; /* DL-27.1: a container with a full-bleed hit layer. */
  display: grid;
  grid-template-rows: auto auto auto auto auto;
  gap: 4px;
  padding: 10px 12px;
  box-sizing: border-box;
  border-radius: var(--radius-control);
  background: var(--tab-rest-bg); /* DL-21.7, amended: the resting wash. */
  /* DL-1.3's inset hairline is the frame; DL-34.3 colours it by state. */
  box-shadow: inset 0 0 0 1px var(--hair);
  transition: background-color var(--duration) var(--ease);
}

.board-card:hover {
  background: var(--state-hover-bg);
}

.board-card[aria-current="true"] {
  background: var(--tab-active-bg); /* DL-34.4 with DL-27.22's token. */
}

.board-card[data-state="asked"] {
  box-shadow: inset 0 0 0 1px var(--status-unread); /* DL-34.3 */
}

.board-card[data-state="failed"] {
  box-shadow: inset 0 0 0 1px var(--red); /* DL-34.3 */
}

/* DL-34.3: the frame is the whole `asked` signal; the rail's ripple stays on
   the rail, where its disc is sized against the list's edge. */
.agent-board .asr-row__mark[data-state="asked"]::after {
  animation: none;
  display: none;
}

.board-card__hit {
  position: absolute;
  inset: 0;
  border: 0;
  border-radius: var(--radius-control); /* DL-20.1: `inherit` is not a rung the gate accepts. */
  background: transparent;
  cursor: default;
  padding: 0;
}

.board-card__hit:focus-visible {
  outline: 2px solid var(--accent); /* DL-21.3 */
  outline-offset: -2px;
}

/* Text rows above the hit layer, clicks falling through. Listed by class:
   `:not(.board-card__hit)` is (0,2,0) and would outrank the actions and menu. */
.board-card > .board-card__row,
.board-card > .board-card__where,
.board-card > .board-card__what,
.board-card > .board-card__meta {
  position: relative;
  pointer-events: none;
}

.board-card__row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.board-card__state {
  flex: 1 1 auto;
}

.board-card[data-state="asked"] .board-card__state {
  color: var(--status-unread); /* DL-27.6 */
}

.board-card[data-state="failed"] .board-card__state {
  color: var(--red); /* DL-3.2 */
}

.board-card__num {
  font-size: var(--type-meta);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.board-card__glyph {
  width: 15px;
  height: 15px;
  flex: 0 0 15px;
  border-radius: 50%;
}

.board-card__glyph--letter {
  display: grid;
  place-items: center;
  font-size: var(--type-meta); /* DL-34.5: no `--type-micro` on the Board (spec §9.2). */
  color: var(--text-muted);
  background: var(--state-hover-bg);
}

.board-card__name {
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.board-card__where,
.board-card__meta {
  font-size: var(--type-meta);
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.board-card__what {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-height: 1.4em;
}

.board-card__what-prefix {
  color: var(--text-faint);
  margin-right: 6px;
}

/* DL-27.5: a fixed trailing column, revealed on hover or focus. */
.board-card__actions {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 2px;
  opacity: 0;
  pointer-events: auto;
  transition: opacity var(--duration) var(--ease);
}

.board-card:hover .board-card__actions,
.board-card:focus-within .board-card__actions,
.board-card[data-menu="open"] .board-card__actions {
  opacity: 1;
}

.board-card__menu {
  position: absolute;
  top: 34px;
  right: 8px;
  z-index: 2;
  min-width: 160px;
  padding: 4px;
  box-sizing: border-box;
  border-radius: var(--radius-control);
  background: var(--chrome-2);
  box-shadow: inset 0 0 0 1px var(--hair-strong);
  pointer-events: auto;
  display: flex;
  flex-direction: column;
}

.board-card__menu-row {
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--radius-control);
  cursor: default;
}

.board-card__menu-row:hover,
.board-card__menu-row:focus-visible {
  background: var(--state-hover-bg);
  outline: none;
}

/* ── panel (DL-34.6, DL-34.7) ── */
.agent-board__panel {
  background: var(--sidebar-bg);
  border-left: 1px solid var(--seam-recessed);
  padding: 12px 14px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow-y: auto;
}

.board-panel__title {
  font-size: var(--type-title);
  font-weight: 600;
  margin: 0;
}

.board-panel__kv {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  column-gap: 12px;
  row-gap: 4px;
  line-height: 1.5;
  margin: 0;
}

.board-panel__key {
  font-size: var(--type-meta);
  color: var(--text-faint);
}

.board-panel__value {
  margin: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.board-panel__confidence {
  color: var(--text-faint);
}

.board-panel__snapshot {
  margin: 0;
  padding: 8px 10px;
  box-sizing: border-box;
  border-radius: var(--radius-control);
  background: var(--bg);
  box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--text-muted);
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 40vh;
  overflow-y: auto;
}

.board-panel__reply {
  width: 100%;
  min-height: 32px;
  max-height: 96px;
  padding: 6px 8px;
  box-sizing: border-box;
  border: 0;
  border-radius: var(--radius-control);
  background: var(--input-bg);
  box-shadow: inset 0 0 0 1px var(--hair);
  color: var(--text-primary);
  font: inherit;
  resize: none;
}

.board-panel__reply:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.board-panel__reply:disabled {
  color: var(--text-faint); /* DL-21.4 */
}

.board-panel__notice {
  font-size: var(--type-meta);
  color: var(--text-faint);
  margin: 0;
}

.board-panel__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.board-panel__action {
  border: 0;
  border-radius: var(--radius-control);
  background: var(--state-hover-bg);
  color: var(--text-primary);
  font: inherit;
  padding: 5px 10px;
  cursor: default;
}

.board-panel__action:hover {
  background: var(--tab-active-bg);
}

.board-panel__action:disabled {
  color: var(--text-faint);
  background: transparent;
}

```

The fold rule (spec §5.7: below a width the specimen measures, the panel COVERS the grid rather than squeezing it) is deliberately not in this sheet yet — its breakpoint is a figure Task 12's specimen produces, and a guessed `@media` width would be the literal DL-4.5 forbids. The wiring plan adds it with the measured number.

Confirm every token used exists in `01-tokens.css` (`--duration`, `--ease`, `--accent`, `--chrome-2`, `--input-bg`); if `--duration`/`--ease` are named differently there, use the DL-20.2 names the file declares.

- [ ] **Step 4: Import and run the gate** — append `@import "./styles/19-agent-board.css";` to `src/styles.css`; `npx vitest run scripts/design-language.test.ts` → every test green except the baseline invariant (part 1, Task 1 step 8: `resolves every cited rule` lists exactly the nine pre-existing citations, no more): typography policy still `[]` because `.board-label` is allowlisted, radius scan clean, DL-34 test green.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/styles/19-agent-board.css src/styles.css scripts/design-language.test.ts && npx prettier --check src/styles/19-agent-board.css src/styles.css scripts/design-language.test.ts
git commit -m "style(board): add the agent board treatment under DL §34

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/styles/19-agent-board.css src/styles.css scripts/design-language.test.ts
```

---

### Task 8: `agent-board-card.tsx`

**Files:**
- Create: `src/ui/agent-board-card.tsx`
- Test: `src/ui/agent-board-card.test.tsx`

**Interfaces:**
- Consumes: `BoardCard`, `STATE_WORD` from `./agent-board-model`; `RailStatusMark` from `./controls/rail-status-mark`; `AgentGlyph` from `./controls/agent-glyph`; `DeckIcon`, `ROW_ICON` from `./controls/deck-icon`; Phosphor `Stop`, `ArrowCounterClockwise`, `ArrowsOutSimple`, `DotsThreeOutline`.
- Produces:

```ts
export interface BoardCardActions {
  onSelect(card: BoardCard | null): void;   // null = close the panel (Task 11's Escape)
  onOpenInStage(card: BoardCard): void;
  onStop(card: BoardCard): void;
  onRestart(card: BoardCard): void;
  onClose(card: BoardCard): void;
}
export interface AgentBoardCardProps {
  readonly card: BoardCard;
  readonly actions: BoardCardActions;
  readonly tabIndex: 0 | -1;                 // roving focus, owned by the grid
  readonly onFocusRequest(card: BoardCard): void;
}
export function AgentBoardCard(props: AgentBoardCardProps): JSX.Element;
export function formatRank(rank: number): string; // 1 → "01"
```

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

vi.mock("./controls/deck-icon", () => ({
  ROW_ICON: 14,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import type { BoardCard } from "./agent-board-model";
import { AgentBoardCard, formatRank, type BoardCardActions } from "./agent-board-card";

function card(over: Partial<BoardCard> = {}): BoardCard {
  return {
    paneId: 11, tabIndex: 0, ordinal: 3, rank: 3, agent: "claude", departed: false, state: "asked",
    name: "Claude", where: "deck · main", checkoutKey: "k", checkout: "main", branch: "main",
    directory: "/Users/deck/spacevibe-deck", what: { kind: "task", text: "Refactor the rail" },
    task: "Refactor the rail", tail: null, up: "12m", changed: "2m", confidence: "explicit", selected: false,
    ...over,
  };
}
function actions(): BoardCardActions & Record<keyof BoardCardActions, ReturnType<typeof vi.fn>> {
  return { onSelect: vi.fn(), onOpenInStage: vi.fn(), onStop: vi.fn(), onRestart: vi.fn(), onClose: vi.fn() };
}
function mount(c: BoardCard, a = actions()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // `act` flushes Preact's effects before the assertions read the DOM.
  act(() => {
    render(<AgentBoardCard card={c} actions={a} tabIndex={0} onFocusRequest={() => {}} />, host);
  });
  return { host, a };
}

describe("AgentBoardCard", () => {
  it("prints the five rows with the state word, rank, glyph, name, where, task and meta", () => {
    const { host } = mount(card());
    const el = host.querySelector(".board-card")!;
    expect(el.getAttribute("data-state")).toBe("asked");
    expect(host.querySelector(".board-card__state")!.textContent).toBe("asked");
    expect(host.querySelector(".board-card__state")!.classList.contains("board-label")).toBe(true);
    expect(host.querySelector(".board-card__num")!.textContent).toBe("03");
    expect(host.querySelector(".board-card__glyph")).not.toBeNull();
    expect(host.querySelector(".board-card__name")!.textContent).toBe("Claude");
    expect(host.querySelector(".board-card__where")!.textContent).toBe("deck · main");
    expect(host.querySelector(".board-card__what")!.textContent).toBe("TaskRefactor the rail");
    expect(host.querySelector(".board-card__meta")!.textContent).toBe("up 12m · 2m");
  });
  it("prints -- for an unknown uptime and nothing on row 4 when there is nothing", () => {
    const { host } = mount(card({ up: "", what: { kind: "none", text: "" } }));
    expect(host.querySelector(".board-card__meta")!.textContent).toBe("up -- · 2m");
    expect(host.querySelector(".board-card__what")!.getAttribute("data-kind")).toBe("none");
  });
  it("marks the selected card with aria-current and a departed one with data-departed", () => {
    const { host } = mount(card({ selected: true, departed: true, state: "idle" }));
    const el = host.querySelector(".board-card")!;
    expect(el.getAttribute("aria-current")).toBe("true");
    expect(el.hasAttribute("data-departed")).toBe(true);
  });
  it("selects on click and opens in stage on double click", () => {
    const { host, a } = mount(card());
    const hit = host.querySelector<HTMLButtonElement>(".board-card__hit")!;
    act(() => hit.click());
    expect(a.onSelect).toHaveBeenCalledTimes(1);
    act(() => hit.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(a.onOpenInStage).toHaveBeenCalledTimes(1);
  });
  it("offers Stop on a live card and Restart on a departed one, and Close only in More", () => {
    const live = mount(card());
    expect(live.host.querySelector("[data-action='stop']")).not.toBeNull();
    expect(live.host.querySelector("[data-action='restart']")).toBeNull();
    expect(live.host.querySelector(".board-card__actions [data-action='close']")).toBeNull();
    act(() => live.host.querySelector<HTMLButtonElement>("[data-action='more']")!.click());
    expect(live.host.querySelector(".board-card__menu [data-action='close']")).not.toBeNull();
    act(() => live.host.querySelector<HTMLButtonElement>(".board-card__menu [data-action='close']")!.click());
    expect(live.a.onClose).toHaveBeenCalledTimes(1);
    const gone = mount(card({ departed: true, state: "idle" }));
    expect(gone.host.querySelector("[data-action='restart']")).not.toBeNull();
    expect(gone.host.querySelector("[data-action='stop']")).toBeNull();
  });
  it("carries the tier in the accessible name", () => {
    const { host } = mount(card({ confidence: "inferred", state: "working" }));
    expect(host.querySelector(".board-card__hit")!.getAttribute("aria-label")).toBe("Claude, working, inferred, deck · main");
  });
});

describe("formatRank", () => {
  it("zero-pads to two digits", () => {
    expect(formatRank(1)).toBe("01");
    expect(formatRank(12)).toBe("12");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/ui/agent-board-card.test.tsx` → FAIL, module not found.

- [ ] **Step 3: Implement** `src/ui/agent-board-card.tsx`:

```tsx
import { ArrowCounterClockwise, ArrowsOutSimple, DotsThreeOutline, Stop } from "@phosphor-icons/react";
import { useState } from "preact/hooks";
import { STATE_WORD, type BoardCard } from "./agent-board-model";
import { AgentGlyph } from "./controls/agent-glyph";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";
import { RailStatusMark } from "./controls/rail-status-mark";

/**
 * One Agent Board card (spec §5.3–§5.6, DL-34.2–DL-34.4). A DL-27.1
 * container with a full-bleed hit layer, five rows, a DL-27.5 hover column
 * and a `More` menu that holds every action for the keyboard.
 */
export interface BoardCardActions {
  /** `null` closes the panel — the composition's Escape sends it. */
  onSelect(card: BoardCard | null): void;
  onOpenInStage(card: BoardCard): void;
  onStop(card: BoardCard): void;
  onRestart(card: BoardCard): void;
  onClose(card: BoardCard): void;
}

export interface AgentBoardCardProps {
  readonly card: BoardCard;
  readonly actions: BoardCardActions;
  readonly tabIndex: 0 | -1;
  readonly onFocusRequest: (card: BoardCard) => void;
}

export function formatRank(rank: number): string {
  return rank < 10 ? `0${rank}` : String(rank);
}

function accessibleName(card: BoardCard): string {
  const tier = card.confidence === "inferred" ? ", inferred" : "";
  return `${card.name}, ${STATE_WORD[card.state]}${tier}, ${card.where}`;
}

export function AgentBoardCard({ card, actions, tabIndex, onFocusRequest }: AgentBoardCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const word = STATE_WORD[card.state];
  const stopOrRestart = card.departed ? (
    <button
      type="button"
      class="iconbtn"
      data-action="restart"
      aria-label={`Restart ${card.name}`}
      onClick={(event) => {
        event.stopPropagation();
        actions.onRestart(card);
      }}
    >
      <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
    </button>
  ) : (
    <button
      type="button"
      class="iconbtn"
      data-action="stop"
      aria-label={`Stop ${card.name}`}
      onClick={(event) => {
        event.stopPropagation();
        actions.onStop(card);
      }}
    >
      <DeckIcon icon={Stop} size={ROW_ICON} />
    </button>
  );

  return (
    <article
      class="board-card"
      data-state={card.state}
      data-pane-id={card.paneId}
      data-departed={card.departed ? "" : undefined}
      data-menu={menuOpen ? "open" : undefined}
      aria-current={card.selected ? "true" : undefined}
    >
      <button
        type="button"
        class="board-card__hit"
        tabIndex={tabIndex}
        aria-label={accessibleName(card)}
        onClick={() => actions.onSelect(card)}
        onDblClick={() => actions.onOpenInStage(card)}
        onFocus={() => onFocusRequest(card)}
      />
      <div class="board-card__row">
        <RailStatusMark state={card.state} />
        <span class="board-label board-card__state">{word}</span>
        <span class="board-card__num">{formatRank(card.rank)}</span>
      </div>
      <div class="board-card__row">
        <AgentGlyph agent={card.agent} className="board-card__glyph" />
        <span class="board-card__name">{card.name}</span>
      </div>
      <div class="board-card__where">{card.where}</div>
      <div class="board-card__what" data-kind={card.what.kind}>
        {card.what.kind === "task" && <span class="board-card__what-prefix">Task</span>}
        {card.what.text}
      </div>
      <div class="board-card__meta">{`up ${card.up === "" ? "--" : card.up} · ${card.changed === "" ? "--" : card.changed}`}</div>
      <div class="board-card__actions">
        {stopOrRestart}
        <button
          type="button"
          class="iconbtn"
          data-action="open"
          aria-label={`Open ${card.name} in stage`}
          onClick={(event) => {
            event.stopPropagation();
            actions.onOpenInStage(card);
          }}
        >
          <DeckIcon icon={ArrowsOutSimple} size={ROW_ICON} />
        </button>
        <button
          type="button"
          class="iconbtn"
          data-action="more"
          aria-label={`More actions for ${card.name}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((open) => !open);
          }}
        >
          <DeckIcon icon={DotsThreeOutline} size={ROW_ICON} />
        </button>
      </div>
      {menuOpen && (
        <div
          class="board-card__menu"
          role="menu"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // The Board's own Escape (panel, then step back) must not fire too.
              event.stopPropagation();
              setMenuOpen(false);
            }
          }}
        >
          <button type="button" role="menuitem" class="board-card__menu-row" data-action="open" onClick={() => { setMenuOpen(false); actions.onOpenInStage(card); }}>
            Open in stage
          </button>
          {card.departed ? (
            <button type="button" role="menuitem" class="board-card__menu-row" data-action="restart" onClick={() => { setMenuOpen(false); actions.onRestart(card); }}>
              Restart
            </button>
          ) : (
            <button type="button" role="menuitem" class="board-card__menu-row" data-action="stop" onClick={() => { setMenuOpen(false); actions.onStop(card); }}>
              Stop
            </button>
          )}
          <button type="button" role="menuitem" class="board-card__menu-row" data-action="close" onClick={() => { setMenuOpen(false); actions.onClose(card); }}>
            Close
          </button>
        </div>
      )}
    </article>
  );
}
```

`AgentGlyph` renders `${className}--letter` for a declared agent; `.board-card__glyph--letter` is styled in Task 7.

- [ ] **Step 4: Run** — `npx vitest run src/ui/agent-board-card.test.tsx` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/agent-board-card.tsx src/ui/agent-board-card.test.tsx && npx prettier --check src/ui/agent-board-card.tsx src/ui/agent-board-card.test.tsx
git commit -m "feat(board): draw the agent card with its state frame, hover column and More menu

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/agent-board-card.tsx src/ui/agent-board-card.test.tsx
```

---

