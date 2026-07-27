// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Pane, PaneAttentionSignal, PaneEvents } from "./pane";
import type { CreatePaneFn } from "./pane-lifecycle";
import { createMemoryPtyClient } from "./pty-client";
import {
  createTerminalManager,
  type ManagerCallbacks,
  type TerminalManager,
} from "./terminal-manager";

/**
 * `emitFocusEvent` models real DOM `focusin` semantics: native `.focus()`
 * fires no event when the element already holds DOM focus. Default `true`
 * matches the common case (element not yet focused); pass `false` to
 * reproduce the already-focused-element case.
 *
 * `fitCounts`, when given, records one increment per `fit()` call for this
 * pane's id — lets a test assert every pane was fit without caring about
 * focus.
 */
function fakePane(
  id: number,
  events: PaneEvents,
  emitFocusEvent = true,
  fitCounts?: Map<number, number>,
): Pane {
  const element = document.createElement("div");
  return {
    id,
    element,
    search: {} as Pane["search"],
    mount() {},
    write() {},
    writeln() {},
    fit() {
      fitCounts?.set(id, (fitCounts.get(id) ?? 0) + 1);
    },
    clear() {},
    scrollPage() {},
    scrollToEdge() {},
    focus() {
      if (emitFocusEvent) {
        events.onFocus(id);
      }
    },
    applySettings() {},
    setHeaderInfo() {},
    captureSelection() {
      return null;
    },
    restoreSelection() {},
    dispose() {},
  };
}

/** Builds a TerminalManager wired to a fake createPane that records the
 * PaneEvents handed to each spawned pane, so a test can invoke
 * `onAttentionSignal` as if the pane itself raised it.
 *
 * `emitFocusEvent` (default `true`) is forwarded to every spawned
 * `fakePane` — pass `false` to model a manager whose panes behave like an
 * already-DOM-focused element (native `.focus()` fires no `focusin`). */
function setup(emitFocusEvent = true): {
  tm: TerminalManager;
  container: HTMLElement;
  onAttentionSignal: ReturnType<typeof vi.fn>;
  onPaneFocus: ReturnType<typeof vi.fn>;
  eventsById: Map<number, PaneEvents>;
  fitCounts: Map<number, number>;
  panesById: Map<number, Pane>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const pty = createMemoryPtyClient({ nextId: 1 });
  const eventsById = new Map<number, PaneEvents>();
  const fitCounts = new Map<number, number>();
  const panesById = new Map<number, Pane>();
  const createPane: CreatePaneFn = (id, _settings, events) => {
    eventsById.set(id, events);
    const pane = fakePane(id, events, emitFocusEvent, fitCounts);
    panesById.set(id, pane);
    return pane;
  };
  const onAttentionSignal = vi.fn();
  const onPaneFocus = vi.fn();
  const callbacks: ManagerCallbacks = {
    onLayoutChange() {},
    onAttentionSignal,
    onPaneFocus,
  };
  const tm = createTerminalManager(container, callbacks, pty, { createPane });
  return {
    tm,
    container,
    onAttentionSignal,
    onPaneFocus,
    eventsById,
    fitCounts,
    panesById,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("createTerminalManager attention signal routing", () => {
  it("routes an osc-notification signal to ManagerCallbacks.onAttentionSignal with the same pane id", async () => {
    const { tm, onAttentionSignal, eventsById } = setup();
    await tm.initFresh();
    const id = tm.activePaneId();
    expect(id).not.toBeNull();

    const signal: PaneAttentionSignal = {
      kind: "requested",
      source: "osc-notification",
    };
    eventsById.get(id!)!.onAttentionSignal?.(id!, signal);

    expect(onAttentionSignal).toHaveBeenCalledTimes(1);
    expect(onAttentionSignal).toHaveBeenCalledWith(id, signal);
  });

  it("routes a bell signal the same way", async () => {
    const { tm, onAttentionSignal, eventsById } = setup();
    await tm.initFresh();
    const id = tm.activePaneId();
    expect(id).not.toBeNull();

    const signal: PaneAttentionSignal = { kind: "requested", source: "bell" };
    eventsById.get(id!)!.onAttentionSignal?.(id!, signal);

    expect(onAttentionSignal).toHaveBeenCalledWith(id, signal);
  });

  it("does not leak a signal from one manager's pane into another manager's callback", async () => {
    const a = setup();
    const b = setup();
    await a.tm.initFresh();
    await b.tm.initFresh();

    const idA = a.tm.activePaneId();
    expect(idA).not.toBeNull();
    a.eventsById.get(idA!)!.onAttentionSignal?.(idA!, {
      kind: "requested",
      source: "bell",
    });

    expect(a.onAttentionSignal).toHaveBeenCalledTimes(1);
    expect(b.onAttentionSignal).not.toHaveBeenCalled();
  });
});

describe("createTerminalManager focusPane", () => {
  it("focuses a known pane: returns true, updates activePaneId, fires onPaneFocus once", async () => {
    const { tm, onPaneFocus } = setup();
    await tm.initFresh();
    await tm.splitActive("row");
    const [first, second] = tm.paneIds();
    expect(second).not.toBeUndefined();
    onPaneFocus.mockClear();

    const ok = tm.focusPane(first!);

    expect(ok).toBe(true);
    expect(tm.activePaneId()).toBe(first);
    expect(onPaneFocus).toHaveBeenCalledTimes(1);
    expect(onPaneFocus).toHaveBeenCalledWith(first);
  });

  it("unknown pane id is a no-op: returns false, active id unchanged, no callback", async () => {
    const { tm, onPaneFocus } = setup();
    await tm.initFresh();
    const activeBefore = tm.activePaneId();
    onPaneFocus.mockClear();

    const ok = tm.focusPane(999999);

    expect(ok).toBe(false);
    expect(tm.activePaneId()).toBe(activeBefore);
    expect(onPaneFocus).not.toHaveBeenCalled();
  });

  it("focusing a different pane while zoomed restores the layout (tmux behavior)", async () => {
    const { tm, container } = setup();
    await tm.initFresh();
    await tm.splitActive("row");
    const [first, second] = tm.paneIds();
    expect(second).not.toBeUndefined();
    // splitActive left `second` active — zoom it.
    expect(tm.activePaneId()).toBe(second);
    tm.toggleZoom();
    expect(container.classList.contains("is-zoomed")).toBe(true);

    const ok = tm.focusPane(first!);

    expect(ok).toBe(true);
    expect(container.classList.contains("is-zoomed")).toBe(false);
    expect(tm.activePaneId()).toBe(first);
  });

  it("fires onPaneFocus exactly once per focusPane call when pane.focus() DOES bubble onFocus (suppression guard prevents a double)", async () => {
    // Default fakePane routes focus() through events.onFocus — without the
    // inProgrammaticFocus guard this would double-fire: once from the
    // bubbled onFocus, once from focusPane's own deterministic ack.
    const { tm, onPaneFocus } = setup();
    await tm.initFresh();
    await tm.splitActive("row");
    const [first] = tm.paneIds();
    onPaneFocus.mockClear();

    tm.focusPane(first!);

    expect(onPaneFocus).toHaveBeenCalledTimes(1);

    // Re-focusing the already-active pane still fires exactly once — setActive
    // early-returns (idempotent) but pane.focus() still bubbles onFocus.
    onPaneFocus.mockClear();
    tm.focusPane(first!);
    expect(onPaneFocus).toHaveBeenCalledTimes(1);
  });

  it("fires onPaneFocus exactly once per focusPane call when pane.focus() does NOT bubble onFocus (already-DOM-focused pane — proves the zero-emit is fixed)", async () => {
    // emitFocusEvent: false models a pane that already holds DOM focus:
    // native .focus() is then a no-op and fires no focusin, so
    // events.onFocus never runs. Before the fix this left focusPane's
    // caller with zero acks for the target; focusPane's own deterministic
    // emit now covers it regardless.
    const { tm, onPaneFocus } = setup(false);
    await tm.initFresh();
    await tm.splitActive("row");
    const [first] = tm.paneIds();
    onPaneFocus.mockClear();

    const ok = tm.focusPane(first!);

    expect(ok).toBe(true);
    expect(tm.activePaneId()).toBe(first);
    expect(onPaneFocus).toHaveBeenCalledTimes(1);
    expect(onPaneFocus).toHaveBeenCalledWith(first);
  });
});

// FR-032 (docs/plans/2026-07-27-keyboard-parity.md Task 1): swap the active
// pane with its neighbor, reusing focusDirection's own nearestInDirection
// resolution + the already-shipped swapLeaves (pane-drag.ts's onSwap uses the
// same primitive). jsdom never lays out real geometry — every slot's
// getBoundingClientRect() is {0,0,0,0} — so, like focusDirection, this suite
// cannot assert WHICH direction resolves to WHICH neighbor (that is
// pane-geometry.test.ts's job, with controlled fake rects). What it CAN prove
// without real layout: a lone pane has no neighbor in any direction (no-op);
// a two-pane split has exactly one "other" pane, so any direction call
// swaps with it, letting behavior (DOM slot order, focus, zoom) be verified.
describe("createTerminalManager swapDirection (FR-032)", () => {
  it("no neighbor (single pane) — no-op, no extra focus", async () => {
    const { tm, container, onPaneFocus } = setup();
    await tm.initFresh();
    const before = [...container.querySelectorAll(".pane-slot")].map((s) =>
      s.getAttribute("data-pane-id"),
    );
    onPaneFocus.mockClear();

    tm.swapDirection("left");

    const after = [...container.querySelectorAll(".pane-slot")].map((s) =>
      s.getAttribute("data-pane-id"),
    );
    expect(after).toEqual(before);
    expect(onPaneFocus).not.toHaveBeenCalled();
  });

  it("swaps the active pane with its neighbor — active id stays the same, only its slot moves (FR-032 AC-1/AC-2)", async () => {
    const { tm, container, onPaneFocus } = setup();
    await tm.initFresh();
    await tm.splitActive("row");
    const activeBefore = tm.activePaneId();
    expect(activeBefore).not.toBeNull();
    const before = [...container.querySelectorAll(".pane-slot")].map((s) =>
      s.getAttribute("data-pane-id"),
    );
    onPaneFocus.mockClear();

    tm.swapDirection("left");

    const after = [...container.querySelectorAll(".pane-slot")].map((s) =>
      s.getAttribute("data-pane-id"),
    );
    // Only two slots exist here — a real swap is exactly the reverse order.
    expect(after).toEqual([...before].reverse());
    expect(tm.activePaneId()).toBe(activeBefore); // id unchanged, only the slot moved
    expect(onPaneFocus).toHaveBeenCalledWith(activeBefore); // focus follows the pane
  });

  it("drops zoom on swap unconditionally — a structural rebuild (render/sync), unlike focusDirection's conditional unzoom via setActive", async () => {
    // Documented difference, not a bug: swapDirection reparents each pane's
    // DOM element into its new slot, which needs the full render()/sync()
    // path — and sync() itself always unzooms first (same as splitActive/
    // closePane), regardless of whether the zoomed pane is the one being
    // swapped. focusDirection never rebuilds the DOM (no structural change),
    // so its setActive-driven unzoom stays conditional: only when focus
    // moves AWAY from the zoomed pane.
    const { tm, container } = setup();
    await tm.initFresh();
    await tm.splitActive("row");
    tm.toggleZoom();
    expect(container.classList.contains("is-zoomed")).toBe(true);

    tm.swapDirection("left");

    expect(container.classList.contains("is-zoomed")).toBe(false);
  });
});

describe("createTerminalManager show", () => {
  it("show() with no args displays the container, fits every pane, and focuses the active pane exactly once", async () => {
    const { tm, container, onPaneFocus, fitCounts } = setup();
    await tm.initFresh();
    await tm.splitActive("row");
    const activeId = tm.activePaneId();
    expect(activeId).not.toBeNull();
    tm.hide();
    expect(container.style.display).toBe("none");
    fitCounts.clear();
    onPaneFocus.mockClear();

    tm.show();

    expect(container.style.display).toBe("");
    for (const id of tm.paneIds()) {
      expect(fitCounts.get(id)).toBe(1);
    }
    expect(onPaneFocus).toHaveBeenCalledTimes(1);
    expect(onPaneFocus).toHaveBeenCalledWith(activeId);
  });

  it("show({ focus: false }) displays and fits every pane but focuses none, and leaves the active id unchanged", async () => {
    const { tm, container, onPaneFocus, fitCounts } = setup();
    await tm.initFresh();
    await tm.splitActive("row");
    const activeBefore = tm.activePaneId();
    expect(activeBefore).not.toBeNull();
    tm.hide();
    fitCounts.clear();
    onPaneFocus.mockClear();

    tm.show({ focus: false });

    expect(container.style.display).toBe("");
    for (const id of tm.paneIds()) {
      expect(fitCounts.get(id)).toBe(1);
    }
    expect(onPaneFocus).not.toHaveBeenCalled();
    expect(tm.activePaneId()).toBe(activeBefore);
  });
});

// Scrollback navigation (docs/plans/2026-07-27-keyboard-parity.md Task 4):
// thin delegation to the active pane's own scrollPage/scrollToEdge (Pane
// wraps xterm's own scrollPages/scrollToTop/scrollToBottom — untested here,
// same convention as clear()/pane.clear(): no test in this codebase
// exercises createPane's real xterm wiring directly, every layer verifies
// delegation against a fake Pane instead).
describe("createTerminalManager scrollActivePage / scrollActiveToEdge", () => {
  it("scrollActivePage delegates to the active pane's scrollPage with the given direction", async () => {
    const { tm, panesById } = setup();
    await tm.initFresh();
    const id = tm.activePaneId();
    expect(id).not.toBeNull();
    const scrollPageSpy = vi.spyOn(panesById.get(id!)!, "scrollPage");

    tm.scrollActivePage(-1);
    tm.scrollActivePage(1);

    expect(scrollPageSpy).toHaveBeenNthCalledWith(1, -1);
    expect(scrollPageSpy).toHaveBeenNthCalledWith(2, 1);
  });

  it("scrollActiveToEdge delegates to the active pane's scrollToEdge with the given edge", async () => {
    const { tm, panesById } = setup();
    await tm.initFresh();
    const id = tm.activePaneId();
    expect(id).not.toBeNull();
    const scrollToEdgeSpy = vi.spyOn(panesById.get(id!)!, "scrollToEdge");

    tm.scrollActiveToEdge("top");
    tm.scrollActiveToEdge("bottom");

    expect(scrollToEdgeSpy).toHaveBeenNthCalledWith(1, "top");
    expect(scrollToEdgeSpy).toHaveBeenNthCalledWith(2, "bottom");
  });

  it("both are a safe no-op with no active pane", () => {
    const { tm } = setup();

    expect(() => {
      tm.scrollActivePage(1);
      tm.scrollActiveToEdge("top");
    }).not.toThrow();
  });
});
