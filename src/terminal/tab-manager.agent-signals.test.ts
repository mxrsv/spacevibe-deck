// @vitest-environment jsdom
/**
 * The stage-2 adapters through `TabManager`'s own seams (agent-signal
 * contract layer, 2026-09-03): a launch is augmented at ARM time and the
 * journal never sees it; a hook post reaches the tracker and the tail store;
 * a host with no adapter types the user's command unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import type { HookEvent } from "../lib/agent-signal-map";
import type { SignalAdapters } from "../lib/launch-augment";
import { tabViews } from "./tabs-store";
import { paneTails } from "./session-tail-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { processInfo, setupControllable } from "./tab-manager.fixtures";

const SETTINGS_PATH =
  "/Users/dev/Library/Application Support/SpaceVibe Deck/agent-hooks/claude.json";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type HookHandler = (event: HookEvent) => void;

function harness(infoByPane: Map<number, PaneProcessInfo>, over: { attach?: number | null } = {}) {
  let handler: HookHandler | null = null;
  const opencodeAttach = vi.fn(async () => over.attach ?? 45123);
  const { tm, pty } = setupControllable(infoByPane, {
    signalConfig: async () => ({ claudeSettingsPath: SETTINGS_PATH, hookPort: 45999 }),
    opencodeAttach,
    hookEvents: async (next) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
  });
  return {
    tm,
    pty,
    opencodeAttach,
    emitHook(event: HookEvent) {
      handler?.(event);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  settings.value = DEFAULT_SETTINGS;
  paneTails.value = new Map();
});

/**
 * Every adapter ships OFF — a pane opens with the command the user chose. The
 * cases below are about what an adapter does once the user switches it on.
 */
function signalsOn(...agents: readonly (keyof SignalAdapters)[]): void {
  const on = Object.fromEntries(agents.map((agent) => [agent, true]));
  settings.value = {
    ...settings.value,
    agentSignalAdapters: { ...settings.value.agentSignalAdapters, ...on },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createTabManager — arm-time augmentation (stage 2)", () => {
  it("returns each materialized pane without borrowing another concurrent launch's destination", async () => {
    const { tm, pty } = harness(new Map());
    try {
      await tm.init();
      const ids = await Promise.all([
        tm.materializePane({
          layout: null,
          cwds: ["/first"],
          paneCommands: ["codex resume first"],
        }),
        tm.materializePane({
          layout: null,
          cwds: ["/second"],
          paneCommands: ["codex resume second"],
        }),
      ]);
      expect(ids[0]).not.toBeNull();
      expect(ids[1]).not.toBeNull();
      expect(ids[0]!.paneId).not.toBe(ids[1]!.paneId);
      expect(pty.sessions.get(ids[0]!.paneId)?.cwd).toBe("/first");
      expect(pty.sessions.get(ids[1]!.paneId)?.cwd).toBe("/second");
    } finally {
      tm.dispose();
    }
  });

  it("invalidates a Recent launch receipt when its PTY command write fails", async () => {
    const { tm, pty } = harness(new Map());
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(pty, "writePty").mockRejectedValue(new Error("PTY write failed"));
    try {
      await tm.init();
      const receipt = await tm.materializePane({
        layout: null,
        cwds: ["/repo"],
        paneCommands: ["codex resume sample"],
      });
      expect(receipt?.canFocus()).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
      pty.emitOutput(receipt!.paneId, "$ ");
      await vi.advanceTimersByTimeAsync(0);
      expect(receipt?.canFocus()).toBe(false);
    } finally {
      tm.dispose();
      error.mockRestore();
    }
  });

  it("restarts the confirmed Claude session with hooks when no transcript tail was read", async () => {
    signalsOn("claude");
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = harness(infos);
    try {
      await tm.init();
      await tm.materialize({ layout: null, cwds: ["/repo"], agent: "claude" });
      await vi.advanceTimersByTimeAsync(0);
      pty.emitOutput(1, "$ ");
      await vi.advanceTimersByTimeAsync(2000);
      const confirmed = tabViews.value[0]?.panes?.[0]?.sessionId;
      expect(confirmed).toMatch(UUID);
      infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
      await vi.advanceTimersByTimeAsync(2000);
      await expect(tm.restartPane(1)).resolves.toBe(true);
      const command = pty.writes.at(-1)?.data ?? "";
      expect(command).toContain(`claude --resume ${confirmed}`);
      expect(command).toContain(`--settings '${SETTINGS_PATH}'`);
      expect(command).not.toContain("--session-id");
    } finally {
      tm.dispose();
    }
  });

  it("forgets a previous session when a new same-name agent runs without a confirmed id", async () => {
    signalsOn("claude");
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = harness(infos);
    try {
      await tm.init();
      await tm.materialize({ layout: null, cwds: ["/repo"], agent: "claude" });
      await vi.advanceTimersByTimeAsync(0);
      pty.emitOutput(1, "$ ");
      await vi.advanceTimersByTimeAsync(2000);
      const previous = tabViews.value[0]?.panes?.[0]?.sessionId;
      expect(previous).toMatch(UUID);
      infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
      await vi.advanceTimersByTimeAsync(2000);
      // A manual launch bypasses Deck's command augmentation and starts a new session.
      infos.set(1, processInfo(1, "/repo", "claude", "agent", "claude"));
      await vi.advanceTimersByTimeAsync(2000);
      infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
      await vi.advanceTimersByTimeAsync(2000);
      await expect(tm.restartPane(1)).resolves.toBe(true);
      expect(pty.writes.at(-1)?.data).toContain("claude --continue");
      expect(pty.writes.at(-1)?.data).not.toContain(previous!);
    } finally {
      tm.dispose();
    }
  });

  it("reattaches an opencode port on Restart", async () => {
    signalsOn("opencode");
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "opencode", "agent", "opencode")],
    ]);
    const { tm, pty, opencodeAttach } = harness(infos);
    try {
      await tm.init();
      await tm.materialize({ layout: null, cwds: ["/repo"], agent: "opencode" });
      await vi.advanceTimersByTimeAsync(0);
      pty.emitOutput(1, "$ ");
      await vi.advanceTimersByTimeAsync(2000);
      infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
      await vi.advanceTimersByTimeAsync(2000);
      opencodeAttach.mockClear();
      await expect(tm.restartPane(1)).resolves.toBe(true);
      expect(opencodeAttach).toHaveBeenCalledWith(1);
      expect(pty.writes.at(-1)?.data).toContain("--port 45123");
      expect(pty.writes.at(-1)?.data).toBe("opencode -c --port 45123\r");
    } finally {
      tm.dispose();
    }
  });

  // The shipped defaults, for every agent that HAS an adapter: the pane types
  // the command the user chose and nothing else, and main is not asked for a
  // port it would then have to reserve.
  for (const [agent, launchCommand] of [
    ["claude", "claude --dangerously-skip-permissions"],
    ["codex", "codex --full-auto"],
    ["opencode", "opencode"],
  ] as const) {
    it(`types the user's ${agent} command unchanged with the shipped defaults`, async () => {
      const infoByPane = new Map<number, PaneProcessInfo>([
        [1, processInfo(1, "/repo", agent, "agent", agent)],
      ]);
      const { tm, pty, opencodeAttach } = harness(infoByPane);
      await tm.init();
      await tm.materialize({
        layout: null,
        cwds: ["/repo"],
        workspacePath: "/repo",
        agent,
        launchCommand,
      });
      await vi.advanceTimersByTimeAsync(0);
      pty.emitOutput(1, "$ ");
      await vi.advanceTimersByTimeAsync(0);

      expect(pty.writes.find((write) => write.id === 1)?.data).toBe(`${launchCommand}\r`);
      expect(opencodeAttach).not.toHaveBeenCalled();
      tm.dispose();
    });
  }

  it("types the settings file and a minted session id after the user's claude command, and journals the user's", async () => {
    signalsOn("claude");
    const infoByPane = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = harness(infoByPane);
    await tm.init();
    await tm.materialize({
      layout: null,
      cwds: ["/repo"],
      workspacePath: "/repo",
      agent: "claude",
      launchCommand: "claude --dangerously-skip-permissions",
    });
    await vi.advanceTimersByTimeAsync(0);
    pty.emitOutput(1, "$ ");
    await vi.advanceTimersByTimeAsync(0);

    const typed = pty.writes.find((write) => write.id === 1)?.data ?? "";
    expect(
      typed.startsWith(
        `claude --dangerously-skip-permissions --settings '${SETTINGS_PATH}' --session-id `,
      ),
    ).toBe(true);
    const minted = typed.trim().split(" ").at(-1) ?? "";
    expect(minted).toMatch(UUID);
    // The journal holds the USER's command, never the augmented one.
    expect(tm.captureSession()[0]?.panes[0]?.launchCommand).toBe(
      "claude --dangerously-skip-permissions",
    );
    // The minted id becomes the pane's session once the gate opens.
    await vi.advanceTimersByTimeAsync(2000);
    expect(tabViews.value[0]?.panes?.[0]?.sessionId).toBe(minted);
    expect(tm.captureSession()[0]?.panes[0]?.sessionId).toBe(minted);
    tm.dispose();
  });

  it("asks main for a port before typing opencode, and appends it", async () => {
    signalsOn("opencode");
    const infoByPane = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "opencode", "agent", "opencode")],
    ]);
    const { tm, pty, opencodeAttach } = harness(infoByPane, { attach: 45777 });
    await tm.init();
    await tm.materialize({
      layout: null,
      cwds: ["/repo"],
      workspacePath: "/repo",
      agent: "opencode",
      launchCommand: "opencode",
    });
    await vi.advanceTimersByTimeAsync(0);
    pty.emitOutput(1, "$ ");
    await vi.advanceTimersByTimeAsync(0);
    expect(opencodeAttach).toHaveBeenCalledWith(1);
    expect(pty.writes.find((write) => write.id === 1)?.data).toBe("opencode --port 45777\r");
    tm.dispose();
  });

  it("appends codex's notification flag, and nothing when the adapter is off", async () => {
    const infoByPane = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "codex", "agent", "codex")],
    ]);
    signalsOn("codex");
    const { tm, pty } = harness(infoByPane);
    await tm.init();
    await tm.materialize({
      layout: null,
      cwds: ["/repo"],
      workspacePath: "/repo",
      agent: "codex",
      launchCommand: "codex --full-auto",
    });
    await vi.advanceTimersByTimeAsync(0);
    pty.emitOutput(1, "$ ");
    await vi.advanceTimersByTimeAsync(0);
    expect(pty.writes.find((write) => write.id === 1)?.data).toBe(
      "codex --full-auto -c tui.notification_condition=always\r",
    );
    tm.dispose();

    // Claude with its adapter off: the user's command, verbatim.
    const claudeInfo = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const second = harness(claudeInfo);
    await second.tm.init();
    await second.tm.materialize({
      layout: null,
      cwds: ["/repo"],
      workspacePath: "/repo",
      agent: "claude",
      launchCommand: "claude",
    });
    await vi.advanceTimersByTimeAsync(0);
    second.pty.emitOutput(1, "$ ");
    await vi.advanceTimersByTimeAsync(0);
    expect(second.pty.writes.find((write) => write.id === 1)?.data).toBe("claude\r");
    second.tm.dispose();
  });

  it("a host with no adapters arms the user's command unchanged", async () => {
    const infoByPane = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setupControllable(infoByPane, { signalConfig: null });
    await tm.init();
    await tm.materialize({
      layout: null,
      cwds: ["/repo"],
      workspacePath: "/repo",
      agent: "claude",
      launchCommand: "claude",
    });
    pty.emitOutput(1, "$ ");
    expect(pty.writes).toEqual([{ id: 1, data: "claude\r" }]);
    tm.dispose();
  });
});

describe("createTabManager — hook events (stage 2)", () => {
  function claudeHook(over: Partial<HookEvent>): HookEvent {
    return {
      paneId: 1,
      source: "hook",
      agent: "claude",
      event: "Stop",
      sessionId: "11111111-2222-4333-8444-555555555555",
      cwd: "/repo",
      message: null,
      detail: null,
      receivedAt: 1000,
      ...over,
    };
  }

  it("a Stop post completes the pane explicitly and puts its sentence on the row", async () => {
    const infoByPane = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, emitHook } = harness(infoByPane);
    await tm.init();
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await vi.advanceTimersByTimeAsync(0); // gate opens on the materialize poll

    emitHook(claudeHook({ event: "SessionStart" }));
    emitHook(claudeHook({ event: "Stop", message: "Suite is green." }));

    const pane = tabViews.value[0]?.panes?.[0];
    expect(pane?.attention).toBe("completed");
    expect(pane?.confidence).toBe("explicit");
    expect(pane?.sessionId).toBe("11111111-2222-4333-8444-555555555555");
    expect(paneTails.value.get(1)).toBe("Suite is green.");
    tm.dispose();
  });

  it("a PermissionRequest is a request with its detail; a post for another pane or occupant is ignored", async () => {
    const infoByPane = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, emitHook } = harness(infoByPane);
    await tm.init();
    await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
    await vi.advanceTimersByTimeAsync(0);

    emitHook(claudeHook({ event: "PermissionRequest", detail: "Bash" }));
    let pane = tabViews.value[0]?.panes?.[0];
    expect(pane?.attention).toBe("requested");
    expect(pane?.detail).toBe("permission prompt — Bash");

    // A previous occupant's late Stop: dropped by the generation check.
    emitHook(claudeHook({ event: "Stop", sessionId: "old-occupant" }));
    pane = tabViews.value[0]?.panes?.[0];
    expect(pane?.attention).toBe("requested");
    // A pane this window does not own: ignored.
    emitHook(claudeHook({ paneId: 99, event: "Stop" }));
    expect(tabViews.value[0]?.panes?.[0]?.attention).toBe("requested");
    tm.dispose();
  });
});
