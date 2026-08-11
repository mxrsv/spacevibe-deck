/**
 * OSC shell-integration parser — a 1:1 port of `src-tauri/src/shell_integration.rs`.
 *
 * Deck learns two things from terminal output: OSC 133;B says a prompt is
 * ready (attention state), and OSC 9;9 reports the shell's working directory.
 * Both arrive mid-stream and can straddle chunk boundaries, so the parser is
 * a value: it carries whatever it could not finish into the next call.
 *
 * Ported behaviours that look like details but are not:
 *  - the 128 KB pending cap, so a stream that opens an OSC and never closes it
 *    cannot grow the buffer without bound;
 *  - a lone trailing ESC is kept, because the `]` may be in the next chunk;
 *  - a payload that is not valid UTF-8 is skipped rather than throwing.
 */
import path from "node:path";
import fs from "node:fs";

const OSC_PREFIX = Buffer.from([0x1b, 0x5d]); // ESC ]
const MAX_PENDING_BYTES = 128 * 1024;
const ESC = 0x1b;
const BEL = 0x07;
const BACKSLASH = 0x5c;

export type ShellIntegrationEvent =
  | { readonly kind: "prompt-ready" }
  | { readonly kind: "current-directory"; readonly value: string };

export interface ParseResult {
  readonly parser: ShellIntegrationParser;
  readonly events: readonly ShellIntegrationEvent[];
}

/** Immutable parser state — `parse` returns the next one (C1). */
export class ShellIntegrationParser {
  private readonly pending: Buffer;

  constructor(pending: Buffer = Buffer.alloc(0)) {
    this.pending = pending;
  }

  parse(chunk: string): ParseResult {
    let input = Buffer.concat([this.pending, Buffer.from(chunk, "utf8")]);
    if (input.length > MAX_PENDING_BYTES) {
      input = input.subarray(input.length - MAX_PENDING_BYTES);
    }

    const events: ShellIntegrationEvent[] = [];
    let cursor = 0;
    let incompleteStart: number | null = null;

    for (;;) {
      const relativeStart = input.subarray(cursor).indexOf(OSC_PREFIX);
      if (relativeStart === -1) {
        break;
      }
      const start = cursor + relativeStart;
      const payloadStart = start + OSC_PREFIX.length;
      const terminator = findTerminator(input.subarray(payloadStart));
      if (terminator === null) {
        incompleteStart = start;
        break;
      }
      const payloadEnd = payloadStart + terminator.payloadLength;
      const payload = decodeUtf8Strict(
        input.subarray(payloadStart, payloadEnd),
      );
      if (payload !== null) {
        const event = parsePayload(payload);
        if (event !== null) {
          events.push(event);
        }
      }
      cursor = payloadEnd + terminator.terminatorLength;
    }

    let nextPending: Buffer;
    if (incompleteStart !== null) {
      nextPending = Buffer.from(input.subarray(incompleteStart));
    } else if (input.length > 0 && input[input.length - 1] === ESC) {
      // A trailing ESC may be the start of the next OSC; its `]` has not
      // arrived yet. Keeping only the ESC (not the whole tail) matches Rust.
      nextPending = Buffer.from([ESC]);
    } else {
      nextPending = Buffer.alloc(0);
    }

    return { parser: new ShellIntegrationParser(nextPending), events };
  }
}

interface Terminator {
  readonly payloadLength: number;
  readonly terminatorLength: number;
}

/** BEL, or ST (ESC \). Returns null while the terminator is still missing. */
function findTerminator(input: Buffer): Terminator | null {
  for (let index = 0; index < input.length; index += 1) {
    const byte = input[index];
    if (byte === BEL) {
      return { payloadLength: index, terminatorLength: 1 };
    }
    if (byte === ESC && input[index + 1] === BACKSLASH) {
      return { payloadLength: index, terminatorLength: 2 };
    }
  }
  return null;
}

/**
 * Rust's `std::str::from_utf8` rejects invalid sequences; Node's default
 * decoder replaces them with U+FFFD instead. Round-tripping detects that, so a
 * malformed payload is skipped here exactly as it is there.
 */
function decodeUtf8Strict(bytes: Buffer): string | null {
  const decoded = bytes.toString("utf8");
  return Buffer.compare(Buffer.from(decoded, "utf8"), bytes) === 0
    ? decoded
    : null;
}

function parsePayload(payload: string): ShellIntegrationEvent | null {
  if (payload === "133;B") {
    return { kind: "prompt-ready" };
  }
  if (!payload.startsWith("9;9;")) {
    return null;
  }
  const raw = payload.slice("9;9;".length).trim();
  const unquoted =
    raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw;
  return unquoted.length > 0
    ? { kind: "current-directory", value: unquoted }
    : null;
}

/**
 * A candidate root that must never reach the filesystem.
 *
 * On Windows `\\host\share` is absolute, and probing it is a real network call
 * into the SMB redirector: seconds per unreachable host, and Windows offers the
 * interactive user's NTLMv2 credentials to whatever host the candidate names.
 * PTY-sourced cwd text and terminal-link targets share this one predicate, as
 * they do in Rust — `links.ts` imports it rather than defining its own.
 *
 * The Rust version classifies via Windows path prefixes and falls back to the
 * textual form elsewhere. Node has no prefix parser, so the textual form is
 * used on every platform, plus the verbatim `\\?\` and `\\.\` forms which the
 * Rust prefix check also rejects.
 */
export function hasRejectedRoot(candidate: string): boolean {
  const trimmed = candidate.trim();
  return (
    trimmed.startsWith("\\\\") ||
    trimmed.startsWith("//?/") ||
    trimmed.startsWith("//./")
  );
}

/**
 * Last candidate that names an existing directory, or `current` when this one
 * is not acceptable. Hits the filesystem, so callers must keep it off any
 * lock-holding path — the Rust comment on `validate_cwd_candidates` explains
 * why that mattered there and the same reasoning applies to the event loop.
 */
export function retainValidCwd(
  current: string | null,
  candidate: string,
): string | null {
  const trimmed = candidate.trim();
  if (hasRejectedRoot(trimmed)) {
    return current;
  }
  if (!path.isAbsolute(trimmed)) {
    return current;
  }
  try {
    return fs.statSync(trimmed).isDirectory() ? trimmed : current;
  } catch {
    return current;
  }
}

/** Fold a batch of candidates down to the last one that validates. */
export function validateCwdCandidates(
  candidates: readonly string[],
): string | null {
  return candidates.reduce<string | null>(
    (current, candidate) => retainValidCwd(current, candidate),
    null,
  );
}
