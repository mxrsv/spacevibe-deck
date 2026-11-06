import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { splitChunks } from "@protocol/chunk";
import type { AppEvent } from "@protocol/messages";
import { requestBody } from "./chunked";

function fakeConnection() {
  const listeners = new Set<(e: AppEvent) => void>();
  return {
    connection: {
      onEvent(listener: (e: AppEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit: (e: AppEvent) => listeners.forEach((l) => l(e)),
    count: () => listeners.size,
  };
}

type Answer = { text: string } | { chunked: string };
const pick = (a: Answer) => a;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("requestBody", () => {
  it("returns an inline body as is", async () => {
    const fake = fakeConnection();
    const { text } = await requestBody(
      fake.connection,
      async () => ({ text: "hello" }) as Answer,
      pick,
    );
    expect(text).toBe("hello");
    expect(fake.count()).toBe(0);
  });

  it("joins chunks that arrive AFTER the response, as the desktop sends them", async () => {
    const fake = fakeConnection();
    const body = "x".repeat(150_000) + "end";
    const chunks = splitChunks("body1", body);
    expect(chunks.length).toBeGreaterThan(1);
    const pending = requestBody(
      fake.connection,
      async () => ({ chunked: "body1" }) as Answer,
      pick,
    );
    await Promise.resolve();
    await Promise.resolve();
    for (const chunk of chunks) fake.emit(chunk);
    expect((await pending).text).toBe(body);
    expect(fake.count()).toBe(0);
  });

  it("joins chunks that arrive BEFORE the response is handled", async () => {
    const fake = fakeConnection();
    const chunks = splitChunks("body2", "abc");
    const { text } = await requestBody(
      fake.connection,
      async () => {
        for (const chunk of chunks) fake.emit(chunk);
        return { chunked: "body2" } as Answer;
      },
      pick,
    );
    expect(text).toBe("abc");
  });

  it("fails clearly when a chunk is missing or never comes", async () => {
    const fake = fakeConnection();
    const chunks = splitChunks("body3", "y".repeat(150_000));
    const gap = requestBody(fake.connection, async () => ({ chunked: "body3" }) as Answer, pick);
    const caught = gap.catch((e: unknown) => e);
    await Promise.resolve();
    await Promise.resolve();
    fake.emit(chunks[0]);
    fake.emit(chunks[chunks.length - 1]); // skips the middle
    expect(await caught).toMatchObject({ code: "bad-response" });

    const slow = requestBody(
      fake.connection,
      async () => ({ chunked: "body4" }) as Answer,
      pick,
      1_000,
    );
    const slowCaught = slow.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await slowCaught).toMatchObject({ code: "bad-response" });
  });
});
