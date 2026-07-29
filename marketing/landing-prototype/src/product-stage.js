/**
 * Hero stage stream engine — drives the shared stage data with real timers.
 *
 * The data itself (sidebar, status bar, pane scripts) lives in
 * `marketing/stage/stage-data.js` and is re-exported here so the landing's
 * import paths stay as they were; the marketing video reads the same data but
 * drives it from a virtual clock instead.
 */

import { STAGE_ARIA_LABEL } from "../../stage/brand.js";
import {
  deepFreeze,
  stagePanes,
  stageSidebar,
  stageStatus,
} from "../../stage/stage-data.js";

export { STAGE_ARIA_LABEL, deepFreeze, stagePanes, stageSidebar, stageStatus };

function appendLine(linesEl, step, maxLines) {
  const line = document.createElement("div");
  line.className = `a-appwin__line${step.cls ? ` ${step.cls}` : ""}`;
  line.textContent = step.text ?? "";
  linesEl.append(line);

  while (linesEl.childElementCount > maxLines) {
    linesEl.firstElementChild?.remove();
  }
}

function applyStep(step, linesEl, spinnerEl, maxLines) {
  if (step.kind === "line") {
    spinnerEl.hidden = true;
    appendLine(linesEl, step, maxLines);
    return;
  }

  if (step.kind === "chunk") {
    const last = linesEl.lastElementChild;

    if (last === null) {
      appendLine(linesEl, step, maxLines);
    } else {
      last.textContent += step.text ?? "";
    }

    return;
  }

  if (step.kind === "think") {
    spinnerEl.textContent = step.text ?? "";
    spinnerEl.hidden = false;
  }
  // "rest" is a pure delay — nothing to apply.
}

/** Render the completed frame in one shot (reduced-motion path). */
function renderStaticFrame(pane, linesEl, spinnerEl) {
  spinnerEl.hidden = true;

  for (const step of pane.steps) {
    if (step.kind === "line" || step.kind === "chunk") {
      applyStep(step, linesEl, spinnerEl, pane.maxLines);
    }
  }
}

function runPane(pane, linesEl, spinnerEl) {
  let timerId = null;
  let disposed = false;
  let index = 0;
  let dueAt = performance.now() + pane.startOffset + pane.steps[0].delay;

  function tick() {
    if (disposed) {
      return;
    }

    const now = performance.now();

    // Apply every step already due in one pass — a throttled background
    // tab catches up without a visible animation burst.
    while (index < pane.steps.length && dueAt <= now) {
      applyStep(pane.steps[index], linesEl, spinnerEl, pane.maxLines);
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

        spinnerEl.hidden = true;
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
 * @returns {() => void} dispose — cancels every pending timer
 */
export function mountStageStream(gridRoot) {
  if (!gridRoot) {
    throw new Error("Stage grid root is missing.");
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const disposers = [];

  for (const pane of stagePanes) {
    const region = gridRoot.querySelector(`[data-stream="${pane.id}"]`);
    const linesEl = region?.querySelector("[data-lines]");
    const spinnerEl = region?.querySelector("[data-spinner]");

    if (!linesEl || !spinnerEl) {
      throw new Error(`Stage pane "${pane.id}" markup is missing.`);
    }

    // Seed the completed frame in both paths so no pane ever sits empty;
    // with motion enabled the stream keeps appending on top of it.
    renderStaticFrame(pane, linesEl, spinnerEl);

    if (!reduceMotion.matches) {
      disposers.push(runPane(pane, linesEl, spinnerEl));
    }
  }

  return () => {
    disposers.forEach((dispose) => dispose());
  };
}
