// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { createMemoryPtyClient, type PtyClient } from "./pty-client";
import { agentQuickPickerOpen } from "../chrome/events";
import { activeTabIndex, tabViews } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { fakePane, flush, processInfo, setupControllable, wire } from "./tab-manager.fixtures";
import { TASK_PROMPT_POLL_MS, TASK_PROMPT_READY_TIMEOUT_MS } from "./task-prompt-send";
import type { MaterializeIntent } from "./tab-materialize";

vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

vi.mock("../host/window-host", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => true,
    onFocusChanged: async () => () => {},
  }),
}));

const INTENT: MaterializeIntent = {
  layout: { type: "leaf" },
  cwds: ["/repo"],
  agent: "claude",
  workspacePath: "/repo",
};

/** Every byte the fake PTY was asked to write, joined. */
function written(pty: ReturnType<typeof createMemoryPtyClient>): string {
  return pty.writes.map((entry) => entry.data).join("");
}

/**
 * A live-map manager whose pane's paste can be steered — `setupControllable`
 * takes no pane overrides, and the two outcomes below are only reachable by
 * making the paste itself fail or by moving the gate underneath it.
 */
function controllableWithPaste(
  infoByPane: Map<number, PaneProcessInfo>,
  pasteText: NonNullable<Parameters<typeof fakePane>[2]>["pasteText"],
): { tm: ReturnType<typeof wire>["tm"]; pty: ReturnType<typeof createMemoryPtyClient> } {
  const base = createMemoryPtyClient({ nextId: 1 });
  const pty: PtyClient = {
    ...base,
    async ptyInfo(ids: readonly number[]): Promise<PaneProcessInfo[]> {
      return ids.flatMap((id) => {
        const info = infoByPane.get(id);
        return info === undefined ? [] : [info];
      });
    },
  };
  const { tm } = wire(pty, {}, { pasteText });
  return { tm, pty: base };
}

/**
 * Wait out a process poll and drive the recognised pane to `phase: "idle"`.
 * Gate 1 reads `pty_info` directly, but gate 2 reads the TRACKER, which is fed
 * by the 2s poll and by output — never by launchTask's own reads.
 */
async function driveToIdle(
  tm: ReturnType<typeof wire>["tm"],
  pty: ReturnType<typeof createMemoryPtyClient>,
): Promise<void> {
  await vi.waitFor(
    () => {
      pty.emitOutput(1, "\x1b]9;4;0\x07");
      expect(tm.paneAttention(1)?.phase).toBe("idle");
    },
    { timeout: 6000, interval: 100 },
  );
}

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  document.body.innerHTML = "";
  tabViews.value = [];
  activeTabIndex.value = 0;
  settings.value = DEFAULT_SETTINGS;
  vi.mocked(sendAgentNotification).mockClear();
});

afterEach(() => {
  agentQuickPickerOpen.value = false;
  vi.useRealTimers();
});

describe("launchTask", () => {
  it("returns spawn-failed and never writes the prompt", async () => {
    const base = createMemoryPtyClient({ nextId: 1 });
    const pty = {
      ...base,
      async spawnShell(): Promise<number> {
        throw new Error("no pty available");
      },
    };
    const { tm } = wire(pty);
    const outcome = await tm.launchTask(INTENT, "ship it");
    expect(outcome).toBe("spawn-failed");
    expect(written(base)).not.toContain("ship it");
  });

  it("returns started for a launch with no prompt", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();
    const outcome = await tm.launchTask(INTENT, null);
    expect(outcome).toBe("started");
    expect(written(pty)).not.toContain("ship it");
  });

  it("treats a whitespace-only prompt as no prompt", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm } = setupControllable(infos);
    await tm.init();
    expect(await tm.launchTask(INTENT, "   \n ")).toBe("started");
  });

  it("refuses to prompt a shell pane instead of typing into it", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();
    const outcome = await tm.launchTask({ ...INTENT, agent: null }, "ship it");
    expect(outcome).toBe("prompt-not-sent");
    expect(written(pty)).not.toContain("ship it");
  });

  it("waits for the agent before writing the prompt", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();

    const running = tm.launchTask(INTENT, "ship it");
    await flush();
    // Still a shell: the prompt must not have been pasted yet, which is the
    // whole reason readiness is polled BEFORE injectIntoPane.
    expect(written(pty)).not.toContain("ship it");

    infos.set(1, processInfo(1, "/repo", "claude", "agent", "claude"));
    await driveToIdle(tm, pty);

    expect(await running).toBe("sent");
    expect(written(pty)).toContain("ship it");
  });

  it("reports prompt-failed when the paste itself fails", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = controllableWithPaste(infos, async () => false);
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    expect(await running).toBe("prompt-failed");
  });

  it("maps a pasted-but-unsubmitted result to prompt-pending", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    // The gate moves out from under the inject between its paste and its `\r`:
    // the pane is a DIFFERENT agent by the time it re-reads. That is exactly
    // the state whose text is already in the agent's composer, so the outcome
    // must be terminal rather than retried.
    const { tm, pty } = controllableWithPaste(infos, async () => {
      infos.set(1, processInfo(1, "/repo", "codex", "agent", "codex"));
      return true;
    });
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    expect(await running).toBe("prompt-pending");
  });

  it("gives up without pasting when readiness never arrives", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();
    vi.useFakeTimers();

    const running = tm.launchTask(INTENT, "ship it");
    await vi.advanceTimersByTimeAsync(TASK_PROMPT_READY_TIMEOUT_MS + TASK_PROMPT_POLL_MS);

    expect(await running).toBe("prompt-not-sent");
    expect(written(pty)).not.toContain("ship it");
    // The tab it opened is still standing — a launch that could not be
    // prompted is still a pane the user can type into.
    expect(tabViews.value.length).toBe(1);
  });
});
