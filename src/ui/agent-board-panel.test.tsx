// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import type { BoardCard } from "./agent-board-model";
import { AgentBoardPanel, type BoardPanelState } from "./agent-board-panel";

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
    project: "deck",
    where: "deck · main",
    checkoutKey: "k",
    checkout: "main",
    branch: "main",
    directory: "/Users/deck/spacevibe-deck",
    what: { kind: "task", text: "Refactor" },
    task: "Refactor\nthe rail",
    tail: "Done with tests",
    up: "12m",
    changed: "2m",
    confidence: "inferred",
    selected: true,
    ...over,
  };
}
const READY: BoardPanelState = {
  snapshot: "$ claude\n> working",
  replyEnabled: true,
  replyNotice: null,
  sending: false,
  paneExited: false,
};
const noop = {
  onSelect: vi.fn(),
  onOpenInStage: vi.fn(),
  onStop: vi.fn(),
  onRestart: vi.fn(),
  onClose: vi.fn(),
};

function mount(c: BoardCard, state = READY, onReply = vi.fn(), autoFocus = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // `act` flushes the focus effect before `document.activeElement` is read.
  act(() => {
    render(
      <AgentBoardPanel
        card={c}
        state={state}
        actions={noop}
        onReply={onReply}
        autoFocusReply={autoFocus}
      />,
      host,
    );
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
    const task = [...host.querySelectorAll(".board-panel__value")].find((el) =>
      el.textContent?.startsWith("Refactor"),
    )!;
    expect(task.textContent).toBe("Refactor\nthe rail — placed, not sent");
  });
  it("shows the snapshot and sends on Enter, not on Shift+Enter", () => {
    const { host, onReply } = mount(card());
    expect(host.querySelector(".board-panel__snapshot")!.textContent).toBe("$ claude\n> working");
    const box = host.querySelector<HTMLTextAreaElement>(".board-panel__reply")!;
    box.value = "continue";
    act(() => {
      box.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
      );
    });
    expect(onReply).not.toHaveBeenCalled();
    act(() => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ paneId: 11 }), "continue");
  });
  it("disables the reply box and prints the notice when the wiring says so", () => {
    const { host } = mount(card(), {
      ...READY,
      replyEnabled: false,
      replyNotice: "placed — confirm in the terminal",
    });
    expect(host.querySelector<HTMLTextAreaElement>(".board-panel__reply")!.disabled).toBe(true);
    expect(host.querySelector(".board-panel__notice")!.textContent).toBe(
      "placed — confirm in the terminal",
    );
  });
  it("offers Restart not Stop for a departed card, and disables both when the pane exited", () => {
    const gone = mount(card({ departed: true, state: "idle" }));
    expect(gone.host.querySelector(".board-panel__actions [data-action='restart']")).not.toBeNull();
    expect(gone.host.querySelector(".board-panel__actions [data-action='stop']")).toBeNull();
    // The State row says the same word the card does (DL-34.2 amended).
    expect(gone.host.querySelector(".board-panel__value")!.textContent).toContain("ended");
    const dead = mount(card({ departed: true, state: "idle" }), {
      ...READY,
      paneExited: true,
      replyEnabled: false,
    });
    expect(
      dead.host.querySelector<HTMLButtonElement>(".board-panel__actions [data-action='restart']")!
        .disabled,
    ).toBe(true);
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
    act(() => {
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box.rows).toBe(3);
    box.value = "a\nb\nc\nd\ne\nf";
    act(() => {
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box.rows).toBe(4);
  });
});
