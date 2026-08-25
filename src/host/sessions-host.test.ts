import { afterEach, describe, expect, it, vi } from "vitest";
import { listSessions } from "./sessions-host";
import * as bridge from "./bridge";
import { SESSIONS_DEFAULT_LIMIT } from "../lib/session-history";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("sessions-host", () => {
  it("sends a flat limit key", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    const invoke = vi.spyOn(bridge, "invoke").mockResolvedValue({
      entries: [],
      totals: { claude: 0, codex: 0 },
      limit: SESSIONS_DEFAULT_LIMIT,
    });
    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toEqual({
      status: "supported",
      snapshot: {
        entries: [],
        totals: { claude: 0, codex: 0 },
        limit: SESSIONS_DEFAULT_LIMIT,
      },
    });
    expect(invoke).toHaveBeenCalledWith("sessions_list", {
      limit: SESSIONS_DEFAULT_LIMIT,
    });
  });

  it("confirms unsupported without invoking when the Electron bridge is absent", async () => {
    const invoke = vi.spyOn(bridge, "invoke");

    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toEqual({
      status: "unsupported",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps an invocation rejection distinct from an unsupported host", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    const failure = new Error("disk temporarily unavailable");
    vi.spyOn(bridge, "invoke").mockRejectedValue(failure);

    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toEqual({
      status: "error",
      error: failure,
    });
  });

  it("preserves a non-Error invocation rejection inside the error result", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    const failure = { code: "SESSION_SCAN_FAILED" };
    vi.spyOn(bridge, "invoke").mockRejectedValue(failure);

    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toEqual({
      status: "error",
      error: failure,
    });
  });

  it("reports an invalid reply as an invocation error, not unsupported", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    vi.spyOn(bridge, "invoke").mockResolvedValue({ nope: true });

    const result = await listSessions(SESSIONS_DEFAULT_LIMIT);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});
