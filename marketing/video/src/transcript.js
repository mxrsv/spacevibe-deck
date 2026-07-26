/**
 * Deterministic replay of the shared pane scripts.
 *
 * The landing drives `stagePanes` with real timers; the video needs the same
 * transcript as a pure function of time so any frame can be rendered on
 * demand, in any order. Same data, same visible result — just sampled instead
 * of streamed.
 */

/** @typedef {{ text: string, cls?: string }} Line */

const cache = new WeakMap();

/**
 * Absolute event times (ms) for one pane, plus the length of a full cycle.
 * Mirrors `runPane`: the first step waits `startOffset + delay[0]`, later
 * steps add their own delay, and a finished cycle rests `restGap` before the
 * first step of the next one.
 */
function scheduleFor(pane) {
  const cached = cache.get(pane);

  if (cached) {
    return cached;
  }

  if (pane.steps.length === 0) {
    throw new Error(`Pane "${pane.id}" has no steps.`);
  }

  const first = pane.startOffset + pane.steps[0].delay;
  const offsets = [0];

  for (let i = 1; i < pane.steps.length; i += 1) {
    offsets.push(offsets[i - 1] + pane.steps[i].delay);
  }

  const schedule = {
    first,
    offsets,
    cycleSpan: offsets[offsets.length - 1] + pane.restGap + pane.steps[0].delay,
  };

  cache.set(pane, schedule);

  return schedule;
}

function pushLine(lines, line, maxLines) {
  const next = [...lines, line];

  return next.length > maxLines ? next.slice(next.length - maxLines) : next;
}

function applyStep(state, step, maxLines) {
  if (step.kind === "line") {
    return {
      lines: pushLine(
        state.lines,
        { text: step.text ?? "", cls: step.cls },
        maxLines,
      ),
      spinner: null,
    };
  }

  if (step.kind === "chunk") {
    if (state.lines.length === 0) {
      return {
        lines: pushLine(state.lines, { text: step.text ?? "" }, maxLines),
        spinner: state.spinner,
      };
    }

    const lastIndex = state.lines.length - 1;
    const last = state.lines[lastIndex];

    return {
      lines: [
        ...state.lines.slice(0, lastIndex),
        { ...last, text: last.text + (step.text ?? "") },
      ],
      spinner: state.spinner,
    };
  }

  if (step.kind === "think") {
    return { lines: state.lines, spinner: step.text ?? "" };
  }

  // "rest" is a pure delay.
  return state;
}

/**
 * Transcript snapshot for one pane at `timeMs` after its terminal came up.
 *
 * @param {{ id: string, steps: ReadonlyArray<object>, maxLines: number,
 *   startOffset: number, restGap: number }} pane
 * @param {number} timeMs
 * @param {ReadonlyArray<Line>} [boot] lines already on screen at t = 0, the
 *   agent's start-up banner
 * @returns {{ lines: ReadonlyArray<Line>, spinner: string | null }}
 */
export function paneTranscriptAt(pane, timeMs, boot = []) {
  const { first, offsets, cycleSpan } = scheduleFor(pane);
  let state = { lines: [...boot], spinner: null };

  if (timeMs < first) {
    return state;
  }

  const cycles = Math.floor((timeMs - first) / cycleSpan);

  for (let cycle = 0; cycle <= cycles; cycle += 1) {
    const base = first + cycle * cycleSpan;

    // A new cycle starts by clearing the spinner, exactly as the timer path
    // does before it replays step 0.
    if (cycle > 0) {
      state = { ...state, spinner: null };
    }

    for (let i = 0; i < pane.steps.length; i += 1) {
      if (base + offsets[i] > timeMs) {
        break;
      }

      state = applyStep(state, pane.steps[i], pane.maxLines);
    }
  }

  return state;
}
