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
    paneId: 11,
    tabIndex: 0,
    ordinal: 3,
    rank: 3,
    agent: "claude",
    departed: false,
    hasRun: true,
    state: "asked",
    name: "Claude",
    where: "deck · main",
    checkoutKey: "k",
    checkout: "main",
    branch: "main",
    directory: "/Users/deck/spacevibe-deck",
    what: { kind: "task", text: "Refactor the rail" },
    task: "Refactor the rail",
    tail: null,
    up: "12m",
    changed: "2m",
    confidence: "explicit",
    selected: false,
    ...over,
  };
}
function actions(): BoardCardActions & Record<keyof BoardCardActions, ReturnType<typeof vi.fn>> {
  return {
    onSelect: vi.fn(),
    onOpenInStage: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onClose: vi.fn(),
  };
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
    // A real space, so assistive tech does not announce "TaskRefactor".
    expect(host.querySelector(".board-card__what")!.textContent).toBe("Task Refactor the rail");
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
  it("prints `ended` for a departed card, in the picture and in the accessible name", () => {
    const gone = mount(card({ departed: true, state: "idle" }));
    expect(gone.host.querySelector(".board-card__state")!.textContent).toBe("ended");
    expect(gone.host.querySelector(".board-card__hit")!.getAttribute("aria-label")).toBe(
      "Claude, ended, deck · main",
    );
    // Not a sixth state: the data attribute the sort, the filter and the nav
    // counts read is still `idle`.
    expect(gone.host.querySelector(".board-card")!.getAttribute("data-state")).toBe("idle");
    const quiet = mount(card({ departed: false, state: "idle" }));
    expect(quiet.host.querySelector(".board-card__state")!.textContent).toBe("idle");
  });
  it("selects on click and opens in stage on double click", () => {
    const { host, a } = mount(card());
    const hit = host.querySelector<HTMLButtonElement>(".board-card__hit")!;
    act(() => hit.click());
    expect(a.onSelect).toHaveBeenCalledTimes(1);
    act(() => {
      hit.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(a.onOpenInStage).toHaveBeenCalledTimes(1);
  });
  it("offers Stop on a live card and Restart on a departed one, and Close only in More", () => {
    const live = mount(card());
    expect(live.host.querySelector("[data-action='stop']")).not.toBeNull();
    expect(live.host.querySelector("[data-action='restart']")).toBeNull();
    expect(live.host.querySelector(".board-card__actions [data-action='close']")).toBeNull();
    act(() => live.host.querySelector<HTMLButtonElement>("[data-action='more']")!.click());
    expect(live.host.querySelector(".board-card__menu [data-action='close']")).not.toBeNull();
    act(() =>
      live.host
        .querySelector<HTMLButtonElement>(".board-card__menu [data-action='close']")!
        .click(),
    );
    expect(live.a.onClose).toHaveBeenCalledTimes(1);
    const gone = mount(card({ departed: true, state: "idle" }));
    expect(gone.host.querySelector("[data-action='restart']")).not.toBeNull();
    expect(gone.host.querySelector("[data-action='stop']")).toBeNull();
  });
  it("keeps the hover column out of the Tab order and opens More from the card", () => {
    const { host } = mount(card());
    const column = [...host.querySelectorAll<HTMLButtonElement>(".board-card__actions .iconbtn")];
    expect(column.length).toBe(3);
    expect(column.map((button) => button.tabIndex)).toEqual([-1, -1, -1]);
    // The keyboard route §5.6 designed: the card answers the context-menu key.
    const hit = host.querySelector<HTMLButtonElement>(".board-card__hit")!;
    act(() => hit.focus());
    act(() => {
      hit.dispatchEvent(
        new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }),
      );
    });
    expect(host.querySelector(".board-card__menu")).not.toBeNull();
    act(() => {
      host
        .querySelector(".board-card__menu")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".board-card__menu")).toBeNull();
    // Escape used to drop focus to <body>; it returns to the card now.
    expect(document.activeElement).toBe(hit);
  });
  it("focuses the first menu row on open and dismisses on an outside press", () => {
    const { host } = mount(card());
    act(() => host.querySelector<HTMLButtonElement>("[data-action='more']")!.click());
    const firstRow = host.querySelector<HTMLButtonElement>(".board-card__menu-row")!;
    expect(document.activeElement).toBe(firstRow);
    // jsdom has no PointerEvent; the handler only reads `target`.
    act(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(host.querySelector(".board-card__menu")).toBeNull();
  });
  it("carries the tier in the accessible name", () => {
    const { host } = mount(card({ confidence: "inferred", state: "working" }));
    expect(host.querySelector(".board-card__hit")!.getAttribute("aria-label")).toBe(
      "Claude, working, inferred, deck · main",
    );
  });
});

describe("formatRank", () => {
  it("zero-pads to two digits", () => {
    expect(formatRank(1)).toBe("01");
    expect(formatRank(12)).toBe("12");
  });
});
