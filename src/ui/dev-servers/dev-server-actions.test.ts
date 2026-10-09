import { describe, expect, it, vi } from "vitest";
import type { DevServerResolveResult } from "../../dev-servers/dev-server-types";
import { runDevServerAction, type DevServerActionDeps } from "./dev-server-actions";
import { itemOf } from "./dev-server-fixtures";

const READY: DevServerResolveResult = {
  status: "ready",
  id: "a",
  url: "http://127.0.0.1:5999/resolved",
  protocol: "http",
};

function deps(over: Partial<DevServerActionDeps> = {}): DevServerActionDeps {
  return {
    resolve: vi.fn(async () => READY),
    openInDeck: vi.fn(async (url: string) => ({ ok: true as const, url })),
    openExternal: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    ...over,
  };
}

const item = itemOf();

describe("runDevServerAction", () => {
  it("rechecks the instance and opens the URL the core returned, not the row's", async () => {
    const d = deps();

    const result = await runDevServerAction("open-deck", item, d);

    expect(d.resolve).toHaveBeenCalledWith("a", "token-a");
    expect(d.openInDeck).toHaveBeenCalledWith("http://127.0.0.1:5999/resolved");
    expect(result).toEqual({ tone: "ok", text: "Opened 127.0.0.1:5173 in Deck" });
  });

  it("opens the external browser with the resolved URL", async () => {
    const d = deps();

    const result = await runDevServerAction("open-external", item, d);

    expect(d.openExternal).toHaveBeenCalledWith("http://127.0.0.1:5999/resolved");
    expect(result.tone).toBe("ok");
  });

  it("copies the resolved URL, not the stale one", async () => {
    const d = deps();

    const result = await runDevServerAction("copy", item, d);

    expect(d.copy).toHaveBeenCalledWith("http://127.0.0.1:5999/resolved");
    expect(result).toEqual({ tone: "ok", text: "Copied http://127.0.0.1:5999/resolved" });
  });

  it("copies a bare address without asking the core, because no URL is involved", async () => {
    const d = deps();
    const bare = itemOf({ url: null, protocol: "unknown" });

    const result = await runDevServerAction("copy", bare, d);

    expect(d.resolve).not.toHaveBeenCalled();
    expect(d.copy).toHaveBeenCalledWith("127.0.0.1:5173");
    expect(result.tone).toBe("ok");
  });

  describe.each([
    ["stale", { status: "stale" } as const, "is no longer the server that was listed"],
    [
      "not running",
      { status: "unavailable", reason: "not-running" } as const,
      "that server is not running any more",
    ],
    [
      "an incomplete scan",
      { status: "unavailable", reason: "scan-incomplete" } as const,
      "could not confirm it is running",
    ],
    [
      "an unidentified protocol",
      { status: "unknown-protocol", error: "tls:CERT_HAS_EXPIRED" } as const,
      "certificate not trusted",
    ],
  ])("when the core refuses with %s", (_name, refusal, words) => {
    it.each(["open-deck", "open-external", "copy"] as const)(
      "%s acts on nothing",
      async (action) => {
        const d = deps({ resolve: vi.fn(async () => refusal) });

        const result = await runDevServerAction(action, item, d);

        expect(result.tone).toBe("error");
        expect(result.text).toContain(words);
        expect(d.openInDeck).not.toHaveBeenCalled();
        expect(d.openExternal).not.toHaveBeenCalled();
        expect(d.copy).not.toHaveBeenCalled();
      },
    );
  });

  it("says so when the core cannot be reached, and acts on nothing", async () => {
    const d = deps({
      resolve: vi.fn(async () => {
        throw new Error("ipc down");
      }),
    });

    const result = await runDevServerAction("open-deck", item, d);

    expect(result).toEqual({
      tone: "error",
      text: "Not opened — could not check that server just now.",
    });
    expect(d.openInDeck).not.toHaveBeenCalled();
  });

  it("reports a browser that would not open", async () => {
    const d = deps({
      openExternal: vi.fn(async () => {
        throw new Error("denied");
      }),
    });

    expect(await runDevServerAction("open-external", item, d)).toEqual({
      tone: "error",
      text: "Could not open your browser.",
    });
  });

  it("reports why the Deck browser would not open", async () => {
    const d = deps({
      openInDeck: vi.fn(async () => ({
        ok: false as const,
        message: "The Deck browser could not open.",
      })),
    });

    expect(await runDevServerAction("open-deck", item, d)).toEqual({
      tone: "error",
      text: "The Deck browser could not open.",
    });
  });

  it("reports a clipboard that refuses", async () => {
    const d = deps({
      copy: vi.fn(async () => {
        throw new Error("denied");
      }),
    });

    expect((await runDevServerAction("copy", item, d)).tone).toBe("error");
  });
});
