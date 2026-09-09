import { describe, expect, it } from "vitest";
import { busySessionsOf, createSseParser, opencodeSignalOf } from "./opencode-events";

const SES = "ses_0123456789abcdef";

describe("opencodeSignalOf", () => {
  it("maps session.status busy/retry to working and idle to completed", () => {
    expect(
      opencodeSignalOf({
        type: "session.status",
        properties: { sessionID: SES, status: { type: "busy" } },
      }),
    ).toEqual({ kind: "working", sessionId: SES, detail: null });
    expect(
      opencodeSignalOf({
        type: "session.status",
        properties: { sessionID: SES, status: { type: "retry", attempt: 1, message: "x" } },
      })?.kind,
    ).toBe("working");
    expect(
      opencodeSignalOf({
        type: "session.status",
        properties: { sessionID: SES, status: { type: "idle" } },
      }),
    ).toEqual({ kind: "completed", sessionId: SES, detail: null });
  });

  it("maps session.idle and session.error", () => {
    expect(opencodeSignalOf({ type: "session.idle", properties: { sessionID: SES } })?.kind).toBe(
      "completed",
    );
    expect(
      opencodeSignalOf({
        type: "session.error",
        properties: { sessionID: SES, error: { name: "ProviderAuthError", data: {} } },
      }),
    ).toEqual({ kind: "error", sessionId: SES, detail: "ProviderAuthError" });
  });

  it("maps both permission spellings to requested, and both replies to answered", () => {
    expect(
      opencodeSignalOf({
        type: "permission.asked",
        properties: { id: "per_1", sessionID: SES, permission: "bash", patterns: [] },
      }),
    ).toEqual({ kind: "requested", sessionId: SES, detail: "bash" });
    expect(
      opencodeSignalOf({
        type: "permission.v2.asked",
        properties: { id: "per_1", sessionID: SES, action: "edit", resources: [] },
      }),
    ).toEqual({ kind: "requested", sessionId: SES, detail: "edit" });
    expect(
      opencodeSignalOf({
        type: "permission.replied",
        properties: { sessionID: SES, requestID: "per_1", reply: "once" },
      })?.kind,
    ).toBe("answered");
    expect(
      opencodeSignalOf({
        type: "permission.v2.replied",
        properties: { sessionID: SES, requestID: "per_1", reply: { type: "once" } },
      })?.kind,
    ).toBe("answered");
  });

  it("drops everything that is not a state, and anything without a safe session id", () => {
    expect(opencodeSignalOf({ type: "server.connected", properties: {} })).toBeNull();
    expect(
      opencodeSignalOf({ type: "message.updated", properties: { sessionID: SES } }),
    ).toBeNull();
    expect(
      opencodeSignalOf({ type: "session.idle", properties: { sessionID: "../x" } }),
    ).toBeNull();
    expect(opencodeSignalOf("text")).toBeNull();
    expect(opencodeSignalOf(null)).toBeNull();
  });
});

describe("createSseParser", () => {
  it("yields a frame per blank-line-terminated block, across chunk boundaries", () => {
    const parser = createSseParser();
    const first = JSON.stringify({ id: "evt_1", type: "server.connected", properties: {} });
    const second = JSON.stringify({
      id: "evt_2",
      type: "session.idle",
      properties: { sessionID: SES },
    });
    expect(parser.push(`data: ${first}\n\ndata: ${second.slice(0, 10)}`)).toEqual([
      JSON.parse(first),
    ]);
    expect(parser.push(`${second.slice(10)}\n\n`)).toEqual([JSON.parse(second)]);
  });

  it("ignores comment, event and id lines, and non-JSON data", () => {
    const parser = createSseParser();
    expect(parser.push(": keep-alive\n\nevent: x\nid: 1\ndata: not json\n\n")).toEqual([]);
  });

  it("joins multi-line data with newlines", () => {
    const parser = createSseParser();
    expect(parser.push('data: {"a":\ndata: 1}\n\n')).toEqual([{ a: 1 }]);
  });
});

describe("busySessionsOf", () => {
  it("lists the busy and retrying sessions of a status map", () => {
    expect(
      busySessionsOf({
        [SES]: { type: "busy" },
        ses_b: { type: "idle" },
        ses_c: { type: "retry", attempt: 2 },
        "bad id": { type: "busy" },
      }),
    ).toEqual([SES, "ses_c"]);
    expect(busySessionsOf(null)).toEqual([]);
    expect(busySessionsOf([])).toEqual([]);
  });
});
