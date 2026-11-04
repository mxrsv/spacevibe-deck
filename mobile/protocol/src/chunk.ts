/**
 * Large bodies (a file, a diff, a screen snapshot-sized read) do not fit one sealed message, so the
 * sender splits them into `chunk` events and the receiver joins them in order. Splitting measures
 * each piece by its JSON-encoded UTF-8 size, so a payload full of control characters (6 bytes each
 * once escaped) still leaves every message under `MAX_MESSAGE_BYTES`.
 */
import { CHUNK_BYTES, MAX_READ_BYTES } from "./limits";

export interface ChunkEvent {
  readonly ev: "chunk";
  readonly p: {
    readonly id: string;
    readonly seq: number;
    readonly last: boolean;
    readonly data: string;
  };
}

/** Largest joined payload, in UTF-16 units: bodies are capped at `MAX_READ_BYTES` before they chunk. */
export const MAX_CHUNKED_CHARS = MAX_READ_BYTES * 2;
const MAX_PENDING_IDS = 16;

/** Bytes one code point costs inside a JSON string once encoded as UTF-8. */
function jsonCost(codePoint: number): number {
  if (codePoint === 0x22 || codePoint === 0x5c) return 2;
  if (codePoint === 0x08 || codePoint === 0x09 || codePoint === 0x0a) return 2;
  if (codePoint === 0x0c || codePoint === 0x0d) return 2;
  if (codePoint < 0x20) return 6;
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) return 6; // a lone surrogate is escaped
  return codePoint < 0x10000 ? 3 : 4;
}

/** An empty payload still yields one (empty, `last`) chunk so the receiver sees it end. */
export function splitChunks(id: string, payload: string): ChunkEvent[] {
  const pieces: string[] = [];
  let start = 0;
  let cost = 0;
  let index = 0;
  while (index < payload.length) {
    const codePoint = payload.codePointAt(index) ?? 0;
    const width = codePoint > 0xffff ? 2 : 1;
    const next = jsonCost(codePoint);
    if (cost + next > CHUNK_BYTES) {
      pieces.push(payload.slice(start, index));
      start = index;
      cost = 0;
    }
    cost += next;
    index += width;
  }
  pieces.push(payload.slice(start));
  return pieces.map((data, seq) => ({
    ev: "chunk",
    p: { id, seq, last: seq === pieces.length - 1, data },
  }));
}

export type JoinResult =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly reason: "empty" | "gap" | "duplicate" | "too-large" | "id-mismatch" | "unfinished";
    };

/** Joins a complete, in-order set of chunks of one id. */
export function joinChunks(chunks: readonly ChunkEvent[]): JoinResult {
  if (chunks.length === 0) return { ok: false, reason: "empty" };
  const id = chunks[0].p.id;
  let total = 0;
  const parts: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const { p } = chunks[i];
    if (p.id !== id) return { ok: false, reason: "id-mismatch" };
    if (i > 0 && p.seq === chunks[i - 1].p.seq) return { ok: false, reason: "duplicate" };
    if (p.seq !== i) return { ok: false, reason: "gap" };
    total += p.data.length;
    if (total > MAX_CHUNKED_CHARS) return { ok: false, reason: "too-large" };
    if (p.last !== (i === chunks.length - 1)) {
      return { ok: false, reason: p.last ? "gap" : "unfinished" };
    }
    parts.push(p.data);
  }
  return { ok: true, text: parts.join("") };
}

export type AssemblerResult =
  | { readonly status: "more" }
  | { readonly status: "done"; readonly id: string; readonly text: string }
  | { readonly status: "error"; readonly id: string; readonly reason: string };

/**
 * Stateful receiver for chunk events as they arrive between other messages. An id that errors is
 * forgotten, so one bad body cannot wedge the rest, and the number of bodies in flight is bounded.
 */
export function createChunkAssembler(): {
  push(chunk: ChunkEvent["p"]): AssemblerResult;
  pending(): number;
} {
  const open = new Map<string, ChunkEvent[]>();
  return {
    pending: () => open.size,
    push(chunk) {
      const list = open.get(chunk.id) ?? [];
      if (list.length === 0 && open.size >= MAX_PENDING_IDS) {
        return { status: "error", id: chunk.id, reason: "too-many-pending" };
      }
      const event: ChunkEvent = { ev: "chunk", p: chunk };
      const expected = list.length;
      if (chunk.seq !== expected) {
        open.delete(chunk.id);
        return {
          status: "error",
          id: chunk.id,
          reason: chunk.seq < expected ? "duplicate" : "gap",
        };
      }
      list.push(event);
      open.set(chunk.id, list);
      if (!chunk.last) {
        const size = list.reduce((sum, item) => sum + item.p.data.length, 0);
        if (size > MAX_CHUNKED_CHARS) {
          open.delete(chunk.id);
          return { status: "error", id: chunk.id, reason: "too-large" };
        }
        return { status: "more" };
      }
      open.delete(chunk.id);
      const joined = joinChunks(list);
      return joined.ok
        ? { status: "done", id: chunk.id, text: joined.text }
        : { status: "error", id: chunk.id, reason: joined.reason };
    },
  };
}
