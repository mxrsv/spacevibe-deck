import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createCodexIntegration } from "./codex-integration";
import { createHookServer, type HookEventPayload, type HookServer } from "./hook-server";
import { parseHookBody } from "./hook-request";
import { parseHookEvent, contractSignalOf } from "../../src/lib/agent-signal-map";
import { createAgentAttentionTracker } from "../../src/terminal/agent-attention";
import { buildEnv } from "../pty/spawn";

const scratch: string[] = [];
const servers: HookServer[] = [];
const on = { agentSignalAdapters: { codex: true } };
const off = { agentSignalAdapters: { codex: false } };
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deck-codex-test-"));
  scratch.push(dir);
  return { dir, userData: path.join(dir, "Deck's Data"), hooksPath: path.join(dir, "hooks.json") };
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true })));
});

function run(command: string, env: NodeJS.ProcessEnv, payload: unknown) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("/bin/sh", ["-c", command], { env, stdio: "pipe" });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("Codex lifecycle bridge", () => {
  it("does not re-enable delivery when a pending enable finishes after disable was requested", async () => {
    const deps = await setup();
    let unblock!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const syncHooks = vi.fn(async (_file: string, _script: string, _enabled: boolean) => {
      entered();
      await blocked;
    });
    const integration = createCodexIntegration({ ...deps, supported: true, syncHooks });
    const enabling = integration.sync(on);
    await started;
    const disabling = integration.sync(off);
    expect(integration.enabled()).toBe(false);
    unblock();
    await enabling;
    expect(integration.enabled()).toBe(false);
    await disabling;
    expect(integration.enabled()).toBe(false);
    expect(syncHooks.mock.calls.map((call) => call[2])).toEqual([true, false]);
  });

  it("runs the generated script through pane env and the authenticated endpoint", async () => {
    const deps = await setup();
    const integration = createCodexIntegration({ ...deps, supported: true });
    await integration.sync(on);
    const document = JSON.parse(await fs.readFile(deps.hooksPath, "utf8"));
    const command = document.hooks.Stop[0].hooks[0].command;
    const events: HookEventPayload[] = [];
    const server = createHookServer({
      tokenFor: (id) => (id === 7 ? "secret" : null),
      emitToOwner: (_id, payload) => {
        if (integration.enabled()) events.push(payload);
      },
    });
    servers.push(server);
    const port = await server.listen();
    expect(port).not.toBeNull();
    const env = buildEnv(process.env, "test", {
      paneId: 7,
      hookToken: "secret",
      hookPort: port,
      codexHookScript: integration.scriptPath(),
    });
    expect(env.DECK_CODEX_HOOK_SCRIPT).toBe(integration.scriptPath());
    const payload = {
      hook_event_name: "Stop",
      session_id: "session-1",
      turn_id: "turn-1",
      last_assistant_message: "Finished.\nMore details.",
      cwd: "/repo",
    };
    expect(await run(command, env, payload)).toEqual({
      code: 0,
      stdout: "",
      stderr: "",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "codex",
      paneId: 7,
      event: "Stop",
      turnId: "turn-1",
      sessionId: "session-1",
      message: "Finished.",
    });
    const decoded = parseHookEvent(events[0]);
    expect(decoded).not.toBeNull();
    const signal = contractSignalOf(decoded!);
    const tracker = createAgentAttentionTracker();
    tracker.noteProcess(7, "codex", true);
    tracker.noteContract(7, signal!);
    expect(tracker.snapshot(7)).toMatchObject({ phase: "idle", attention: "completed" });
    const outside = await run(
      command,
      { ...env, DECK_CODEX_HOOK_SCRIPT: "/another/install" },
      payload,
    );
    expect(outside).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(events).toHaveLength(1);
    await fs.writeFile(path.join(deps.dir, ".curlrc"), "proxy = http://127.0.0.1:1\n");
    const proxied = await run(
      command,
      {
        ...env,
        CURL_HOME: deps.dir,
        http_proxy: "http://127.0.0.1:1",
        ALL_PROXY: "http://127.0.0.1:1",
        NO_PROXY: "",
        no_proxy: "",
      },
      payload,
    );
    expect(proxied).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(events).toHaveLength(2);
    const refused = await run(command, { ...env, DECK_HOOK_TOKEN: "wrong" }, payload);
    expect(refused.code).toBe(0);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain("could not be delivered");
    expect(events).toHaveLength(2);
    await integration.sync(off);
    await run(command, env, payload);
    expect(events).toHaveLength(2);
    expect(
      buildEnv({ DECK_CODEX_HOOK_SCRIPT: "stale" }, "test", {
        paneId: 8,
        hookToken: "secret",
        hookPort: null,
      }),
    ).not.toHaveProperty("DECK_CODEX_HOOK_SCRIPT");
  });

  it("rejects unscoped, malformed and subagent events", () => {
    const body = { session_id: "session-1", hook_event_name: "Stop" };
    expect(parseHookBody(7, JSON.stringify(body), "codex")).toBeNull();
    expect(parseHookBody(7, JSON.stringify({ ...body, turn_id: "../bad" }), "codex")).toBeNull();
    expect(
      parseHookBody(
        7,
        JSON.stringify({ ...body, turn_id: "turn-1", hook_event_name: "SubagentStop" }),
        "codex",
      ),
    ).toBeNull();
  });

  it("accepts Codex's large prompt payload without forwarding prompt contents", () => {
    const body = {
      session_id: "session-1",
      hook_event_name: "UserPromptSubmit",
      turn_id: "turn-1",
      prompt: "p".repeat(100_000),
    };
    const post = parseHookBody(7, JSON.stringify(body), "codex");
    expect(post).toMatchObject({ event: "UserPromptSubmit", turnId: "turn-1" });
    expect(post).not.toHaveProperty("prompt");
    expect(parseHookBody(7, JSON.stringify(body), "claude")).toBeNull();
  });

  it("retries registration after a failure and disables immediately", async () => {
    const deps = await setup();
    const log = vi.fn();
    const syncHooks = vi
      .fn()
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValue(undefined);
    const integration = createCodexIntegration({ ...deps, supported: true, syncHooks, log });
    await integration.sync(on);
    expect(integration.enabled()).toBe(false);
    expect(log).toHaveBeenCalledOnce();
    await integration.sync(on);
    expect(integration.enabled()).toBe(true);
    const disabling = integration.sync(off);
    expect(integration.enabled()).toBe(false);
    await disabling;
  });
});
