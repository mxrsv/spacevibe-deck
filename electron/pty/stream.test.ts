import { describe, expect, it, vi } from "vitest";
import { createStreamDecoder, OutputBatcher } from "./stream";

const tick = () =>
  new Promise((resolve) => queueMicrotask(() => resolve(null)));
/** Two hops: the batcher re-schedules itself while a backlog remains. */
const drain = async () => {
  for (let i = 0; i < 20; i += 1) {
    await tick();
  }
};

function makeBatcher(
  overrides: Partial<{ batchMaxBytes: number; queueMaxBytes: number }> = {},
) {
  const emitted: string[] = [];
  const pause = vi.fn();
  const resume = vi.fn();
  const batcher = new OutputBatcher({
    emit: (data) => emitted.push(data),
    pause,
    resume,
    ...overrides,
  });
  return { batcher, emitted, pause, resume };
}

describe("OutputBatcher", () => {
  it("coalesces chunks pushed in the same tick into one emit", async () => {
    const { batcher, emitted } = makeBatcher();

    batcher.push("a");
    batcher.push("b");
    batcher.push("c");
    await drain();

    expect(emitted).toEqual(["abc"]);
  });

  it("never emits synchronously", () => {
    const { batcher, emitted } = makeBatcher();

    batcher.push("a");

    expect(emitted).toEqual([]);
  });

  it("splits a backlog at the batch cap and preserves order", async () => {
    const { batcher, emitted } = makeBatcher({ batchMaxBytes: 4 });

    batcher.push("aaa");
    batcher.push("bbb");
    batcher.push("ccc");
    await drain();

    expect(emitted.join("")).toBe("aaabbbccc");
    expect(emitted.every((batch) => batch.length <= 6)).toBe(true);
  });

  it("emits an oversized single chunk whole rather than wedging", async () => {
    const { batcher, emitted } = makeBatcher({ batchMaxBytes: 4 });

    batcher.push("aaaaaaaaaaaa");
    await drain();

    expect(emitted).toEqual(["aaaaaaaaaaaa"]);
  });

  it("pauses the source once the backlog passes the ceiling, then resumes", async () => {
    const { batcher, pause, resume } = makeBatcher({
      batchMaxBytes: 2,
      queueMaxBytes: 4,
    });

    batcher.push("aaaaaa");

    expect(pause).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();

    await drain();

    expect(resume).toHaveBeenCalledOnce();
  });

  it("drops nothing when flushed synchronously on exit", () => {
    const { batcher, emitted } = makeBatcher();

    batcher.push("tail");
    batcher.flush();

    expect(emitted).toEqual(["tail"]);
  });

  it("ignores pushes after close", async () => {
    const { batcher, emitted } = makeBatcher();

    batcher.close();
    batcher.push("late");
    await drain();

    expect(emitted).toEqual([]);
  });
});

describe("createStreamDecoder", () => {
  it("holds back a multi-byte sequence split across chunks", () => {
    const decode = createStreamDecoder();
    // "é" is 0xC3 0xA9 — split it across two reads.
    const first = decode(new Uint8Array([0x61, 0xc3]));
    const second = decode(new Uint8Array([0xa9, 0x62]));

    expect(first).toBe("a");
    expect(second).toBe("éb");
  });

  it("replaces genuinely invalid bytes instead of stalling", () => {
    const decode = createStreamDecoder();

    const out = decode(new Uint8Array([0x61, 0xff, 0x62]));

    expect(out).toBe("a�b");
  });

  it("carries a partial sequence across many chunks", () => {
    const decode = createStreamDecoder();
    // "😀" is F0 9F 98 80 — one byte per call.
    const parts = [0xf0, 0x9f, 0x98, 0x80].map((byte) =>
      decode(new Uint8Array([byte])),
    );

    expect(parts.join("")).toBe("😀");
  });
});

describe("decoder tail at exit", () => {
  it("releases a held-back partial sequence as U+FFFD", () => {
    // A shell dying mid-character used to drop these bytes silently; Rust
    // flushed them lossily so the user saw a replacement char.
    const decode = createStreamDecoder();

    expect(decode(new Uint8Array([0x61, 0xf0, 0x9f]))).toBe("a");
    expect(decode.flush()).toBe("�");
  });

  it("returns nothing when the stream ended cleanly", () => {
    const decode = createStreamDecoder();
    decode(new Uint8Array([0x61]));

    expect(decode.flush()).toBe("");
  });
});
