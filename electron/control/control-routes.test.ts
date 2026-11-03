import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeAddParams, WorktreeAddResult } from "../git/worktree";
import { CONTROL_CALL_CAP_MS, CONTROL_MAX_BODY_BYTES } from "./control-auth";
import { createControlRouter, type ControlPane } from "./control-routes";
import {
  createPaneMirror,
  type PaneMirror,
  type PaneSnapshot,
  type WaitResult,
} from "./pane-mirror";

const TOKEN = "0123456789abcdef0123456789abcdef";
const TTY = "ttys009";
const servers: http.Server[] = [];
const REPO = path.resolve("/work/app");
const PARENT = path.dirname(REPO);
const ELSEWHERE = path.resolve("/tmp/elsewhere");
const DOTDOT = path.resolve("/work/dotdot");

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

type Report = Omit<PaneSnapshot, "reportedAt">;
const CLAUDE_IDLE: Report = {
  phase: "idle",
  attention: "completed",
  source: "hook",
  confidence: "explicit",
  agent: "claude",
  pid: 4242,
};
const CLAUDE_WORKING: Report = {
  ...CLAUDE_IDLE,
  phase: "working",
  attention: "none",
  source: null,
};

/** The real mirror with `wait` recorded, and optionally answered without waiting. */
function recordingMirror(answer?: WaitResult) {
  const real = createPaneMirror({ now: () => Date.now() });
  const wait = vi.fn<PaneMirror["wait"]>((paneId, target, options) =>
    answer === undefined ? real.wait(paneId, target, options) : Promise.resolve(answer),
  );
  const mirror: PaneMirror = { ...real, wait };
  return { mirror, wait };
}

async function start(
  addWorktree: (params: WorktreeAddParams) => Promise<WorktreeAddResult> = async (params) => ({
    ok: true,
    path: params.destPath,
  }),
  options: { mirror?: PaneMirror; panes?: readonly ControlPane[] } = {},
) {
  const log = vi.fn<(message: string) => void>();
  const mirror = options.mirror ?? createPaneMirror({ now: () => Date.now() });
  const panesOf = vi.fn((window: string): readonly ControlPane[] =>
    window === "main" ? (options.panes ?? []) : [{ paneId: 99, cwd: "/other/window" }],
  );
  const router = createControlRouter({
    tokenFor: (paneId) => (paneId === 7 ? TOKEN : null),
    ttyFor: (paneId) => (paneId === 7 ? TTY : null),
    version: () => "9.9.9",
    windowOf: (paneId) => (paneId === 7 ? "main" : null),
    addWorktree,
    mirror,
    panesOf,
    log,
  });
  const server = http.createServer((request, response) => {
    void router.handle(request, response);
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const port = (server.address() as AddressInfo).port;
  const url = (route: string) => `http://127.0.0.1:${port}/control/v1/${route}`;
  const call = async (
    route: string,
    fields: Record<string, string> = {},
    headers: Record<string, string> = {},
    method = "POST",
    signal?: AbortSignal,
  ) => {
    const response = await fetch(url(route), {
      method,
      ...(signal === undefined ? {} : { signal }),
      headers: {
        "x-deck-pane": "7",
        "x-deck-token": TOKEN,
        "x-deck-tty": TTY,
        ...headers,
      },
      ...(method === "POST" ? { body: new URLSearchParams(fields) } : {}),
    });
    return {
      status: response.status,
      type: response.headers.get("content-type") ?? "",
      text: await response.text(),
    };
  };
  return { call, log, port, router, mirror, panesOf };
}

describe("control router — status", () => {
  it("answers a few lines of text by default", async () => {
    const { call } = await start();
    const reply = await call("status");
    expect(reply.status).toBe(200);
    expect(reply.type).toContain("text/plain");
    expect(reply.text).toBe(
      "Deck 9.9.9\npane 7 in window main\nagent control: on\ncan open panes: no\n",
    );
  });

  it("says the caller can open panes once its mirror reports an agent (ORC8)", async () => {
    const { call, mirror } = await start();
    expect(JSON.parse((await call("status", { json: "1" })).text)).toMatchObject({
      canOpen: false,
    });
    mirror.report(7, { ...CLAUDE_IDLE, agent: null, pid: null });
    expect(JSON.parse((await call("status", { json: "1" })).text)).toMatchObject({
      canOpen: false,
    });
    mirror.report(7, CLAUDE_IDLE);
    expect(JSON.parse((await call("status", { json: "1" })).text)).toMatchObject({
      canOpen: true,
    });
    expect((await call("status")).text).toContain("can open panes: yes");
  });

  it("answers one JSON object with ok when the body says json=1", async () => {
    const { call } = await start();
    const reply = await call("status", { json: "1" });
    expect(reply.status).toBe(200);
    expect(reply.type).toContain("application/json");
    expect(JSON.parse(reply.text)).toEqual({
      ok: true,
      version: "9.9.9",
      paneId: 7,
      window: "main",
      switch: "on",
      canOpen: false,
    });
  });
});

describe("control router — worktree create", () => {
  it("defaults the destination to the repository's parent joined with the branch, slashes as dashes", async () => {
    const addWorktree = vi.fn(async (p: WorktreeAddParams): Promise<WorktreeAddResult> => ({
      ok: true,
      path: p.destPath,
    }));
    const { call } = await start(addWorktree);
    const reply = await call("worktree/create", { repo: REPO, branch: "feat/login" });
    expect(addWorktree).toHaveBeenCalledWith({
      repoPath: REPO,
      branch: "feat/login",
      destPath: path.join(PARENT, "feat-login"),
    });
    expect(reply).toMatchObject({ status: 200, text: `${path.join(PARENT, "feat-login")}\n` });
  });

  it("resolves a repository path ending in a dot before taking its parent", async () => {
    const addWorktree = vi.fn(async (p: WorktreeAddParams): Promise<WorktreeAddResult> => ({
      ok: true,
      path: p.destPath,
    }));
    const { call } = await start(addWorktree);
    await call("worktree/create", { repo: `${REPO}${path.sep}.`, branch: "fix" });
    expect(addWorktree).toHaveBeenCalledWith({
      repoPath: REPO,
      branch: "fix",
      destPath: path.join(PARENT, "fix"),
    });
  });

  it("uses --dest as given and returns the path in JSON", async () => {
    const addWorktree = vi.fn(async (p: WorktreeAddParams): Promise<WorktreeAddResult> => ({
      ok: true,
      path: p.destPath,
    }));
    const { call } = await start(addWorktree);
    const reply = await call("worktree/create", {
      repo: REPO,
      branch: "feat/x",
      dest: ELSEWHERE,
      json: "1",
    });
    expect(addWorktree.mock.calls[0]?.[0].destPath).toBe(ELSEWHERE);
    expect(JSON.parse(reply.text)).toEqual({ ok: true, path: ELSEWHERE });
  });

  it("passes the closed git error codes through as 422", async () => {
    const { call } = await start(async () => ({ ok: false, error: "branch-exists" }));
    const reply = await call("worktree/create", { repo: REPO, branch: "main", json: "1" });
    expect(reply.status).toBe(422);
    expect(JSON.parse(reply.text)).toEqual({ ok: false, error: "branch-exists" });
    const text = await call("worktree/create", { repo: REPO, branch: "main" });
    expect(text.status).toBe(422);
    expect(text.text).toContain("branch-exists");
  });

  it("answers 400 usage for a missing or relative argument without running git", async () => {
    const addWorktree = vi.fn(async (): Promise<WorktreeAddResult> => ({
      ok: true,
      path: "/never",
    }));
    const { call } = await start(addWorktree);
    const cases: Array<Record<string, string>> = [
      { branch: "x" },
      { repo: REPO },
      { repo: "work/app", branch: "x" },
      { repo: REPO, branch: "x", dest: "../elsewhere" },
      { repo: REPO, branch: "..", json: "1" },
      { repo: REPO, branch: "   ", json: "1" },
    ];
    for (const fields of cases) {
      const reply = await call("worktree/create", fields);
      expect(reply.status).toBe(400);
    }
    const json = await call("worktree/create", { json: "1" });
    expect(JSON.parse(json.text)).toMatchObject({ ok: false, error: "usage" });
    expect(addWorktree).not.toHaveBeenCalled();
  });

  it("lets a branch the folder rule cannot name through when --dest names the folder", async () => {
    const addWorktree = vi.fn(async (p: WorktreeAddParams): Promise<WorktreeAddResult> => ({
      ok: true,
      path: p.destPath,
    }));
    const { call } = await start(addWorktree);
    const reply = await call("worktree/create", {
      repo: REPO,
      branch: "..",
      dest: DOTDOT,
    });
    expect(reply.status).toBe(200);
    expect(addWorktree.mock.calls[0]?.[0].branch).toBe("..");
  });
});

describe("control router — commands that are not built yet", () => {
  it("answers 404 not-implemented for each planned command, and unknown-command for the rest", async () => {
    const { call } = await start();
    for (const route of [
      "pane/open",
      "pane/send",
      "pane/read",
      "pane/close",
      "skill/orchestrate",
    ]) {
      const reply = await call(route, { json: "1" });
      expect(reply.status).toBe(404);
      expect(JSON.parse(reply.text)).toEqual({ ok: false, error: "not-implemented" });
    }
    const unknown = await call("pane/frobnicate", { json: "1" });
    expect(unknown.status).toBe(404);
    expect(JSON.parse(unknown.text)).toEqual({ ok: false, error: "unknown-command" });
    const text = await call("pane/frobnicate");
    expect(text.type).toContain("text/plain");
  });
});

describe("control router — authorization", () => {
  it("answers the same 403 body for an unknown pane, a wrong token and a wrong tty", async () => {
    const { call, log } = await start();
    const replies = [
      await call("status", {}, { "x-deck-pane": "8" }),
      await call("status", {}, { "x-deck-token": "nope" }),
      await call("status", {}, { "x-deck-tty": "ttys010" }),
    ];
    for (const reply of replies) {
      expect(reply.status).toBe(403);
      expect(JSON.parse(reply.text)).toEqual({ ok: false, error: "forbidden" });
    }
    expect(new Set(replies.map((r) => r.text)).size).toBe(1);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it("logs the pane and the reason for a refusal and never the token", async () => {
    const { call, log } = await start();
    await call("status", {}, { "x-deck-token": "guess-guess-guess" });
    await call("status", {}, { "x-deck-tty": "ttys010" });
    await call("pane/open", { json: "1" });
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines[0]).toContain("pane 7");
    expect(lines[0]).toContain("wrong token");
    expect(lines[1]).toContain("wrong tty");
    expect(lines[2]).toContain("not implemented");
    for (const line of lines) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain("guess-guess-guess");
    }
  });

  it("refuses a request that is not a POST before it reads anything", async () => {
    const { call } = await start();
    const reply = await call("status", {}, {}, "GET");
    expect(reply.status).toBe(405);
  });

  it("refuses an oversize declared body with 413", async () => {
    const { call } = await start();
    const reply = await call("status", { text: "x".repeat(CONTROL_MAX_BODY_BYTES + 1) });
    expect(reply.status).toBe(413);
    expect(JSON.parse(reply.text)).toEqual({ ok: false, error: "too-large" });
  });

  it("cuts a streamed body that outgrows the cap without a Content-Length", async () => {
    const { port } = await start();
    const status = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/control/v1/status",
          headers: {
            "x-deck-pane": "7",
            "x-deck-token": TOKEN,
            "x-deck-tty": TTY,
            "transfer-encoding": "chunked",
          },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        },
      );
      request.on("error", reject);
      const chunk = Buffer.alloc(16 * 1024, "a");
      for (let sent = 0; sent <= CONTROL_MAX_BODY_BYTES; sent += chunk.length) {
        request.write(chunk);
      }
      request.end();
    });
    expect(status).toBe(413);
  });

  it("answers 500 JSON and stays up when a command throws", async () => {
    const { call, log } = await start(async () => {
      throw new Error("git exploded");
    });
    const reply = await call("worktree/create", { repo: REPO, branch: "x" });
    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.text)).toEqual({ ok: false, error: "internal" });
    expect(log.mock.calls.at(-1)?.[0]).toContain("git exploded");
    expect((await call("status")).status).toBe(200);
  });
});

describe("control router — pane list (ORC10)", () => {
  const PANES: readonly ControlPane[] = [
    { paneId: 9, cwd: "/work/other" },
    { paneId: 7, cwd: "/work/app" },
    { paneId: 8, cwd: null },
  ];

  it("lists the caller's window by id, with the mirror's state and who opened each pane", async () => {
    const { call, mirror, router, panesOf } = await start(undefined, { panes: PANES });
    mirror.report(7, CLAUDE_IDLE);
    mirror.report(8, { ...CLAUDE_WORKING, agent: "codex", pid: 5151 });
    router.recordOpened(8, 7);
    const reply = await call("pane/list", { json: "1" });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({
      ok: true,
      panes: [
        {
          paneId: 7,
          agent: "claude",
          phase: "idle",
          attention: "completed",
          confidence: "explicit",
          cwd: "/work/app",
          mine: false,
        },
        {
          paneId: 8,
          agent: "codex",
          phase: "working",
          attention: "none",
          confidence: "explicit",
          cwd: null,
          mine: true,
        },
        {
          paneId: 9,
          agent: "shell",
          phase: "unknown",
          attention: "none",
          confidence: "unknown",
          cwd: "/work/other",
          mine: false,
        },
      ],
    });
    expect(panesOf).toHaveBeenCalledTimes(1);
    expect(panesOf).toHaveBeenCalledWith("main");
  });

  it("prints one aligned line per pane in text form", async () => {
    const { call, mirror, router } = await start(undefined, { panes: PANES });
    mirror.report(7, CLAUDE_IDLE);
    mirror.report(8, { ...CLAUDE_WORKING, agent: "codex" });
    router.recordOpened(8, 7);
    const reply = await call("pane/list");
    expect(reply.type).toContain("text/plain");
    expect(reply.text).toBe(
      [
        "7  claude  idle     completed  explicit  -     /work/app",
        "8  codex   working  none       explicit  mine  -",
        "9  shell   unknown  none       unknown   -     /work/other",
        "",
      ].join("\n"),
    );
  });

  it("never prints a control character from a working directory into the pane's terminal", async () => {
    const { call } = await start(undefined, {
      panes: [{ paneId: 7, cwd: "/work/\u001b[2Jhi\nthere" }],
    });
    const text = (await call("pane/list")).text;
    expect(text).toBe("7  shell  unknown  none  unknown  -  /work/?[2Jhi?there\n");
  });

  it("forgets a pane's mirror and opener together once the pane is gone", async () => {
    const { call, mirror, router } = await start(undefined, { panes: [{ paneId: 8, cwd: "/w" }] });
    mirror.report(8, CLAUDE_IDLE);
    router.recordOpened(8, 7);
    router.forgetPane(8);
    mirror.forget(8);
    const [pane] = JSON.parse((await call("pane/list", { json: "1" })).text).panes;
    expect(pane).toMatchObject({ paneId: 8, agent: "shell", mine: false });
  });
});

describe("control router — pane wait (ORC14-15)", () => {
  const waitFor = (fields: Record<string, string> = {}) => ({
    id: "7",
    for: "idle",
    json: "1",
    ...fields,
  });

  it("answers at once with the state when the caller's own pane already satisfies the target", async () => {
    const { call, mirror } = await start();
    mirror.report(7, CLAUDE_IDLE);
    const json = await call("pane/wait", waitFor({ for: "turn" }));
    expect(json.status).toBe(200);
    expect(JSON.parse(json.text)).toEqual({
      ok: true,
      reached: true,
      phase: "idle",
      attention: "completed",
      confidence: "explicit",
      agent: "claude",
    });
    const text = await call("pane/wait", { id: "7", for: "idle" });
    expect(text.text).toBe("pane 7: idle, attention completed, confidence explicit\n");
  });

  it("holds the call until a later report satisfies the target", async () => {
    const { call, mirror } = await start();
    mirror.report(7, CLAUDE_WORKING);
    const pending = call("pane/wait", waitFor());
    await new Promise((resolve) => setTimeout(resolve, 50));
    mirror.report(7, CLAUDE_IDLE);
    const reply = await pending;
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toMatchObject({ reached: true, phase: "idle" });
  });

  it("scopes a wait to the caller and the panes it opened, with a missing pane's answer for the rest", async () => {
    const { call, mirror, router, log } = await start();
    mirror.report(8, CLAUDE_IDLE);
    const stranger = await call("pane/wait", waitFor({ id: "8" }));
    const missing = await call("pane/wait", waitFor({ id: "99" }));
    expect(stranger.status).toBe(403);
    expect(JSON.parse(stranger.text)).toEqual({ ok: false, error: "forbidden" });
    expect(stranger.text).toBe(missing.text);
    expect(log.mock.calls.at(-1)?.[0]).toContain("pane 7");
    router.recordOpened(8, 7);
    const opened = await call("pane/wait", waitFor({ id: "8" }));
    expect(opened.status).toBe(200);
  });

  it.each([
    ["no id", { id: "" }],
    ["a non-numeric id", { id: "seven" }],
    ["an id with a leading zero", { id: "07" }],
    ["no target", { for: "" }],
    ["an unknown target", { for: "done" }],
    ["a zero timeout", { timeout: "0" }],
    ["a timeout over an hour", { timeout: "3601" }],
    ["a negative timeout", { timeout: "-5" }],
    ["a fractional timeout", { timeout: "1.5" }],
    ["a timeout with a unit", { timeout: "30s" }],
  ])("answers 400 usage for %s without waiting", async (_name, change) => {
    const { mirror, wait } = recordingMirror();
    const { call } = await start(undefined, { mirror });
    const reply = await call("pane/wait", waitFor(change));
    expect(reply.status).toBe(400);
    expect(JSON.parse(reply.text)).toMatchObject({ ok: false, error: "usage" });
    expect(wait).not.toHaveBeenCalled();
  });

  it.each([["idle"], ["needs-you"], ["exited"], ["turn"]])(
    "passes the %s target through",
    async (target) => {
      const { mirror, wait } = recordingMirror({ reached: false, reason: "cap" });
      const { call } = await start(undefined, { mirror });
      await call("pane/wait", waitFor({ for: target, timeout: "5" }));
      expect(wait).toHaveBeenCalledWith(7, target, expect.objectContaining({ capMs: 5000 }));
    },
  );

  it("holds one slice at most, and asks the shim to come back while time is left (202)", async () => {
    const { mirror, wait } = recordingMirror({ reached: false, reason: "cap" });
    const { call } = await start(undefined, { mirror });
    const long = await call("pane/wait", waitFor({ timeout: "600" }));
    expect(wait.mock.calls[0]?.[2].capMs).toBe(CONTROL_CALL_CAP_MS);
    expect(long.status).toBe(202);
    expect(JSON.parse(long.text)).toEqual({ ok: false, pending: true });
    const edge = await call("pane/wait", waitFor({ timeout: String(CONTROL_CALL_CAP_MS / 1000) }));
    expect(edge.status).toBe(408);
  });

  it("answers 408 timeout when the last slice runs out", async () => {
    const { mirror, wait } = recordingMirror({ reached: false, reason: "cap" });
    const { call } = await start(undefined, { mirror });
    const reply = await call("pane/wait", waitFor({ timeout: "30" }));
    expect(wait.mock.calls[0]?.[2].capMs).toBe(30_000);
    expect(reply.status).toBe(408);
    expect(JSON.parse(reply.text)).toEqual({ ok: false, error: "timeout" });
    const text = await call("pane/wait", { id: "7", for: "idle", timeout: "30" });
    expect(text.text).toBe("deck: timed out waiting for pane 7\n");
  });

  it("times out for real after the shortest timeout, holding the call that long", async () => {
    const { call, mirror } = await start();
    mirror.report(7, CLAUDE_WORKING);
    const started = Date.now();
    const reply = await call("pane/wait", waitFor({ timeout: "1" }));
    expect(reply.status).toBe(408);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it("answers 200 with reached false and the reason when the agent took no turn", async () => {
    const { mirror } = recordingMirror({ reached: false, reason: "no-turn" });
    const { call, mirror: kept } = await start(undefined, { mirror });
    kept.report(7, CLAUDE_IDLE);
    const reply = await call("pane/wait", waitFor());
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.text)).toEqual({
      ok: true,
      reached: false,
      reason: "no-turn",
      phase: "idle",
      attention: "completed",
      confidence: "explicit",
      agent: "claude",
    });
    const text = await call("pane/wait", { id: "7", for: "idle" });
    expect(text.text).toBe(
      "pane 7: no turn started after the send; idle, attention completed, confidence explicit\n",
    );
  });

  it("answers 422 pane-gone when the pane ends while the call is held", async () => {
    const { call, mirror } = await start();
    mirror.report(7, CLAUDE_WORKING);
    const pending = call("pane/wait", waitFor());
    await new Promise((resolve) => setTimeout(resolve, 50));
    mirror.forget(7);
    const reply = await pending;
    expect(reply.status).toBe(422);
    expect(JSON.parse(reply.text)).toEqual({ ok: false, error: "pane-gone" });
  });

  it("needs a turn that began after the send once markSent has run, and not before", async () => {
    const { mirror, wait } = recordingMirror({ reached: false, reason: "cap" });
    const { call, router } = await start(undefined, { mirror });
    mirror.report(7, CLAUDE_IDLE);
    mirror.report(7, CLAUDE_IDLE);
    await call("pane/wait", waitFor({ timeout: "5" }));
    expect(wait.mock.calls[0]?.[2]).not.toHaveProperty("afterRevision");
    router.markSent(7);
    await call("pane/wait", waitFor({ timeout: "5" }));
    expect(wait.mock.calls[1]?.[2].afterRevision).toBe(2);
    mirror.report(7, CLAUDE_WORKING);
    await call("pane/wait", waitFor({ timeout: "5" }));
    expect(wait.mock.calls[2]?.[2].afterRevision).toBe(2);
    router.forgetPane(7);
    await call("pane/wait", waitFor({ timeout: "5" }));
    expect(wait.mock.calls[3]?.[2]).not.toHaveProperty("afterRevision");
  });

  it("does not resolve on the idle that preceded a send, then resolves on the turn after it", async () => {
    const { call, mirror, router } = await start();
    mirror.report(7, CLAUDE_IDLE);
    router.markSent(7);
    const pending = call("pane/wait", waitFor());
    await new Promise((resolve) => setTimeout(resolve, 50));
    mirror.report(7, CLAUDE_WORKING);
    mirror.report(7, CLAUDE_IDLE);
    const reply = await pending;
    expect(JSON.parse(reply.text)).toMatchObject({ reached: true, phase: "idle" });
  });

  it("lets go of the wait when the caller hangs up", async () => {
    const { mirror, wait } = recordingMirror();
    const { call, mirror: kept } = await start(undefined, { mirror });
    kept.report(7, CLAUDE_WORKING);
    const hangup = new AbortController();
    const pending = call("pane/wait", waitFor(), {}, "POST", hangup.signal).catch(() => null);
    await vi.waitFor(() => expect(wait).toHaveBeenCalled());
    const signal = wait.mock.calls[0]?.[2].signal;
    expect(signal?.aborted).toBe(false);
    hangup.abort();
    await pending;
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});
