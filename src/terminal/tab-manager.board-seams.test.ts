// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import type { Pane } from "./pane";
import type { CreatePaneFn } from "./pane-lifecycle";
import { activeTabIndex, tabViews, type PaneView } from "./tabs-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  fakePane,
  flush,
  freshWindowFocusController,
  processInfo,
  setup,
  setupControllable,
} from "./tab-manager.fixtures";
import {
  installSessionTailSync,
  noteResumedPane,
  resetSessionTailStore,
} from "./session-tail-store";

// Task 23: the production-default notifier sends through this adapter. Mock
// it at the module boundary so NO test can ever reach the real Tauri
// `@tauri-apps/plugin-notification` API, regardless of the
// `agentNotifications` setting's value at the time.
vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

// `restartPane` resumes the session the tail store kept on the agent's way
// out, so the Restart cases below have to drive that store for real. Both
// facades are mocked exactly as `tab-manager.pane-views.test.ts` mocks them —
// `available` is read at call time inside `installSessionTailSync`, and
// `sessionTails` has to answer a pairing without touching the bridge.
// `addWorktree` is stubbed alongside it because other modules import it from
// the same facade.
const tailHost = vi.hoisted(() => ({
  sessionTails: vi.fn(async () => [{ id: "sess-abc", tail: "what claude said", model: null }]),
}));

vi.mock("../host/worktree-host", () => ({
  available: true,
  addWorktree: async () => ({ ok: false, error: "unknown" }),
}));

vi.mock("../host/session-tail-host", () => ({
  sessionTails: () => tailHost.sessionTails(),
}));

// init() installs the file-drop listener, which reaches into the Tauri window
// and webview. Stub them so init() can register the pty output listener the
// unread tracking hangs off of. Local to this file, not imported from
// tab-manager.fixtures.ts: `beforeEach` below reassigns `windowFocus`, and an
// ES import is a read-only live binding — reassigning it from outside its
// declaring module isn't legal.
let windowFocus = freshWindowFocusController();

vi.mock("../host/window-host", () => ({
  // `getCurrentWindow` and `getCurrentWebview` were separate Tauri modules and
  // are now one facade, so a single factory must supply both — two vi.mock
  // calls for the same path would silently keep only the last.
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
  getCurrentWindow: () => ({
    scaleFactor: async () => 1,
    close: async () => {},
    isFocused: async () => {
      if (windowFocus.isFocusedError) {
        throw windowFocus.isFocusedError;
      }
      return windowFocus.initialFocused;
    },
    onFocusChanged: async (handler: (event: { payload: boolean }) => void) => {
      if (windowFocus.onFocusChangedError) {
        throw windowFocus.onFocusChangedError;
      }
      windowFocus.emitFocusChanged = (focused) => handler({ payload: focused });
      return windowFocus.unlistenFocus;
    },
  }),
}));

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
  document.body.innerHTML = "";
  // `tabViews`/`activeTabIndex` are window-scoped module globals, so a case
  // that forgot to reset them would read the previous case's tabs.
  tabViews.value = [];
  activeTabIndex.value = 0;
  windowFocus = freshWindowFocusController();
  settings.value = DEFAULT_SETTINGS;
  // Pane ids restart at 1 in every case, so a `lastSessionId` left behind by
  // an earlier one would satisfy a Restart assertion for free.
  resetSessionTailStore();
  vi.mocked(sendAgentNotification).mockClear();
});

/**
 * The pane view at `[tab][pane]`. `TabView.panes` is optional — a view built
 * by a seed fixture predates the field — so every read needs a guard, and a
 * throw here names the missing pane instead of failing on `undefined`.
 */
function paneAt(tabIndex: number, paneIndex: number): PaneView {
  const pane = tabViews.value[tabIndex]?.panes?.[paneIndex];
  if (pane === undefined) {
    throw new Error(`no pane ${paneIndex} in tab ${tabIndex}`);
  }
  return pane;
}

/** One recognized `claude` pane, which is what opens the tracker's process gate. */
function agentInfos(...ids: readonly number[]): Map<number, PaneProcessInfo> {
  return new Map(ids.map((id) => [id, processInfo(id, "/repo", "claude", "agent", "claude")]));
}

/**
 * A pane factory that records what the manager did to each pane, over the
 * fixture's own `fakePane`.
 *
 * The `writes` map is what the cases below assert on, which is why the
 * override stays even though the fixture's own pane now accumulates a real
 * buffer: the buffer answers `serializeScrollback`, it does not report per-id
 * what was written.
 */
function recordingPanes(): {
  createPane: CreatePaneFn;
  writes: Map<number, string>;
  disposed: Set<number>;
} {
  const writes = new Map<number, string>();
  const disposed = new Set<number>();
  const createPane: CreatePaneFn = (id, _settings, events) => {
    const base = fakePane(id, events);
    const pane: Pane = {
      ...base,
      write(data) {
        writes.set(id, (writes.get(id) ?? "") + data);
      },
      // Kept in step with `write` above, so a pane built here answers its own
      // recorded output rather than the base fake's separate buffer.
      serializeScrollback() {
        return writes.get(id) ?? "";
      },
      dispose() {
        disposed.add(id);
        base.dispose();
      },
    };
    return pane;
  };
  return { createPane, writes, disposed };
}

/**
 * Spec §5.4/§5.5: selecting a Board card moves neither the tab nor the
 * manager's active pane, so the panel reads and writes a pane whose tab is
 * NOT on the stage. An earlier draft of the wiring plan added a
 * `selectPaneUnderSurface` seam on the theory that the panel's snapshot needs
 * the pane mounted — these cases are the experiment that decides it. If they
 * fail, the spec's selection model needs an amendment.
 */
describe("a pane in a tab that is not on the stage", () => {
  it("stays alive behind display:none and keeps taking output", async () => {
    const { createPane, writes, disposed } = recordingPanes();
    const { tm, pty } = setup({ infos: agentInfos(1, 2), deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    const hidden = tm.activePaneId() as number;
    await tm.materialize({ layout: null, cwds: ["/repo"] }); // tab 2 takes the stage
    await tm.init();
    await flush();

    // `TerminalManager.hide()` is `container.style.display = "none"` and
    // nothing else — the tab's xterm instances are never torn down.
    const stages = [...document.querySelectorAll<HTMLElement>(".tab-stage")];
    expect(stages.length).toBe(2);
    expect(stages[0].style.display).toBe("none");
    expect(stages[1].style.display).not.toBe("none");
    expect(disposed.has(hidden)).toBe(false);

    // Output that arrives while the tab is off the stage still reaches the
    // pane, so its buffer is current when the panel reads it.
    pty.emitOutput(hidden, "from the hidden tab\r\n");
    expect(writes.get(hidden)).toContain("from the hidden tab");
    // And the panel can READ it from there, which is the other half of the
    // experiment: no selection seam is needed because the snapshot resolves by
    // pane id, not through whichever tab holds the stage.
    expect(tm.serializePane(hidden, 20)).toContain("from the hidden tab");

    tm.dispose();
  });

  it("still accepts an injected reply", async () => {
    const { createPane } = recordingPanes();
    const { tm, pty } = setup({ infos: agentInfos(1, 2), deps: { createPane } });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    const hidden = tm.activePaneId() as number;
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();

    // `pasteIntoPane` resolves through `life.panes.get(id)`, never through the
    // active tab — which is why the reply box needs no selection seam either.
    await expect(
      tm.injectIntoPane(hidden, "hello", { autoSend: false, expectedAgent: null }),
    ).resolves.toBe("pasted");
    await flush();
    expect(pty.writes.some((write) => write.id === hidden && write.data.includes("hello"))).toBe(
      true,
    );

    tm.dispose();
  });
});

describe("acknowledgePane", () => {
  it("clears one pane's attention and syncs the views", async () => {
    // `emitSignal` goes through the real `onAttentionSignal` wiring, and the
    // tracker's process gate only opens for a pane a poll recognised as an
    // agent — so `infos` must name one, and `init()` must have started the
    // poll before the signal arrives.
    const { tm, emitSignal } = setup({ infos: agentInfos(1) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    const target = paneAt(0, 0).paneId;

    emitSignal(target, { kind: "requested", source: "osc-notification" });
    await flush();
    expect(paneAt(0, 0).attention).toBe("requested");

    tm.acknowledgePane(target);
    await flush();
    // `AttentionKind` is "none" | "completed" | "requested" | "warning" |
    // "error" — `"idle"` is the RAIL's word, not this layer's.
    expect(paneAt(0, 0).attention).toBe("none");

    tm.dispose();
  });

  it("resets the notifier's latch identity, so the next request notifies again", async () => {
    // The ack has to route through `maybeNotify`, the same choke point
    // `onPaneFocus` uses. That function dedupes on the LATCH IDENTITY it
    // keeps in `lastNotifiedKind`, and only a snapshot of "none" resets it —
    // so an ack that skipped the call would leave the key at "requested" and
    // the pane's NEXT request would be dropped as a phase-only re-emit. A
    // Board ack would then silently disable that pane's notifications.
    settings.value = { ...DEFAULT_SETTINGS, agentNotifications: true };
    windowFocus.initialFocused = false; // the notifier is background-only
    const { tm, emitSignal } = setup({ infos: agentInfos(1) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    const target = paneAt(0, 0).paneId;

    emitSignal(target, { kind: "requested", source: "osc-notification" });
    await flush();
    expect(vi.mocked(sendAgentNotification).mock.calls.length).toBe(1);

    tm.acknowledgePane(target);
    await flush();
    emitSignal(target, { kind: "requested", source: "osc-notification" });
    await flush();
    expect(vi.mocked(sendAgentNotification).mock.calls.length).toBe(2);

    tm.dispose();
  });

  it("is a no-op for a pane this window does not hold", async () => {
    const { tm } = setup({ infos: agentInfos(1) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    // Identity, not equality: `syncViews` always assigns a fresh array, so
    // the same reference is what proves no sync ran. `not.toThrow()` alone
    // cannot discriminate — `tracker.acknowledge` already answers null for an
    // unknown pane.
    const before = tabViews.value;
    expect(() => tm.acknowledgePane(9999)).not.toThrow();
    await flush();
    expect(tabViews.value).toBe(before);

    tm.dispose();
  });

  it("does not change the active tab", async () => {
    const { tm, emitSignal } = setup({ infos: agentInfos(1, 2) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    const other = paneAt(0, 0).paneId;
    emitSignal(other, { kind: "requested", source: "osc-notification" });
    await flush();

    tm.acknowledgePane(other);
    await flush();
    // Spec §5.4: acknowledging from the Board moves neither the tab nor the
    // manager's active pane.
    expect(activeTabIndex.value).toBe(1);
    expect(paneAt(0, 0).attention).toBe("none");

    tm.dispose();
  });
});

describe("serializePane and paneAlive", () => {
  it("strips colour out of the snapshot", async () => {
    const { tm, pty } = setup({ infos: agentInfos(1) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    const id = paneAt(0, 0).paneId;

    // A red word followed by a plain one. The escape is written as a JS
    // escape on purpose — a literal control byte in a test file is invisible
    // in a diff and unsearchable.
    pty.emitOutput(id, "\x1b[31mred\x1b[0m plain\r\n");

    const snapshot = tm.serializePane(id, 10);
    expect(snapshot).not.toBeNull();
    expect(snapshot).toContain("red plain");
    expect(snapshot).not.toContain("\x1b");

    tm.dispose();
  });

  it("keeps only the last rows, trailing blank ones trimmed", async () => {
    const { tm, pty } = setup({ infos: agentInfos(1) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    const id = paneAt(0, 0).paneId;

    // The serialize addon answers the requested scrollback PLUS the whole
    // viewport, so the raw string runs past `lines` and usually ends in blank
    // rows. Spec §7.3: the panel shows the last N rows, trimmed.
    pty.emitOutput(id, "one\r\ntwo\r\nthree\r\nfour\r\n\r\n\r\n");

    expect(tm.serializePane(id, 2)).toBe("three\nfour");

    tm.dispose();
  });

  it("answers null for a pane no tab holds", async () => {
    const { tm } = setup({ infos: agentInfos(1) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();

    expect(tm.serializePane(9999, 10)).toBeNull();
    expect(tm.paneAlive(9999)).toBe(false);

    tm.dispose();
  });

  it("still answers for a pane whose PTY exited, and paneAlive says it is gone", async () => {
    const { tm, pty } = setup({ infos: agentInfos(1) });
    await tm.materialize({ layout: null, cwds: ["/repo"] });
    await tm.init();
    await flush();
    const id = paneAt(0, 0).paneId;
    pty.emitOutput(id, "last words\r\n");
    // The before-check is the discriminator: without it, "an exited pane still
    // answers" passes trivially for a pane whose exit path never ran.
    expect(tm.paneAlive(id)).toBe(true);

    pty.emitExit(id);
    await flush();

    // The panel's whole job is showing what the agent last said — an exited
    // pane keeps its buffer, so `serializePane` is NOT gated on the exit.
    const snapshot = tm.serializePane(id, 40);
    expect(snapshot).toContain("last words");
    // `handleExit` writes its banner with a yellow SGR pair; the tab layer
    // strips it, which proves the exit path ran AND that stripping reaches
    // output the manager itself produced.
    expect(snapshot).toContain("[Session ended");
    expect(snapshot).not.toContain("\x1b");
    expect(tm.paneAlive(id)).toBe(false);

    tm.dispose();
  });
});

/**
 * `processInfo(id, cwd, process, kind, agent)` is the fixtures file's own
 * builder. Do NOT hand-write the literal: `explicitAgent` returns null unless
 * `kind === "agent"` (`process-info.ts:108-110`), so a fixture missing it can
 * never produce a `lastAgent` and Restart would refuse for the wrong reason.
 */
const agentInfo = (id: number, agent: string): PaneProcessInfo =>
  processInfo(id, "/repo", agent, "agent", agent);
const shellInfo = (id: number): PaneProcessInfo =>
  processInfo(id, "/repo", "zsh", "idle-shell", null);

/** Everything written into one pane, in order. */
function writesTo(pty: { writes: readonly { id: number; data: string }[] }, id: number): string[] {
  return pty.writes.filter((write) => write.id === id).map((write) => write.data);
}

/**
 * A pane whose `claude` has left and whose shell is back — the only state in
 * which Restart is offered.
 *
 * `setupControllable` reads each pane's process live from the map on every
 * poll, which is how a case moves a pane from claude → shell; only `init()`
 * starts the recurring poller, so the idiom is fake timers plus
 * `advanceTimersByTimeAsync`, exactly as `tab-manager.pane-views.test.ts`
 * does it. `withTail` drives the REAL session tail store, because
 * `lastSessionId` is the one input `restartPane` cannot be handed: there is no
 * setter, and the store only keeps an id it saw on the pairing's way out.
 */
async function departedAgentPane(options: { withTail: boolean; launchCommand?: string }): Promise<{
  tm: ReturnType<typeof setupControllable>["tm"];
  pty: ReturnType<typeof setupControllable>["pty"];
  paneId: number;
  stop: () => void;
}> {
  const infos = new Map<number, PaneProcessInfo>();
  const { tm, pty } = setupControllable(infos);
  await tm.materialize({
    layout: null,
    cwds: ["/repo"],
    ...(options.launchCommand === undefined ? {} : { launchCommand: options.launchCommand }),
  });
  await tm.init();
  await vi.advanceTimersByTimeAsync(0);
  const paneId = paneAt(0, 0).paneId;
  const stopTails = options.withTail ? installSessionTailSync() : null;

  infos.set(paneId, agentInfo(paneId, "claude"));
  if (options.withTail) {
    // A pane that has never reached `working` has `hasRun: false`, and the
    // store asks nothing about one unless a restore path has said it continues
    // an existing conversation. That mark is what earns this pane its one
    // question.
    noteResumedPane(tabViews.value[0].workspacePath, "claude");
  }
  // TWO polls per step, because the two layers are not in step: the poll
  // publishes `tabViews` synchronously, and only then does the tail store's
  // own 300ms debounce start.
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(2000);

  infos.set(paneId, shellInfo(paneId)); // the agent left; the shell is back
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(2000);

  return {
    tm,
    pty,
    paneId,
    stop: () => {
      stopTails?.();
      tm.dispose();
    },
  };
}

describe("restartPane", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resumes the exact session the departed agent was running", async () => {
    // Spec §11.10. The discriminating assertion of this whole task: the id
    // comes from what the tail store KEPT on the agent's way out, never from
    // the live pairing, which `forget` empties at this exact transition.
    // Reading that map instead would silently degrade every Restart to
    // `--continue` and resume whatever conversation the CLI touched last.
    const { tm, pty, paneId, stop } = await departedAgentPane({ withTail: true });
    try {
      expect(paneAt(0, 0).lastSessionId).toBe("sess-abc");
      await expect(tm.restartPane(paneId)).resolves.toBe(true);
      expect(writesTo(pty, paneId)).toContain("claude --resume sess-abc\r");
    } finally {
      stop();
    }
  });

  it("asks for the LATEST session when no id was kept — never a bare relaunch", async () => {
    // No tail sync ran, so the store never saw a pairing. `--continue` is the
    // honest ask; a bare `claude` would start a new conversation under a label
    // that says it resumes one.
    const { tm, pty, paneId, stop } = await departedAgentPane({ withTail: false });
    try {
      await expect(tm.restartPane(paneId)).resolves.toBe(true);
      expect(writesTo(pty, paneId)).toContain("claude --continue\r");
    } finally {
      stop();
    }
  });

  it("folds the pane's own launch flags back in", async () => {
    const { tm, pty, paneId, stop } = await departedAgentPane({
      withTail: false,
      launchCommand: "claude --dangerously-skip-permissions",
    });
    try {
      await expect(tm.restartPane(paneId)).resolves.toBe(true);
      expect(writesTo(pty, paneId)).toContain("claude --continue --dangerously-skip-permissions\r");
    } finally {
      stop();
    }
  });

  it("refuses while the agent is still running", async () => {
    // Restart exists for a pane whose agent has LEFT. Without this guard a
    // live claude would be handed `claude --continue` at its own prompt.
    const infos = new Map<number, PaneProcessInfo>();
    const { tm, pty } = setupControllable(infos);
    try {
      await tm.materialize({ layout: null, cwds: ["/repo"] });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);
      const paneId = paneAt(0, 0).paneId;
      infos.set(paneId, agentInfo(paneId, "claude"));
      await vi.advanceTimersByTimeAsync(2000);

      await expect(tm.restartPane(paneId)).resolves.toBe(false);
      expect(writesTo(pty, paneId)).toHaveLength(0);
    } finally {
      tm.dispose();
    }
  });

  it("refuses a pane whose PTY has exited", async () => {
    // `ownerOf` still finds it — the tab holds the pane until it is closed —
    // and `lastAgent` is still set, so nothing else in the guard chain would
    // stop a write into a dead PTY.
    const { tm, pty, paneId, stop } = await departedAgentPane({ withTail: false });
    try {
      const before = writesTo(pty, paneId).length;
      pty.emitExit(paneId);
      await vi.advanceTimersByTimeAsync(0);
      expect(tm.paneAlive(paneId)).toBe(false);

      await expect(tm.restartPane(paneId)).resolves.toBe(false);
      expect(writesTo(pty, paneId)).toHaveLength(before);
    } finally {
      stop();
    }
  });

  it("refuses a pane that never ran an agent", async () => {
    const infos = new Map<number, PaneProcessInfo>();
    const { tm, pty } = setupControllable(infos);
    try {
      await tm.materialize({ layout: null, cwds: ["/repo"] });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);
      const paneId = paneAt(0, 0).paneId;
      infos.set(paneId, shellInfo(paneId));
      await vi.advanceTimersByTimeAsync(2000);

      await expect(tm.restartPane(paneId)).resolves.toBe(false);
      expect(writesTo(pty, paneId)).toHaveLength(0);
    } finally {
      tm.dispose();
    }
  });

  it("refuses a pane this window does not hold", async () => {
    const { tm } = setup({ infos: agentInfos(1) });
    try {
      await tm.materialize({ layout: null, cwds: ["/repo"] });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);
      await expect(tm.restartPane(9999)).resolves.toBe(false);
    } finally {
      tm.dispose();
    }
  });
});
