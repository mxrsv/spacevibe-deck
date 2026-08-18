/**
 * Agent-pending ring around a workspace avatar: ~24 short ticks with a
 * comet opacity ramp. SVG (not CSS mask-composite) so it paints in WKWebView.
 */

const COUNT = 24;
const CX = 13;
const CY = 13;
const R = 11.2;
const TICK_W = 1.35;
const TICK_H = 2.1;

interface Tick {
  readonly x: number;
  readonly y: number;
  readonly rotate: number;
  readonly opacity: number;
}

const TICKS: readonly Tick[] = Array.from({ length: COUNT }, (_, i) => {
  const t = i / COUNT;
  // Bright head at i=0; fade along the trail; drop the faintest tip.
  const opacity = Math.pow(1 - t, 1.55);
  const angle = (i / COUNT) * Math.PI * 2 - Math.PI / 2;
  return {
    x: CX + Math.cos(angle) * R - TICK_W / 2,
    y: CY + Math.sin(angle) * R - TICK_H / 2,
    rotate: (angle * 180) / Math.PI + 90,
    opacity,
  };
}).filter((tick) => tick.opacity >= 0.04);

export function WorkspaceSpinner() {
  return (
    <svg class="wsitem__spinner" viewBox="0 0 26 26" width="26" height="26" aria-hidden="true">
      {TICKS.map((tick, i) => (
        <rect
          key={i}
          x={tick.x}
          y={tick.y}
          width={TICK_W}
          height={TICK_H}
          rx="0.35"
          opacity={tick.opacity}
          transform={`rotate(${tick.rotate} ${CX} ${CY})`}
        />
      ))}
    </svg>
  );
}
