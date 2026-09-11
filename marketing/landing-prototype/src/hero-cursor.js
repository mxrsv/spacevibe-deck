/**
 * The hero's drawn pointer: it walks the window to the control a scene change
 * is made with, rests on it, and presses it — so the cycle reads as someone
 * USING Deck rather than as slides. Owner-asked 2026-09-11.
 *
 * It moves by a CSS transition on `transform`, not by script frames: the
 * caller only says where to go, and a browser without transitions still lands
 * the pointer in the right place. Every timer here is the caller's to cancel;
 * the pointer never schedules a scene change itself.
 */

/** Glide, rest on the target, press — the cycle starts a walk this early. */
export const GLIDE_MS = 820;
const REST_MS = 380;
const PRESS_MS = 200;
const FADE_AFTER_MS = 900;
export const CURSOR_LEAD_MS = GLIDE_MS + REST_MS + PRESS_MS;
/* Between the presses of one sequence: long enough to see what opened. */
const STEP_GAP_MS = 250;

/* Where a pointer with no previous position enters from, as a share of the
   window: low and to the right of its target, the way a hand comes in. */
const ENTRY_OFFSET = { x: 0.16, y: 0.28 };

const ARROW_SVG = `
  <svg class="hero-cursor__arrow" viewBox="0 0 16 22" aria-hidden="true">
    <path d="M1 1v17.2l4.3-4.1 2.9 6.6 2.6-1.1-2.9-6.5h6z"
      fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round" />
  </svg>
`;

/**
 * @param {HTMLElement} win the `.a-appwin` figure; must be positioned
 * @returns {{ walk(target: Element): void, leave(): void, cancel(): void, dispose(): void }}
 */
export function mountHeroCursor(win) {
  if (!win) {
    throw new Error("Hero cursor needs its window.");
  }

  const el = document.createElement("div");
  el.className = "hero-cursor";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `${ARROW_SVG}<span class="hero-cursor__ring"></span>`;
  win.append(el);

  let position = null;
  let over = null;
  let timers = [];

  function later(fn, ms) {
    timers = [...timers, setTimeout(fn, ms)];
  }

  function pointOf(target) {
    const box = win.getBoundingClientRect();
    const rect = target.getBoundingClientRect();

    return {
      x: rect.left - box.left + rect.width * 0.5,
      y: rect.top - box.top + rect.height * 0.55,
    };
  }

  function place(point) {
    el.style.transform = `translate(${point.x}px, ${point.y}px)`;
  }

  function release() {
    over?.classList.remove("is-cursor-over");
    over = null;
  }

  function enterNear(point) {
    el.classList.add("is-placing");
    place({
      x: point.x + win.clientWidth * ENTRY_OFFSET.x,
      y: point.y + win.clientHeight * ENTRY_OFFSET.y,
    });
    // Commit the entry point before the transition is restored, or the
    // browser folds both writes into one and the pointer appears on target.
    void el.offsetWidth;
    el.classList.remove("is-placing");
  }

  function press() {
    el.classList.remove("is-pressing");
    void el.offsetWidth;
    el.classList.add("is-pressing");
    later(() => el.classList.remove("is-pressing"), PRESS_MS * 3);
  }

  /** Glide to `target`, rest on it, press it — CURSOR_LEAD_MS in all. */
  function walk(target, onPress) {
    const point = pointOf(target);

    release();

    if (position === null) {
      enterNear(point);
    }

    el.classList.add("is-visible");
    place(point);
    position = point;
    later(() => {
      over = target;
      target.classList.add("is-cursor-over");
    }, GLIDE_MS);
    later(() => {
      press();
      onPress?.();
    }, GLIDE_MS + REST_MS);
  }

  return {
    walk,

    /**
     * Several presses in a row. Each `target` is a function because a step's
     * target may only exist once the press before it has opened something.
     *
     * @param {Array<{ target: () => Element | null, onPress?: () => void }>} steps
     */
    sequence(steps) {
      steps.forEach((step, index) => {
        later(() => {
          const target = step.target();

          if (target) {
            walk(target, step.onPress);
          }
        }, index * (CURSOR_LEAD_MS + STEP_GAP_MS));
      });
    },

    /** Drop the hover the scene swap left behind, then fade out. */
    leave() {
      release();
      later(() => {
        el.classList.remove("is-visible");
        position = null;
      }, FADE_AFTER_MS);
    },

    cancel() {
      timers.forEach(clearTimeout);
      timers = [];
    },

    dispose() {
      this.cancel();
      release();
      el.remove();
    },
  };
}
