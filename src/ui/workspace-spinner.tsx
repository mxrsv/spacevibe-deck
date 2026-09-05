/**
 * Agent-working ring: a STILL ring of round dots whose ink runs around it.
 *
 * Nothing rotates (owner, 2026-08-20; DL-27.3 amended): each dot holds its
 * place and animates opacity on a shared cycle, offset by its slot, so the
 * bright head appears to travel clockwise while the geometry never moves —
 * a colour change, not a spin. The stagger lives in `02-shell.css`
 * (`wschase`), keyed by the `--dot` index set here; its step is the cycle
 * length over `COUNT`, so changing the dot count means changing that CSS too.
 *
 * SVG (not CSS mask-composite) so it paints in WKWebView. The drawing is a
 * 26 box because the class was sized for a 20px avatar; the rail overrides it
 * to its own 14px mark (DL-27.3), where these 8 dots render round and whole
 * instead of the sub-pixel smear the original 24 rotating ticks became.
 */

const COUNT = 8;
const CX = 13;
const CY = 13;
// R + DOT_R stays inside the 26 viewBox, so no dot leans on the class's
// `overflow: visible` to survive.
const R = 10.4;
const DOT_R = 2.2;

interface Dot {
  readonly x: number;
  readonly y: number;
}

const DOTS: readonly Dot[] = Array.from({ length: COUNT }, (_, i) => {
  const angle = (i / COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: CX + Math.cos(angle) * R,
    y: CY + Math.sin(angle) * R,
  };
});

export function WorkspaceSpinner() {
  return (
    <svg class="wsitem__spinner" viewBox="0 0 26 26" width="26" height="26" aria-hidden="true">
      {DOTS.map((dot, i) => (
        <circle
          key={i}
          class="wsdot"
          cx={dot.x}
          cy={dot.y}
          r={DOT_R}
          style={{ "--dot": String(i) }}
        />
      ))}
    </svg>
  );
}
