/**
 * Hero stage stream engine — drives the shared stage data with real timers.
 *
 * The data itself (sidebar, status bar, rail, tab strip, pane scripts) lives
 * in `marketing/stage/stage-data.js` and is re-exported here so the landing's
 * import paths stay as they were; the marketing video reads the same data but
 * drives it from a virtual clock instead.
 *
 * A pane owns two regions, and they are not siblings: its transcript stands
 * inside the pane grid, while its rail row and its tab chip stand OUTSIDE it,
 * in the window's chrome. That is why the mount takes a second, wider root.
 */

import { STAGE_ARIA_LABEL } from "../../stage/brand.js";
import {
  deepFreeze,
  stagePanes,
  stageRail,
  stageSidebar,
  stageStatus,
  stageStrip,
} from "../../stage/stage-data.js";

export {
  STAGE_ARIA_LABEL,
  deepFreeze,
  stagePanes,
  stageRail,
  stageSidebar,
  stageStatus,
  stageStrip,
};

function appendLine(linesEl, step, maxLines) {
  const line = document.createElement("div");
  line.className = `a-appwin__line${step.cls ? ` ${step.cls}` : ""}`;
  line.textContent = step.text ?? "";
  linesEl.append(line);

  while (linesEl.childElementCount > maxLines) {
    linesEl.firstElementChild?.remove();
  }
}

/**
 * Resolve a pane's rail and chip hooks ONCE, into plain arrays.
 *
 * `querySelectorAll`, never `querySelector`: a pane owns MORE THAN ONE node
 * per hook — its rail row and, while it is the focused pane, the active tab
 * chip — and the two have to move together.
 *
 * A miss returns an empty array rather than throwing. That is the opposite of
 * `[data-lines]` / `[data-spinner]`, which are the transcript itself and stay
 * fatal: a tour panel that draws a pane grid with no rail beside it is normal,
 * and so is a pane whose row is a static one (`id: null` emits no hook at all).
 *
 * The lookup is scoped to `root` and must NEVER be widened to `document`. The
 * page mounts several stages at once; a document-wide query would let one
 * panel's step repaint another panel's rail.
 *
 * @param {string | null} paneId
 * @param {ParentNode} root
 */
function resolveHooks(paneId, root) {
  if (paneId === null || paneId === undefined) {
    return { tailEls: [], dotEls: [] };
  }

  return {
    tailEls: [...root.querySelectorAll(`[data-tail="${paneId}"]`)],
    dotEls: [...root.querySelectorAll(`[data-dot="${paneId}"]`)],
  };
}

/**
 * The rail half of a step: the sentence on every `[data-tail]` node, the
 * status on every `[data-dot]` node.
 *
 * `data-state` is written on the `[data-dot]` node ALONE — the mark, which is
 * where the four dot states and the working ring are painted. The row
 * `<button>` carries a `data-state` of its own, set once at render and never
 * updated here, so no style may hang off that copy.
 *
 * An absent field leaves its hook as it stands: a step carrying neither says
 * nothing about the rail.
 */
function applyRail(ctx, tail, state) {
  if (tail !== undefined) {
    for (const el of ctx.tailEls) {
      el.textContent = tail;
    }
  }

  if (state !== undefined) {
    for (const el of ctx.dotEls) {
      el.dataset.state = state;
    }
  }
}

/**
 * The single funnel. Every step reaches the DOM through here — the timed run
 * and the completed frame alike — so a field applied here is correct on both
 * paths by construction.
 */
function applyStep(step, ctx) {
  // The rail half runs for EVERY kind, ahead of the transcript's early
  // returns: `think` and `rest` may carry a tail or a state too.
  applyRail(ctx, step.tail, step.state);

  if (step.kind === "line") {
    ctx.spinnerEl.hidden = true;
    appendLine(ctx.linesEl, step, ctx.maxLines);
    return;
  }

  if (step.kind === "chunk") {
    const last = ctx.linesEl.lastElementChild;

    if (last === null) {
      appendLine(ctx.linesEl, step, ctx.maxLines);
    } else {
      last.textContent += step.text ?? "";
    }

    return;
  }

  if (step.kind === "think") {
    ctx.spinnerEl.textContent = step.text ?? "";
    ctx.spinnerEl.hidden = false;
  }
  // "rest" is a pure delay for the transcript.
}

/**
 * Render the completed frame in one shot (reduced-motion path).
 *
 * It walks EVERY step kind, not only the two that print: `think` and `rest`
 * carry rail fields as well, so a reader who asked for no motion must be left
 * with the LAST sentence and the LAST dot, not with whichever pair a printing
 * step happened to be the last to carry. Skipping that is exactly how the
 * reduced-motion gate fails.
 *
 * The spinner is cleared AFTER the walk rather than before it, because a
 * `think` step now goes through the same funnel as everything else — and a
 * finished frame is not a thinking one, whatever kind the script ends on.
 */
function renderStaticFrame(pane, ctx) {
  for (const step of pane.steps) {
    applyStep(step, ctx);
  }

  ctx.spinnerEl.hidden = true;
}

/**
 * The rail values a run STARTS from.
 *
 * `tail` and `state` are scanned INDEPENDENTLY, and that is the whole point.
 * The codex and opencode scripts open on a step carrying `state: "working"`
 * and no `tail`; seeding from "the first step that carries either field"
 * would leave both panes wearing the previous cycle's FINISHED sentence
 * beside a working spinner for the first four seconds of every loop.
 */
function firstRailValues(pane) {
  let tail;
  let state;

  for (const step of pane.steps) {
    if (tail === undefined) {
      tail = step.tail;
    }

    if (state === undefined) {
      state = step.state;
    }

    if (tail !== undefined && state !== undefined) {
      break;
    }
  }

  return { tail, state };
}

function runPane(pane, ctx) {
  const seed = firstRailValues(pane);
  let timerId = null;
  let disposed = false;
  let index = 0;
  let dueAt = performance.now() + pane.startOffset + pane.steps[0].delay;

  // A run is about to replay from step 1, so the rail must not open on the
  // completed frame the mount just painted — the reader would watch it jump
  // backwards. Same reason at the loop below, which resets `index` without
  // clearing anything.
  applyRail(ctx, seed.tail, seed.state);

  function tick() {
    if (disposed) {
      return;
    }

    const now = performance.now();

    // Apply every step already due in one pass — a throttled background
    // tab catches up without a visible animation burst.
    while (index < pane.steps.length && dueAt <= now) {
      applyStep(pane.steps[index], ctx);
      index += 1;

      if (index < pane.steps.length) {
        dueAt += pane.steps[index].delay;
      }
    }

    if (index >= pane.steps.length) {
      // Loop without clearing: the next cycle's lines push the old ones out
      // through the maxLines cap, so the pane always reads as live work.
      timerId = setTimeout(() => {
        if (disposed) {
          return;
        }

        ctx.spinnerEl.hidden = true;
        applyRail(ctx, seed.tail, seed.state);
        index = 0;
        dueAt = performance.now() + pane.steps[0].delay;
        tick();
      }, pane.restGap);
      return;
    }

    timerId = setTimeout(tick, Math.max(16, dueAt - now));
  }

  timerId = setTimeout(tick, Math.max(0, dueAt - performance.now()));

  return () => {
    disposed = true;
    clearTimeout(timerId);
  };
}

/**
 * Start the streaming simulation inside the stage's pane grid.
 *
 * @param {HTMLElement} gridRoot element containing one `[data-stream]`
 *   transcript region per pane (each with `[data-lines]` + `[data-spinner]`)
 * @param {{ chromeRoot?: ParentNode }} [options] `chromeRoot` is the wider
 *   root the rail and tab-strip hooks are looked up under — those nodes stand
 *   outside the grid, so the hero passes its whole `.a-appwin` figure. It
 *   defaults to `gridRoot`, which is what a tour panel with no chrome wants.
 * @returns {() => void} dispose — cancels every pending timer
 */
export function mountStageStream(gridRoot, { chromeRoot = gridRoot } = {}) {
  if (!gridRoot) {
    throw new Error("Stage grid root is missing.");
  }

  // An explicit null falls back rather than crashing: a missing chrome root is
  // the same tolerated miss as a missing hook inside one.
  const hookRoot = chromeRoot ?? gridRoot;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const disposers = [];

  for (const pane of stagePanes) {
    const region = gridRoot.querySelector(`[data-stream="${pane.id}"]`);
    const linesEl = region?.querySelector("[data-lines]");
    const spinnerEl = region?.querySelector("[data-spinner]");

    if (!linesEl || !spinnerEl) {
      throw new Error(`Stage pane "${pane.id}" markup is missing.`);
    }

    const ctx = {
      linesEl,
      spinnerEl,
      maxLines: pane.maxLines,
      ...resolveHooks(pane.id, hookRoot),
    };

    // Seed the completed frame in both paths so no pane ever sits empty;
    // with motion enabled the stream keeps appending on top of it.
    renderStaticFrame(pane, ctx);

    if (!reduceMotion.matches) {
      disposers.push(runPane(pane, ctx));
    }
  }

  return () => {
    disposers.forEach((dispose) => dispose());
  };
}
