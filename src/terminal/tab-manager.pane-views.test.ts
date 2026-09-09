// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneProcessInfo } from "../lib/process-info";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings } from "../settings/settings-store";
import { sendAgentNotification } from "../lib/native-notification";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import {
  flush,
  freshWindowFocusController,
  processInfo,
  setup,
  setupControllable,
} from "./tab-manager.fixtures";
import { noteTaskPrompt, paneTaskPrompts, resetTaskPrompts } from "./board-task-prompts";
import {
  installSessionTailSync,
  noteResumedPane,
  paneSessionIds,
  resetSessionTailStore,
} from "./session-tail-store";
import { activeTabIndex, tabViews } from "./tabs-store";

// The production-default notifier sends through this adapter, and an
// agent→shell poll latches `completed` — which is exactly what the third case
// drives. Mock it at the module boundary so no test here can ever reach the
// real Tauri notification API, whatever the `agentNotifications` setting says.
vi.mock("../lib/native-notification", () => ({
  sendAgentNotification: vi.fn(),
}));

// `lastSessionId` is the one projected field this layer does not compute: it
// is read off the session tail store, which only runs on a host that HAS the
// `session_tail` channel. Both facades are mocked exactly as
// `session-tail-store.test.ts` mocks them — `available` is read at call time
// inside `installSessionTailSync`, and `sessionTails` has to answer a pairing
// without touching the bridge. `addWorktree` is stubbed alongside it because
// other modules import it from the same facade.
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

// `init()` installs the file-drop listener and reads window focus, both of
// which reach into the Tauri window/webview facade. Local to this file, not
// imported from tab-manager.fixtures.ts: `beforeEach` reassigns
// `windowFocus`, and an ES import is a read-only live binding.
let windowFocus = freshWindowFocusController();

vi.mock("../host/window-host", () => ({
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
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/deck" });
  document.body.innerHTML = "";
  tabViews.value = [];
  activeTabIndex.value = 0;
  // Pane ids restart at 1 in every case, so a prompt left by an earlier one
  // would satisfy this file's assertions for free.
  resetTaskPrompts();
  // Same reason, one store over: a `lastSessionId` left by an earlier case
  // would satisfy this file's assertion for free.
  resetSessionTailStore();
  windowFocus = freshWindowFocusController();
  settings.value = DEFAULT_SETTINGS;
  vi.mocked(sendAgentNotification).mockClear();
});

// `processInfo(id, cwd, process, kind, agent)` is the fixtures file's own
// exported builder. Do NOT hand-write the literal: `explicitAgent` returns
// null unless `kind === "agent"` (`process-info.ts:108-110`), so a fixture
// missing it can never produce a `lastAgent`.
const CWD = "/Users/deck/deck";
const LEAF = { type: "leaf" } as const;
const agentInfo = (id: number, agent: string): PaneProcessInfo =>
  processInfo(id, CWD, agent, "agent", agent);
const shellInfo = (id: number): PaneProcessInfo => processInfo(id, CWD, "zsh", "idle-shell", null);

describe("PaneView ordinals, start time and last agent", () => {
  it("numbers each pane once and keeps the number across a split", async () => {
    const { tm } = setup({});
    await tm.materialize({ layout: null, cwds: [CWD] });
    await flush();
    const first = tabViews.value[0].panes?.[0].ordinal;
    expect(first).toBeGreaterThan(0);
    await tm.splitActive("row");
    await flush();
    const panes = tabViews.value[0].panes ?? [];
    expect(panes[0].ordinal).toBe(first);
    expect(panes[1].ordinal).toBeGreaterThan(first!);
    tm.dispose();
  });

  it("does not renumber the survivors when a pane closes", async () => {
    // Both panes must poll as `idle-shell`: `confirmClose` only skips its
    // native dialog when every target is explicitly one, and an unanswerable
    // dialog in jsdom refuses the close outright.
    const { tm } = setup({
      infos: new Map([
        [1, shellInfo(1)],
        [2, shellInfo(2)],
      ]),
    });
    await tm.materialize({ layout: null, cwds: [CWD] });
    await tm.splitActive("row");
    await flush();
    const kept = tabViews.value[0].panes?.[0].ordinal;
    const doomed = tabViews.value[0].panes?.[1].paneId ?? -1;
    await tm.closePaneAt(0, doomed);
    await flush();
    // Spec §5.2: the printed number is a RANK the model computes from these
    // ordinals; the ordinal itself never moves.
    expect(tabViews.value[0].panes).toHaveLength(1);
    expect(tabViews.value[0].panes?.[0].ordinal).toBe(kept);
    tm.dispose();
  });

  it("keeps the agent that left as lastAgent, and restarts startedAt for a new one", async () => {
    // `setupControllable` reads each pane's process live from the map on every
    // poll, which is how a test moves a pane from claude → shell → codex. Only
    // `init()` starts the recurring poller, so the idiom here is fake timers
    // plus `advanceTimersByTimeAsync`, exactly as the attention-tracker suite
    // does it — a bare `flush()` would never reach the next poll.
    vi.useFakeTimers();
    const infos = new Map<number, PaneProcessInfo>();
    const { tm } = setupControllable(infos);
    try {
      await tm.materialize({ layout: null, cwds: [CWD] });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);
      const paneId = tabViews.value[0].panes?.[0].paneId ?? -1;

      infos.set(paneId, agentInfo(paneId, "claude"));
      await vi.advanceTimersByTimeAsync(2000);
      const born = tabViews.value[0].panes?.[0].startedAt;
      expect(born).toBeGreaterThan(0);

      infos.set(paneId, shellInfo(paneId)); // the agent left; the shell is back
      await vi.advanceTimersByTimeAsync(2000);
      const gone = tabViews.value[0].panes?.[0];
      expect(gone?.agent).toBe("claude");
      expect(gone?.phase).toBe("exited");
      expect(gone?.lastAgent).toBe("claude");
      // A DEPARTURE is not a new generation — the card must not reset its uptime.
      expect(gone?.startedAt).toBe(born);

      infos.set(paneId, agentInfo(paneId, "codex"));
      await vi.advanceTimersByTimeAsync(2000);
      const next = tabViews.value[0].panes?.[0];
      expect(next?.lastAgent).toBe("codex");
      expect(next?.startedAt).toBeGreaterThan(born!);
    } finally {
      tm.dispose();
      vi.useRealTimers();
    }
  });

  it("drops the task prompt when a DIFFERENT agent takes the pane", async () => {
    // Spec §11.2: the prompt is dropped on pane close "or generation change".
    // Without the second half, a pane launched with a task for claude prints
    // claude's task on the card of whatever agent replaces it — the same
    // stale-pin failure as the 2026-08-22 rail bug, one store over.
    vi.useFakeTimers();
    const infos = new Map<number, PaneProcessInfo>();
    const { tm } = setupControllable(infos);
    try {
      await tm.materialize({ layout: null, cwds: [CWD] });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);
      const paneId = tabViews.value[0].panes?.[0].paneId ?? -1;

      infos.set(paneId, agentInfo(paneId, "claude"));
      await vi.advanceTimersByTimeAsync(2000);
      // Recorded the way `launchTask` records it, once the pane is claude's.
      noteTaskPrompt(paneId, "Refactor the rail model");
      expect(paneTaskPrompts.value.get(paneId)).toBe("Refactor the rail model");

      // The agent LEAVING is not a generation change: Restart resumes this
      // same conversation, and its card must keep saying what it was for.
      infos.set(paneId, shellInfo(paneId));
      await vi.advanceTimersByTimeAsync(2000);
      expect(paneTaskPrompts.value.get(paneId)).toBe("Refactor the rail model");

      // A different agent IS one.
      infos.set(paneId, agentInfo(paneId, "codex"));
      await vi.advanceTimersByTimeAsync(2000);
      expect(paneTaskPrompts.value.has(paneId)).toBe(false);
    } finally {
      tm.dispose();
      vi.useRealTimers();
    }
  });

  it("takes a restored pane's task prompt from the intent, zipped to leaves", async () => {
    // The other half of session restore's round trip: `restoreSession` has no
    // pane ids (`materialize` answers a boolean), so it hands the prompts in
    // zipped to leaves the way `paneCommands` already travels, and THIS layer
    // is where a leaf index becomes a pane id.
    const { tm } = setup({});
    await tm.materialize({
      layout: { type: "split", direction: "row", ratio: 0.5, first: LEAF, second: LEAF },
      cwds: [CWD, CWD],
      panePrompts: ["Ship the rail", null],
    });
    await flush();
    const ids = (tabViews.value[0].panes ?? []).map((pane) => pane.paneId);
    expect(ids).toHaveLength(2);
    expect(paneTaskPrompts.value.get(ids[0])).toBe("Ship the rail");
    expect(paneTaskPrompts.value.has(ids[1])).toBe(false);
    tm.dispose();
  });

  it("carries the session id the agent was running when it left", async () => {
    // Spec §11.11. The tail store deletes a pane's LIVE pairing at the
    // agent → shell transition, which is exactly when the Board starts
    // offering Restart — so the projection reads the id the store kept on its
    // way out, never `paneSessionIds`.
    vi.useFakeTimers();
    const infos = new Map<number, PaneProcessInfo>();
    const { tm } = setupControllable(infos);
    let stopTails: (() => void) | null = null;
    try {
      await tm.materialize({ layout: null, cwds: [CWD] });
      await tm.init();
      await vi.advanceTimersByTimeAsync(0);
      const paneId = tabViews.value[0].panes?.[0].paneId ?? -1;
      stopTails = installSessionTailSync();

      infos.set(paneId, agentInfo(paneId, "claude"));
      // A pane that has never reached `working` has `hasRun: false`, and the
      // store asks nothing about one — unless a restore path has said it
      // continues an existing conversation. That mark is what earns this pane
      // its one question, and the workspace path is read back rather than
      // guessed, because the mark is keyed on the TAB's own spelling of it.
      noteResumedPane(tabViews.value[0].workspacePath, "claude");
      // TWO polls for every step, because the two layers are not in step: the
      // poll publishes `tabViews` synchronously, and only then does the tail
      // store's own 300ms debounce start. The first advance lands the pane's
      // new process, the second lets the store answer for it.
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(paneSessionIds.value.get(paneId)).toBe("sess-abc");

      infos.set(paneId, shellInfo(paneId)); // the agent left; the shell is back
      // Same two-step, one layer further: the first poll publishes
      // `agent: null` while the field is still empty, the store forgets on its
      // debounce, and the next poll's `syncViews` projects what it kept.
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      const gone = tabViews.value[0].panes?.[0];
      expect(gone?.agent).toBe("claude");
      expect(gone?.phase).toBe("exited");
      expect(paneSessionIds.value.get(paneId)).toBeUndefined();
      expect(gone?.lastSessionId).toBe("sess-abc");
    } finally {
      stopTails?.();
      tm.dispose();
      vi.useRealTimers();
    }
  });

  it("carries the tracker's own confidence, never a guess", async () => {
    const { tm } = setup({ infos: new Map([[1, agentInfo(1, "claude")]]) });
    await tm.materialize({ layout: null, cwds: [CWD] });
    await flush();
    // `AttentionKind` has no `idle` member — the trust tier is the tracker's
    // `confidence` field (`agent-attention.ts:37`), projected, not re-derived.
    expect(tabViews.value[0].panes?.[0].confidence).toBe("explicit");
    tm.dispose();
  });
});
