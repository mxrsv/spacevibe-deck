/**
 * OSC 9;4 progress-report parsing (ConEmu convention, emitted by Claude Code
 * and rendered natively by Ghostty / iTerm2 / Windows Terminal):
 *
 *   ESC ] 9 ; 4 ; <state> [; <progress>] (BEL | ESC \)
 *
 * States: 0 = clear/idle, 1 = normal progress, 2 = error, 3 = indeterminate
 * (busy), 4 = warning. Anything non-zero means "the app is working". The
 * parser itself is agnostic to state semantics — it keeps whatever raw
 * integer arrives (including unknown future states) rather than narrowing
 * to the known 0..4 range.
 */

/** A sequence with no state param means "clear" by convention. */
const CLEAR = 0;

/** Matches one COMPLETE OSC 9;4 sequence; group 1 = state, group 2 = progress. */
const OSC_9_4 = /\x1b\]9;4(?:;(\d+)(?:;(\d*))?)?(?:\x07|\x1b\\)/g;

/** One parsed OSC 9;4 report. `progress` is present only when the sequence
 * carried a numeric second param. */
export interface OscProgressEvent {
  state: number;
  progress?: number;
}

/** Result of feeding one chunk through the incremental parser. */
export interface OscProgressParse {
  events: OscProgressEvent[];
  carry: string;
}

/**
 * Longest OSC 9;4 sequence is ~16 bytes ("\x1b]9;4;<s>;<100>\x1b\\"). This is
 * both the trailing-byte window `agent-activity.ts` keeps between PTY reads
 * (compatibility surface) and the hard cap `parseProgressEvents` enforces on
 * its own incomplete-prefix carry, so a sequence that never terminates can't
 * grow the carry buffer without bound.
 */
export const OSC_CARRY_LENGTH = 24;

/** Incremental prefixes of an OSC 9;4 sequence that have not yet reached a
 * terminator: `\x1b`, `\x1b]`, `\x1b]9`, `\x1b]9;`, `\x1b]9;4`, `\x1b]9;4;`,
 * `\x1b]9;4;1`, `\x1b]9;4;1;`, `\x1b]9;4;1;42` … */
const INCOMPLETE_PREFIX = /^\x1b(\](9(;(4(;\d*(;\d*)?)?)?)?)?)?$/;

/** The ST terminator itself split across chunks: digits (and optional
 * progress) followed by a lone ESC whose `\` arrives next chunk. */
const INCOMPLETE_SPLIT_ST = /^\x1b\]9;4;\d*(;\d*)?\x1b$/;

/**
 * Find the incomplete OSC 9;4 prefix (if any) trailing `text`, scanning
 * candidate start points left-to-right so a fragment of an unrelated,
 * unterminated OSC sequence (a partial title, a partial notification) is
 * skipped in favor of the real pending progress report. Returns "" when
 * there is no such prefix, or when the candidate exceeds the hard cap.
 */
function incompleteCarry(text: string): string {
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '\x1b') continue;
    const candidate = text.slice(i);
    if (candidate.length > OSC_CARRY_LENGTH) continue;
    if (INCOMPLETE_PREFIX.test(candidate) || INCOMPLETE_SPLIT_ST.test(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Incremental OSC 9;4 parser. Feed it the carry returned by the previous
 * call plus the newly read chunk; it returns every COMPLETE report found, in
 * order, and the (possibly empty) incomplete trailing prefix to carry into
 * the next call. A sequence that completed within this call is never
 * re-emitted by a later call.
 */
export function parseProgressEvents(carry: string, chunk: string): OscProgressParse {
  const buf = carry + chunk;
  const events: OscProgressEvent[] = [];
  let consumedEnd = 0;

  for (const match of buf.matchAll(OSC_9_4)) {
    const state = match[1] === undefined ? CLEAR : Number.parseInt(match[1], 10);
    const progressParam = match[2];
    events.push(
      progressParam !== undefined && progressParam !== ''
        ? { state, progress: Number.parseInt(progressParam, 10) }
        : { state },
    );
    consumedEnd = (match.index ?? 0) + match[0].length;
  }

  const trailing = buf.slice(consumedEnd);
  return { events, carry: incompleteCarry(trailing) };
}

/**
 * Last OSC 9;4 state in `text`, or null when the text has none. Pure — feed
 * it raw PTY output; later sequences in the same chunk win. Implemented on
 * top of `parseProgressEvents` — kept as a stable, simpler surface for
 * callers that only care about the latest state.
 */
export function lastProgressState(text: string): number | null {
  const { events } = parseProgressEvents('', text);
  if (events.length === 0) return null;
  return events[events.length - 1].state;
}
