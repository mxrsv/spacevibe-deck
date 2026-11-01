/**
 * Reads of a Codex rollout that Codex has compressed.
 *
 * Since 0.162.1 Codex compresses every rollout untouched for seven days into
 * `<name>.jsonl.zst`: one zstd frame, the original mtime kept, the plain file
 * deleted. Resuming one writes the plain `.jsonl` back before the `.zst` is
 * removed, so for a moment both exist; discovery keeps the plain one, as
 * Codex's own walker does. Every reader of rollout bytes goes through here
 * (or `readCompressedLines` in `reader.ts`, which streams), or a week-old
 * conversation silently drops out of resume, history and usage.
 */
import { fstatSync, readFileSync, readSync } from "node:fs";
import { constants, zstdDecompressSync } from "node:zlib";
import { CODEX_COMPRESSED_SUFFIX } from "./model";

/**
 * Largest decompressed rollout Deck will hold. The largest one measured on the
 * dev machine (2026-10-24) is 89 MiB; this bounds a pathological frame rather
 * than a real conversation.
 */
const MAX_DECOMPRESSED_BYTES = 512 * 1024 * 1024;

/**
 * Compressed bytes the first head attempt reads; each retry doubles it. Most
 * rollouts reach 64 KiB of content within one or two attempts, and starting
 * small decompresses ~4x less than one generous read: 0.6 s versus 1.6 s for
 * 1,822 real rollouts under Electron (2026-10-24).
 */
const FIRST_HEAD_WINDOW_BYTES = 16 * 1024;

/**
 * Decompressed bytes kept from the end of a compressed rollout: the widest
 * window `session-tail.ts` reads. The rail re-asks every pane's tail whenever
 * any pane's attention moves, and a `.zst` has no seekable end, so without
 * this an idle restored Codex pane would decompress its whole rollout (up to
 * 89 MiB measured) once per window step on every ask.
 */
const TAIL_CACHE_BYTES = 1024 * 1024;
const TAIL_CACHE_ENTRIES = 16;

/** `path + mtime + size` → the end of its content, and whether that is all of it. */
const tailCache = new Map<string, { readonly tail: Buffer; readonly whole: boolean }>();

export function isCompressedRollout(filePath: string): boolean {
  return filePath.endsWith(CODEX_COMPRESSED_SUFFIX);
}

/** The whole decompressed content of an open `.zst` file. Throws on a corrupt or truncated frame. */
function readDecompressed(fd: number): Buffer {
  return zstdDecompressSync(readFileSync(fd), { maxOutputLength: MAX_DECOMPRESSED_BYTES });
}

/**
 * The last `cap` decompressed bytes of an open `.zst` file at `filePath`,
 * decompressing it at most once while it is unchanged.
 */
export function readDecompressedTail(fd: number, filePath: string, cap: number): Buffer {
  const { mtimeMs, size } = fstatSync(fd);
  const key = JSON.stringify([filePath, mtimeMs, size]);
  let entry = tailCache.get(key);
  if (entry === undefined || (!entry.whole && entry.tail.length < cap)) {
    const content = readDecompressed(fd);
    const keep = Math.max(cap, TAIL_CACHE_BYTES);
    entry = {
      tail: Buffer.from(content.subarray(Math.max(0, content.length - keep))),
      whole: content.length <= keep,
    };
    tailCache.delete(key);
    tailCache.set(key, entry);
    if (tailCache.size > TAIL_CACHE_ENTRIES) {
      tailCache.delete(tailCache.keys().next().value as string);
    }
  }
  return entry.tail.subarray(Math.max(0, entry.tail.length - cap));
}

/**
 * The first `cap` decompressed bytes of an open `.zst` file (fewer only when
 * the content is shorter), reading only as much compressed input as that
 * takes. A head read must not decompress a whole multi-megabyte rollout.
 *
 * `ZSTD_e_flush` returns what a cut-off input completes. Electron's zlib
 * throws on a cut-off input under the default `ZSTD_e_end`; plain Node does
 * not, so a test run under Node alone cannot catch that difference.
 */
export function readDecompressedHead(fd: number, cap: number): Buffer {
  const size = fstatSync(fd).size;
  for (let window = FIRST_HEAD_WINDOW_BYTES; ; window *= 2) {
    const input = Buffer.alloc(Math.min(window, size));
    const read = readSync(fd, input, 0, input.length, 0);
    const whole = read >= size;
    const output = zstdDecompressSync(input.subarray(0, read), {
      maxOutputLength: MAX_DECOMPRESSED_BYTES,
      ...(whole ? {} : { finishFlush: constants.ZSTD_e_flush }),
    });
    // A short read leaves nothing to widen into, so a wider window would loop.
    if (whole || output.length >= cap || read < input.length) {
      return output.subarray(0, cap);
    }
  }
}
