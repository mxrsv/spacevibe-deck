// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HookEvent } from "../lib/agent-signal-map";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { paneSignal } from "../ui/agent-rail-model";
import { processInfo, setupControllable } from "./tab-manager.fixtures";
import { tabViews } from "./tabs-store";

beforeEach(() => {
  vi.useFakeTimers();
  settings.value = {
    ...DEFAULT_SETTINGS,
    agentSignalAdapters: { claude: false, codex: true, opencode: false },
  };
});
afterEach(() => {
  vi.useRealTimers();
  settings.value = DEFAULT_SETTINGS;
});

async function setup(manual = false) {
  const infos = new Map([
    [
      1,
      manual
        ? processInfo(1, "/repo", "zsh", "idle-shell", null)
        : processInfo(1, "/repo", "codex", "agent", "codex"),
    ],
  ]);
  let receive: ((event: HookEvent) => void) | null = null;
  const { tm, pty } = setupControllable(infos, {
    signalConfig: async () => ({ claudeSettingsPath: null, hookPort: 45999 }),
    hookEvents: async (handler) => {
      receive = handler;
      return () => {
        receive = null;
      };
    },
  });
  await tm.init();
  await tm.openFromPreset({ type: "leaf" }, ["/repo"], { workspacePath: "/repo" });
  await vi.advanceTimersByTimeAsync(0);
  const emit = (event: string, turnId = "turn-1", paneId = 1) =>
    receive?.({
      paneId,
      source: "hook",
      agent: "codex",
      event,
      turnId,
      sessionId: "session-1",
      cwd: "/repo",
      message: "Finished.",
      detail: null,
      receivedAt: Date.now(),
    });
  return { tm, pty, infos, emit };
}

describe("Codex card lifecycle", () => {
  it("keeps the newest hook while process discovery is waiting for git branch resolution", async () => {
    const { tm, pty, infos, emit } = await setup(true);
    let finishBranch!: (value: string | null) => void;
    const branch = new Promise<string | null>((resolve) => {
      finishBranch = resolve;
    });
    const lookup = vi.spyOn(pty, "gitBranch").mockReturnValue(branch);
    try {
      infos.set(1, processInfo(1, "/new-repo", "codex", "agent", "codex"));
      emit("UserPromptSubmit");
      await vi.advanceTimersByTimeAsync(0);
      expect(lookup).toHaveBeenCalled();
      emit("Stop");
      finishBranch("main");
      await vi.advanceTimersByTimeAsync(0);
      expect(tabViews.value[0].panes?.[0]).toMatchObject({ phase: "idle", hasRun: true });
      expect(tabViews.value[0].agentBusy).toBe(false);
    } finally {
      finishBranch(null);
      tm.dispose();
    }
  });

  it("keeps the card and tab idle through 60s of repaints, then starts the next turn", async () => {
    const { tm, pty, emit } = await setup();
    try {
      emit("UserPromptSubmit");
      expect(tabViews.value[0].panes?.[0]?.phase).toBe("working");
      emit("Stop");
      for (let i = 0; i < 60; i++) {
        await vi.advanceTimersByTimeAsync(1000);
        pty.emitOutput(1, "\x1b[?2026h\x1b[?2026l");
      }
      const pane = tabViews.value[0].panes![0];
      expect(pane.phase).toBe("idle");
      expect(paneSignal(pane).state).not.toBe("working");
      expect(tabViews.value[0].agentBusy).toBe(false);
      emit("UserPromptSubmit", "turn-2");
      emit("Stop", "turn-1");
      expect(tabViews.value[0].panes?.[0]?.phase).toBe("working");
      expect(tabViews.value[0].agentBusy).toBe(true);
    } finally {
      tm.dispose();
    }
  });

  it("accepts a manual launch's completion before the next scheduled process poll", async () => {
    const { tm, infos, emit } = await setup(true);
    try {
      infos.set(1, processInfo(1, "/repo", "codex", "agent", "codex"));
      emit("SessionStart");
      emit("UserPromptSubmit");
      emit("Stop");
      await vi.advanceTimersByTimeAsync(0);
      expect(tabViews.value[0].panes?.[0]).toMatchObject({
        phase: "idle",
        sessionId: "session-1",
        hasRun: true,
      });
    } finally {
      tm.dispose();
    }
  });

  it("ignores hooks when Signals is disabled and releases lifecycle authority", async () => {
    const { tm, pty, emit } = await setup();
    try {
      emit("UserPromptSubmit");
      emit("Stop");
      settings.value = DEFAULT_SETTINGS;
      await vi.advanceTimersByTimeAsync(2000);
      pty.emitOutput(1, "new output");
      await vi.advanceTimersByTimeAsync(500);
      pty.emitOutput(1, "more output");
      expect(tabViews.value[0].panes?.[0]?.phase).toBe("working");
      emit("Stop", "turn-2");
      expect(tabViews.value[0].panes?.[0]?.phase).toBe("working");
    } finally {
      tm.dispose();
    }
  });
});
