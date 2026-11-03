import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlCommandPayload, ControlReplyPayload } from "../../src/lib/control-command";
import { createControlRouter, type ControlRouter } from "./control-routes";
import { ORCHESTRATE_SKILL } from "./orchestrate-skill";
import { createPaneMirror, type PaneSnapshot } from "./pane-mirror";

const TOKEN = "0123456789abcdef0123456789abcdef";
const TTY = "ttys009";
const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

type Report = Omit<PaneSnapshot, "reportedAt">;
const CODEX_IDLE: Report = {
  phase: "idle",
  attention: "none",
  source: null,
  confidence: "explicit",
  agent: "codex",
  pid: 5000,
};

/** What the fake window does with a pushed command: answer with these fields, or stay silent. */
type Window = (command: ControlCommandPayload) => Partial<ControlReplyPayload> | "silent";

/**
 * The real router on a real listener, with a fake window on the other end of `deliver`: the
 * window's answer goes back through `settleReply`, as the `control_reply` handler would call it.
 */
async function start(
  options: {
    window?: Window;
    windows?: Record<number, string | null>;
    /** Set `live.value` to false to close pane 7: its token is gone from then on. */
    live?: { value: boolean };
  } = {},
) {
  const log = vi.fn<(message: string) => void>();
  const pushed: ControlCommandPayload[] = [];
  const mirror = createPaneMirror({ now: () => Date.now() });
  const windows = { 7: "main", 12: "main", 13: "main", ...options.windows };
  let router: ControlRouter | undefined;
  router = createControlRouter({
    tokenFor: (paneId) => (paneId === 7 && (options.live?.value ?? true) ? TOKEN : null),
    ttyFor: (paneId) => (paneId === 7 ? TTY : null),
    version: () => "9.9.9",
    windowOf: (paneId) => (windows as Record<number, string | null>)[paneId] ?? null,
    deliver: (_paneId, event, payload) => {
      expect(event).toBe("control:command");
      const command = payload as ControlCommandPayload;
      pushed.push(command);
      const answer = options.window?.(command) ?? "silent";
      if (answer === "silent") return;
      setTimeout(() => {
        router?.settleReply("main", {
          requestId: command.requestId,
          ok: true,
          paneId: null,
          text: null,
          outcome: null,
          error: null,
          ...answer,
        });
      }, 0);
    },
    addWorktree: async (params) => ({ ok: true, path: params.destPath }),
    mirror,
    panesOf: () => [
      { paneId: 7, cwd: "/work/coordinator" },
      { paneId: 12, cwd: "/work/worker" },
    ],
    log,
  });
  const server = http.createServer((request, response) => {
    void router?.handle(request, response);
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as AddressInfo).port;
  const call = async (route: string, fields: Record<string, string> = {}, signal?: AbortSignal) => {
    const response = await fetch(`http://127.0.0.1:${port}/control/v1/${route}`, {
      method: "POST",
      ...(signal === undefined ? {} : { signal }),
      headers: { "x-deck-pane": "7", "x-deck-token": TOKEN, "x-deck-tty": TTY },
      body: new URLSearchParams(fields),
    });
    return { status: response.status, text: await response.text() };
  };
  return { call, router, mirror, pushed, log };
}

describe("control router with a window — pane open", () => {
  it("opens a pane in the caller's window and then lets the caller act on it, and on nothing else", async () => {
    const { call, mirror, pushed } = await start({
      window: (command) => (command.command === "open" ? { paneId: 12 } : { outcome: "sent" }),
    });
    mirror.report(12, CODEX_IDLE);
    mirror.report(13, CODEX_IDLE);

    const opened = await call("pane/open", { cwd: "/tmp", agent: "codex", json: "1" });
    expect(opened.status).toBe(200);
    expect(JSON.parse(opened.text)).toEqual({ ok: true, paneId: 12 });
    expect(pushed[0]).toMatchObject({ command: "open", paneId: 7, cwd: "/tmp", agent: "codex" });

    const list = JSON.parse((await call("pane/list", { json: "1" })).text);
    expect(list.panes.find((pane: { paneId: number }) => pane.paneId === 12)).toMatchObject({
      mine: true,
    });

    expect((await call("pane/send", { id: "12", text: "go" })).text.trim()).toBe("sent");
    expect((await call("pane/send", { id: "13", text: "go" })).status).toBe(403);
  });

  it("keeps a pane in the caller's scope when the call hung up before the window answered", async () => {
    const { call, router, pushed } = await start({ window: () => "silent" });
    const hangup = new AbortController();
    const abandoned = call("pane/open", { cwd: "/tmp", agent: "codex" }, hangup.signal).catch(
      () => undefined,
    );
    await vi.waitFor(() => expect(pushed).toHaveLength(1));
    hangup.abort();
    await abandoned;
    // The server notices the closed connection a moment later.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      router.settleReply("main", {
        requestId: pushed[0].requestId,
        ok: true,
        paneId: 12,
        text: null,
        outcome: null,
        error: null,
      }),
    ).toBe(true);

    const list = JSON.parse((await call("pane/list", { json: "1" })).text);
    expect(list.panes.find((pane: { paneId: number }) => pane.paneId === 12)).toMatchObject({
      mine: true,
    });
  });

  it("opens with --prompt and answers once the prompt is typed", async () => {
    const { call, mirror, pushed } = await start({
      window: (command) => {
        if (command.command === "open") {
          // The agent comes up idle as the tab opens.
          mirror.report(12, CODEX_IDLE);
          return { paneId: 12 };
        }
        return { outcome: "sent" };
      },
    });
    const opened = await call("pane/open", {
      cwd: "/tmp",
      agent: "codex",
      prompt: "Task: T1",
    });
    expect(opened.status).toBe(200);
    expect(opened.text).toBe("12\nprompt: sent\n");
    expect(pushed.map((command) => command.command)).toEqual(["open", "send"]);
    expect(pushed[1]).toMatchObject({
      paneId: 12,
      text: "Task: T1",
      submit: true,
      expectedAgent: "codex",
    });
  });
});

describe("control router with a window — send, read, close", () => {
  async function withWorker(window: Window) {
    const started = await start({ window });
    started.router.recordOpened(12, 7);
    started.mirror.report(12, CODEX_IDLE);
    return started;
  }

  it("types into a pane it opened and says what happened, in text and in JSON", async () => {
    const { call } = await withWorker(() => ({ outcome: "pasted" }));
    expect(await call("pane/send", { id: "12", text: "go", no_submit: "1" })).toEqual({
      status: 200,
      text: "pasted\n",
    });
    const json = await call("pane/send", { id: "12", text: "go", json: "1" });
    expect(JSON.parse(json.text)).toEqual({ ok: true, outcome: "pasted" });
  });

  it("does not let a wait resolve on the idle that preceded a send", async () => {
    const { call } = await withWorker(() => ({ outcome: "sent" }));
    const before = await call("pane/wait", { id: "12", for: "idle", timeout: "1" });
    expect(before.status).toBe(200);

    await call("pane/send", { id: "12", text: "go" });
    const after = await call("pane/wait", { id: "12", for: "idle", timeout: "1" });

    // The send marked the pane: the old idle no longer counts, and no turn followed it.
    expect(after.status).toBe(408);
  });

  it("answers 422 window-gone, pushing nothing, when the pane's window cannot be reached", async () => {
    const { call, router, mirror, pushed } = await start({ windows: { 12: null } });
    router.recordOpened(12, 7);
    mirror.report(12, CODEX_IDLE);

    const result = await call("pane/read", { id: "12", json: "1" });

    expect(result.status).toBe(422);
    expect(JSON.parse(result.text)).toEqual({ ok: false, error: "window-gone" });
    expect(pushed).toHaveLength(0);
  });

  it("reads the last envelope of a worker's screen", async () => {
    const screen = [
      "⏺ Done. Here is the result.",
      "  DECK_WORKER_DONE",
      "  task: T2",
      "  summary: wired the route",
      "  files: electron/a.ts",
      "  checks: npm test passed",
      "  handoff: none",
    ].join("\n");
    const { call, pushed } = await withWorker(() => ({ text: screen }));
    const result = await call("pane/read", { id: "12", envelope: "1", json: "1" });
    expect(JSON.parse(result.text)).toEqual({
      ok: true,
      envelope: {
        kind: "done",
        task: "T2",
        summary: "wired the route",
        files: "electron/a.ts",
        checks: "npm test passed",
        handoff: "none",
      },
    });
    expect(pushed[0]).toMatchObject({ command: "read", paneId: 12, lines: 2000 });
  });

  it("closes a pane it opened, and refuses to close itself", async () => {
    const { call, pushed } = await withWorker(() => ({}));
    expect(await call("pane/close", { id: "12", force: "1" })).toEqual({
      status: 200,
      text: "closed pane 12\n",
    });
    expect(pushed[0]).toMatchObject({ command: "close", paneId: 12, force: true });
    expect((await call("pane/close", { id: "7", force: "1" })).status).toBe(403);
    expect(pushed).toHaveLength(1);
  });

  it("logs the refusal of a close on a busy pane, with the pane and the reason", async () => {
    const { call, mirror, log, pushed } = await withWorker(() => ({}));
    mirror.report(12, { ...CODEX_IDLE, phase: "working" });

    const result = await call("pane/close", { id: "12" });

    expect(result.status).toBe(409);
    expect(pushed).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/pane 7.*busy/));
  });

  it("answers a held call 422 window-gone when the caller's own pane ends", async () => {
    const { call, router, pushed } = await withWorker(() => "silent");
    const held = call("pane/read", { id: "12", json: "1" });
    await vi.waitFor(() => expect(pushed).toHaveLength(1));

    router.forgetPane(7);

    const result = await held;
    expect(result.status).toBe(422);
    expect(JSON.parse(result.text)).toEqual({ ok: false, error: "window-gone" });
    expect(
      router.settleReply("main", {
        requestId: pushed[0].requestId,
        ok: true,
        paneId: null,
        text: "late",
        outcome: null,
        error: null,
      }),
    ).toBe(false);
  });

  it("answers a send queued behind another as a missing pane once its caller's pane is forgotten, pushing nothing for it", async () => {
    const live = { value: true };
    const { call, router, mirror, pushed } = await start({ window: () => "silent", live });
    router.recordOpened(12, 7);
    mirror.report(12, CODEX_IDLE);
    const first = call("pane/send", { id: "12", text: "one", json: "1" });
    const second = call("pane/send", { id: "12", text: "two", json: "1" });
    await vi.waitFor(() => expect(pushed).toHaveLength(1));
    // Let the second request arrive and take its place behind the first.
    await new Promise((resolve) => setTimeout(resolve, 50));

    live.value = false;
    router.forgetPane(7);

    const [held, queued] = await Promise.all([first, second]);
    expect(held.status).toBe(422);
    expect(queued.status).toBe(403);
    expect(JSON.parse(queued.text)).toEqual({ ok: false, error: "forbidden" });
    expect(pushed).toHaveLength(1);
  });

  it("holds the call when another window answers, until the right one does", async () => {
    const { call, router, pushed, log } = await withWorker(() => "silent");
    const held = call("pane/read", { id: "12" });
    await vi.waitFor(() => expect(pushed).toHaveLength(1));
    const reply = (text: string): ControlReplyPayload => ({
      requestId: pushed[0].requestId,
      ok: true,
      paneId: null,
      text,
      outcome: null,
      error: null,
    });

    expect(router.settleReply("deck-2", reply("forged"))).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not asked"));
    expect(router.settleReply("main", reply("real screen"))).toBe(true);

    expect(await held).toEqual({ status: 200, text: "real screen\n" });
  });
});

describe("control router — skill orchestrate (ORC19)", () => {
  it("prints the guide in the form the call asked for, to any authenticated pane", async () => {
    const { call } = await start();
    const text = await call("skill/orchestrate");
    expect(text.status).toBe(200);
    expect(text.text).toBe(`${ORCHESTRATE_SKILL}\n`);
    const json = await call("skill/orchestrate", { json: "1" });
    expect(JSON.parse(json.text)).toEqual({ ok: true, text: ORCHESTRATE_SKILL });
  });
});
