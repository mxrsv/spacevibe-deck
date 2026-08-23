import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionTails } from "./session-tail-host";
import * as bridge from "./bridge";
import type { ResumeRequest } from "../lib/agent-resume";

afterEach(() => vi.restoreAllMocks());

const REQUEST: ResumeRequest = { agent: "claude", cwd: "/w", lastSeenAt: 1 };

describe("session-tail-host", () => {
  it("sends the requests under a flat key (R6)", async () => {
    const invoke = vi.spyOn(bridge, "invoke").mockResolvedValue([]);
    await sessionTails([REQUEST]);
    expect(invoke).toHaveBeenCalledWith("session_tail", { requests: [REQUEST] });
  });

  it("carries the pairing through, tail and all", async () => {
    vi.spyOn(bridge, "invoke").mockResolvedValue([{ id: "sess-1", tail: "what it said" }]);
    await expect(sessionTails([REQUEST])).resolves.toEqual([
      { id: "sess-1", tail: "what it said" },
    ]);
  });

  it("keeps a paired-but-wordless answer as a PAIRING, not as nothing", async () => {
    // The distinction the whole fix rests on: `{ id, tail: null }` means "this
    // pane's own session had nothing quotable in the window" and must survive
    // the parse, where a bare `null` means "nothing could be paired at all".
    // Flattening the first into the second would make the store keep a
    // sentence it should have dropped.
    vi.spyOn(bridge, "invoke").mockResolvedValue([{ id: "sess-1", tail: null }]);
    await expect(sessionTails([REQUEST])).resolves.toEqual([{ id: "sess-1", tail: null }]);
  });

  it("answers null AT ITS OWN POSITION for anything that is not an answer", async () => {
    // Positional, so a malformed entry must not be dropped: dropping it shifts
    // every later sentence onto the wrong pane.
    vi.spyOn(bridge, "invoke").mockResolvedValue([
      { id: "sess-1", tail: "kept" },
      null,
      "a bare string from an older host",
      { tail: "no id" },
      { id: "", tail: "empty id" },
      { id: "sess-2", tail: 42 },
    ]);
    const six = [REQUEST, REQUEST, REQUEST, REQUEST, REQUEST, REQUEST];
    await expect(sessionTails(six)).resolves.toEqual([
      { id: "sess-1", tail: "kept" },
      null,
      null,
      null,
      null,
      { id: "sess-2", tail: null },
    ]);
  });

  it("answers exactly one slot per REQUEST, whatever length the host sends", async () => {
    // The contract is positional against the requests. A host answering with a
    // different length must not be able to change how many panes get an answer:
    // a short reply pads with nulls, a long one has its surplus dropped.
    vi.spyOn(bridge, "invoke").mockResolvedValue([{ id: "sess-1", tail: "one" }]);
    await expect(sessionTails([REQUEST, REQUEST, REQUEST])).resolves.toEqual([
      { id: "sess-1", tail: "one" },
      null,
      null,
    ]);
  });

  it("drops a surplus answer rather than returning more slots than panes", async () => {
    vi.spyOn(bridge, "invoke").mockResolvedValue([
      { id: "sess-1", tail: "one" },
      { id: "sess-2", tail: "two" },
    ]);
    await expect(sessionTails([REQUEST])).resolves.toEqual([{ id: "sess-1", tail: "one" }]);
  });

  it("answers one null per request when the host sends no list at all", async () => {
    vi.spyOn(bridge, "invoke").mockResolvedValue(undefined);
    await expect(sessionTails([REQUEST, REQUEST])).resolves.toEqual([null, null]);
  });
});
