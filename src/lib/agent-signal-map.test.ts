import { describe, expect, it } from "vitest";
import { contractSignalOf, parseHookEvent, type HookEvent } from "./agent-signal-map";

const SESSION = "11111111-2222-4333-8444-555555555555";

function claude(event: string, over: Partial<HookEvent> = {}): HookEvent {
  return {
    paneId: 7,
    source: "hook",
    agent: "claude",
    event,
    sessionId: SESSION,
    cwd: "/w",
    message: null,
    detail: null,
    receivedAt: 1000,
    ...over,
  };
}

function opencode(event: string, over: Partial<HookEvent> = {}): HookEvent {
  return claude(event, { source: "server", agent: "opencode", sessionId: "ses_abc", ...over });
}

describe("contractSignalOf — claude hooks", () => {
  it("Stop is a completion carrying the sentence", () => {
    expect(contractSignalOf(claude("Stop", { message: "Suite is green." }))).toEqual({
      source: "hook",
      kind: "completed",
      sessionId: SESSION,
      detail: null,
      message: "Suite is green.",
      observedAt: 1000,
    });
  });

  it("StopFailure is the only producer of an error", () => {
    expect(contractSignalOf(claude("StopFailure", { detail: null }))?.kind).toBe("error");
  });

  it("Notification is a request only for its two matched kinds", () => {
    expect(contractSignalOf(claude("Notification", { detail: "permission_prompt" }))).toMatchObject(
      {
        kind: "requested",
        detail: "permission prompt",
      },
    );
    expect(contractSignalOf(claude("Notification", { detail: "idle_prompt" }))).toMatchObject({
      kind: "requested",
      detail: "input needed",
    });
    expect(contractSignalOf(claude("Notification", { detail: "agent_completed" }))).toBeNull();
    expect(contractSignalOf(claude("Notification"))).toBeNull();
  });

  it("PermissionRequest is a request naming the tool", () => {
    expect(contractSignalOf(claude("PermissionRequest", { detail: "Bash" }))).toMatchObject({
      kind: "requested",
      detail: "permission prompt — Bash",
    });
  });

  it("SessionStart names the session; SessionEnd, SubagentStop and TeammateIdle say nothing", () => {
    expect(contractSignalOf(claude("SessionStart"))?.kind).toBe("session");
    expect(contractSignalOf(claude("SessionEnd"))).toBeNull();
    expect(contractSignalOf(claude("SubagentStop"))).toBeNull();
    expect(contractSignalOf(claude("TeammateIdle"))).toBeNull();
  });

  it("a hook from an agent the map does not know says nothing", () => {
    expect(contractSignalOf(claude("Stop", { agent: "codex" }))).toBeNull();
    expect(contractSignalOf(claude("Stop", { source: "server" }))).toBeNull();
  });
});

describe("contractSignalOf — opencode server", () => {
  it("maps status, idle, error and both permission spellings", () => {
    expect(contractSignalOf(opencode("session.status"))?.kind).toBe("working");
    expect(contractSignalOf(opencode("session.status", { detail: "idle" }))?.kind).toBe(
      "completed",
    );
    expect(contractSignalOf(opencode("session.idle"))?.kind).toBe("completed");
    expect(
      contractSignalOf(opencode("session.error", { detail: "ProviderAuthError" })),
    ).toMatchObject({
      kind: "error",
      detail: "ProviderAuthError",
    });
    expect(contractSignalOf(opencode("permission.asked", { detail: "bash" }))).toMatchObject({
      kind: "requested",
      detail: "permission — bash",
    });
    expect(contractSignalOf(opencode("permission.v2.asked"))).toMatchObject({
      kind: "requested",
      detail: "permission",
    });
    expect(contractSignalOf(opencode("permission.replied"))?.kind).toBe("answered");
    expect(contractSignalOf(opencode("permission.v2.replied"))?.kind).toBe("answered");
    expect(contractSignalOf(opencode("message.updated"))).toBeNull();
  });
});

describe("parseHookEvent", () => {
  it("accepts the flat wire shape and refuses anything else", () => {
    const wire = {
      paneId: 7,
      source: "hook",
      agent: "claude",
      event: "Stop",
      sessionId: SESSION,
      cwd: "/w",
      message: "done",
      detail: null,
      receivedAt: 5,
    };
    expect(parseHookEvent(wire)).toEqual({ ...wire, detail: null });
    expect(parseHookEvent({ ...wire, paneId: "7" })).toBeNull();
    expect(parseHookEvent({ ...wire, source: "other" })).toBeNull();
    expect(parseHookEvent({ ...wire, sessionId: "../x" })).toBeNull();
    expect(parseHookEvent(null)).toBeNull();
    expect(parseHookEvent({ ...wire, message: "", receivedAt: "x" })).toMatchObject({
      message: null,
      receivedAt: 0,
    });
  });
});
