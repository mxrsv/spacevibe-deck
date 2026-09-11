import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { createClaudeIntegration } from "./claude-integration";
import { createHookServer, type HookEventPayload } from "./hook-server";
import { managedHookCommand } from "./claude-user-settings";

const ON = { agentSignalAdapters: { claude: true } };
const OFF = { agentSignalAdapters: { claude: false } };
const PATHS = { scriptPath: "/deck/hook.sh", settingsPath: "/deck/claude.json" };

describe("Claude integration lifecycle", () => {
  it("serializes registration and immediately disables delivery while unregistration waits", async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncSettings = vi
      .fn()
      .mockImplementationOnce(() => wait)
      .mockResolvedValue(undefined);
    const integration = createClaudeIntegration({
      userData: "/deck",
      supported: true,
      writeFiles: vi.fn().mockResolvedValue(PATHS),
      syncSettings,
    });
    const on = integration.sync(ON);
    const off = integration.sync(OFF);
    expect(integration.enabled()).toBe(false);
    release();
    await Promise.all([on, off]);
    expect(syncSettings.mock.calls.map((args) => args[2])).toEqual([true, false]);
    expect(integration.enabled()).toBe(false);
    await integration.sync(ON);
    expect(integration.enabled()).toBe(true);
    expect(integration.scriptPath()).toBe(PATHS.scriptPath);
  });

  it("logs registration failure, keeps delivery off, and allows a later retry", async () => {
    const log = vi.fn();
    const syncSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid settings"))
      .mockResolvedValue(undefined);
    const integration = createClaudeIntegration({
      userData: "/deck",
      supported: true,
      log,
      writeFiles: vi.fn().mockResolvedValue(PATHS),
      syncSettings,
    });
    await integration.sync(ON);
    expect(integration.enabled()).toBe(false);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("registration failed"),
      expect.any(Error),
    );
    await integration.sync(ON);
    expect(integration.enabled()).toBe(true);
  });

  it("never writes global settings on unsupported hosts", async () => {
    const writeFiles = vi.fn();
    const integration = createClaudeIntegration({
      userData: "/deck",
      supported: false,
      writeFiles,
    });
    await integration.sync(ON);
    expect(writeFiles).not.toHaveBeenCalled();
    expect(integration.scriptPath()).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("manual Claude hook transport", () => {
  it("delivers real shell hook payloads to the authenticated pane without launcher flags", async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), "deck-manual-hook-"));
    const events: HookEventPayload[] = [];
    const integration = createClaudeIntegration({
      userData: root,
      settingsPath: path.join(root, "user-settings.json"),
    });
    const server = createHookServer({
      tokenFor: (pane) => (pane === 7 ? "secret" : null),
      emitToOwner: (_pane, event) => {
        if (integration.enabled()) events.push(event);
      },
    });
    try {
      const port = await server.listen();
      expect(port).not.toBeNull();
      await integration.sync(ON);
      const script = integration.scriptPath()!;
      const env = {
        PATH: process.env.PATH,
        DECK_CLAUDE_HOOK_SCRIPT: script,
        DECK_PANE_ID: "7",
        DECK_HOOK_TOKEN: "secret",
        DECK_HOOK_PORT: String(port),
      };
      const post = (event: string, environment = env) =>
        new Promise<void>((resolve, reject) => {
          const child = execFile(
            "/bin/sh",
            ["-c", managedHookCommand(script, event)],
            { env: environment },
            (error) => (error ? reject(error) : resolve()),
          );
          child.stdin!.end(
            JSON.stringify({
              hook_event_name: event,
              session_id: "manual-session",
              cwd: root,
              last_assistant_message: "Manual task completed",
            }),
          );
        });
      await post("SessionStart");
      await post("Stop");
      expect(events.map((event) => event.event)).toEqual(["SessionStart", "Stop"]);
      expect(events[1]).toMatchObject({
        paneId: 7,
        sessionId: "manual-session",
        message: "Manual task completed",
      });
      await integration.sync(OFF);
      await post("Stop");
      expect(events).toHaveLength(2);
    } finally {
      await server.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
