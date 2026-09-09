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
import { paneTaskPrompts, resetTaskPrompts } from "./board-task-prompts";
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
  paneId = 1,
): Promise<void> {
  await vi.waitFor(
    () => {
      pty.emitOutput(paneId, "\x1b]9;4;0\x07");
      expect(tm.paneAttention(paneId)?.phase).toBe("idle");
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
  // Window-scoped module state, and pane ids restart at 1 in every case: a
  // key left behind by an earlier launch would satisfy the negative
  // assertions below without the production code doing anything.
  resetTaskPrompts();
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
    const result = await tm.launchTask(INTENT, "ship it");
    expect(result).toEqual({ outcome: "spawn-failed", tabKey: null });
    expect(written(base)).not.toContain("ship it");
  });

  it("returns started for a launch with no prompt", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();
    const result = await tm.launchTask(INTENT, null);
    expect(result.outcome).toBe("started");
    expect(result.tabKey).toBeTypeOf("number");
    expect(written(pty)).not.toContain("ship it");
  });

  it("drops the prompt entirely, and never waits, while staging is off", async () => {
    // Production's own default (`TASK_PROMPT_STAGING_ENABLED` false). The pane
    // is DELIBERATELY left as a bare shell — under staging this is the input
    // that makes `waitForPromptReady` burn its full 90s ceiling — and the
    // assertion is that no fake timer has to be advanced for the call to
    // settle. `started` is the honest outcome: the tab is up, the agent was
    // asked for nothing.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setupControllable(infos, { promptStaging: false });
    await tm.init();
    const result = await tm.launchTask(INTENT, "ship it");
    expect(result.outcome).toBe("started");
    expect(result.tabKey).toBeTypeOf("number");
    expect(written(pty)).not.toContain("ship it");
    expect(paneTaskPrompts.value.get(1)).toBeUndefined();
  });

  it("treats a whitespace-only prompt as no prompt", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm } = setupControllable(infos);
    await tm.init();
    expect((await tm.launchTask(INTENT, "   \n ")).outcome).toBe("started");
  });

  it("refuses to prompt a shell pane instead of typing into it", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "zsh", "idle-shell", null)],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();
    const result = await tm.launchTask({ ...INTENT, agent: null }, "ship it");
    expect(result.outcome).toBe("prompt-not-sent");
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

    expect((await running).outcome).toBe("prompt-pending");
    expect(written(pty)).toContain("ship it");
    // Auto-send is off: the text reaches the composer and the Enter is the
    // user's. A bare carriage return here would be Deck pressing it for them,
    // which on a first-run trust menu means "yes, I trust this folder".
    expect(pty.writes.some((entry) => entry.data === "\r")).toBe(false);
  });

  it("reports prompt-failed when the paste itself fails", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = controllableWithPaste(infos, async () => false);
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    expect((await running).outcome).toBe("prompt-failed");
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
    expect((await running).outcome).toBe("prompt-pending");
  });

  it("sends each concurrent launch's prompt to its own pane", async () => {
    // The invariant this pins: a launch addresses the tab IT created, never
    // "whatever is last". Two launches in flight can push in either order
    // across an await, and reading `tabs[tabs.length - 1]` would then type one
    // task's prompt into the other's pane. The interleave is not forced here
    // (it depends on microtask ordering inside addTab); the observable
    // pairing is what regresses if the capture goes back to a lookup.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/a", "claude", "agent", "claude")],
      [2, processInfo(2, "/b", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();

    const first = tm.launchTask({ ...INTENT, cwds: ["/a"], workspacePath: "/a" }, "alpha");
    const second = tm.launchTask({ ...INTENT, cwds: ["/b"], workspacePath: "/b" }, "beta");

    await vi.waitFor(
      () => {
        pty.emitOutput(1, "\x1b]9;4;0\x07");
        pty.emitOutput(2, "\x1b]9;4;0\x07");
        expect(tm.paneAttention(1)?.phase).toBe("idle");
        expect(tm.paneAttention(2)?.phase).toBe("idle");
      },
      { timeout: 8000, interval: 100 },
    );

    expect((await first).outcome).toBe("prompt-pending");
    expect((await second).outcome).toBe("prompt-pending");

    const alpha = pty.writes.find((entry) => entry.data.includes("alpha"));
    const beta = pty.writes.find((entry) => entry.data.includes("beta"));
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(alpha?.id).not.toBe(beta?.id);
    // NOT asserted here: how many tabs the STRIP shows. Two concurrent
    // launches leave two entries in the manager (`allPaneIds()` answers
    // `[1, 2]`) but only one in `tabViews` — a pre-existing sync gap in the
    // materialize/selectTab path, unrelated to the pairing this test pins and
    // deliberately left alone rather than fixed in passing.
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

    expect((await running).outcome).toBe("prompt-not-sent");
    expect(written(pty)).not.toContain("ship it");
    // The tab it opened is still standing — a launch that could not be
    // prompted is still a pane the user can type into.
    expect(tabViews.value.length).toBe(1);
  });

  it("retries a failed paste in the original tab without materializing another", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    let pasteSucceeds = false;
    const { tm, pty } = controllableWithPaste(infos, async () => pasteSucceeds);
    await tm.init();

    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    const first = await running;
    expect(first.outcome).toBe("prompt-failed");
    expect(tm.canRetryTaskPrompt(first.tabKey ?? -1)).toBe(true);
    expect(first.tabKey).toBeTypeOf("number");

    pasteSucceeds = true;
    const retry = await tm.retryTaskPrompt(first.tabKey ?? -1, "ship it", "claude");

    expect(retry).toBe("prompt-pending");
    expect(tabViews.value).toHaveLength(1);
  });

  it("focuses the exact pane holding a pending prompt and withdraws it after that pane closes", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = controllableWithPaste(infos, async () => true);
    await tm.init();

    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    const first = await running;
    expect(first.outcome).toBe("prompt-pending");
    expect(tm.canFocusTaskPrompt(first.tabKey ?? -1)).toBe(true);

    await tm.splitActive("row");
    infos.set(2, processInfo(2, "/repo", "claude", "agent", "claude"));
    await driveToIdle(tm, pty, 2);
    expect(tm.activePaneId()).toBe(2);

    expect(tm.focusTaskPrompt(first.tabKey ?? -1)).toBe(true);
    expect(tm.activePaneId()).toBe(1);

    infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
    await tm.closePaneAt(0, 1);
    expect(tm.canFocusTaskPrompt(first.tabKey ?? -1)).toBe(false);
    expect(tm.focusTaskPrompt(first.tabKey ?? -1)).toBe(false);
    expect(tm.activePaneId()).toBe(2);
  });

  it("refuses retry after the original tab is gone", async () => {
    const { tm, pty } = setupControllable(new Map());
    await tm.init();

    expect(await tm.retryTaskPrompt(999, "ship it", "claude")).toBe("prompt-not-sent");
    expect(written(pty)).not.toContain("ship it");
  });

  it("refuses retry when the pane now runs a different agent", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = controllableWithPaste(infos, async () => false);
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    const first = await running;

    infos.set(1, processInfo(1, "/repo", "codex", "agent", "codex"));

    expect(await tm.retryTaskPrompt(first.tabKey ?? -1, "ship it", "claude")).toBe(
      "prompt-not-sent",
    );
  });

  it("refuses retry after the same agent restarts inside the original pane", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, { ...processInfo(1, "/repo", "claude", "agent", "claude"), processId: 101 }],
    ]);
    const { tm, pty } = controllableWithPaste(infos, async () => false);
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    const first = await running;
    expect(first.outcome).toBe("prompt-failed");

    infos.set(1, {
      ...processInfo(1, "/repo", "claude", "agent", "claude"),
      processId: 202,
    });

    expect(await tm.retryTaskPrompt(first.tabKey ?? -1, "ship it", "claude")).toBe(
      "prompt-not-sent",
    );
  });

  it("refuses retry when the same agent restarts during the retry readiness check", async () => {
    const original = {
      ...processInfo(1, "/repo", "claude", "agent", "claude"),
      processId: 101,
    };
    const restarted = { ...original, processId: 202 };
    const base = createMemoryPtyClient({ nextId: 1 });
    let retrying = false;
    let retryReads = 0;
    let pasteAttempts = 0;
    const pty: PtyClient = {
      ...base,
      async ptyInfo(ids: readonly number[]): Promise<PaneProcessInfo[]> {
        if (!ids.includes(1)) {
          return [];
        }
        if (!retrying) {
          return [original];
        }
        retryReads += 1;
        return [retryReads === 1 ? original : restarted];
      },
    };
    const { tm } = wire(
      pty,
      {},
      {
        pasteText: async () => {
          pasteAttempts += 1;
          return false;
        },
      },
    );
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, base);
    const first = await running;
    expect(first.outcome).toBe("prompt-failed");
    expect(pasteAttempts).toBe(1);

    retrying = true;
    expect(await tm.retryTaskPrompt(first.tabKey ?? -1, "ship it", "claude")).toBe(
      "prompt-not-sent",
    );
    expect(retryReads).toBe(2);
    expect(pasteAttempts).toBe(1);
  });

  it("refuses retry after the original agent changes working directory", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, { ...processInfo(1, "/repo", "claude", "agent", "claude"), processId: 101 }],
    ]);
    const { tm, pty } = controllableWithPaste(infos, async () => false);
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    const first = await running;

    infos.set(1, {
      ...processInfo(1, "/repo/other", "claude", "agent", "claude"),
      processId: 101,
    });

    expect(await tm.retryTaskPrompt(first.tabKey ?? -1, "ship it", "claude")).toBe(
      "prompt-not-sent",
    );
  });

  it("refuses retry when the original pane was replaced by another pane of the same agent", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    let pasteSucceeds = false;
    const { tm, pty } = controllableWithPaste(infos, async () => pasteSucceeds);
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    const first = await running;
    expect(first.outcome).toBe("prompt-failed");

    await tm.splitActive("row");
    infos.set(2, processInfo(2, "/repo", "claude", "agent", "claude"));
    await driveToIdle(tm, pty, 2);
    infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
    await tm.closePaneAt(0, 1);
    expect(tm.allPaneIds()).toEqual([2]);
    expect(tm.canRetryTaskPrompt(first.tabKey ?? -1)).toBe(false);

    pasteSucceeds = true;
    expect(await tm.retryTaskPrompt(first.tabKey ?? -1, "ship it", "claude")).toBe(
      "prompt-not-sent",
    );
  });
});

describe("the launch prompt a Board card prints", () => {
  it("records the prompt a pending launch left in the composer", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();
    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    // `TASK_PROMPT_AUTOSEND` is false, so this — not `sent` — is what a
    // prompted launch normally answers. A store that only knew `sent` would be
    // empty for almost every launch the app ever makes.
    expect((await running).outcome).toBe("prompt-pending");
    expect(paneTaskPrompts.value.get(1)).toBe("ship it");
  });

  it("records nothing when readiness never arrives, though the target resolved", async () => {
    // The pane IS the expected agent, so `taskPromptTarget` answers a real
    // target — it never reaches `phase: "idle"`, so readiness times out. This
    // is the case that separates the outcome check from a target-only one: a
    // condition written on `delivery.target !== null` would record a prompt
    // this pane was never handed.
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = setupControllable(infos);
    await tm.init();
    vi.useFakeTimers();

    const running = tm.launchTask(INTENT, "ship it");
    await vi.advanceTimersByTimeAsync(TASK_PROMPT_READY_TIMEOUT_MS + TASK_PROMPT_POLL_MS);

    expect((await running).outcome).toBe("prompt-not-sent");
    expect(written(pty)).not.toContain("ship it");
    expect(paneTaskPrompts.value.has(1)).toBe(false);
  });

  it("records nothing for a failed paste, and records it once the retry lands", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    let pasteSucceeds = false;
    const { tm, pty } = controllableWithPaste(infos, async () => pasteSucceeds);
    await tm.init();

    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    expect((await running).outcome).toBe("prompt-failed");
    expect(paneTaskPrompts.value.has(1)).toBe(false);

    pasteSucceeds = true;
    // A retry that lands is the same fact as a launch that landed, so the
    // retry path records too — otherwise the card of a pane whose FIRST paste
    // failed would print no Task line for the rest of its life.
    const tabKey = tabViews.value[0].key;
    expect(await tm.retryTaskPrompt(tabKey, "ship it", "claude")).toBe("prompt-pending");
    expect(paneTaskPrompts.value.get(1)).toBe("ship it");
  });

  it("forgets the prompt when the pane holding it closes", async () => {
    const infos = new Map<number, PaneProcessInfo>([
      [1, processInfo(1, "/repo", "claude", "agent", "claude")],
    ]);
    const { tm, pty } = controllableWithPaste(infos, async () => true);
    await tm.init();

    const running = tm.launchTask(INTENT, "ship it");
    await driveToIdle(tm, pty);
    expect((await running).outcome).toBe("prompt-pending");
    expect(paneTaskPrompts.value.get(1)).toBe("ship it");

    // A second pane so the tab survives the close, and pane 1 polling as an
    // explicit `idle-shell` so `confirmClose` skips its native dialog — jsdom
    // cannot answer one, and an unanswerable dialog refuses the close.
    await tm.splitActive("row");
    infos.set(2, processInfo(2, "/repo", "claude", "agent", "claude"));
    await driveToIdle(tm, pty, 2);
    infos.set(1, processInfo(1, "/repo", "zsh", "idle-shell", null));
    await tm.closePaneAt(0, 1);

    expect(paneTaskPrompts.value.has(1)).toBe(false);
  });
});
