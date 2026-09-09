# Agent Board — model, treatment and specimen — plan, part 4 of 5: nav, panel and composition (Tasks 9–11)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Read [part 1](2026-09-03-agent-board-model-and-specimen.md) first — goal, architecture, the spec link and the Global Constraints every task below inherits. Tasks are numbered across the five parts.

---

### Task 9: `agent-board-nav.tsx`

**Files:**
- Create: `src/ui/agent-board-nav.tsx`
- Test: `src/ui/agent-board-nav.test.tsx`

**Interfaces:**
- Consumes: `BoardStatusRow`, `BoardProjectRow`, `BoardStatusFilter` from `./agent-board-model`.
- Produces:

```ts
export interface AgentBoardNavProps {
  readonly status: readonly BoardStatusRow[];
  readonly projects: readonly BoardProjectRow[];
  readonly onStatusFilter: (filter: BoardStatusFilter) => void;
  readonly onProjectFilter: (key: string | null) => void;
}
export function AgentBoardNav(props: AgentBoardNavProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { AgentBoardNav } from "./agent-board-nav";

const STATUS = [
  { filter: "all" as const, label: "All", count: 6, active: true },
  { filter: "asked" as const, label: "Asked", count: 1, active: false },
];
const PROJECTS = [
  { key: "deck", label: "deck · main", count: 4, active: false },
  { key: "fix", label: "deck · fix-rail · fix/rail", count: 2, active: false },
];

describe("AgentBoardNav", () => {
  it("renders STATUS then PROJECTS as two labelled listboxes with counts", () => {
    const host = document.createElement("div");
    act(() => {
      render(<AgentBoardNav status={STATUS} projects={PROJECTS} onStatusFilter={() => {}} onProjectFilter={() => {}} />, host);
    });
    const labels = [...host.querySelectorAll(".board-label")].map((el) => el.textContent);
    expect(labels).toEqual(["Status", "Projects"]);
    const rows = [...host.querySelectorAll(".board-nav__row")].map((el) => el.textContent);
    expect(rows).toEqual(["All6", "Asked1", "deck · main4", "deck · fix-rail · fix/rail2"]);
    expect(host.querySelector(".board-nav__row[aria-selected='true']")!.textContent).toBe("All6");
    expect(host.querySelectorAll("[role='listbox']").length).toBe(2);
  });
  it("reports a status pick and toggles a project pick off on a second press", () => {
    const onStatus = vi.fn();
    const onProject = vi.fn();
    const host = document.createElement("div");
    act(() => {
      render(<AgentBoardNav status={STATUS} projects={[{ ...PROJECTS[0], active: true }]} onStatusFilter={onStatus} onProjectFilter={onProject} />, host);
    });
    act(() => host.querySelectorAll<HTMLButtonElement>(".board-nav__row")[1].click());
    expect(onStatus).toHaveBeenCalledWith("asked");
    act(() => host.querySelectorAll<HTMLButtonElement>(".board-nav__row")[2].click());
    expect(onProject).toHaveBeenCalledWith(null);
  });
});
```

Note the headings are written `Status` / `Projects` in the markup and become `STATUS` / `PROJECTS` through `.board-label`'s `text-transform` — DL-4.3's third exception is a treatment, so the DOM text stays sentence-case (a screen reader reads a word, not a shout).

- [ ] **Step 2: Run** — `npx vitest run src/ui/agent-board-nav.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import type { BoardProjectRow, BoardStatusFilter, BoardStatusRow } from "./agent-board-model";

/** STATUS then PROJECTS (spec §6, DL-34.8): two listboxes, totals not filtered. */
export interface AgentBoardNavProps {
  readonly status: readonly BoardStatusRow[];
  readonly projects: readonly BoardProjectRow[];
  readonly onStatusFilter: (filter: BoardStatusFilter) => void;
  readonly onProjectFilter: (key: string | null) => void;
}

export function AgentBoardNav({ status, projects, onStatusFilter, onProjectFilter }: AgentBoardNavProps) {
  return (
    <nav class="agent-board__nav" aria-label="Agent Board filters">
      <div class="board-nav__group">
        <span class="board-label" id="board-nav-status">Status</span>
        <div role="listbox" aria-labelledby="board-nav-status">
          {status.map((row) => (
            <button
              key={row.filter}
              type="button"
              role="option"
              class="board-nav__row"
              aria-selected={row.active}
              onClick={() => onStatusFilter(row.filter)}
            >
              <span class="board-nav__label">{row.label}</span>
              <span class="board-nav__count">{row.count}</span>
            </button>
          ))}
        </div>
      </div>
      {projects.length > 0 && (
        <div class="board-nav__group">
          <span class="board-label" id="board-nav-projects">Projects</span>
          <div role="listbox" aria-labelledby="board-nav-projects">
            {projects.map((row) => (
              <button
                key={row.key}
                type="button"
                role="option"
                class="board-nav__row"
                aria-selected={row.active}
                onClick={() => onProjectFilter(row.active ? null : row.key)}
              >
                <span class="board-nav__label">{row.label}</span>
                <span class="board-nav__count">{row.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
```

- [ ] **Step 4: Run** — `npx vitest run src/ui/agent-board-nav.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/agent-board-nav.tsx src/ui/agent-board-nav.test.tsx && npx prettier --check src/ui/agent-board-nav.tsx src/ui/agent-board-nav.test.tsx
git commit -m "feat(board): draw the STATUS then PROJECTS nav

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/agent-board-nav.tsx src/ui/agent-board-nav.test.tsx
```

---

### Task 10: `agent-board-panel.tsx`

**Files:**
- Create: `src/ui/agent-board-panel.tsx`
- Test: `src/ui/agent-board-panel.test.tsx`

**Interfaces:**
- Consumes: `BoardCard`, `STATE_WORD` from `./agent-board-model`; `BoardCardActions` from `./agent-board-card`.
- Produces:

```ts
export interface BoardPanelState {
  readonly snapshot: string | null;      // plain text, already stripped and row-limited
  readonly replyEnabled: boolean;         // live agent AND hasRun (wiring decides)
  readonly replyNotice: string | null;    // "placed — confirm in the terminal", gate words
  readonly sending: boolean;
  readonly paneExited: boolean;
}
export interface AgentBoardPanelProps {
  readonly card: BoardCard;
  readonly state: BoardPanelState;
  readonly actions: BoardCardActions;
  readonly onReply: (card: BoardCard, text: string) => void;
  readonly autoFocusReply: boolean;       // true when the card is `asked` (owner rule)
}
export function AgentBoardPanel(props: AgentBoardPanelProps): JSX.Element;
```

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { BoardCard } from "./agent-board-model";
import { AgentBoardPanel, type BoardPanelState } from "./agent-board-panel";

function card(over: Partial<BoardCard> = {}): BoardCard {
  return {
    paneId: 11, tabIndex: 0, ordinal: 3, rank: 3, agent: "claude", departed: false, state: "asked",
    name: "Claude", where: "deck · main", checkoutKey: "k", checkout: "main", branch: "main",
    directory: "/Users/deck/spacevibe-deck", what: { kind: "task", text: "Refactor" },
    task: "Refactor\nthe rail", tail: "Done with tests", up: "12m", changed: "2m", confidence: "inferred", selected: true,
    ...over,
  };
}
const READY: BoardPanelState = { snapshot: "$ claude\n> working", replyEnabled: true, replyNotice: null, sending: false, paneExited: false };
const noop = { onSelect: vi.fn(), onOpenInStage: vi.fn(), onStop: vi.fn(), onRestart: vi.fn(), onClose: vi.fn() };

function mount(c: BoardCard, state = READY, onReply = vi.fn(), autoFocus = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // `act` flushes the focus effect before `document.activeElement` is read.
  act(() => {
    render(<AgentBoardPanel card={c} state={state} actions={noop} onReply={onReply} autoFocusReply={autoFocus} />, host);
  });
  return { host, onReply };
}

describe("AgentBoardPanel", () => {
  it("prints the title and the key-value rows, omitting rows with no value", () => {
    const { host } = mount(card({ branch: null, task: null, tail: null }));
    expect(host.querySelector(".board-panel__title")!.textContent).toBe("Claude");
    const keys = [...host.querySelectorAll(".board-panel__key")].map((el) => el.textContent);
    expect(keys).toEqual(["State", "Checkout", "Directory", "Up", "Changed"]);
    expect(host.querySelector(".board-panel__value")!.textContent).toBe("asked · inferred");
  });
  it("wraps the full task and marks it placed until the pane has run", () => {
    const { host } = mount(card({ what: { kind: "tail", text: "Done with tests" } }));
    const task = [...host.querySelectorAll(".board-panel__value")].find((el) => el.textContent?.startsWith("Refactor"))!;
    expect(task.textContent).toBe("Refactor\nthe rail — placed, not sent");
  });
  it("shows the snapshot and sends on Enter, not on Shift+Enter", () => {
    const { host, onReply } = mount(card());
    expect(host.querySelector(".board-panel__snapshot")!.textContent).toBe("$ claude\n> working");
    const box = host.querySelector<HTMLTextAreaElement>(".board-panel__reply")!;
    box.value = "continue";
    act(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true })));
    expect(onReply).not.toHaveBeenCalled();
    act(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ paneId: 11 }), "continue");
  });
  it("disables the reply box and prints the notice when the wiring says so", () => {
    const { host } = mount(card(), { ...READY, replyEnabled: false, replyNotice: "placed — confirm in the terminal" });
    expect(host.querySelector<HTMLTextAreaElement>(".board-panel__reply")!.disabled).toBe(true);
    expect(host.querySelector(".board-panel__notice")!.textContent).toBe("placed — confirm in the terminal");
  });
  it("offers Restart not Stop for a departed card, and disables both when the pane exited", () => {
    const gone = mount(card({ departed: true, state: "idle" }));
    expect(gone.host.querySelector(".board-panel__actions [data-action='restart']")).not.toBeNull();
    expect(gone.host.querySelector(".board-panel__actions [data-action='stop']")).toBeNull();
    const dead = mount(card({ departed: true, state: "idle" }), { ...READY, paneExited: true, replyEnabled: false });
    expect(dead.host.querySelector<HTMLButtonElement>(".board-panel__actions [data-action='restart']")!.disabled).toBe(true);
  });
  it("focuses the reply box on mount when asked to, and the panel itself otherwise", () => {
    const { host } = mount(card(), READY, vi.fn(), true);
    expect(document.activeElement).toBe(host.querySelector(".board-panel__reply"));
    const other = mount(card({ state: "working" }), READY, vi.fn(), false);
    expect(document.activeElement).toBe(other.host.querySelector(".agent-board__panel"));
  });
  it("grows the reply box with its content up to four lines", () => {
    const { host } = mount(card());
    const box = host.querySelector<HTMLTextAreaElement>(".board-panel__reply")!;
    expect(box.rows).toBe(1);
    box.value = "a\nb\nc";
    act(() => box.dispatchEvent(new Event("input", { bubbles: true })));
    expect(box.rows).toBe(3);
    box.value = "a\nb\nc\nd\ne\nf";
    act(() => box.dispatchEvent(new Event("input", { bubbles: true })));
    expect(box.rows).toBe(4);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/ui/agent-board-panel.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useRef } from "preact/hooks";
import type { BoardCardActions } from "./agent-board-card";
import { STATE_WORD, type BoardCard } from "./agent-board-model";

/**
 * Tier 2 (spec §7, DL-34.6, DL-34.7): title, key-value rows, the scrollback
 * snapshot, the reply box, the actions. Every fact here is handed in; the
 * panel never reads a store, so the gallery can mount it over a fixture.
 */
export interface BoardPanelState {
  readonly snapshot: string | null;
  readonly replyEnabled: boolean;
  readonly replyNotice: string | null;
  readonly sending: boolean;
  readonly paneExited: boolean;
}

export interface AgentBoardPanelProps {
  readonly card: BoardCard;
  readonly state: BoardPanelState;
  readonly actions: BoardCardActions;
  readonly onReply: (card: BoardCard, text: string) => void;
  readonly autoFocusReply: boolean;
}

interface Row {
  readonly key: string;
  readonly value: string | null;
  readonly faintSuffix?: string;
}

function rows(card: BoardCard): readonly Row[] {
  const placed = card.task !== null && card.what.kind !== "task";
  return [
    { key: "State", value: STATE_WORD[card.state], faintSuffix: card.confidence === "inferred" ? " · inferred" : undefined },
    { key: "Checkout", value: card.checkout },
    { key: "Branch", value: card.branch },
    { key: "Directory", value: card.directory },
    { key: "Up", value: card.up === "" ? null : card.up },
    { key: "Changed", value: card.changed === "" ? null : card.changed },
    { key: "Task", value: card.task, faintSuffix: placed ? " — placed, not sent" : undefined },
    { key: "Last turn", value: card.tail },
  ];
}

const REPLY_MAX_ROWS = 4;

export function AgentBoardPanel({ card, state, actions, onReply, autoFocusReply }: AgentBoardPanelProps) {
  const reply = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLElement>(null);
  // Spec §7.4: an `asked` card opens with the reply box focused; otherwise
  // focus lands on the panel itself, so Escape and Tab start from here. Runs
  // ONCE per mount — the composition keys the panel by pane id, so a new card
  // is a new mount, and a later `replyEnabled` flip cannot steal focus from
  // the grid.
  useEffect(() => {
    if (autoFocusReply && state.replyEnabled) {
      reply.current?.focus();
    } else {
      root.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only, by design
  }, []);

  // "One line growing to four" (spec §7.4): the row count follows the text.
  const grow = (): void => {
    const box = reply.current;
    if (!box) return;
    const lines = box.value.split("\n").length;
    box.rows = Math.min(REPLY_MAX_ROWS, Math.max(1, lines));
  };

  const submit = (): void => {
    const box = reply.current;
    if (!box || !state.replyEnabled || state.sending) return;
    const text = box.value.trim();
    if (text === "") return;
    onReply(card, text);
    box.value = "";
    grow(); // back to one row
  };
  const busy = state.sending;

  return (
    <aside ref={root} class="agent-board__panel" aria-label={`${card.name} details`} tabIndex={-1}>
      <h2 class="board-panel__title">{card.name}</h2>
      <dl class="board-panel__kv">
        {rows(card).flatMap((row) =>
          row.value === null
            ? []
            : [
                <dt key={`${row.key}-k`} class="board-panel__key">
                  {row.key}
                </dt>,
                <dd key={`${row.key}-v`} class="board-panel__value">
                  {row.key === "State" ? <span class="board-label">{row.value}</span> : row.value}
                  {row.faintSuffix !== undefined && <span class="board-panel__confidence">{row.faintSuffix}</span>}
                </dd>,
              ],
        )}
      </dl>
      {state.snapshot !== null && <pre class="board-panel__snapshot">{state.snapshot}</pre>}
      <textarea
        ref={reply}
        class="board-panel__reply"
        rows={1}
        placeholder={state.replyEnabled ? "Reply — Enter sends, Shift+Enter breaks a line" : "No agent to answer"}
        disabled={!state.replyEnabled || busy}
        aria-label={`Reply to ${card.name}`}
        onInput={grow}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      {state.replyNotice !== null && <p class="board-panel__notice" role="status">{state.replyNotice}</p>}
      <div class="board-panel__actions">
        <button type="button" class="board-panel__action" data-action="open" disabled={busy} onClick={() => actions.onOpenInStage(card)}>
          Open in stage
        </button>
        {card.departed ? (
          <button type="button" class="board-panel__action" data-action="restart" disabled={busy || state.paneExited} onClick={() => actions.onRestart(card)}>
            Restart
          </button>
        ) : (
          <button type="button" class="board-panel__action" data-action="stop" disabled={busy || state.paneExited} onClick={() => actions.onStop(card)}>
            Stop
          </button>
        )}
        <button type="button" class="board-panel__action" data-action="close" disabled={busy} onClick={() => actions.onClose(card)}>
          Close
        </button>
      </div>
    </aside>
  );
}
```

The `State` row's value is the ONLY panel text in `.board-label` (spec §7.2); keys are sentence-case copy.

- [ ] **Step 4: Run** — `npx vitest run src/ui/agent-board-panel.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/agent-board-panel.tsx src/ui/agent-board-panel.test.tsx && npx prettier --check src/ui/agent-board-panel.tsx src/ui/agent-board-panel.test.tsx
git commit -m "feat(board): draw the detail panel with its snapshot and reply box

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/agent-board-panel.tsx src/ui/agent-board-panel.test.tsx
```

---

### Task 11: `agent-board.tsx` — composition, heading, empty states, keyboard

**Files:**
- Create: `src/ui/agent-board.tsx`
- Test: `src/ui/agent-board.test.tsx`

**Interfaces:**
- Consumes: `AgentBoardView`, `BoardCard`, `BoardStatusFilter`, `cardForDigit` from `./agent-board-model`; `AgentBoardCard`, `BoardCardActions` from `./agent-board-card`; `AgentBoardNav`; `AgentBoardPanel`, `BoardPanelState`.
- Produces — the contract the wiring plan mounts against:

```ts
export interface AgentBoardActions extends BoardCardActions {
  onReply(card: BoardCard, text: string): void;
  onStatusFilter(filter: BoardStatusFilter): void;
  onProjectFilter(key: string | null): void;
  onNewAgent(): void;        // empty state's launcher (§4.4)
  onEscape(): void;          // second Escape: step the Board back (DL-34.9)
}
export interface AgentBoardProps {
  readonly view: AgentBoardView;
  readonly actions: AgentBoardActions;
  readonly panel: BoardPanelState;   // the wiring computes it for the selected card
}
export function AgentBoard(props: AgentBoardProps): JSX.Element;
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

import { AgentBoard, type AgentBoardActions } from "./agent-board";
import type { AgentBoardView, BoardCard } from "./agent-board-model";
import type { BoardPanelState } from "./agent-board-panel";

function card(paneId: number, rank: number, state: BoardCard["state"], selected = false): BoardCard {
  return {
    paneId, tabIndex: 0, ordinal: rank, rank, agent: "claude", departed: false, state, name: `Agent ${rank}`,
    where: "deck · main", checkoutKey: "k", checkout: "main", branch: "main", directory: "/d",
    what: { kind: "none", text: "" }, task: null, tail: null, up: "", changed: "1m", confidence: null, selected,
  };
}
function view(cards: BoardCard[], selected: BoardCard | null = null): AgentBoardView {
  return {
    all: cards, cards, total: cards.length, shown: cards.length,
    status: [{ filter: "all", label: "All", count: cards.length, active: true }],
    projects: cards.length ? [{ key: "k", label: "deck · main", count: cards.length, active: false }] : [],
    selected,
  };
}
const PANEL: BoardPanelState = { snapshot: null, replyEnabled: false, replyNotice: null, sending: false, paneExited: false };
function actions(): AgentBoardActions & Record<string, ReturnType<typeof vi.fn>> {
  return {
    onSelect: vi.fn(), onOpenInStage: vi.fn(), onStop: vi.fn(), onRestart: vi.fn(), onClose: vi.fn(),
    onReply: vi.fn(), onStatusFilter: vi.fn(), onProjectFilter: vi.fn(), onNewAgent: vi.fn(), onEscape: vi.fn(),
  };
}
function mount(v: AgentBoardView, a = actions()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    render(<AgentBoard view={v} actions={a} panel={PANEL} />, host);
  });
  return { host, a };
}

describe("AgentBoard", () => {
  it("states the result in its heading and opens the panel for the selected card", () => {
    const cards = [card(1, 1, "asked", true), card(2, 2, "working")];
    const { host } = mount(view(cards, cards[0]));
    expect(host.querySelector(".agent-board__heading")!.textContent).toBe("2 of 2");
    expect(host.querySelector(".agent-board")!.getAttribute("data-panel")).toBe("open");
    expect(host.querySelector(".agent-board__panel .board-panel__title")!.textContent).toBe("Agent 1");
  });
  it("draws the empty Board with its launcher and the empty filter without it", () => {
    const empty = mount(view([]));
    expect(empty.host.querySelector(".agent-board__empty")!.textContent).toContain("No agents running");
    act(() => empty.host.querySelector<HTMLButtonElement>(".agent-board__empty button")!.click());
    expect(empty.a.onNewAgent).toHaveBeenCalledTimes(1);
    const filtered = mount({ ...view([card(1, 1, "idle")]), cards: [], shown: 0 });
    expect(filtered.host.querySelector(".agent-board__heading")!.textContent).toBe("0 of 1");
    expect(filtered.host.querySelector(".agent-board__empty")).toBeNull();
  });
  it("selects by digit while the grid holds focus, and not from the nav", () => {
    const cards = [card(1, 1, "idle"), card(2, 2, "idle")];
    const { host, a } = mount(view(cards));
    const grid = host.querySelector<HTMLElement>(".agent-board__grid")!;
    act(() => grid.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
    expect(a.onSelect).toHaveBeenCalledWith(expect.objectContaining({ paneId: 2 }));
    const nav = host.querySelector<HTMLElement>(".agent-board__nav")!;
    act(() => nav.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })));
    expect(a.onSelect).toHaveBeenCalledTimes(1);
  });
  it("opens the focused card in the stage on ⌘Enter / Ctrl+Enter", () => {
    const cards = [card(1, 1, "idle"), card(2, 2, "idle")];
    const { host, a } = mount(view(cards));
    const grid = host.querySelector<HTMLElement>(".agent-board__grid")!;
    act(() => grid.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true })));
    expect(a.onOpenInStage).toHaveBeenCalledWith(expect.objectContaining({ paneId: 1 }));
  });
  it("hands focus back to the selected card when Escape closes the panel", () => {
    const cards = [card(1, 1, "working"), card(2, 2, "idle", true)];
    const { host, a } = mount(view(cards, cards[1]));
    const aside = host.querySelector<HTMLElement>(".agent-board__panel")!;
    aside.focus();
    expect(document.activeElement).toBe(aside);
    act(() => aside.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(a.onSelect).toHaveBeenCalledWith(null);
    expect(document.activeElement).toBe(host.querySelectorAll(".board-card__hit")[1]);
  });
  it("moves roving focus with the arrow keys", () => {
    const cards = [card(1, 1, "idle"), card(2, 2, "idle"), card(3, 3, "idle")];
    const { host } = mount(view(cards));
    const hits = host.querySelectorAll<HTMLButtonElement>(".board-card__hit");
    expect([...hits].map((h) => h.tabIndex)).toEqual([0, -1, -1]);
    hits[0].focus();
    act(() => hits[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement).toBe(hits[1]);
    act(() => hits[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(hits[2]);
  });
  it("Escape closes the panel first, then steps the Board back", () => {
    const cards = [card(1, 1, "asked", true)];
    const { host, a } = mount(view(cards, cards[0]));
    const root = host.querySelector<HTMLElement>(".agent-board")!;
    act(() => root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(a.onSelect).toHaveBeenCalledWith(null);
    expect(a.onEscape).not.toHaveBeenCalled();
    const bare = mount(view(cards));
    act(() => bare.host.querySelector<HTMLElement>(".agent-board")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(bare.a.onEscape).toHaveBeenCalledTimes(1);
  });
});
```

`onSelect(null)` closes the panel — `BoardCardActions.onSelect` already takes `BoardCard | null` (Task 8); the wiring plan's `selectBoardCard` caller reads `null` as "deselect".

- [ ] **Step 2: Run** — `npx vitest run src/ui/agent-board.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

```tsx
import { PlusSquare } from "@phosphor-icons/react";
import { useRef, useState } from "preact/hooks";
import { AgentBoardCard, type BoardCardActions } from "./agent-board-card";
import { cardForDigit, type AgentBoardView, type BoardCard, type BoardStatusFilter } from "./agent-board-model";
import { AgentBoardNav } from "./agent-board-nav";
import { AgentBoardPanel, type BoardPanelState } from "./agent-board-panel";
import { DeckIcon, ROW_ICON } from "./controls/deck-icon";

/**
 * The Agent Board (spec §4–§7, DL §34): nav · grid · panel. Presentational —
 * every fact arrives in `view` and every effect leaves through `actions`, so
 * the gallery mounts the real thing over a fixture and the wiring plan binds
 * it to the stores without touching this file.
 */
export interface AgentBoardActions extends BoardCardActions {
  onReply(card: BoardCard, text: string): void;
  onStatusFilter(filter: BoardStatusFilter): void;
  onProjectFilter(key: string | null): void;
  onNewAgent(): void;
  onEscape(): void;
}

export interface AgentBoardProps {
  readonly view: AgentBoardView;
  readonly actions: AgentBoardActions;
  readonly panel: BoardPanelState;
}

const COLUMNS_GUESS = 3;

export function AgentBoard({ view, actions, panel }: AgentBoardProps) {
  const [focusedPaneId, setFocusedPaneId] = useState<number | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const focusIndex = Math.max(0, view.cards.findIndex((card) => card.paneId === focusedPaneId));

  const focusCard = (index: number): void => {
    const hits = grid.current?.querySelectorAll<HTMLButtonElement>(".board-card__hit");
    const target = hits?.[Math.min(Math.max(index, 0), (hits?.length ?? 1) - 1)];
    target?.focus();
  };

  const onGridKey = (event: KeyboardEvent): void => {
    // Spec §5.5: ⌘Enter (Ctrl+Enter on Windows) is tier 3 for the focused card.
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      const focused = view.cards[focusIndex];
      if (focused !== undefined) {
        event.preventDefault();
        actions.onOpenInStage(focused);
      }
      return;
    }
    const digit = cardForDigit(view, event.key);
    if (digit !== null) {
      event.preventDefault();
      actions.onSelect(digit);
      return;
    }
    const last = view.cards.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: focusIndex + 1,
      ArrowLeft: focusIndex - 1,
      ArrowDown: focusIndex + COLUMNS_GUESS,
      ArrowUp: focusIndex - COLUMNS_GUESS,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      focusCard(next);
    }
  };

  const onRootKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (view.selected !== null) {
      // The panel holds focus; unmounting it would drop focus to <body>, and
      // the SECOND Escape (DL-34.9) would never reach this handler. Hand
      // focus back to the selected card first (a hidden card clamps to 0).
      focusCard(view.cards.findIndex((card) => card.paneId === view.selected?.paneId));
      actions.onSelect(null);
    } else {
      actions.onEscape();
    }
  };

  const panelOpen = view.selected !== null;
  return (
    <section class="agent-board" data-panel={panelOpen ? "open" : "closed"} aria-label="Agent Board" onKeyDown={onRootKey}>
      <AgentBoardNav
        status={view.status}
        projects={view.projects}
        onStatusFilter={actions.onStatusFilter}
        onProjectFilter={actions.onProjectFilter}
      />
      <div class="agent-board__main">
        <div class="agent-board__heading" role="status">{`${view.shown} of ${view.total}`}</div>
        {view.total === 0 ? (
          <div class="agent-board__empty">
            <span>No agents running</span>
            <button type="button" class="iconbtn" aria-label="New agent" onClick={() => actions.onNewAgent()}>
              <DeckIcon icon={PlusSquare} size={ROW_ICON} />
            </button>
          </div>
        ) : (
          <div class="agent-board__grid" ref={grid} onKeyDown={onGridKey}>
            {view.cards.map((card, index) => (
              <AgentBoardCard
                key={card.paneId}
                card={card}
                actions={actions}
                tabIndex={index === focusIndex ? 0 : -1}
                onFocusRequest={(focused) => setFocusedPaneId(focused.paneId)}
              />
            ))}
          </div>
        )}
      </div>
      {view.selected !== null && (
        <AgentBoardPanel
          key={view.selected.paneId} // a new card is a new panel: its mount effect places focus once
          card={view.selected}
          state={panel}
          actions={actions}
          onReply={actions.onReply}
          autoFocusReply={view.selected.state === "asked"}
        />
      )}
    </section>
  );
}
```

`COLUMNS_GUESS` is a keyboard convenience for ↑/↓ until the specimen fixes the card width; measure the real column count from `grid.current` (`getComputedStyle(...).gridTemplateColumns.split(" ").length`) once the stylesheet is on screen — leave that swap as a comment for the wiring plan, not a TODO.

- [ ] **Step 4: Run** — `npx vitest run src/ui/agent-board.test.tsx src/ui/agent-board-card.test.tsx` → PASS; `npx tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/ui/agent-board.tsx src/ui/agent-board.test.tsx && npx prettier --check src/ui/agent-board.tsx src/ui/agent-board.test.tsx
git commit -m "feat(board): compose nav, grid and panel with roving focus, digits and Escape

Claude-Session: https://claude.ai/code/session_01KD5e2AXJjijLZKCyt9McUi" -- src/ui/agent-board.tsx src/ui/agent-board.test.tsx src/ui/agent-board-card.tsx
```

---

