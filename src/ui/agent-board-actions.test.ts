import { beforeEach, describe, expect, it, vi } from "vitest";
import { effect } from "@preact/signals";
import {
  agentBoardOpen,
  agentBoardSurfaceActive,
  boardSnapshotTick,
  openAgentBoard,
  resetAgentBoardStore,
  stepAgentBoardBack,
} from "./agent-board-store";
import {
  boardPanelState,
  createBoardActions,
  type BoardActionDeps,
  type BoardManagerSeams,
} from "./agent-board-actions";
import type { BoardCard } from "./agent-board-model";
import { BOARD_SNAPSHOT_LINES } from "./agent-board-panel";

/** The one card these cases select; every field is a placeholder but `paneId`. */
function card(paneId: number): BoardCard {
  return {
    paneId,
    tabIndex: 0,
    ordinal: paneId,
    rank: 1,
    agent: "claude",
    departed: false,
    // The ordinary case: a pane whose agent has taken a turn. The reply gate's
    // second condition reads this, so the case that must NOT auto-send spreads
    // over it rather than relying on a default.
    hasRun: true,
    state: "idle",
    name: "Agent 01",
    project: "deck",
    where: "deck · main",
    checkoutKey: "deck",
    checkout: "deck",
    branch: "main",
    directory: "~/deck",
    what: { kind: "none", text: "" },
    task: null,
    tail: null,
    up: "",
    changed: "1m",
    confidence: null,
    selected: true,
  };
}

/**
 * A full `BoardActionDeps` of spies — the harness the whole Board-action
 * family is written against. `App` has no render harness in this repo
 * (`app-policy.ts` says so in its own comment), so every action that reaches a
 * seam lives in the factory and is proven here. Tasks 11–14 extend this bag as
 * they add the seams their actions call.
 */
function fakeDeps(overrides: Partial<BoardActionDeps> = {}): BoardActionDeps {
  return {
    manager: null,
    openTaskLauncher: vi.fn(),
    notifySurfacesChanged: vi.fn(),
    focusActive: vi.fn(),
    setNotice: vi.fn(),
    notice: vi.fn(() => null),
    setSending: vi.fn(),
    isSending: vi.fn(() => false),
    clearSelection: vi.fn(),
    selectedPaneId: vi.fn(() => null),
    // An absent `killForeground` is exactly what a host without the channel
    // looks like, so the default bag is the one that proves the optional call.
    pty: {},
    ...overrides,
  };
}

beforeEach(() => {
  // The store is a window-scoped singleton, so a board left open by one case
  // would decide the next one's answer.
  resetAgentBoardStore();
});

describe("createBoardActions", () => {
  it("routes New agent to the task launcher, not to a bare new tab", () => {
    const openTaskLauncher = vi.fn();
    createBoardActions(fakeDeps({ openTaskLauncher })).onNewAgent();
    expect(openTaskLauncher).toHaveBeenCalledTimes(1);
  });

  it("steps the board off the stage on Escape, tells TabManager and hands focus back", () => {
    const notifySurfacesChanged = vi.fn();
    const focusActive = vi.fn();
    openAgentBoard();

    createBoardActions(fakeDeps({ notifySurfacesChanged, focusActive })).onEscape();

    expect(agentBoardSurfaceActive.value).toBe(false);
    // A store-signal transition is invisible to `syncViews`, and the Board's
    // own root held DOM focus — leaving without either is the asymmetry the
    // chip's ✕ (`closeAgentBoardTab`) already avoids.
    expect(notifySurfacesChanged).toHaveBeenCalledTimes(1);
    expect(focusActive).toHaveBeenCalledTimes(1);
  });

  it("keeps the chip when Escape only takes the stage back", () => {
    openAgentBoard();
    createBoardActions(fakeDeps()).onEscape();
    // Escape is DL-34.9's second press, not ⌘W: the surface leaves the stage
    // and the chip stays in the strip.
    expect(agentBoardSurfaceActive.value).toBe(false);
  });
});

describe("onStop", () => {
  it("stops the agent without killing the pane", () => {
    const killForeground = vi.fn().mockResolvedValue(undefined);
    const closePaneAt = vi.fn();
    const deps = fakeDeps({
      pty: { killForeground },
      manager: fakeManager({ closePaneAt }),
    });

    createBoardActions(deps).onStop(card(11));

    // Spec §5.6: the agent ends and the pane stays. A Stop that closed the pane
    // would take away the card it was pressed from.
    expect(killForeground).toHaveBeenCalledWith(11);
    expect(closePaneAt).not.toHaveBeenCalled();
  });

  it("does nothing, loudly or otherwise, on a host with no kill channel", () => {
    // The member is optional; the optional call is how "this host cannot do it"
    // is said, and it must not throw on the way past.
    expect(() => createBoardActions(fakeDeps()).onStop(card(11))).not.toThrow();
  });
});

describe("boardPanelState", () => {
  it("is not sending while no card is selected", () => {
    const deps = fakeDeps({ isSending: vi.fn(() => true) });
    expect(boardPanelState(deps, null).sending).toBe(false);
  });

  it("mirrors the in-flight flag for the selected card", () => {
    const deps = fakeDeps({ isSending: vi.fn(() => true) });
    expect(boardPanelState(deps, card(11)).sending).toBe(true);
  });
});

/**
 * The tail of a `Promise<void>` seam. Every other suite in this repo that has
 * to wait on one declares this locally (`reset-section.test.tsx:42`,
 * `notifications-section.test.tsx:41`) — there is no shared helper to import.
 */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Every seam `BoardManagerSeams` declares, all spies, overridable one at a time. */
function fakeManager(overrides: Partial<BoardManagerSeams> = {}): BoardManagerSeams {
  return {
    activateForAttention: vi.fn(),
    closePaneAt: vi.fn().mockResolvedValue(undefined),
    injectIntoPane: vi.fn(),
    acknowledgePane: vi.fn(),
    serializePane: vi.fn(() => null),
    // False by default because the default `closePaneAt` above models a
    // COMPLETED close, after which the pane is gone. A default of `true` would
    // make the "clears a selection that named it" case fail for a reason that
    // has nothing to do with what it asserts.
    paneAlive: vi.fn(() => false),
    // True by default: the seam's own refusals are its business, and a card
    // is only ever drawing Restart because its agent already left.
    restartPane: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("Restart (spec §5.6, §11.10)", () => {
  it("restarts through the tab layer, never by respawning a pane", () => {
    const restartPane = vi.fn().mockResolvedValue(true);
    createBoardActions(fakeDeps({ manager: fakeManager({ restartPane }) })).onRestart(card(11));
    expect(restartPane).toHaveBeenCalledWith(11);
  });

  it("says nothing when the restart went through", async () => {
    const deps = fakeDeps({ manager: fakeManager() });
    createBoardActions(deps).onRestart(card(11));
    await flushMicrotasks();
    expect(deps.setNotice).not.toHaveBeenCalled();
  });

  it("reports a refusal instead of swallowing it", async () => {
    // Four of `restartPane`'s five refusals are reachable from a card that is
    // currently drawing the control, so a voided boolean is the Board saying
    // nothing at all to a press.
    const deps = fakeDeps({
      manager: fakeManager({ restartPane: vi.fn().mockResolvedValue(false) }),
    });
    createBoardActions(deps).onRestart(card(11));
    await flushMicrotasks();
    expect(deps.setNotice).toHaveBeenLastCalledWith({
      paneId: 11,
      text: expect.stringContaining("could not restart"),
    });
  });

  it("does nothing at all before the manager exists", () => {
    const deps = fakeDeps();
    expect(() => createBoardActions(deps).onRestart(card(11))).not.toThrow();
    expect(deps.setNotice).not.toHaveBeenCalled();
  });
});

describe("tier 3 and Close", () => {
  it("hands the stage to the pane, and the chip survives", () => {
    openAgentBoard();
    // The real `activateForAttention` calls `surfaces.deactivate()`, which is
    // what steps the Board off the stage — modelled here so the two assertions
    // below can be made together: the SURFACE gives up its turn, the CHIP does
    // not. A fake that did nothing would let "the chip survives" pass for the
    // trivial reason that nothing ever closed it.
    const activateForAttention = vi.fn(() => {
      stepAgentBoardBack();
    });
    const deps = fakeDeps({ manager: fakeManager({ activateForAttention }) });

    createBoardActions(deps).onOpenInStage(card(11));

    expect(activateForAttention).toHaveBeenCalledWith(0, 11);
    // Without these two the strip goes stale and the caret drops to <body> —
    // exactly what `onEscape` pairs them for.
    expect(deps.notifySurfacesChanged).toHaveBeenCalledTimes(1);
    expect(deps.focusActive).toHaveBeenCalledTimes(1);
    expect(agentBoardSurfaceActive.value).toBe(false);
    // The chip is untouched, so ⌘⇧O brings the Board straight back.
    expect(agentBoardOpen.value).toBe(true);
  });

  it("closes the pane and clears a selection that named it", async () => {
    const closePaneAt = vi.fn().mockResolvedValue(undefined);
    const deps = fakeDeps({
      manager: fakeManager({ closePaneAt }),
      selectedPaneId: vi.fn(() => 11),
    });

    createBoardActions(deps).onClose(card(11));
    await flushMicrotasks();

    expect(closePaneAt).toHaveBeenCalledWith(0, 11);
    // A panel about a pane that is gone is a panel about nothing.
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("leaves a selection alone when a DIFFERENT card is closed", async () => {
    const closePaneAt = vi.fn().mockResolvedValue(undefined);
    const deps = fakeDeps({
      manager: fakeManager({ closePaneAt }),
      selectedPaneId: vi.fn(() => 11),
    });

    createBoardActions(deps).onClose(card(12));
    await flushMicrotasks();

    expect(closePaneAt).toHaveBeenCalledWith(0, 12);
    // Clearing unconditionally would shut a panel the user is reading about
    // another card.
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("does not throw before the manager exists", () => {
    const actions = createBoardActions(fakeDeps());
    expect(() => actions.onOpenInStage(card(11))).not.toThrow();
    expect(() => actions.onClose(card(11))).not.toThrow();
  });
});

describe("the panel's snapshot (spec §7.3, DL-34.6)", () => {
  it("reads the selected card's own scrollback", () => {
    const serializePane = vi.fn(() => "one\ntwo");
    const deps = fakeDeps({ manager: fakeManager({ serializePane }) });

    expect(boardPanelState(deps, card(11)).snapshot).toBe("one\ntwo");
    // The pane is named by id — the panel never asks for "the active pane",
    // which is what lets a selection leave the tab where it is (spec §5.4).
    expect(serializePane).toHaveBeenCalledWith(11, BOARD_SNAPSHOT_LINES);
  });

  it("asks for nothing while no card is selected", () => {
    const serializePane = vi.fn(() => "one\ntwo");
    const deps = fakeDeps({ manager: fakeManager({ serializePane }) });

    const state = boardPanelState(deps, null);

    expect(state.snapshot).toBeNull();
    expect(state.paneExited).toBe(false);
    // A closed panel reads no buffer: the call is per render, and a Board with
    // nothing selected renders as often as one with a card.
    expect(serializePane).not.toHaveBeenCalled();
  });

  it("still shows the snapshot of a pane whose PTY has gone, and says it exited", () => {
    const deps = fakeDeps({
      manager: fakeManager({
        serializePane: vi.fn(() => "last words"),
        paneAlive: vi.fn(() => false),
      }),
    });

    const state = boardPanelState(deps, card(11));

    // NOT `snapshot === null`: an exited pane still holds its buffer and still
    // answers, which is the point — the panel shows what the agent last said.
    expect(state.snapshot).toBe("last words");
    expect(state.paneExited).toBe(true);
  });

  it("does not call a live pane exited", () => {
    const deps = fakeDeps({ manager: fakeManager({ paneAlive: vi.fn(() => true) }) });
    expect(boardPanelState(deps, card(11)).paneExited).toBe(false);
  });

  it("claims nothing before the manager exists", () => {
    const state = boardPanelState(fakeDeps(), card(11));
    expect(state.snapshot).toBeNull();
    // An absent manager is "not known yet", not "the pane died" — disabling
    // the panel's actions on a render before the manager is constructed would
    // be a claim this deps bag cannot support.
    expect(state.paneExited).toBe(false);
  });
});

describe("Close when the user declined the busy dialog", () => {
  it("keeps the selection while the pane is still alive", async () => {
    // `closePaneAt` resolves void for a completed close, a DECLINED busy
    // dialog, a stale index and a non-member pane alike
    // (`close-coordinator.ts`, three early returns). Asking the pane is what
    // tells them apart without touching close coordination.
    const paneAlive = vi.fn(() => true);
    const deps = fakeDeps({
      manager: fakeManager({ paneAlive }),
      selectedPaneId: vi.fn(() => 11),
    });

    createBoardActions(deps).onClose(card(11));
    await flushMicrotasks();

    expect(paneAlive).toHaveBeenCalledWith(11);
    // Clearing here would shut the panel and release the held sort under a
    // card the user just chose to KEEP.
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });
});

describe("onReply (spec §7.4, DL-34.7)", () => {
  it("does not press Enter in a pane that has never run a turn", () => {
    // The safety property this task exists for. `submitAllowed` takes no
    // `hasRun` input, and a fresh claude sitting on its trust-this-folder menu
    // reads `idle` and would pass it — so `autoSend: true` there would press
    // Enter on a security prompt nobody read. The ARGUMENT is asserted, not
    // the outcome: a fake that refused for any other reason would let an
    // `autoSend: true` implementation through.
    const injectIntoPane = vi.fn().mockResolvedValue("pasted");
    const deps = fakeDeps({ manager: fakeManager({ injectIntoPane }) });

    createBoardActions(deps).onReply({ ...card(11), hasRun: false }, "1");

    expect(injectIntoPane).toHaveBeenCalledWith(11, "1", {
      autoSend: false,
      expectedAgent: "claude",
    });
  });

  it("presses Enter in a pane whose agent has taken a turn", () => {
    const injectIntoPane = vi.fn().mockResolvedValue("sent");
    const deps = fakeDeps({ manager: fakeManager({ injectIntoPane }) });

    createBoardActions(deps).onReply(card(11), "yes please");

    // The expected agent is the CARD's, so the gate's first check compares
    // against the agent the user was looking at rather than whatever is
    // running by the time the paste lands.
    expect(injectIntoPane).toHaveBeenCalledWith(11, "yes please", {
      autoSend: true,
      expectedAgent: "claude",
    });
  });

  it("acknowledges the pane only when the reply was actually sent", async () => {
    const acknowledgePane = vi.fn();
    const deps = fakeDeps({
      manager: fakeManager({
        injectIntoPane: vi.fn().mockResolvedValue("sent"),
        acknowledgePane,
      }),
    });

    createBoardActions(deps).onReply(card(11), "yes please");
    await flushMicrotasks();

    // The user answered, so the question is answered — the only acknowledging
    // path from the Board besides tier 3 (spec §5.5).
    expect(acknowledgePane).toHaveBeenCalledWith(11);
    expect(deps.setSending).toHaveBeenLastCalledWith(false);
  });

  it("says the text was placed when the gate refused to press Enter", async () => {
    const acknowledgePane = vi.fn();
    const deps = fakeDeps({
      manager: fakeManager({
        injectIntoPane: vi.fn().mockResolvedValue("pasted"),
        acknowledgePane,
      }),
    });

    createBoardActions(deps).onReply(card(11), "maybe");
    await flushMicrotasks();

    // A REAL question is refused by the gate on purpose: the text sits in the
    // agent's composer and the user presses Enter themselves. That is not a
    // failure, and it is not an answer either — so nothing is acknowledged.
    expect(acknowledgePane).not.toHaveBeenCalled();
    expect(deps.setNotice).toHaveBeenLastCalledWith({
      paneId: 11,
      text: "placed — confirm in the terminal",
    });
  });

  it("reports a failed delivery instead of pretending it landed", async () => {
    const deps = fakeDeps({
      manager: fakeManager({ injectIntoPane: vi.fn().mockResolvedValue("failed") }),
    });

    createBoardActions(deps).onReply(card(11), "nope");
    await flushMicrotasks();

    expect(deps.setNotice).toHaveBeenLastCalledWith({
      paneId: 11,
      text: expect.stringContaining("could not reach the agent"),
    });
  });

  it("says the same about a pane the inject could not even target", async () => {
    // `busy` and `no-target` are the other two non-landing outcomes: neither
    // put the text anywhere, so neither may read as `pasted`.
    const deps = fakeDeps({
      manager: fakeManager({ injectIntoPane: vi.fn().mockResolvedValue("no-target") }),
    });

    createBoardActions(deps).onReply(card(11), "nope");
    await flushMicrotasks();

    expect(deps.setNotice).toHaveBeenLastCalledWith({
      paneId: 11,
      text: expect.stringContaining("could not reach the agent"),
    });
  });

  it("refuses an empty reply, with nothing in flight to blame it on", () => {
    const injectIntoPane = vi.fn().mockResolvedValue("sent");
    const deps = fakeDeps({
      manager: fakeManager({ injectIntoPane }),
      isSending: vi.fn(() => false),
    });

    createBoardActions(deps).onReply(card(11), "   ");

    expect(injectIntoPane).not.toHaveBeenCalled();
    // And the panel is not left believing a press is in flight.
    expect(deps.setSending).not.toHaveBeenCalled();
  });

  it("refuses a second press while one is in flight", () => {
    const injectIntoPane = vi.fn().mockResolvedValue("sent");
    const deps = fakeDeps({
      manager: fakeManager({ injectIntoPane }),
      isSending: vi.fn(() => true),
    });

    createBoardActions(deps).onReply(card(11), "hello");

    expect(injectIntoPane).not.toHaveBeenCalled();
  });

  it("does not strand the panel as sending before the manager exists", () => {
    // `deps.manager?.injectIntoPane(...)` short-circuits to `undefined` on a
    // null manager, so a `setSending(true)` written before that call would
    // never be undone — no `.then`, no `.finally`, a reply box disabled for
    // the life of the window.
    const deps = fakeDeps();

    expect(() => createBoardActions(deps).onReply(card(11), "hello")).not.toThrow();

    expect(deps.setSending).not.toHaveBeenCalled();
  });
});

describe("the panel's reply state (spec §7.4)", () => {
  it("lets a live agent be answered", () => {
    const deps = fakeDeps({ manager: fakeManager({ paneAlive: vi.fn(() => true) }) });
    expect(boardPanelState(deps, card(11)).replyEnabled).toBe(true);
  });

  it("has nothing to answer a departed agent with", () => {
    // The pane is alive — its shell came back — but the agent that would read
    // the reply has gone, so the box is closed rather than pasting into a
    // bare shell.
    const deps = fakeDeps({ manager: fakeManager({ paneAlive: vi.fn(() => true) }) });
    expect(boardPanelState(deps, { ...card(11), departed: true }).replyEnabled).toBe(false);
  });

  it("does not offer a reply to a pane whose PTY has gone", () => {
    const deps = fakeDeps({ manager: fakeManager({ paneAlive: vi.fn(() => false) }) });
    expect(boardPanelState(deps, card(11)).replyEnabled).toBe(false);
  });

  it("offers nothing before the manager exists", () => {
    expect(boardPanelState(fakeDeps(), card(11)).replyEnabled).toBe(false);
  });

  it("shows the notice the last press left", () => {
    const deps = fakeDeps({
      manager: fakeManager({ paneAlive: vi.fn(() => true) }),
      notice: vi.fn(() => ({ paneId: 11, text: "placed — confirm in the terminal" })),
    });
    expect(boardPanelState(deps, card(11)).replyNotice).toBe("placed — confirm in the terminal");
  });

  it("does NOT print one card's notice under another", () => {
    // The notice signal is window-scoped and is cleared only by the next
    // press, so before it carried a pane id, replying to card 11 and then
    // selecting card 31 printed "placed — confirm in the terminal" under 31 —
    // a claim about 31's terminal that was never made.
    const deps = fakeDeps({
      manager: fakeManager({ paneAlive: vi.fn(() => true) }),
      notice: vi.fn(() => ({ paneId: 11, text: "placed — confirm in the terminal" })),
    });
    expect(boardPanelState(deps, card(31)).replyNotice).toBeNull();
  });

  it("subscribes its reader to the refresh tick (spec §7.3)", () => {
    // The property is SUBSCRIPTION, not a fresh return value: `boardPanelState`
    // is a plain function, so calling it twice re-reads the buffer whether or
    // not it touches the tick. What the `void boardSnapshotTick.value` line
    // buys is that `App`'s render — a signal reader — re-runs when the timer
    // fires. An `effect` is that reader, without a component.
    const deps = fakeDeps({
      manager: fakeManager({ paneAlive: vi.fn(() => true), serializePane: vi.fn(() => "out") }),
    });
    let runs = 0;
    const dispose = effect(() => {
      boardPanelState(deps, card(11));
      runs += 1;
    });
    expect(runs).toBe(1);
    boardSnapshotTick.value += 1;
    expect(runs).toBe(2);
    dispose();
  });

  it("says nothing while no card is selected", () => {
    const deps = fakeDeps({
      notice: vi.fn(() => ({ paneId: 11, text: "placed — confirm in the terminal" })),
    });
    expect(boardPanelState(deps, null).replyNotice).toBeNull();
  });
});
