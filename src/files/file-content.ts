/**
 * Encoding, line endings and the two refusals (plan T6).
 *
 * Byte-level and pure, so the HOST can apply it (`electron/fs/read.ts`) and a
 * 50 MB file is never sent across the bridge to be rejected in the renderer.
 * That is why this module lives in `src/files` but is also compiled into the
 * main process — see `tsconfig.electron.json`'s include list. It must therefore
 * stay free of DOM and Preact imports.
 */

/** Above this, a file opens read-only rather than being refused outright:
 * reading a large log is useful, editing it in a webview is not (spec §4.4). */
export const MAX_EDITABLE_BYTES = 2 * 1024 * 1024;

/**
 * Above this, a file is refused outright.
 *
 * The spec says two things that need reconciling: §4.4 opens anything above
 * 2 MB read-only, while §11's manual item 13 expects a **50 MB file to refuse
 * with a reason**. Both are right at different scales — a 3 MB lockfile is
 * worth reading, and a 50 MB one is worth refusing before it is pulled through
 * the IPC bridge and handed to a webview. This constant is where the two meet:
 * read-only from 2 MB, refused from 16 MB.
 */
export const MAX_READABLE_BYTES = 16 * 1024 * 1024;

/** How much of a file is inspected for the binary verdict. */
export const BINARY_SNIFF_BYTES = 8192;

export type Eol = "lf" | "crlf";

export type FileEncoding = "utf-8" | "invalid-utf-8";

export interface FileContent {
  /** Always LF-normalized — the editor works in LF and `applyEol` restores
   * the file's own ending on save, so nothing rewrites endings silently. */
  readonly content: string;
  readonly eol: Eol;
  readonly encoding: FileEncoding;
  /** Bytes on disk at read time — the size cap's input, kept for the status bar. */
  readonly bytes: number;
  /** True when the file had BOTH endings and `eol` is the dominant one. */
  readonly mixedEol: boolean;
  readonly readOnly: boolean;
  /** Why it is read-only, in words the UI shows verbatim. Null when editable. */
  readonly reason: string | null;
}

export type FileRead =
  | { readonly kind: "ok"; readonly file: FileContent }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * A NUL byte in the first block means binary (spec §4.4).
 *
 * Cheap and wrong at the margins — a UTF-16 text file trips it — which is the
 * right trade: the failure is "Deck declines to open a file you could open
 * elsewhere", not "Deck renders 40 MB of entropy into a webview".
 */
export function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * The file's dominant line ending, and whether it was mixed.
 *
 * "Dominant" rather than "first seen": a CRLF file with one stray LF must not
 * be rewritten to LF on save, and vice versa. A file with no ending at all is
 * LF, matching what a new file gets.
 */
export function detectEol(text: string): { eol: Eol; mixed: boolean } {
  let crlf = 0;
  let lf = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 10) {
      continue;
    }
    if (index > 0 && text.charCodeAt(index - 1) === 13) {
      crlf += 1;
    } else {
      lf += 1;
    }
  }
  return { eol: crlf > lf ? "crlf" : "lf", mixed: crlf > 0 && lf > 0 };
}

/** Collapse every CRLF to LF. The editor never sees a carriage return. */
export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Restore `eol` on the way back to disk — the save half of `normalizeEol`. */
export function applyEol(text: string, eol: Eol): string {
  const lf = normalizeEol(text);
  return eol === "crlf" ? lf.replace(/\n/g, "\r\n") : lf;
}

/**
 * Decode as UTF-8, strictly.
 *
 * `fatal: true` first so invalid input is DETECTED rather than silently
 * replaced: U+FFFD in the buffer would be saved back over the user's file as
 * literal replacement characters, quietly corrupting it. On failure the lossy
 * decode is still shown, but read-only, so nothing can be written back.
 */
export function decodeUtf8(bytes: Uint8Array): {
  text: string;
  encoding: FileEncoding;
} {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf-8",
    };
  } catch {
    return {
      text: new TextDecoder("utf-8").decode(bytes),
      encoding: "invalid-utf-8",
    };
  }
}

export const BINARY_REFUSAL =
  "This looks like a binary file, so Deck will not open it.";

export function oversizeReason(bytes: number): string {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `This file is ${mb} MB — above the ${MAX_EDITABLE_BYTES / (1024 * 1024)} MB editing limit, so it opens read-only.`;
}

/**
 * The refusal for a file too large to open at all, or null when it may be read.
 *
 * Checked by the HOST from the file's `stat` BEFORE any bytes are read, which
 * is the whole point: a 50 MB file must never be loaded into the main process
 * to be rejected afterwards.
 */
export function refuseForSize(bytes: number): string | null {
  if (bytes <= MAX_READABLE_BYTES) {
    return null;
  }
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  return `This file is ${mb} MB — too large for Deck to open.`;
}

export const INVALID_UTF8_REASON =
  "This file is not valid UTF-8, so it opens read-only.";

/**
 * The whole verdict for one file's bytes.
 *
 * Order matters and is deliberate: binary is REFUSED before anything is
 * decoded, because decoding 40 MB of entropy is the cost this check exists to
 * avoid. Size and encoding both degrade to read-only rather than refusing —
 * seeing the file is the point of the panel.
 */
export function readFileContent(bytes: Uint8Array): FileRead {
  const tooLarge = refuseForSize(bytes.length);
  if (tooLarge !== null) {
    // Defence in depth. The host refuses from `stat` before reading, so
    // reaching this line means something read the bytes anyway.
    return { kind: "refused", reason: tooLarge };
  }
  if (looksBinary(bytes)) {
    return { kind: "refused", reason: BINARY_REFUSAL };
  }
  const oversize = bytes.length > MAX_EDITABLE_BYTES;
  const { text, encoding } = decodeUtf8(bytes);
  const { eol, mixed } = detectEol(text);
  const reason = oversize
    ? oversizeReason(bytes.length)
    : encoding === "invalid-utf-8"
      ? INVALID_UTF8_REASON
      : null;
  return {
    kind: "ok",
    file: {
      content: normalizeEol(text),
      eol,
      encoding,
      bytes: bytes.length,
      mixedEol: mixed,
      readOnly: reason !== null,
      reason,
    },
  };
}

/** Status-bar spelling of a file's encoding and ending. */
export function encodingLabel(file: FileContent): string {
  return file.encoding === "utf-8" ? "UTF-8" : "UTF-8 (invalid)";
}

export function eolLabel(file: FileContent): string {
  return file.eol === "crlf" ? "CRLF" : "LF";
}
