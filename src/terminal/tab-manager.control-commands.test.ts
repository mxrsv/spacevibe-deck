// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControlCommandPayload, ControlReplyPayload } from "../lib/control-command";
import type { PaneProcessInfo } from "../lib/process-info";
import type { DetectedAgent } from "./pty-client";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { activeTabIndex, tabViews } from "./tabs-store";
import { freshWindowFocusController, processInfo, setupControllable } from "./tab-manager.fixtures";

vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

// The close census asks through the dialog facade; the tests answer it and count the asks.
const dialog = vi.hoisted(() => ({ ask: vi.fn(async (): Promise<boolean> => false) }));
vi.mock("../host/dialog-host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/dialog-host")>()),
  ask: dialog.ask,
}));

// `openAgentTab` waits for the window's agent cache; these tests decide what it holds.
const probe = vi.hoisted(() => ({
  ensureAgentsDetected: vi.fn(async (): Promise<readonly DetectedAgent[]> => []),
}));
vi.mock("./agent-detection-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-detection-store")>()),
  ensureAgentsDetected: probe.ensureAgentsDetected,
}));

let windowFocus = freshWindowFocusController();
vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => windowFocus.initialFocused,
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

const CODEX: DetectedAgent = { name: "codex", path: "/bin/codex" };
const ESC = String.fromCharCode(27);
const OSC_IDLE = `${ESC}]9;4;0\u0007`;

beforeEach(() => {
  vi.useFakeTimers();
  settings.value = DEFAULT_SETTINGS;
  windowFocus = freshWindowFocusController();
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  document.body.innerHTML = "";
  tabViews.value = [];
  activeTabIndex.value = -1;
  dialog.ask.mockReset();
  dialog.ask.mockResolvedValue(false);
  probe.ensureAgentsDetected.mockReset();
  probe.ensureAgentsDetected.mockResolvedValue([CODEX]);
});

afterEach(() => {
  vi.useRealTimers();
  resetDesktopEnvironmentForTests();
});

const codexPane = (id: number, processId = id * 1000): PaneProcessInfo => ({
  ...processInfo(id, "/repo", "codex", "agent", "codex"),
  processId,
});

function command(
  name: ControlCommandPayload["command"],
  paneId: number,
  used: Partial<ControlCommandPayload> = {},
  requestId = "r1",
): ControlCommandPayload {
  return {
    requestId,
    command: name,
    paneId,
    cwd: null,
    agent: null,
    name: null,
    text: null,
    submit: null,
    expectedAgent: null,
    lines: null,
    force: null,
    deadline: null,
    ...used,
  };
}

/** A manager with the control channel wired to a recorder, `infos` read live on every poll. */
async function mount(infos: Map<number, PaneProcessInfo>) {
  let hear: ((payload: unknown) => void) | undefined;
  const replies: ControlReplyPayload[] = [];
  const built = setupControllable(infos, {
    reportPaneAttention: null,
    controlCommands: async (handler) => {
      hear = handler;
      return () => {};
    },
    controlReply: (reply) => replies.push(reply),
  });
  await built.tm.init();
  const push = (payload: ControlCommandPayload): void => {
    if (hear === undefined) throw new Error("the manager never subscribed to control commands");
    hear(payload);
  };
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  return { ...built, replies, push, tick };
}

/** A tab holding one codex pane that has reached idle, as the Prompt Board tests set one up. */
async function openCodexPane(m: Awaited<ReturnType<typeof mount>>, id = 1, cwd = "/repo") {
  await m.tm.openFromPreset({ type: "leaf" }, [cwd], { workspacePath: cwd });
  await m.tick(0);
  m.pty.emitOutput(id, OSC_IDLE);
}

describe("control commands in the tab manager — open (ORC11)", () => {
  it("opens a new tab at the directory with the agent typed once the shell is ready, and replies its pane", async () => {
    const infos = new Map<number, PaneProcessInfo>();
    const m = await mount(infos);

    m.push(command("open", 99, { cwd: "/work/app-t1", agent: "codex", name: "T1" }));
    await m.tick(3000);

    expect(m.replies).toHaveLength(1);
    const reply = m.replies[0];
    expect(reply).toMatchObject({ ok: true, error: null });
    const paneId = reply.paneId;
    expect(paneId).not.toBeNull();
    expect(m.pty.sessions.get(paneId as number)?.cwd).toBe("/work/app-t1");
    expect(m.pty.writes).toEqual([
      {
        id: paneId,
        data: "codex --dangerously-bypass-approvals-and-sandbox -c tui.animations=false\r",
      },
    ]);
    expect(tabViews.value).toHaveLength(1);
    expect(tabViews.value[0]).toMatchObject({ name: "T1", workspacePath: "/work/app-t1" });
    m.tm.dispose();
  });

  it("waits for the agent cache before judging an agent, so a cold start does not refuse a real one", async () => {
    let answer: (agents: readonly DetectedAgent[]) => void = () => {};
    probe.ensureAgentsDetected.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const m = await mount(new Map());

    m.push(command("open", 99, { cwd: "/work/a", agent: "codex" }));
    await m.tick(100);
    expect(m.replies).toEqual([]);

    answer([CODEX]);
    await m.tick(3000);
    expect(m.replies[0]).toMatchObject({ ok: true });
    m.tm.dispose();
  });

  it.each([
    ["not installed", () => probe.ensureAgentsDetected.mockResolvedValue([])],
    [
      "switched off in Settings",
      () => {
        settings.value = { ...DEFAULT_SETTINGS, disabledAgents: ["codex"] };
      },
    ],
  ])("refuses an agent that is %s and opens no tab, not a bare shell", async (_name, arrange) => {
    arrange();
    const m = await mount(new Map());

    m.push(command("open", 99, { cwd: "/work/a", agent: "codex" }));
    await m.tick(3000);

    expect(m.replies).toEqual([
      {
        requestId: "r1",
        ok: false,
        paneId: null,
        text: null,
        outcome: null,
        error: "unknown-agent",
      },
    ]);
    expect(m.pty.sessions.size).toBe(0);
    expect(m.pty.writes).toEqual([]);
    expect(tabViews.value).toHaveLength(0);
    m.tm.dispose();
  });

  it("refuses an agent id nothing knows", async () => {
    const m = await mount(new Map());
    m.push(command("open", 99, { cwd: "/work/a", agent: "not-a-real-agent" }));
    await m.tick(3000);
    expect(m.replies[0]).toMatchObject({ ok: false, error: "unknown-agent" });
    expect(m.pty.sessions.size).toBe(0);
    m.tm.dispose();
  });
});

describe("control commands in the tab manager — send (ORC12, ORC23)", () => {
  it("pastes at once and sends Enter 500 ms later, for the same agent process", async () => {
    const infos = new Map([[1, codexPane(1)]]);
    const m = await mount(infos);
    await openCodexPane(m);
    m.pty.writes.length = 0;

    m.push(command("send", 1, { text: "do the thing", submit: true, expectedAgent: "codex" }));
    await m.tick(499);

    expect(m.pty.writes.some((write) => write.data.includes("do the thing"))).toBe(true);
    expect(m.pty.writes.some((write) => write.data === "\r")).toBe(false);
    expect(m.replies).toEqual([]);

    await m.tick(1);
    await m.tick(0);

    expect(m.pty.writes[m.pty.writes.length - 1]).toEqual({ id: 1, data: "\r" });
    expect(m.replies).toEqual([
      { requestId: "r1", ok: true, paneId: null, text: null, outcome: "sent", error: null },
    ]);
    m.tm.dispose();
  });

  it("withholds Enter and says stale when the agent process was replaced during the wait", async () => {
    const infos = new Map([[1, codexPane(1, 1000)]]);
    const m = await mount(infos);
    await openCodexPane(m);
    m.pty.writes.length = 0;

    m.push(command("send", 1, { text: "do the thing", submit: true, expectedAgent: "codex" }));
    await m.tick(200);
    // A new codex process took the pane: same agent name, different process.
    infos.set(1, codexPane(1, 7777));
    await m.tick(300);
    await m.tick(0);

    expect(m.pty.writes.some((write) => write.data === "\r")).toBe(false);
    expect(m.pty.writes.some((write) => write.data.includes("do the thing"))).toBe(true);
    expect(m.replies[0]).toMatchObject({ ok: false, outcome: "stale" });
    m.tm.dispose();
  });

  it("withholds Enter and says pasted when the agent asked for the user during the wait", async () => {
    const infos = new Map([[1, codexPane(1)]]);
    const m = await mount(infos);
    await openCodexPane(m);
    m.pty.writes.length = 0;

    m.push(command("send", 1, { text: "do the thing", submit: true, expectedAgent: "codex" }));
    await m.tick(200);
    m.emitSignal(1, { kind: "requested", source: "osc-notification" });
    await m.tick(300);
    await m.tick(0);

    expect(m.pty.writes.some((write) => write.data === "\r")).toBe(false);
    expect(m.replies[0]).toMatchObject({ ok: true, outcome: "pasted" });
    m.tm.dispose();
  });

  it("only pastes when told not to submit, and does not wait", async () => {
    const infos = new Map([[1, codexPane(1)]]);
    const m = await mount(infos);
    await openCodexPane(m);
    m.pty.writes.length = 0;

    m.push(command("send", 1, { text: "a draft", submit: false, expectedAgent: "codex" }));
    await m.tick(0);
    await m.tick(0);

    expect(m.replies[0]).toMatchObject({ ok: true, outcome: "pasted" });
    expect(m.pty.writes.some((write) => write.data === "\r")).toBe(false);
    m.tm.dispose();
  });

  it("types nothing into a pane that now runs a shell, or another agent", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const m = await mount(infos);
    await m.tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await m.tick(0);
    m.pty.writes.length = 0;

    m.push(command("send", 1, { text: "rm -rf nothing", submit: true, expectedAgent: "codex" }));
    await m.tick(1000);
    infos.set(1, processInfo(1, "/repo", "claude", "agent", "claude"));
    m.push(
      command("send", 1, { text: "rm -rf nothing", submit: true, expectedAgent: "codex" }, "r2"),
    );
    await m.tick(1000);

    expect(m.pty.writes).toEqual([]);
    expect(m.replies.map((reply) => [reply.requestId, reply.error])).toEqual([
      ["r1", "not-an-agent-pane"],
      ["r2", "not-an-agent-pane"],
    ]);
    m.tm.dispose();
  });

  it("answers no-target for a pane the window does not hold", async () => {
    const m = await mount(new Map());
    m.push(command("send", 404, { text: "go", submit: true, expectedAgent: "codex" }));
    await m.tick(1000);
    expect(m.replies[0]).toMatchObject({ ok: false, error: "no-target" });
    m.tm.dispose();
  });

  it("delivers two sends to one pane in order, the second after the first finished", async () => {
    const infos = new Map([[1, codexPane(1)]]);
    const m = await mount(infos);
    await openCodexPane(m);
    m.pty.writes.length = 0;

    m.push(command("send", 1, { text: "first", submit: true, expectedAgent: "codex" }, "r1"));
    m.push(command("send", 1, { text: "second", submit: true, expectedAgent: "codex" }, "r2"));
    await m.tick(250);
    // Only the first is in the pane; the second waits for the first's Enter.
    expect(m.pty.writes.some((write) => write.data.includes("second"))).toBe(false);

    await m.tick(1000);
    await m.tick(0);

    const data = m.pty.writes.map((write) => write.data);
    const firstAt = data.findIndex((chunk) => chunk.includes("first"));
    const firstEnter = data.indexOf("\r");
    const secondAt = data.findIndex((chunk) => chunk.includes("second"));
    expect(firstAt).toBeGreaterThanOrEqual(0);
    expect(firstEnter).toBeGreaterThan(firstAt);
    expect(secondAt).toBeGreaterThan(firstEnter);
    expect(m.replies.map((reply) => [reply.requestId, reply.outcome])).toEqual([
      ["r1", "sent"],
      ["r2", "sent"],
    ]);
    m.tm.dispose();
  });
});

describe("control commands in the tab manager — a send that outlived its call (ORC11)", () => {
  it("types nothing for a queued send whose deadline passed while the first held the pane", async () => {
    const infos = new Map([[1, codexPane(1)]]);
    const m = await mount(infos);
    await openCodexPane(m);
    m.pty.writes.length = 0;

    // Main waits 300 ms for the second reply; the first send holds the pane for 500 ms.
    m.push(command("send", 1, { text: "first", submit: true, expectedAgent: "codex" }, "r1"));
    m.push(
      command(
        "send",
        1,
        { text: "second", submit: true, expectedAgent: "codex", deadline: Date.now() + 300 },
        "r2",
      ),
    );
    await m.tick(2000);

    expect(m.pty.writes.some((write) => write.data.includes("first"))).toBe(true);
    expect(m.pty.writes.some((write) => write.data.includes("second"))).toBe(false);
    expect(m.replies.map((reply) => [reply.requestId, reply.outcome, reply.error])).toEqual([
      ["r1", "sent", null],
      ["r2", null, "expired"],
    ]);
    m.tm.dispose();
  });
});

describe("control commands in the tab manager — read (ORC13)", () => {
  it("replies the last rows of the pane without escape sequences", async () => {
    const m = await mount(new Map([[1, codexPane(1)]]));
    await openCodexPane(m);
    m.pty.emitOutput(1, `${ESC}[1mheader${ESC}[0m\r\n${ESC}[32mone${ESC}[0m\r\ntwo\r\nthree\r\n`);
    await m.tick(0);

    m.push(command("read", 1, { lines: 2 }));
    await m.tick(0);

    expect(m.replies[0]).toMatchObject({ ok: true, text: "two\nthree" });
    m.tm.dispose();
  });

  it("answers no-target for a pane the window does not hold", async () => {
    const m = await mount(new Map());
    m.push(command("read", 404, { lines: 10 }));
    await m.tick(0);
    expect(m.replies[0]).toMatchObject({ ok: false, error: "no-target" });
    m.tm.dispose();
  });
});

describe("control commands in the tab manager — close (ORC16)", () => {
  /** Pane 1 is the coordinator's tab, pane 2 a worker in its own tab. */
  async function twoTabs() {
    const infos = new Map([
      [1, codexPane(1)],
      [2, codexPane(2)],
    ]);
    const m = await mount(infos);
    await m.tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await m.tm.openFromPreset({ type: "leaf" }, ["/repo-t1"], { workspacePath: "/repo-t1" });
    await m.tick(0);
    return m;
  }

  it("closes a running agent's tab with force and never asks the user", async () => {
    const m = await twoTabs();

    m.push(command("close", 2, { force: true }));
    await m.tick(0);
    await m.tick(0);

    expect(dialog.ask).not.toHaveBeenCalled();
    expect(m.replies).toEqual([
      { requestId: "r1", ok: true, paneId: null, text: null, outcome: null, error: null },
    ]);
    expect(m.tm.allPaneIds()).toEqual([1]);
    expect(tabViews.value).toHaveLength(1);
    m.tm.dispose();
  });

  it("asks exactly as before without force, and leaves the pane when the user cancels", async () => {
    const m = await twoTabs();
    dialog.ask.mockResolvedValue(false);

    m.push(command("close", 2, { force: false }));
    await m.tick(0);
    await m.tick(0);

    expect(dialog.ask).toHaveBeenCalledTimes(1);
    expect(m.replies[0]).toMatchObject({ ok: false, error: "not-closed" });
    expect(m.tm.allPaneIds()).toEqual([1, 2]);
    m.tm.dispose();
  });

  it("closes without force once the user confirms the dialog", async () => {
    const m = await twoTabs();
    dialog.ask.mockResolvedValue(true);

    m.push(command("close", 2, { force: false }));
    await m.tick(0);
    await m.tick(0);

    expect(dialog.ask).toHaveBeenCalledTimes(1);
    expect(m.replies[0]).toMatchObject({ ok: true });
    expect(m.tm.allPaneIds()).toEqual([1]);
    m.tm.dispose();
  });

  it("waives the confirmation for the forced pane only: a later ordinary close still asks", async () => {
    const m = await twoTabs();
    m.push(command("close", 2, { force: true }));
    await m.tick(0);
    await m.tick(0);
    expect(dialog.ask).not.toHaveBeenCalled();

    // The coordinator's own tab, closed the ordinary way, is still guarded.
    await m.tm.closeTab(0);
    expect(dialog.ask).toHaveBeenCalledTimes(1);
    expect(m.tm.allPaneIds()).toEqual([1]);
    m.tm.dispose();
  });

  it("answers no-target for a pane the window does not hold", async () => {
    const m = await mount(new Map());
    m.push(command("close", 404, { force: true }));
    await m.tick(0);
    expect(m.replies[0]).toMatchObject({ ok: false, error: "no-target" });
    m.tm.dispose();
  });
});

describe("injectIntoPane — the process check and the wait before Enter", () => {
  async function agentPane(infos: Map<number, PaneProcessInfo>) {
    const m = await mount(infos);
    await openCodexPane(m);
    m.pty.writes.length = 0;
    return m;
  }

  it("sends Enter after the delay when the process is still the expected one", async () => {
    const m = await agentPane(new Map([[1, codexPane(1, 4242)]]));

    const outcome = m.tm.injectIntoPane(1, "hello", {
      autoSend: true,
      expectedAgent: "codex",
      submitDelayMs: 500,
      expectedProcessId: 4242,
    });
    await m.tick(499);
    expect(m.pty.writes.some((write) => write.data === "\r")).toBe(false);
    await m.tick(1);

    await expect(outcome).resolves.toBe("sent");
    m.tm.dispose();
  });

  it.each([
    ["submitting", true],
    ["only pasting (--no-submit)", false],
  ])(
    "answers stale and pastes nothing when the process is not the expected one before the paste, %s",
    async (_name, autoSend) => {
      // The agent the request was gated on is gone: a shell has the pane now.
      const infos = new Map<number, PaneProcessInfo>([[1, codexPane(1, 4242)]]);
      const m = await agentPane(infos);
      infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));

      const outcome = m.tm.injectIntoPane(1, "hello", {
        autoSend,
        expectedAgent: "codex",
        expectedProcessId: 4242,
      });
      await m.tick(0);

      await expect(outcome).resolves.toBe("stale");
      expect(m.pty.writes).toEqual([]);
      m.tm.dispose();
    },
  );

  it("answers stale and pastes nothing when another process of the same agent has the pane", async () => {
    const m = await agentPane(new Map([[1, codexPane(1, 4242)]]));

    const outcome = m.tm.injectIntoPane(1, "hello", {
      autoSend: true,
      expectedAgent: "codex",
      expectedProcessId: 9999,
    });
    await m.tick(0);

    await expect(outcome).resolves.toBe("stale");
    expect(m.pty.writes).toEqual([]);
    m.tm.dispose();
  });

  it("answers stale, with the text already pasted, when the process changes during the wait before Enter", async () => {
    const infos = new Map([[1, codexPane(1, 4242)]]);
    const m = await agentPane(infos);

    const outcome = m.tm.injectIntoPane(1, "hello", {
      autoSend: true,
      expectedAgent: "codex",
      submitDelayMs: 500,
      expectedProcessId: 4242,
    });
    await m.tick(200);
    infos.set(1, codexPane(1, 9999));
    await m.tick(300);

    await expect(outcome).resolves.toBe("stale");
    expect(m.pty.writes.some((write) => write.data.includes("hello"))).toBe(true);
    expect(m.pty.writes.some((write) => write.data === "\r")).toBe(false);
    m.tm.dispose();
  });

  it("withholds Enter, leaving the text pasted, when the deadline passes during the wait", async () => {
    const m = await agentPane(new Map([[1, codexPane(1, 4242)]]));

    const outcome = m.tm.injectIntoPane(1, "hello", {
      autoSend: true,
      expectedAgent: "codex",
      submitDelayMs: 500,
      expectedProcessId: 4242,
      submitDeadline: Date.now() + 200,
    });
    await m.tick(500);

    await expect(outcome).resolves.toBe("pasted");
    expect(m.pty.writes.some((write) => write.data.includes("hello"))).toBe(true);
    expect(m.pty.writes.some((write) => write.data === "\r")).toBe(false);
    m.tm.dispose();
  });

  it("sends Enter when the deadline is still ahead after the wait", async () => {
    const m = await agentPane(new Map([[1, codexPane(1, 4242)]]));

    const outcome = m.tm.injectIntoPane(1, "hello", {
      autoSend: true,
      expectedAgent: "codex",
      submitDelayMs: 500,
      expectedProcessId: 4242,
      submitDeadline: Date.now() + 5_000,
    });
    await m.tick(500);

    await expect(outcome).resolves.toBe("sent");
    m.tm.dispose();
  });

  it("does not wait and does not compare process ids when the options are absent, as before", async () => {
    const m = await agentPane(new Map([[1, codexPane(1, 4242)]]));

    const outcome = m.tm.injectIntoPane(1, "hello", { autoSend: true, expectedAgent: "codex" });
    await m.tick(0);

    await expect(outcome).resolves.toBe("sent");
    m.tm.dispose();
  });

  it("does not wait at all when it is not going to submit", async () => {
    const m = await agentPane(new Map([[1, codexPane(1, 4242)]]));
    const outcome = m.tm.injectIntoPane(1, "hello", {
      autoSend: false,
      expectedAgent: "codex",
      submitDelayMs: 500,
      expectedProcessId: 4242,
    });
    await m.tick(0);
    await expect(outcome).resolves.toBe("pasted");
    m.tm.dispose();
  });
});
