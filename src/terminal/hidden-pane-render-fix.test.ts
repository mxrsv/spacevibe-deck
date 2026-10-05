// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { applyHiddenPaneRenderFix } from "./hidden-pane-render-fix";

type Point = [number, number] | undefined;

interface RenderServiceView {
  _isPaused: boolean;
  _needsFullRefresh: boolean;
  _needsSelectionRefresh: boolean;
  _selectionState: { start: Point; end: Point; columnSelectMode: boolean };
  _renderer: {
    value?: { handleSelectionChanged(start: Point, end: Point, column: boolean): void };
  };
  handleSelectionChanged(start: Point, end: Point, column: boolean): void;
}

function renderServiceOf(term: Terminal): RenderServiceView {
  return (term as unknown as { _core: { _renderService: RenderServiceView } })._core._renderService;
}

const terminals: Terminal[] = [];

/** jsdom has no `matchMedia`, which xterm's DPR watcher calls during `open()`. */
function stubMatchMedia(): void {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
}

/** A real xterm, opened — the shape check must run against the shipped internals. */
function openTerminal(): Terminal {
  stubMatchMedia();
  const term = new Terminal({ cols: 40, rows: 10 });
  const host = document.createElement("div");
  document.body.appendChild(host);
  term.open(host);
  terminals.push(term);
  return term;
}

afterEach(() => {
  for (const term of terminals.splice(0)) {
    term.dispose();
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("applyHiddenPaneRenderFix", () => {
  it("installs on the installed @xterm/xterm, so an upgrade cannot drop it silently", () => {
    expect(applyHiddenPaneRenderFix(openTerminal())).toBe(true);
  });

  it("defers the selection repaint while paused and re-arms xterm's resume flags", () => {
    const term = openTerminal();
    applyHiddenPaneRenderFix(term);
    const service = renderServiceOf(term);
    const renderer = service._renderer.value;
    expect(renderer).toBeDefined();
    const repaint = vi.spyOn(renderer!, "handleSelectionChanged");
    service._isPaused = true;
    service._needsFullRefresh = false;
    service._needsSelectionRefresh = false;

    service.handleSelectionChanged([1, 2], [5, 3], true);

    expect(repaint).not.toHaveBeenCalled();
    expect(service._selectionState).toEqual({ start: [1, 2], end: [5, 3], columnSelectMode: true });
    expect(service._needsFullRefresh).toBe(true);
    expect(service._needsSelectionRefresh).toBe(true);
  });

  it("repaints immediately on a visible terminal, as before", () => {
    const term = openTerminal();
    applyHiddenPaneRenderFix(term);
    const service = renderServiceOf(term);
    const repaint = vi.spyOn(service._renderer.value!, "handleSelectionChanged");
    service._isPaused = false;

    service.handleSelectionChanged([0, 0], [3, 0], false);

    expect(repaint).toHaveBeenCalledWith([0, 0], [3, 0], false);
    expect(service._selectionState).toEqual({
      start: [0, 0],
      end: [3, 0],
      columnSelectMode: false,
    });
  });

  it("leaves a terminal without the expected internals untouched", () => {
    const fake = { _core: { _renderService: { handleSelectionChanged: () => {} } } };
    expect(applyHiddenPaneRenderFix(fake as unknown as Terminal)).toBe(false);
  });
});
