/**
 * The working mark (RCP-15, DL-1.2): the terminal's braille spinner, ten frames of 80ms shown
 * one at a time by opacity, holding ⠹ under reduced motion. Each frame's dots are drawn, not
 * typed: the Windows monospace fallback may lack the braille block, and a missing glyph would
 * draw a box where the agent's state should be. One SVG holds the ten frames
 * (`32-state-mark.css` stacks and runs them).
 */

/** ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏, the spinner every agent CLI prints. */
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
/** ⠹: the frame that still reads as "working" when nothing moves. */
const STILL_FRAME = 2;
/** The six-dot cell inside the 14 slot: two columns, three rows, 4 apart. */
const DOT_X = [5, 9] as const;
const DOT_Y = [3, 7, 11] as const;
const DOT_R = 1.4;

/** A braille glyph's raised dots as [column, row]: U+2800 plus one bit per dot, dots 1-3 left. */
export function brailleDots(glyph: string): readonly (readonly [number, number])[] {
  const bits = (glyph.codePointAt(0) ?? 0x2800) - 0x2800;
  return [0, 1, 2, 3, 4, 5]
    .filter((dot) => (bits & (1 << dot)) !== 0)
    .map((dot) => [dot < 3 ? 0 : 1, dot % 3] as const);
}

export function BrailleSpinner() {
  return (
    <svg className="braille-spinner" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      {FRAMES.map((glyph, frame) => (
        <g
          key={glyph}
          data-still={frame === STILL_FRAME ? "" : undefined}
          style={{ "--frame": frame }}
        >
          {brailleDots(glyph).map(([column, row]) => (
            <circle key={`${column}${row}`} cx={DOT_X[column]} cy={DOT_Y[row]} r={DOT_R} />
          ))}
        </g>
      ))}
    </svg>
  );
}
