/**
 * The space the window sits in: a slow aurora curtain, a vignette and a
 * static grain plate.
 *
 * Deliberately CSS-only. A WebGL curtain would have to be seeked through its
 * own uniform and would depend on the headless GPU path; three blurred blobs
 * whose positions are a function of `t` render identically everywhere.
 */

const BLOBS = Object.freeze([
  {
    size: 54,
    ax: 17,
    ay: 11,
    fx: 0.21,
    fy: 0.17,
    px: 0,
    py: 0,
    x0: 17,
    y0: 24,
    alpha: 1,
  },
  {
    size: 48,
    ax: 13,
    ay: 15,
    fx: 0.13,
    fy: 0.19,
    px: 1.2,
    py: 0.6,
    x0: 84,
    y0: 31,
    alpha: 0.92,
  },
  {
    size: 58,
    ax: 15,
    ay: 13,
    fx: 0.11,
    fy: 0.23,
    px: 2.4,
    py: 1.9,
    x0: 50,
    y0: 89,
    alpha: 0.85,
  },
]);

/**
 * @param {HTMLElement} host
 */
export function createBackdrop(host) {
  if (!host) {
    throw new Error("Backdrop host is missing.");
  }

  host.innerHTML = `
    <div class="vid-aurora">
      ${BLOBS.map((_, i) => `<i data-blob="${i}"></i>`).join("")}
    </div>
    <div class="vid-vignette"></div>
    <div class="vid-grain"></div>
  `;

  const aurora = host.querySelector(".vid-aurora");

  if (!aurora) {
    throw new Error("Backdrop aurora layer failed to render.");
  }

  const blobs = BLOBS.map((_, i) => {
    const el = host.querySelector(`[data-blob="${i}"]`);

    if (!el) {
      throw new Error(`Backdrop blob ${i} failed to render.`);
    }

    return el;
  });

  return {
    /** @param {{ backdrop: { palette: readonly string[], glow: number } , t: number }} state */
    apply(state) {
      const { palette, glow } = state.backdrop;

      aurora.style.setProperty("--wash", palette[1] ?? palette[0]);
      aurora.style.opacity = String(0.55 + glow * 0.45);

      blobs.forEach((el, i) => {
        const b = BLOBS[i];
        const x = b.x0 + b.ax * Math.sin(b.fx * state.t + b.px);
        const y = b.y0 + b.ay * Math.cos(b.fy * state.t + b.py);

        el.style.setProperty("--x", `${x}%`);
        el.style.setProperty("--y", `${y}%`);
        el.style.setProperty("--size", `${b.size}vmax`);
        el.style.setProperty("--tint", palette[i] ?? palette[0]);
        el.style.setProperty("--alpha", String(b.alpha * glow));
      });
    },
  };
}
