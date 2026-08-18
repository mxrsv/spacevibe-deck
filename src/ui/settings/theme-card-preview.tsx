import { deriveChromeColors } from '../../lib/derive-colors';
import type { ThemePreset } from '../../settings/themes';

/**
 * The miniature of Deck a theme card shows (DL-24.2).
 *
 * It is a drawing of the app, not a strip of swatches, because that is the
 * question a theme picker answers: not "what are these twenty colours" but
 * "what will my window look like". The parts are the ones a user recognises
 * from across the room — the command row, the navigation rail, the stage, an
 * agent line — at the smallest size where each is still its own shape.
 *
 * Every colour here comes from the preset's own theme object, through the SAME
 * `deriveChromeColors` the running app publishes as CSS custom properties
 * (DL-2.1's swatch exception, DL-24.3). A card painted from hand-picked values
 * would be a second visual truth, and the first thing it would get wrong is the
 * one thing the card exists to show.
 *
 * Nothing here reads a `--token`: the card must show a theme that is NOT the
 * active one, and a token resolves to whatever theme the app is running.
 */

/**
 * Ink strengths for the rail's filler rows.
 *
 * Well under half of `--text-faint`, and measured on the rendered card rather
 * than chosen: a faint TEXT colour painted as a solid 4px block reads far
 * louder than the text it was tuned for, and at full strength the rail out-shouts
 * the accent the card exists to show. The three differ so the rail reads as a
 * list rather than a hatch.
 */
const FILLER_ROWS = [0.34, 0.2, 0.27] as const;

/** Same reasoning, for the one un-accented line on the stage. */
const MUTED_LINE = 0.32;

export function ThemeCardPreview({ preset }: { preset: ThemePreset }) {
  const { theme } = preset;
  const chrome = deriveChromeColors(theme.background, theme.foreground);
  const accent = theme.blue ?? theme.cyan ?? theme.foreground;

  return (
    <span class="theme-mini" style={{ background: chrome.sidebarBg }}>
      {/* DL-18.3/DL-18.7: the frame is the TOP OF THE NAVIGATION COLUMN, so it
          shares the rail's surface and there is no seam between them. Painting
          it as its own chrome step would draw a band the app does not have. */}
      <span class="theme-mini__frame" style={{ background: chrome.sidebarBg }}>
        <span class="theme-mini__light" style={{ background: theme.red }} />
        <span class="theme-mini__light" style={{ background: theme.yellow }} />
        <span class="theme-mini__light" style={{ background: theme.green }} />
        <span class="theme-mini__chip" style={{ background: chrome.stateHoverBg }} />
      </span>
      <span class="theme-mini__body">
        <span
          class="theme-mini__rail"
          style={{
            background: chrome.sidebarBg,
            borderColor: chrome.sidebarSeam,
          }}
        >
          <span class="theme-mini__tab" style={{ background: accent }} />
          {FILLER_ROWS.map((strength, index) => (
            <span
              key={index}
              class="theme-mini__row"
              style={{ background: chrome.textFaint, opacity: strength }}
            />
          ))}
        </span>
        <span class="theme-mini__stage" style={{ background: theme.background }}>
          <span class="theme-mini__line">
            <span class="theme-mini__dot" style={{ background: accent }} />
            <span class="theme-mini__bar theme-mini__bar--wide" style={{ background: accent }} />
          </span>
          <span class="theme-mini__line" style={{ opacity: MUTED_LINE }}>
            <span class="theme-mini__dot" style={{ background: chrome.textFaint }} />
            <span
              class="theme-mini__bar theme-mini__bar--wider"
              style={{ background: chrome.textFaint }}
            />
          </span>
          <span class="theme-mini__line">
            <span class="theme-mini__dot" style={{ background: accent }} />
            <span class="theme-mini__bar" style={{ background: accent }} />
          </span>
        </span>
      </span>
    </span>
  );
}
