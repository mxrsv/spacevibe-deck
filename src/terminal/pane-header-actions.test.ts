import { describe, expect, it, vi } from "vitest";
import {
  createPaneHeaderHandlers,
  paneHeaderActions,
  registerPaneHeaderActions,
  type PaneHeaderActionDeps,
  type PaneHeaderActionHandlers,
} from "./pane-header-actions";

/** Panes 1 and 2 share tab 0, pane 3 is alone in tab 1; the focus starts on pane 1. */
function deps(overrides: Partial<PaneHeaderActionDeps> = {}) {
  let active: number | null = 1;
  const calls = {
    focusPane: vi.fn((_index: number, paneId: number) => {
      active = paneId;
    }),
    splitActive: vi.fn(),
    toggleFocusExpand: vi.fn(),
    closePaneAt: vi.fn(),
  };
  const all: PaneHeaderActionDeps = {
    tabIndexOf: (paneId) => ({ 1: 0, 2: 0, 3: 1 })[paneId] ?? -1,
    activePaneId: () => active,
    ...calls,
    ...overrides,
  };
  return { all, calls };
}

describe("createPaneHeaderHandlers", () => {
  it("focuses an unfocused pane before splitting it, so the split lands on that pane", () => {
    const { all, calls } = deps();

    createPaneHeaderHandlers(all).split(2, "row");

    expect(calls.focusPane).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(calls.splitActive).toHaveBeenCalledExactlyOnceWith("row");
    expect(calls.focusPane.mock.invocationCallOrder[0]).toBeLessThan(
      calls.splitActive.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("splits the pane in another tab through that tab's index", () => {
    const { all, calls } = deps();

    createPaneHeaderHandlers(all).split(3, "column");

    expect(calls.focusPane).toHaveBeenCalledExactlyOnceWith(1, 3);
    expect(calls.splitActive).toHaveBeenCalledExactlyOnceWith("column");
  });

  // The attention preflight refuses while a preset draft is open; the active
  // pane is then still the old one, and splitting it would act on the wrong pane.
  it("does not split when the pressed pane did not take the focus", () => {
    const { all, calls } = deps({ focusPane: vi.fn() });

    createPaneHeaderHandlers(all).split(2, "row");

    expect(calls.splitActive).not.toHaveBeenCalled();
  });

  it("flips Focus expand only once its own pane holds the focus", () => {
    const { all, calls } = deps();
    createPaneHeaderHandlers(all).toggleExpand(2);
    expect(calls.focusPane).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(calls.toggleFocusExpand).toHaveBeenCalledOnce();

    const refused = deps({ focusPane: vi.fn() });
    createPaneHeaderHandlers(refused.all).toggleExpand(2);
    expect(refused.calls.toggleFocusExpand).not.toHaveBeenCalled();
  });

  it("closes the pressed pane even while another pane is focused, without moving focus", () => {
    const { all, calls } = deps();

    createPaneHeaderHandlers(all).close(2);

    expect(calls.closePaneAt).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(calls.focusPane).not.toHaveBeenCalled();
  });

  it("does nothing for a pane no tab holds", () => {
    const { all, calls } = deps();
    const handlers = createPaneHeaderHandlers(all);

    handlers.split(9, "row");
    handlers.toggleExpand(9);
    handlers.close(9);

    expect(calls.focusPane).not.toHaveBeenCalled();
    expect(calls.splitActive).not.toHaveBeenCalled();
    expect(calls.toggleFocusExpand).not.toHaveBeenCalled();
    expect(calls.closePaneAt).not.toHaveBeenCalled();
  });
});

describe("registerPaneHeaderActions", () => {
  const handlers = (): PaneHeaderActionHandlers => ({
    split: vi.fn(),
    toggleExpand: vi.fn(),
    close: vi.fn(),
  });

  it("answers inert until something registers, and again after the disposer runs", () => {
    expect(() => paneHeaderActions().close(1)).not.toThrow();

    const mine = handlers();
    const dispose = registerPaneHeaderActions(mine);
    paneHeaderActions().close(1);
    expect(mine.close).toHaveBeenCalledExactlyOnceWith(1);

    dispose();
    paneHeaderActions().close(1);
    expect(mine.close).toHaveBeenCalledOnce();
  });

  it("lets a stale disposer leave newer handlers alone", () => {
    const first = handlers();
    const second = handlers();
    const disposeFirst = registerPaneHeaderActions(first);
    const disposeSecond = registerPaneHeaderActions(second);

    disposeFirst();
    paneHeaderActions().close(1);
    expect(second.close).toHaveBeenCalledOnce();

    disposeSecond();
  });
});
