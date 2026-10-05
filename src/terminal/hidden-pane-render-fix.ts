import type { Terminal } from "@xterm/xterm";

/**
 * Workaround for an xterm.js render-pause gap that saturates the renderer
 * while a hidden tab prints.
 *
 * `RenderService.refreshRows` skips rendering while the terminal is paused —
 * its IntersectionObserver reports the screen element off screen, which is
 * every pane of a `display: none` tab — but `handleSelectionChanged` forwards
 * to the renderer regardless. The selection service calls it on every scroll,
 * so a hidden pane with scrolling output redraws all of its rows each frame.
 * Hidden panes run the DOM renderer (WebGL is released on hide, see
 * `suspendRenderer` in pane.ts), and its width cache measures glyphs through
 * `offsetWidth`, which is 0 inside `display: none` and therefore never cached.
 * Measured 2026-10-05 on 6.0.0: one hidden scrolling pane held the renderer
 * near 100% of a core; fifteen froze the window for seconds at a time.
 * xterm.js `master` still has the same `handleSelectionChanged`; reported as
 * xtermjs/xterm.js#6208 — remove this module once a release carries a fix.
 *
 * While paused, the wrapper records the selection and sets the two flags xterm
 * already uses to repaint on resume: `_needsFullRefresh` makes the resume
 * refresh every row, and `_needsSelectionRefresh` makes that render re-apply
 * the recorded selection. A visible terminal takes the original path.
 */

type SelectionPoint = [number, number] | undefined;

interface SelectionState {
  start: SelectionPoint;
  end: SelectionPoint;
  columnSelectMode: boolean;
}

interface RenderServiceInternals {
  _isPaused: boolean;
  _needsFullRefresh: boolean;
  _needsSelectionRefresh: boolean;
  _selectionState: SelectionState;
  handleSelectionChanged(
    start: SelectionPoint,
    end: SelectionPoint,
    columnSelectMode: boolean,
  ): void;
}

function getRenderService(term: Terminal): RenderServiceInternals | null {
  const service = (
    term as unknown as { _core?: { _renderService?: Partial<RenderServiceInternals> } }
  )._core?._renderService;
  if (
    !service ||
    typeof service.handleSelectionChanged !== "function" ||
    typeof service._isPaused !== "boolean" ||
    typeof service._needsFullRefresh !== "boolean" ||
    typeof service._needsSelectionRefresh !== "boolean" ||
    typeof service._selectionState !== "object" ||
    service._selectionState === null
  ) {
    return null;
  }
  return service as RenderServiceInternals;
}

/**
 * Gate selection repaints on the render pause. Call after `term.open()`, which
 * creates the render service. Returns false, leaving xterm untouched, when its
 * internals no longer have the expected shape — the test that opens a real
 * terminal fails in that case, so an xterm upgrade cannot drop it silently.
 */
export function applyHiddenPaneRenderFix(term: Terminal): boolean {
  const service = getRenderService(term);
  if (service === null) {
    return false;
  }
  const original = service.handleSelectionChanged.bind(service);
  service.handleSelectionChanged = (start, end, columnSelectMode) => {
    if (!service._isPaused) {
      original(start, end, columnSelectMode);
      return;
    }
    service._selectionState = { start, end, columnSelectMode };
    service._needsSelectionRefresh = true;
    service._needsFullRefresh = true;
  };
  return true;
}
