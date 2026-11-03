import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorktreeAddParams, WorktreeAddResult } from "../git/worktree";
import { CONTROL_MAX_BODY_BYTES } from "./control-auth";
import { createControlRouter } from "./control-routes";

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

async function start(
  addWorktree: (params: WorktreeAddParams) => Promise<WorktreeAddResult> = async (params) => ({
    ok: true,
    path: params.destPath,
  }),
) {
  const log = vi.fn<(message: string) => void>();
  const router = createControlRouter({
    tokenFor: (paneId) => (paneId === 7 ? TOKEN : null),
    ttyFor: (paneId) => (paneId === 7 ? TTY : null),
    version: () => "9.9.9",
    windowOf: (paneId) => (paneId === 7 ? "main" : null),
    addWorktree,
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
  ) => {
    const response = await fetch(url(route), {
      method,
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
  return { call, log, port, router };
}

describe("control router — status", () => {
  it("answers a few lines of text by default", async () => {
    const { call } = await start();
    const reply = await call("status");
    expect(reply.status).toBe(200);
    expect(reply.type).toContain("text/plain");
    expect(reply.text).toBe("Deck 9.9.9\npane 7 in window main\nagent control: on\n");
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
      "pane/list",
      "pane/open",
      "pane/send",
      "pane/read",
      "pane/wait",
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
    await call("pane/list", { json: "1" });
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
