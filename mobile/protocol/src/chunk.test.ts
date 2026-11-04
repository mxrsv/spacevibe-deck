import { describe, expect, it } from "vitest";
import { createChunkAssembler, joinChunks, MAX_CHUNKED_CHARS, splitChunks } from "./chunk";
import { utf8Encode } from "./encoding";
import { CHUNK_BYTES, MAX_MESSAGE_BYTES } from "./limits";

describe("splitChunks / joinChunks", () => {
  it("returns one last chunk for a small or empty payload", () => {
    expect(splitChunks("a", "hi").map((c) => c.p)).toEqual([
      { id: "a", seq: 0, last: true, data: "hi" },
    ]);
    expect(splitChunks("a", "")).toHaveLength(1);
    expect(joinChunks(splitChunks("a", ""))).toEqual({ ok: true, text: "" });
  });

  it("splits plain text at CHUNK_BYTES and joins it back byte for byte", () => {
    const payload = "x".repeat(CHUNK_BYTES * 2 + 100);
    const chunks = splitChunks("id", payload);
    expect(chunks.map((c) => c.p.data.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 100]);
    expect(chunks.map((c) => c.p.seq)).toEqual([0, 1, 2]);
    expect(chunks.map((c) => c.p.last)).toEqual([false, false, true]);
    expect(joinChunks(chunks)).toEqual({ ok: true, text: payload });
  });

  it("keeps every encoded message under the limit even for escape-heavy text", () => {
    const esc = String.fromCharCode(0x1b);
    const payload = (esc + '"\\\n🚀é日').repeat(40_000);
    const chunks = splitChunks("id", payload);
    for (const chunk of chunks) {
      expect(utf8Encode(JSON.stringify(chunk)).length).toBeLessThan(MAX_MESSAGE_BYTES);
    }
    expect(joinChunks(chunks)).toEqual({ ok: true, text: payload });
  });

  it("never splits a surrogate pair", () => {
    const payload = "🚀".repeat(CHUNK_BYTES);
    for (const chunk of splitChunks("id", payload)) {
      expect(chunk.p.data.length % 2).toBe(0);
    }
  });

  it("rejects gaps, duplicates, wrong order and an unfinished body", () => {
    const chunks = splitChunks("id", "x".repeat(CHUNK_BYTES * 3));
    expect(joinChunks([chunks[0], chunks[2]])).toMatchObject({ ok: false, reason: "gap" });
    expect(joinChunks([chunks[0], chunks[0], chunks[1], chunks[2]])).toMatchObject({
      ok: false,
      reason: "duplicate",
    });
    expect(joinChunks([chunks[1], chunks[0], chunks[2]])).toMatchObject({
      ok: false,
      reason: "gap",
    });
    expect(joinChunks([chunks[0], chunks[1]])).toMatchObject({ ok: false, reason: "unfinished" });
    expect(joinChunks([])).toMatchObject({ ok: false, reason: "empty" });
    expect(
      joinChunks([chunks[0], { ...chunks[1], p: { ...chunks[1].p, id: "other" } }]),
    ).toMatchObject({
      ok: false,
      reason: "id-mismatch",
    });
  });

  it("rejects a body over twice MAX_READ_BYTES", () => {
    const ok = splitChunks("id", "x".repeat(MAX_CHUNKED_CHARS));
    expect(joinChunks(ok).ok).toBe(true);
    const tooBig = splitChunks("id", "x".repeat(MAX_CHUNKED_CHARS + 1));
    expect(joinChunks(tooBig)).toMatchObject({ ok: false, reason: "too-large" });
  });
});

describe("createChunkAssembler", () => {
  it("joins interleaved bodies as their last chunks arrive", () => {
    const assembler = createChunkAssembler();
    const a = splitChunks("a", "A".repeat(CHUNK_BYTES + 5));
    const b = splitChunks("b", "B".repeat(CHUNK_BYTES + 7));
    expect(assembler.push(a[0].p)).toEqual({ status: "more" });
    expect(assembler.push(b[0].p)).toEqual({ status: "more" });
    expect(assembler.pending()).toBe(2);
    expect(assembler.push(b[1].p)).toEqual({
      status: "done",
      id: "b",
      text: "B".repeat(CHUNK_BYTES + 7),
    });
    expect(assembler.push(a[1].p)).toEqual({
      status: "done",
      id: "a",
      text: "A".repeat(CHUNK_BYTES + 5),
    });
    expect(assembler.pending()).toBe(0);
  });

  it("drops a body on a gap or a duplicate and lets the next one through", () => {
    const assembler = createChunkAssembler();
    const bad = splitChunks("bad", "x".repeat(CHUNK_BYTES * 3));
    assembler.push(bad[0].p);
    expect(assembler.push(bad[2].p)).toMatchObject({ status: "error", id: "bad", reason: "gap" });
    expect(assembler.pending()).toBe(0);
    assembler.push(bad[0].p);
    expect(assembler.push(bad[0].p)).toMatchObject({ status: "error", reason: "duplicate" });
    const good = splitChunks("good", "ok");
    expect(assembler.push(good[0].p)).toEqual({ status: "done", id: "good", text: "ok" });
  });

  it("refuses a body that grows past the limit and caps bodies in flight", () => {
    const assembler = createChunkAssembler();
    const piece = "x".repeat(CHUNK_BYTES);
    let result = assembler.push({ id: "big", seq: 0, last: false, data: piece });
    for (let seq = 1; result.status === "more"; seq++) {
      result = assembler.push({ id: "big", seq, last: false, data: piece });
    }
    expect(result).toMatchObject({ status: "error", reason: "too-large" });

    for (let i = 0; i < 16; i++) assembler.push({ id: `p${i}`, seq: 0, last: false, data: "x" });
    expect(assembler.push({ id: "one-too-many", seq: 0, last: false, data: "x" })).toMatchObject({
      status: "error",
      reason: "too-many-pending",
    });
  });
});
