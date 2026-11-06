import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileService } from "../mobile/service";
import { registerMobile } from "./register-mobile";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => unknown) =>
      mocks.handlers.set(name, callback),
  },
}));

const EVENT = { sender: { id: 7 } };
const call = (channel: string, payload?: unknown) => mocks.handlers.get(channel)!(EVENT, payload);

function fakeService() {
  return {
    state: vi.fn(() => ({ enabled: true, encryptionAvailable: true, phones: [], pending: null })),
    pairStart: vi.fn(),
    pairCancel: vi.fn(),
    revoke: vi.fn(async () => ({ enabled: true })),
    settleQuery: vi.fn(() => true),
    streamData: vi.fn(() => true),
    push: vi.fn(),
  } as unknown as MobileService & Record<string, ReturnType<typeof vi.fn>>;
}

describe("registerMobile with the switch off", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    registerMobile({ service: null, labelOf: () => "deck-1", assertOwner: () => {} });
  });

  it("answers disabled and refuses everything else, touching nothing", async () => {
    expect(call("mobile_state")).toMatchObject({ enabled: false, phones: [], pending: null });
    expect(await call("mobile_pair_start")).toMatchObject({
      enabled: false,
      error: { reason: "disabled" },
    });
    expect(call("mobile_pair_cancel")).toMatchObject({ enabled: false });
    expect(await call("mobile_revoke", { pairingId: "A".repeat(22) })).toMatchObject({
      enabled: false,
    });
    expect(call("mobile_query_report", { requestId: "r", kind: "tree", payload: {} })).toBe(false);
    expect(
      call("mobile_stream_data", {
        subscriptionId: "s",
        paneId: 1,
        kind: "data",
        data: "x",
        cols: 0,
        rows: 0,
      }),
    ).toBe(false);
    expect(call("mobile_push", { paneId: 1, kind: "requested", title: "t", body: "b" })).toBe(
      false,
    );
  });
});

describe("registerMobile with the switch on", () => {
  const service = fakeService();
  const owned = new Set([4]);

  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    registerMobile({
      service,
      labelOf: () => "deck-1",
      assertOwner: (paneId) => {
        if (!owned.has(paneId)) throw new Error("not yours");
      },
    });
  });

  it("settles a query as the window that sent it", () => {
    expect(
      call("mobile_query_report", { requestId: "r1", kind: "tree", payload: { projects: [] } }),
    ).toBe(true);
    expect(service.settleQuery).toHaveBeenCalledWith("deck-1", "r1", "tree", { projects: [] });
    expect(() =>
      call("mobile_query_report", { requestId: "r1", kind: "bogus", payload: {} }),
    ).toThrow(TypeError);
  });

  it("forwards a stream piece only with every field in shape", () => {
    const piece = { subscriptionId: "s", paneId: 4, kind: "data", data: "out", cols: 80, rows: 24 };
    expect(call("mobile_stream_data", piece)).toBe(true);
    expect(service.streamData).toHaveBeenCalledWith("deck-1", piece);
    for (const bad of [
      { kind: "wipe" },
      { paneId: -1 },
      { data: 5 },
      { cols: 5000 },
      { subscriptionId: "" },
    ]) {
      expect(() => call("mobile_stream_data", { ...piece, ...bad })).toThrow(TypeError);
    }
  });

  it("refuses a push for a pane the sender does not own, and for kinds a phone is never told", () => {
    expect(call("mobile_push", { paneId: 4, kind: "completed", title: "t", body: "b" })).toBe(true);
    expect(service.push).toHaveBeenCalledOnce();
    expect(call("mobile_push", { paneId: 9, kind: "completed", title: "t", body: "b" })).toBe(
      false,
    );
    expect(() => call("mobile_push", { paneId: 4, kind: "error", title: "t", body: "b" })).toThrow(
      TypeError,
    );
    expect(service.push).toHaveBeenCalledOnce();
  });

  it("revokes only a well-formed pairing id", async () => {
    await call("mobile_revoke", { pairingId: "A".repeat(22) });
    expect(service.revoke).toHaveBeenCalledWith("A".repeat(22));
    await expect(call("mobile_revoke", { pairingId: "../x" })).rejects.toBeInstanceOf(TypeError);
  });
});
