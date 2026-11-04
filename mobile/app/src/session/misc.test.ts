import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, BACKOFF_MAX_MS } from "./backoff";
import { createRelayLink, type LinkDown } from "./relay-link";
import { createRpc } from "./rpc";
import type { SocketEvents } from "./socket";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("backoffDelay", () => {
  it("doubles from one second to a thirty second cap, with jitter", () => {
    expect(backoffDelay(0, () => 1)).toBe(1_000);
    expect(backoffDelay(0, () => 0)).toBe(500);
    expect(backoffDelay(3, () => 1)).toBe(8_000);
    expect(backoffDelay(20, () => 1)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(20, () => 0)).toBe(BACKOFF_MAX_MS / 2);
  });
});

describe("rpc", () => {
  it("fails every waiting request at once when the channel goes away", async () => {
    const rpc = createRpc(() => "sent");
    const a = rpc.request("usage.get", {}).catch((e: unknown) => e);
    const b = rpc.request("projects.list", {}).catch((e: unknown) => e);
    rpc.failAll("closed", "gone");
    expect(await a).toMatchObject({ code: "closed" });
    expect(await b).toMatchObject({ code: "closed" });
  });

  it("rejects at once when the channel is not open, and ignores a response nobody asked for", async () => {
    const rpc = createRpc(() => "not-open");
    await expect(rpc.request("usage.get", {})).rejects.toMatchObject({ code: "not-connected" });
    expect(rpc.handleResponse({ id: 99, ok: true, r: {} })).toBe(false);
  });

  it("rejects an answer that is not the shape of the method", async () => {
    const rpc = createRpc(() => "sent");
    const pending = rpc.request("pane.open", {
      projectPath: "/p",
      checkoutPath: "/p",
      agent: "claude",
      prompt: null,
    });
    rpc.handleResponse({ id: 1, ok: true, r: { paneId: "seven" } });
    await expect(pending).rejects.toMatchObject({ code: "bad-response" });
  });
});

describe("relay link keep-alive", () => {
  it("pings, and treats a socket that stops answering as dropped", async () => {
    const sent: string[] = [];
    const downs: LinkDown[] = [];
    let events: SocketEvents | null = null;
    createRelayLink({
      relayUrl: "https://relay.test/relay",
      pairingId: "AAAAAAAAAAAAAAAAAAAAAA",
      phoneToken: "t",
      pingIntervalMs: 1_000,
      socketFactory: (_url, e) => {
        events = e;
        return {
          send: (data) => void sent.push(String(data)),
          close() {},
        };
      },
      handlers: { onUp() {}, onPeer() {}, onFrame() {}, onDown: (d) => downs.push(d) },
    });
    events!.onOpen();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.filter((m) => m.includes('"ping"'))).toHaveLength(1);
    events!.onText('{"t":"pong"}');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.filter((m) => m.includes('"ping"'))).toHaveLength(2);
    expect(downs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000); // no pong for the second ping
    expect(downs).toEqual([{ kind: "closed", code: 1006 }]);
  });
});
