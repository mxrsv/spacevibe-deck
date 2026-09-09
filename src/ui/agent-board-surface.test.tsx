// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./controls/deck-icon", () => ({
  ROW_ICON: 14,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { AgentBoardSurface, type BoardHostActions } from "./agent-board-surface";
import { buildAgentBoard, type AgentBoardView } from "./agent-board-model";
import type { BoardPanelState } from "./agent-board-panel";
import type { PaneView, TabView } from "../terminal/tabs-store";
import {
  agentBoardSurfaceActive,
  boardHeldOrder,
  boardSelectedPaneId,
  boardStatusFilter,
  openAgentBoard,
  resetAgentBoardStore,
  stepAgentBoardBack,
} from "./agent-board-store";

const PANEL: BoardPanelState = {
  snapshot: null,
  replyEnabled: false,
  replyNotice: null,
  sending: false,
  paneExited: false,
};

/** Fresh spies per case — a shared const would carry one case's calls forward. */
function hostActions(overrides: Partial<BoardHostActions> = {}): BoardHostActions {
  return {
    onOpenInStage: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onClose: vi.fn(),
    onReply: vi.fn(),
    onNewAgent: vi.fn(),
    onEscape: vi.fn(),
    ...overrides,
  };
}

function pane(paneId: number, agent: string): PaneView {
  return { paneId, agent, attention: "none", phase: "idle", hasRun: true, changedAt: 1_000 };
}

/**
 * A real projection over a two-pane tab rather than a hand-written view: the
 * surface's job is routing, and a fabricated view could agree with a card
 * order the model would never produce.
 */
function someView(): AgentBoardView {
  const panes = [pane(11, "claude"), pane(12, "codex")];
  const tab: TabView = {
    key: 1,
    process: "claude",
    name: null,
    dotColor: null,
    workspacePath: "/w/deck",
    agents: ["claude", "codex"],
    agentBusy: false,
    unread: false,
    panes,
  };
  return buildAgentBoard({
    tabs: [tab],
    activeIndex: 0,
    scans: new Map(),
    workspaceHistoryPaths: ["/w/deck"],
    ordinals: new Map([
      [11, 1],
      [12, 2],
    ]),
    now: 10_000,
    selectedPaneId: null,
    statusFilter: "all",
    projectFilter: null,
    heldOrder: null,
  });
}

function mount(view: AgentBoardView, actions: BoardHostActions = hostActions()): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    render(<AgentBoardSurface view={view} actions={actions} panel={PANEL} />, host);
  });
  return host;
}

describe("AgentBoardSurface", () => {
  beforeEach(() => resetAgentBoardStore());

  it("draws nothing while a terminal tab or another surface holds the stage", () => {
    expect(mount(someView()).querySelector(".agent-board")).toBeNull();
    openAgentBoard();
    stepAgentBoardBack(); // the chip exists; a terminal tab took the stage
    expect(mount(someView()).querySelector(".agent-board")).toBeNull();
  });

  it("covers the stage while the board holds it", () => {
    openAgentBoard();
    const host = mount(someView());
    expect(host.querySelector(".stage__surface--agent-board")).not.toBeNull();
    expect(host.querySelector(".agent-board")).not.toBeNull();
    expect(agentBoardSurfaceActive.value).toBe(true);
  });

  it("routes a nav press into the board's own filter signal", () => {
    openAgentBoard();
    const host = mount(someView());
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".board-nav__row")];
    const asked = rows.find((row) => row.textContent?.startsWith("Asked"));
    act(() => asked?.click());
    expect(boardStatusFilter.value).toBe("asked");
  });

  it("holds the order the user is looking at when a card is selected", () => {
    openAgentBoard();
    const view = someView();
    const host = mount(view);
    act(() => host.querySelector<HTMLButtonElement>(".board-card__hit")?.click());
    expect(boardSelectedPaneId.value).toBe(view.cards[0].paneId);
    // Spec §5.2: the held order is the order on screen, so a live re-sort
    // cannot move the card under the pointer while its panel is open.
    expect(boardHeldOrder.value).toEqual(view.cards.map((card) => card.paneId));
  });

  it("hands Escape to the host action rather than binding it locally", () => {
    // Stepping the Board off the stage also changes what holds the stage, so
    // it has to reach `notifySurfacesChanged` and `focusActive` — both of
    // which are App's. The surface routes; `agent-board-actions.test.ts`
    // proves what the routed action does.
    openAgentBoard();
    const actions = hostActions();
    const host = mount(someView(), actions);
    act(() => {
      host
        .querySelector(".agent-board")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(actions.onEscape).toHaveBeenCalledTimes(1);
  });
});
