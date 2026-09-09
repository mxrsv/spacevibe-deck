import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient, createTauriPtyClient } from "./pty-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createMemoryPtyClient", () => {
  it("assigns monotonic pane ids on spawn", async () => {
    const pty = createMemoryPtyClient({ nextId: 10 });
    expect(await pty.spawnShell({ cols: 80, rows: 24, cwd: "/a" })).toBe(10);
    expect(await pty.spawnShell({ cols: 80, rows: 24, cwd: null })).toBe(11);
    expect(pty.sessions.get(10)?.cwd).toBe("/a");
  });

  it("routes output, prompt readiness, and exit to listeners", async () => {
    const pty = createMemoryPtyClient();
    const outputs: Array<[number, string]> = [];
    const prompts: number[] = [];
    const exits: Array<[number, number | null]> = [];
    const stopOut = await pty.listenOutput((id, data) => {
      outputs.push([id, data]);
    });
    const stopExit = await pty.listenExit((id, exitCode) => {
      exits.push([id, exitCode]);
    });
    const stopPrompt = await pty.listenPromptReady((id) => {
      prompts.push(id);
    });
    pty.emitOutput(1, "hi");
    pty.emitPromptReady(1);
    pty.emitExit(1);
    pty.emitExit(2, 130);
    expect(outputs).toEqual([[1, "hi"]]);
    expect(prompts).toEqual([1]);
    // The status rides the exit since 2026-09-03 (stage 0); a host that reports
    // none — Tauri's `ExitPayload { id }` — answers null, never a guessed zero.
    expect(exits).toEqual([
      [1, null],
      [2, 130],
    ]);
    stopOut();
    stopPrompt();
    stopExit();
    pty.emitOutput(1, "ignored");
    pty.emitPromptReady(1);
    expect(outputs).toHaveLength(1);
    expect(prompts).toHaveLength(1);
  });

  it("preserves explicit pane process truth", async () => {
    const info: PaneProcessInfo = {
      id: 4,
      cwd: "C:\\work",
      process: "node",
      kind: "agent",
      agent: "codex",
    };
    const pty = createMemoryPtyClient({ infos: new Map([[4, info]]) });

    await expect(pty.ptyInfo([4])).resolves.toEqual([info]);
  });
});

describe("createTauriPtyClient Electron session CWDs", () => {
  it("rejects an invalid pane id in the host response", async () => {
    const invoke = vi.fn(async () => [{ id: -1, cwd: String.raw`C:\work` }]);
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const pty = createTauriPtyClient();
    if (pty.sessionCwds === undefined) {
      throw new Error("Expected the Electron session CWD capability");
    }

    await expect(pty.sessionCwds([1])).rejects.toThrow("Invalid pty_cwds response");
    expect(invoke).toHaveBeenCalledWith("pty_cwds", { ids: [1] });
  });
});

describe("createTauriPtyClient Agent Board Stop", () => {
  it("asks the host to end a pane's foreground job with a flat { id }", async () => {
    const invoke = vi.fn(async () => undefined);
    vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
    const pty = createTauriPtyClient();
    // The member is OPTIONAL — that is how a host without the channel says so —
    // but this is the one production client, and it must carry it.
    if (pty.killForeground === undefined) {
      throw new Error("Expected the Electron kill-foreground capability");
    }

    await pty.killForeground(7);

    expect(invoke).toHaveBeenCalledWith("pty_kill_foreground", { id: 7 });
  });
});
