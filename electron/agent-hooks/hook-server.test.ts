import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHookServer, type HookEventPayload, type HookServer } from "./hook-server";

const TOKEN = "0123456789abcdef0123456789abcdef";
const servers: HookServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function start() {
  const events: HookEventPayload[] = [];
  const server = createHookServer({
    tokenFor: (paneId) => (paneId === 7 ? TOKEN : null),
    ttyFor: (paneId) => (paneId === 7 ? "ttys009" : null),
    emitToOwner: (_paneId, payload) => events.push(payload),
    log: () => {},
  });
  servers.push(server);
  const port = await server.listen();
  const post = async (agent: "claude" | "codex", event: string, sessionId: string) => {
    const response = await fetch(
      `http://127.0.0.1:${port}${agent === "codex" ? "/hook/codex" : "/hook"}`,
      {
        method: "POST",
        headers: { "x-deck-pane": "7", "x-deck-token": TOKEN, "x-deck-tty": "ttys009" },
        body: JSON.stringify({ hook_event_name: event, session_id: sessionId, turn_id: "t-1" }),
      },
    );
    expect(response.status).toBe(204);
  };
  const raw = (headers: Record<string, string>, body: object) =>
    fetch(`http://127.0.0.1:${port}/hook/codex`, {
      method: "POST",
      headers: { "x-deck-pane": "7", "x-deck-token": TOKEN, ...headers },
      body: JSON.stringify(body),
    }).then((response) => response.status);
  return { server, events, post, raw };
}

describe("hook server — generation per pane and agent", () => {
  it("a Codex SessionStart does not evict the pane's Claude occupant", async () => {
    const { events, post } = await start();
    await post("claude", "SessionStart", "claude-1");
    await post("codex", "SessionStart", "codex-1");
    await post("claude", "Stop", "claude-1");
    expect(events.map((e) => [e.agent, e.event])).toEqual([
      ["claude", "SessionStart"],
      ["codex", "SessionStart"],
      ["claude", "Stop"],
    ]);
  });

  it("still drops a previous occupant of the same agent", async () => {
    const { events, post } = await start();
    await post("claude", "SessionStart", "claude-1");
    await post("claude", "SessionStart", "claude-2");
    await post("claude", "Stop", "claude-1");
    expect(events.map((e) => e.sessionId)).toEqual(["claude-1", "claude-2"]);
  });

  it("forgetPane clears every agent's generation for the pane", async () => {
    const { server, events, post } = await start();
    await post("claude", "SessionStart", "claude-1");
    await post("codex", "SessionStart", "codex-1");
    server.forgetPane(7);
    // With no memory, a first post is accepted whatever its session.
    await post("claude", "Stop", "claude-2");
    await post("codex", "Stop", "codex-2");
    expect(events.slice(2).map((e) => [e.agent, e.sessionId])).toEqual([
      ["claude", "claude-2"],
      ["codex", "codex-2"],
    ]);
  });

  it("refuses a Codex post from a host with no tty, or another pane's, and drops a subagent's", async () => {
    const { events, raw } = await start();
    const body = { hook_event_name: "PostToolUse", session_id: "codex-1", turn_id: "t-1" };
    expect(await raw({}, body)).toBe(403);
    expect(await raw({ "x-deck-tty": "??" }, body)).toBe(403);
    expect(await raw({ "x-deck-tty": "ttys010" }, body)).toBe(403);
    expect(await raw({ "x-deck-tty": "ttys009" }, { ...body, agent_id: "agent-1" })).toBe(400);
    expect(events).toEqual([]);
    expect(await raw({ "x-deck-tty": "ttys009" }, body)).toBe(204);
    expect(events.map((e) => e.event)).toEqual(["PostToolUse"]);
  });
});

describe("hook server — opencode", () => {
  async function opencode() {
    const { events, server } = await start();
    const port = server.port();
    const sendTo =
      (path: string) =>
      (event: string, sessionId: string, token = TOKEN) =>
        fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers: { "x-deck-pane": "7", "x-deck-token": token },
          body: JSON.stringify({ hook_event_name: event, session_id: sessionId }),
        }).then((response) => response.status);
    return { events, post: sendTo("/hook/opencode"), claude: sendTo("/hook") };
  }

  it("emits agent opencode from a hook, and refuses a wrong token", async () => {
    const { events, post } = await opencode();
    expect(await post("Start", "ses_a", "wrong")).toBe(403);
    expect(await post("Start", "ses_a")).toBe(204);
    expect(events.map((e) => [e.agent, e.source, e.event, e.sessionId])).toEqual([
      ["opencode", "hook", "Start", "ses_a"],
    ]);
  });

  it("drops a post for a session that is not the current one, until SessionStart names it", async () => {
    const { events, post } = await opencode();
    await post("SessionStart", "ses_a");
    await post("Start", "ses_b");
    await post("SessionStart", "ses_b");
    await post("Start", "ses_b");
    await post("Stop", "ses_a");
    await post("SessionStart", "ses_a");
    await post("Start", "ses_a");
    expect(events.map((e) => `${e.event}:${e.sessionId}`)).toEqual([
      "SessionStart:ses_a",
      "SessionStart:ses_b",
      "Start:ses_b",
      "SessionStart:ses_a",
      "Start:ses_a",
    ]);
  });

  it("keeps opencode's occupant apart from Claude's on the same pane", async () => {
    const { events, post, claude } = await opencode();
    await post("SessionStart", "ses_a");
    await claude("SessionStart", "claude-1");
    await post("Stop", "ses_a");
    expect(events.map((e) => e.agent)).toEqual(["opencode", "claude", "opencode"]);
  });
});

describe("hook server — control routes", () => {
  async function withControl(
    handle?: (request: IncomingMessage, response: ServerResponse) => void,
  ) {
    const events: HookEventPayload[] = [];
    const seen: string[] = [];
    const log = vi.fn<(message: string) => void>();
    const server = createHookServer({
      tokenFor: (paneId) => (paneId === 7 ? TOKEN : null),
      ttyFor: (paneId) => (paneId === 7 ? "ttys009" : null),
      emitToOwner: (_paneId, payload) => events.push(payload),
      log,
      ...(handle === undefined
        ? {}
        : {
            control: {
              handle: async (request: IncomingMessage, response: ServerResponse) => {
                seen.push(request.url ?? "");
                handle(request, response);
              },
            },
          }),
    });
    servers.push(server);
    const port = await server.listen();
    const post = (path: string) =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "x-deck-pane": "7", "x-deck-token": TOKEN },
        body: JSON.stringify({ hook_event_name: "Stop", session_id: "claude-1" }),
      });
    return { events, seen, log, post };
  }

  it("hands a /control/ request to the control handler and answers with what it wrote", async () => {
    const { post, seen } = await withControl((_request, response) => {
      response.statusCode = 200;
      response.end("from control");
    });
    const reply = await post("/control/v1/status?x=1");
    expect(reply.status).toBe(200);
    expect(await reply.text()).toBe("from control");
    expect(seen).toEqual(["/control/v1/status?x=1"]);
  });

  it("keeps serving hooks beside the control routes", async () => {
    const { post, events, seen } = await withControl((_request, response) => response.end());
    expect((await post("/hook")).status).toBe(204);
    expect(events.map((e) => e.event)).toEqual(["Stop"]);
    expect(seen).toEqual([]);
  });

  it("answers 404 on /control/ when no control handler is mounted, as it did before", async () => {
    const { post, events } = await withControl();
    expect((await post("/control/v1/status")).status).toBe(404);
    expect((await post("/control/")).status).toBe(404);
    expect(events).toEqual([]);
  });

  it("answers 500 and stays up when the control handler rejects", async () => {
    const { post, log } = await withControl(() => {
      throw new Error("handler broke");
    });
    expect((await post("/control/v1/status")).status).toBe(500);
    expect(log.mock.calls.at(-1)?.[0]).toContain("handler broke");
    expect((await post("/hook")).status).toBe(204);
  });
});
