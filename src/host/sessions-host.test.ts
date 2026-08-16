import { afterEach, describe, expect, it, vi } from "vitest";
import { listSessions } from "./sessions-host";
import * as bridge from "./bridge";
import { SESSIONS_DEFAULT_LIMIT } from "../lib/session-history";

afterEach(() => vi.restoreAllMocks());

describe("sessions-host", () => {
  it("sends a flat limit key", async () => {
    const invoke = vi.spyOn(bridge, "invoke").mockResolvedValue({
      entries: [],
      totals: { claude: 0, codex: 0 },
      limit: SESSIONS_DEFAULT_LIMIT,
    });
    await listSessions(SESSIONS_DEFAULT_LIMIT);
    expect(invoke).toHaveBeenCalledWith("sessions_list", {
      limit: SESSIONS_DEFAULT_LIMIT,
    });
  });

  it("answers null on a host without the channel instead of throwing", async () => {
    vi.spyOn(bridge, "invoke").mockRejectedValue(new Error("no handler"));
    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toBeNull();
  });

  it("answers null on a reply that is not a snapshot", async () => {
    vi.spyOn(bridge, "invoke").mockResolvedValue({ nope: true });
    await expect(listSessions(SESSIONS_DEFAULT_LIMIT)).resolves.toBeNull();
  });
});
