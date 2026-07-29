import { describe, expect, it } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient } from "./pty-client";

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
    const exits: number[] = [];
    const stopOut = await pty.listenOutput((id, data) => {
      outputs.push([id, data]);
    });
    const stopExit = await pty.listenExit((id) => {
      exits.push(id);
    });
    const stopPrompt = await pty.listenPromptReady((id) => {
      prompts.push(id);
    });
    pty.emitOutput(1, "hi");
    pty.emitPromptReady(1);
    pty.emitExit(1);
    expect(outputs).toEqual([[1, "hi"]]);
    expect(prompts).toEqual([1]);
    expect(exits).toEqual([1]);
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
