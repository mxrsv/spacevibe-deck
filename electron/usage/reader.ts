/**
 * The capped line reader and the strict RFC3339 parser — the two pieces every
 * other file in `usage/` builds on. Port of `src-tauri/src/usage/reader.rs`;
 * the semantics (committed offsets, the byte cap, Zulu-only timestamps) are
 * the contract the parity gate holds the two implementations to.
 */
import { closeSync, openSync, readSync } from 'node:fs';

/**
 * Largest line the parser will hold in memory.
 *
 * The largest Claude line measured on the dev machine is 1.22 MB and the
 * largest Codex line 1.96 MB, so 8 MiB is a guard rather than a routine path.
 * Codex conversation lines are documented to reach ~16 MB and carry no usage
 * at all: past the cap the bytes are consumed to the next newline and thrown
 * away without ever being buffered.
 */
export const MAX_LINE_BYTES = 8 * 1024 * 1024;

/**
 * Read granularity. Bigger than a default 8 KiB because a cold scan walks
 * ~2.5 GB of transcripts and the syscall count dominates.
 */
const READ_BUFFER_BYTES = 64 * 1024;

/** What one turn of the reader produced. */
export type LineEvent =
  /** A complete line without its newline, and the offset safe to commit. */
  | { readonly kind: 'line'; readonly bytes: Buffer; readonly offset: number }
  /** A complete line longer than the cap; bytes consumed and discarded. */
  | { readonly kind: 'oversized'; readonly offset: number }
  /** No further complete line. A partial trailing line stays uncommitted. */
  | { readonly kind: 'end' };

/**
 * A streaming line reader with a hard per-line byte cap, over an open fd.
 *
 * The committed offset only ever advances past a newline, which is what makes
 * an interrupted append safe to resume.
 */
export class LineReader {
  private readonly buffer: Buffer;
  /** Valid window into `buffer`. */
  private start = 0;
  private end = 0;
  /** Bytes consumed so far, including a partial trailing line. */
  private consumed: number;
  private readonly cap: number;

  constructor(
    private readonly fd: number,
    start: number,
    cap: number = MAX_LINE_BYTES,
    bufferBytes: number = READ_BUFFER_BYTES,
  ) {
    this.consumed = start;
    this.cap = cap;
    this.buffer = Buffer.alloc(bufferBytes);
  }

  private fill(): number {
    if (this.start < this.end) {
      return this.end - this.start;
    }
    this.start = 0;
    this.end = readSync(this.fd, this.buffer, 0, this.buffer.length, this.consumed);
    return this.end;
  }

  nextLine(): LineEvent {
    const pieces: Buffer[] = [];
    let held = 0;
    let oversized = false;
    for (;;) {
      const available = this.fill();
      if (available === 0) {
        return { kind: 'end' };
      }
      const window = this.buffer.subarray(this.start, this.end);
      const newlineAt = window.indexOf(0x0a);
      const newline = newlineAt !== -1;
      const taken = newline ? newlineAt + 1 : window.length;
      const payload = newline ? newlineAt : taken;
      if (oversized || held + payload > this.cap) {
        // Drop what was already held as well: the point of the cap is that an
        // over-long line never occupies memory.
        oversized = true;
        pieces.length = 0;
        held = 0;
      } else {
        pieces.push(Buffer.from(window.subarray(0, payload)));
        held += payload;
      }
      this.start += taken;
      this.consumed += taken;
      if (newline) {
        return oversized
          ? { kind: 'oversized', offset: this.consumed }
          : { kind: 'line', bytes: Buffer.concat(pieces), offset: this.consumed };
      }
    }
  }
}

/** Open + iterate + close, for callers that want the whole tail. */
export function readLines(path: string, start: number, onEvent: (event: LineEvent) => void): void {
  const fd = openSync(path, 'r');
  try {
    const reader = new LineReader(fd, start);
    for (;;) {
      let event: LineEvent;
      try {
        event = reader.nextLine();
      } catch {
        // A read error mid-file: commit the lines already ingested and let
        // the next scan resume from there rather than losing them.
        return;
      }
      if (event.kind === 'end') {
        return;
      }
      onEvent(event);
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * `YYYY-MM-DDTHH:MM:SS[.fraction]Z` → Unix milliseconds.
 *
 * Hand-rolled to match the Rust implementation bit for bit. Anything not
 * ending in `Z` is refused rather than guessed at: silently reading a
 * `+07:00` stamp as UTC would move seven hours of usage onto the wrong local
 * day, which is the exact failure 15-minute buckets exist to prevent.
 * Fractions past three digits are truncated, not rounded. Pre-epoch dates
 * and leap seconds are refused.
 */
export function parseRfc3339Ms(text: string): number | null {
  if (text.length < 20 || !/^[\x20-\x7e]*$/.test(text)) {
    return null;
  }
  if (
    text[4] !== '-' ||
    text[7] !== '-' ||
    text[10] !== 'T' ||
    text[13] !== ':' ||
    text[16] !== ':'
  ) {
    return null;
  }
  const year = digits(text.slice(0, 4));
  const month = digits(text.slice(5, 7));
  const day = digits(text.slice(8, 10));
  const hour = digits(text.slice(11, 13));
  const minute = digits(text.slice(14, 16));
  const second = digits(text.slice(17, 19));
  const millis = fractionMs(text.slice(19));
  if (
    year === null ||
    month === null ||
    day === null ||
    hour === null ||
    minute === null ||
    second === null ||
    millis === null
  ) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  const seconds = daysFromCivil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second;
  if (seconds < 0) {
    return null;
  }
  return seconds * 1_000 + millis;
}

/** An all-ASCII-digit run as a number; `null` on any other character. */
function digits(text: string): number | null {
  if (text.length === 0 || !/^[0-9]+$/.test(text)) {
    return null;
  }
  return Number.parseInt(text, 10);
}

/** The `[.fraction]Z` tail as whole milliseconds. */
function fractionMs(tail: string): number | null {
  if (tail === 'Z') {
    return 0;
  }
  if (!tail.startsWith('.') || !tail.endsWith('Z') || tail.length < 3) {
    return null;
  }
  const fraction = tail.slice(1, -1);
  if (!/^[0-9]+$/.test(fraction)) {
    return null;
  }
  let millis = 0;
  for (let index = 0; index < 3; index += 1) {
    const digit = index < fraction.length ? fraction.charCodeAt(index) - 48 : 0;
    millis = millis * 10 + digit;
  }
  return millis;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 2:
      return isLeapYear(year) ? 29 : 28;
    default:
      return 0;
  }
}

/**
 * Days between 1970-01-01 and the given civil date — Howard Hinnant's
 * `days_from_civil`, exact for the whole proleptic Gregorian calendar.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
  const shiftedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor((shiftedYear >= 0 ? shiftedYear : shiftedYear - 399) / 400);
  const yearOfEra = shiftedYear - era * 400;
  const shiftedMonth = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}
