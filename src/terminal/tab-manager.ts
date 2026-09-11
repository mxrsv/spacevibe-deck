import { getCurrentWindow } from "../host/window-host";
import type { UnlistenFn } from "../host/bridge";
import { clampFontSize, DEFAULT_SETTINGS } from "../settings/settings-schema";
import { settings, revealDockTab, toggleDock, updateSettings } from "../settings/settings-store";
import { type Direction, type Edge, type SerializedNode } from "../lib/split-tree";
import {
  explicitAgent,
  processLabel,
  type PaneAgent,
  type PaneProcessInfo,
} from "../lib/process-info";
import { capTaskPrompt, type SessionTab } from "../lib/session-schema";
import type { DetachTarget } from "./pane-detach";
import { defaultTransferClient } from "./transfer-client";
import { normalizeWorkspacePath, workspaceLabel } from "../lib/workspace-label";
import { nextOpenSequence, UNSEQUENCED } from "../lib/open-sequence";
import { mergeStripOrder, stripPreferences, type StripSlot } from "../lib/strip-order";
import { lastRows, stripAnsiSequences } from "../lib/strip-ansi-sequences";
import { sendAgentNotification } from "../lib/native-notification";
import { getDesktopEnvironment } from "../lib/platform";
import { BUILT_IN_PRESET } from "../lib/preset-schema";
import { agentForWorkspace, type AgentChoice } from "../lib/workspace-recents";
import { workspacesData } from "../open-board/workspaces-store";
import {
  agentOptions,
  agentProcessMatchers,
  probeNames,
  resolveAgentCommand,
} from "../lib/agent-catalog";
import { agentLaunchCommand, resolveLaunchCommand } from "../lib/launch-command";
import { countAgentLaunch } from "../telemetry/usage-counters";
import { createAgentRegistrySync } from "./agent-registry-sync";
import { agentRegistry as fetchAgentRegistry } from "../host/agent-registry-host";
import { UNAVAILABLE_REGISTRY } from "../lib/agent-registry";
import { augmentLaunchCommand, mintsClaudeSession, needsOpencodePort } from "../lib/launch-augment";
import {
  agentSignalConfig as fetchSignalConfig,
  available as signalsHostAvailable,
  listenHookEvents as listenHostHookEvents,
  NO_SIGNAL_CONFIG,
  opencodeAttach as hostOpencodeAttach,
} from "../host/agent-signals-host";
import { contractSignalOf, type HookEvent } from "../lib/agent-signal-map";
import { lastSessionIdFor, noteExplicitTail } from "./session-tail-store";
import { usageConsentOpen } from "../telemetry/consent-store";
import { matchBinding, selectTabIndex, type ShortcutAction } from "./keymap";
import { TIER_RANK } from "./action-registry";
import {
  isActionPerformable,
  type PerformableContext,
  type StageOwner,
} from "./action-performable";
import { installFileDrop } from "./file-drop";
import { createTerminalManager, type TerminalManager } from "./terminal-manager";
import { createPaneInfoPoller } from "./pane-info-poller";
import { createAgentActivity } from "./agent-activity";
import {
  createAgentAttentionTracker,
  type AttentionKind,
  type PaneAttentionSnapshot,
} from "./agent-attention";
import { createAgentNotifier, type AgentNotifier } from "./agent-notifier";
import type { PaneAttentionSignal } from "./pane";
import { popClosedTab, pushClosedTab, type ClosedTabSnapshot } from "./closed-tabs";
import { confirmClose } from "./close-guard";
import { createCloseCoordinator } from "./close-coordinator";
import { activeAfterClose } from "./tab-close";
import { freshCwd, freshPaneInfo } from "./pane-info";
import { forgetTaskPrompt, noteTaskPrompt, paneTaskPrompts } from "./board-task-prompts";
import { restartCommandFor } from "./pane-restart";
import {
  launchClearsDraft,
  promptReadyToSend,
  TASK_PROMPT_AUTOSEND,
  TASK_PROMPT_POLL_MS,
  TASK_PROMPT_READY_TIMEOUT_MS,
  TASK_PROMPT_STAGING_ENABLED,
  type LaunchTaskOutcome,
  type LaunchTaskResult,
} from "./task-prompt-send";
import { defaultPtyClient, type PtyClient } from "./pty-client";
import { submitAllowed, type InjectOutcome } from "../prompts/inject";
import { defaultBrowserClient } from "../browser/browser-client";
import { sessionsSupported } from "../sessions/sessions-store";
import {
  activateBrowserSurface,
  browserOpen,
  browserSurfaceActive,
  deactivateBrowserSurface,
  openBrowser,
} from "../browser/browser-store";
import {
  agentBoardSurfaceActive,
  openAgentBoard,
  stepAgentBoardBack,
} from "../ui/agent-board-store";
import { createAgentLauncher, type AgentLaunchEntry } from "./agent-launch";
import {
  buildClosedTabSnapshot,
  capturePresetLayout,
  materializeChromeFrom,
  resolvePaneCwds,
  type MaterializeIntent,
} from "./tab-materialize";
import {
  activeTabIndex,
  applyTabOverride,
  statusInfo,
  tabViews,
  type PaneView,
  type TabOverride,
} from "./tabs-store";
import {
  agentQuickPickerOpen,
  boardOpen,
  editorRequest,
  promptsOpen,
  reportChromeMessage,
  saveDialogOpen,
  settingsOpen,
  shortcutCaptureActive,
} from "../chrome/events";
import { toggleQuickLaunch } from "../launcher/launcher-store";
import { INERT_SURFACES, type SurfaceEditCommand } from "./surface-strip";
import {
  type TabEntry,
  type OpenFromPresetOptions,
  type TabManagerDeps,
  type TabManager,
} from "./tab-manager-types";
import { ACTION_SCOPE, DESTRUCTIVE_ACTIONS, COMMAND_ACTIONS } from "./tab-action-scope";

// The module-scope header that used to live here (types + pure constants
// above `createTabManager`) moved out 2026-08-16 for file size:
// `SurfaceStrip`/`INERT_SURFACES` → surface-strip.ts; `TabEntry`/
// `OpenFromPresetOptions`/`TabManagerDeps`/`TabManager` → tab-manager-types.ts;
// `ACTION_SCOPE`/`DESTRUCTIVE_ACTIONS`/`COMMAND_ACTIONS`/`DISPATCHABLE_ACTIONS`
// → tab-action-scope.ts; `explicitAgent`/`processLabel` folded into the
// existing `lib/process-info.ts`. Re-exported below so shipping consumers of
// this module keep their import path unchanged. `DISPATCHABLE_ACTIONS` is
// NOT re-exported: its only two importers are tests, updated to import it
// from tab-action-scope.ts directly. `createTabManager` itself — the load-
// bearing R4 seam — did not move.
export type { SurfaceStrip, SurfaceEditCommand } from "./surface-strip";
export type { OpenFromPresetOptions, TabManagerDeps, TabManager } from "./tab-manager-types";

const WINDOWS_AGENT_TIMEOUT_MESSAGE =
  "PowerShell was not ready in time. Launch the agent manually.";
const WINDOWS_STARTUP_POLL_FALLBACK_MS = 4000;
/**
 * How long after a launch command is typed the second `pty_info` poll runs
 * (trust audit §4.5). One second is inside every agent's boot time on the
 * owner's machine and half the recurring poll's tick, so the attention gate
 * opens before the agent's first turn rather than up to 2 s after it.
 */
const LAUNCH_FOLLOW_UP_POLL_MS = 1000;

/**
 * A v4 uuid for `claude --session-id` (stage 2, spec §10.2). `randomUUID`
 * where the runtime has it; otherwise built from `getRandomValues`, which
 * every renderer and test environment provides.
 */
function mintSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createTabManager(
  host: HTMLElement,
  pty: PtyClient = defaultPtyClient,
  deps: TabManagerDeps = {},
): TabManager {
  const tabs: TabEntry[] = [];
  const unlisteners: UnlistenFn[] = [];
  const promptStaging = deps.promptStaging ?? TASK_PROMPT_STAGING_ENABLED;
  const surfaces = deps.surfaces ?? INERT_SURFACES;
  const transfer = deps.transfer ?? defaultTransferClient;
  const closeWindow = deps.closeWindow ?? (() => getCurrentWindow().close());
  // Per-tab user overrides (rename, dot color), keyed by tab key —
  // merged over process-derived values on every syncViews.
  const overrides = new Map<number, TabOverride>();
  // Tabs with output arrived while in the background, keyed by tab key.
  // In-memory only (like busy) — a background pane's output lights the badge,
  // opening the tab clears it.
  const unread = new Set<number>();
  // UI instances can disappear and reopen while an async injection is still
  // running. This manager-level lock keeps the invariant alive across those
  // remounts and rejects overlap before a second paste reaches the write queue.
  const injectingPanes = new Set<number>();
  // Per-pane ordinal (spec §11.1) — the window's open-order rank, allocated
  // once and never reused. `TabView.openedAt` exists once per TAB and cannot
  // number the panes inside one, so this is a second reader of the same clock,
  // not a second clock. A plain Map in this per-window closure (R5), not a
  // signal: nothing renders off it directly, so there is no write to schedule
  // and no ordering trap. Named `…ById` because `allPaneIds()` is already a
  // function in this closure and the two must not read alike.
  const paneOrdinalById = new Map<number, number>();
  // Per-pane agent generation (spec §11.1, §11.11). `startedAt` is when the
  // CURRENT agent generation began and `agent` is the one it runs (or ran);
  // both are keyed by pane id and dropped with the pane. Kept here rather than
  // on the attention tracker because the tracker's own generation boundary is
  // about attention latches, and reading it would couple the Board's uptime to
  // when a pane last got someone's attention.
  interface PaneGeneration {
    readonly agent: PaneAgent;
    readonly startedAt: number;
    readonly sessionId?: string;
    readonly running: boolean;
  }
  const paneGenerations = new Map<number, PaneGeneration>();
  // An incomplete task handoff belongs to the exact pane that received (or
  // should receive) the prompt, not merely to the tab. A split can replace
  // pane 1 with another instance of the same agent; resolving the tab's first
  // or active pane would then retry or focus an unrelated session.
  interface TaskPromptTarget {
    readonly paneId: number;
    readonly processId: number;
    readonly cwd: string;
    readonly agent: string;
  }
  interface TaskPromptDelivery {
    readonly outcome: LaunchTaskOutcome;
    readonly target: TaskPromptTarget | null;
  }
  const taskPromptTargetByTab = new Map<number, TaskPromptTarget>();
  // One shared clock behind both the activity tracker and the attention
  // tracker: activity-transition `observedAt` and the attention gate's
  // `gateOpenedAt` are compared directly, so they must read the same time
  // source (production = Date.now).
  const now = () => Date.now();
  // Per-pane "actually working" signal (OSC 9;4 progress reports from the
  // agent, else sustained non-echo output) — gates the sidebar spinner so an
  // agent sitting idle at its prompt doesn't spin forever.
  const activity = createAgentActivity({ now });
  // TabManager is the SOLE owner of the Agent Attention Rail tracker. It is
  // fed from the same output / process-poll / exit paths as `activity`, but
  // every input passes a process gate: activity and signals only count once a
  // poll has recognised the pane's foreground process as an agent.
  const tracker = createAgentAttentionTracker({ now });
  // Injected notifier wins (tests); production default reads the setting and
  // window focus LIVE (function seams, not captured values) and sends
  // through Task 20's permission-guarded Tauri adapter.
  const notifier: AgentNotifier =
    deps.notifier ??
    createAgentNotifier({
      isEnabled: () => settings.value.agentNotifications,
      isWindowFocused: () => windowFocused,
      send: sendAgentNotification,
    });
  // Working→idle can expire with no event attached (3s of silence). The 2s
  // poll usually resyncs, but a one-shot timer per pane makes the transition
  // self-sufficient even if pty_info is failing — keyed by pane so a chatty
  // neighbor pane can't keep pushing another pane's expiry away.
  const activityResync = new Map<number, ReturnType<typeof setTimeout>>();
  // A Windows process census forks another PowerShell. Keep that cold WMI
  // child away from newly spawned ConPTY shells until their injected prompt
  // proves the profile has finished, with a bounded fallback if the marker is
  // lost. The host `pty_info` command itself remains unrestricted for close,
  // quit and task-prompt callers outside this renderer poller.
  const windowsStartupPollFallbacks = new Map<number, ReturnType<typeof setTimeout>>();
  // The prompt marker can beat the spawn IPC response, so the pane id is not
  // always available to `deferWindowsStartupPoll` when readiness arrives.
  const windowsStartupReady = new Set<number>();
  // Cover the whole async spawn, not only the period after its pane ids have
  // returned to the renderer. Otherwise the recurring poll can fork WMI while
  // ConPTY and the PowerShell profile are still starting.
  let windowsStartupSpawns = 0;
  // Panes write user input through this wrapper so the tracker can tell
  // keystroke echo from real output; everything else passes straight through.
  const paneIo: PtyClient = {
    ...pty,
    writePty(id, data) {
      activity.noteInput(id);
      return pty.writePty(id, data);
    },
  };
  // Recently closed tabs (Cmd+Shift+T), newest last; in-memory only.
  let closedTabs: readonly ClosedTabSnapshot[] = [];
  let nextKey = 1;
  let active = -1;
  const environment = getDesktopEnvironment();
  const home = environment.homeDir;
  // Fail-safe = focused: an unanswerable/unregisterable window-focus check
  // must never suppress the in-app rail — only native notifications (Task
  // 23) key off this beyond `onPaneFocus`'s ack gate.
  let windowFocused = true;
  // dispose() can run while init()'s `await listen(...)` is still in flight
  // (e.g. a remount mid-init) — guards against pushing a listener into an
  // `unlisteners` array that's already been drained, which would leak it.
  let disposed = false;
  // Types the chosen agent into each new pane's shell once its prompt is up.
  // Through paneIo so its synthetic keystrokes ("claude\r") count as input —
  // the echo suppression then keeps the launch echo out of the spinner.
  const reportAgentLaunchTimeout = deps.onAgentLaunchTimeout ?? reportChromeMessage;
  // The second poll a launch schedules (trust audit §4.5), keyed by pane so a
  // relaunch into the same pane replaces rather than stacks it, and cleared on
  // dispose so a torn-down manager never polls a dead host.
  const launchFollowUpPolls = new Map<number, ReturnType<typeof setTimeout>>();
  const launcher = createAgentLauncher(paneIo, {
    platform: environment.platform,
    onTimeout: () => {
      reportAgentLaunchTimeout(WINDOWS_AGENT_TIMEOUT_MESSAGE);
    },
    onFire: (id) => {
      // The startup blind window (trust audit §4.5): the attention gate opens
      // on the poll that first finds the agent in the foreground, and the
      // recurring poll runs every 2 s. An agent that starts working — or
      // prints its startup OSC clear — before that tick was invisible for a
      // whole run. Poll at once (usually still the shell) and again a second
      // later (usually the agent), so the gate opens within the CLI's own
      // boot time; `noteProcess`'s seed carries anything the activity module
      // saw in between. On Windows the launcher fires only after the prompt
      // marker, which is also what releases the startup poll deferral, so
      // this never forks a WMI census in front of a profile still loading.
      void poller.poll();
      const pending = launchFollowUpPolls.get(id);
      if (pending !== undefined) {
        clearTimeout(pending);
      }
      launchFollowUpPolls.set(
        id,
        setTimeout(() => {
          launchFollowUpPolls.delete(id);
          if (!disposed) {
            void poller.poll();
          }
        }, LAUNCH_FOLLOW_UP_POLL_MS),
      );
    },
  });

  // ---- Agent-signal adapters (stage 2) ------------------------------------
  // The launch config main answered at `init()` — the `--settings` file a
  // Claude launch is augmented with — cached because `arm` happens inside a
  // materialize that must not wait on a round trip; a launch armed before
  // the answer lands goes out un-augmented rather than late. The two seams
  // default to the host facade, which answers "no adapter" where the host
  // cannot (Tauri, the browser preview), and `null` disables that half.
  let signalConfig = NO_SIGNAL_CONFIG;
  const signalConfigFetch = deps.signalConfig === undefined ? fetchSignalConfig : deps.signalConfig;
  const opencodeAttach =
    deps.opencodeAttach === undefined ? hostOpencodeAttach : deps.opencodeAttach;
  const hookEventsListen = deps.hookEvents === undefined ? listenHostHookEvents : deps.hookEvents;
  // Stages 1–3 are Electron-only (spec §8): a host with no `agent_signal_config`
  // — Tauri, the browser preview, the test harness — arms the user's command
  // exactly as before, synchronously, with no minted id and no flag appended.
  const signalsEnabled =
    deps.signalConfig === undefined ? signalsHostAvailable : deps.signalConfig !== null;

  /**
   * Arm each pane's command, augmented at ARM time with the flags that make
   * its CLI report to Deck (spec §4 stage 2; `launch-augment.ts`). The user's
   * own command is what `launchCommandByPane` and the journal hold — the
   * augmented string exists only here and in the shell it is typed into.
   * An opencode pane asks main for a port first; a fresh Claude launch mints
   * its session id here, and the tracker holds it until the gate opens.
   */
  async function prepareLaunch({ id, command }: AgentLaunchEntry): Promise<AgentLaunchEntry> {
    if (!signalsEnabled) return { id, command };
    const adapters = settings.value.agentSignalAdapters;
    const platform = environment.platform;
    if (command === null) {
      return { id, command: null };
    }
    let opencodePort: number | null = null;
    if (opencodeAttach !== null && needsOpencodePort(command, adapters)) {
      opencodePort = await opencodeAttach(id).catch(() => null);
    }
    const sessionId =
      platform !== "windows" && mintsClaudeSession(command, adapters) ? mintSessionId() : null;
    const augmented = augmentLaunchCommand(command, {
      adapters,
      platform,
      claudeSettingsPath: signalConfig.claudeSettingsPath,
      sessionId,
      opencodePort,
    });
    if (augmented.sessionId !== null) {
      tracker.noteMintedSession(id, augmented.sessionId);
    }
    return { id, command: augmented.command };
  }

  async function armLaunch(entries: readonly AgentLaunchEntry[]): Promise<void> {
    if (!signalsEnabled) {
      launcher.arm(entries);
      return;
    }
    const armed = await Promise.all(entries.map(prepareLaunch));
    if (!disposed) {
      launcher.arm(armed);
    }
  }

  /**
   * One accepted hook post or server event for a pane of this window. The
   * map decides what it means; the tracker decides whether it applies (gate
   * and generation); a `Stop`'s sentence goes straight to the tail store.
   */
  function onHookEvent(event: HookEvent): void {
    if (ownerOf(event.paneId) === undefined) {
      return;
    }
    const signal = contractSignalOf(event);
    if (signal === null) {
      return;
    }
    const snap = tracker.noteContract(event.paneId, signal);
    if (snap !== null && signal.kind === "completed" && signal.message !== null) {
      noteExplicitTail(event.paneId, signal.sessionId, signal.message);
    }
    if (snap !== null) {
      maybeNotify(event.paneId, snap);
      syncViews();
    }
  }

  function activeManager(): TerminalManager | null {
    return active >= 0 && active < tabs.length ? tabs[active].manager : null;
  }

  /**
   * Hand keyboard focus to whatever owns the stage right now: the active
   * non-terminal surface when one holds it, otherwise the active tab's
   * focused pane.
   *
   * The exported `focusActive()` below IS this function — extracted so the
   * `commands` table can reach the same rule. `activeManager()?.focusActive()`
   * is NOT interchangeable with it: with a document on the stage that call
   * lands focus on a terminal the user cannot see and their keystrokes go to
   * a shell, and the failure is silent (spec §7).
   */
  function focusStage(): void {
    if (surfaces.activeIndex() >= 0) {
      surfaces.focus();
      return;
    }
    activeManager()?.focusActive();
  }

  /** Workspace of the active tab; null when it has none (or no tab). */
  function activeWorkspacePath(): string | null {
    return active >= 0 && active < tabs.length ? tabs[active].workspacePath : null;
  }

  function syncViews(): void {
    // Number every live pane BEFORE any view is built: a pane split in this
    // very sync must already have its ordinal, or the first render after a
    // split ships `ordinal: undefined` and the Board's cards jump a frame
    // later. The set is also what the prune at the bottom measures against.
    const live = allPaneIds();
    for (const id of live) {
      if (!paneOrdinalById.has(id)) {
        paneOrdinalById.set(id, nextOpenSequence());
      }
    }
    tabViews.value = tabs.map((tab) => {
      const paneId = tab.manager.activePaneId();
      const info = paneId === null ? undefined : poller.infoFor(paneId);
      // The spinner means "an agent is WORKING somewhere in this tab" — every
      // pane counts, not just the focused one (a background pane running
      // `claude` is exactly the case the sidebar exists for). An agent idle
      // at its prompt does not count: activity tracks OSC 9;4 progress
      // reports (with a sustained-output fallback) to tell the two apart.
      const paneIds = tab.manager.paneIds();
      for (const id of paneIds) {
        // A process change (agent exited to the shell, new agent started)
        // invalidates whatever the old program reported.
        activity.noteProcess(id, processLabel(poller.infoFor(id)));
      }
      // Identity is separate from activity: an agent sitting at its prompt
      // still belongs in the worktree presence stack. Stable pane order plus
      // Set insertion order makes this deterministic and removes duplicates
      // when several panes run the same CLI.
      const agents = [
        ...new Set(
          paneIds.flatMap((id) => {
            const agent = explicitAgent(poller.infoFor(id));
            return agent === null ? [] : [agent];
          }),
        ),
      ];
      const agentBusy = paneIds.some(
        (id) => explicitAgent(poller.infoFor(id)) !== null && activity.working(id),
      );
      // The per-pane projection the agent rail's chips and expanded rows both
      // need (agent-status-rail spec §5, tier 2). It reports every pane, agent
      // or not — filtering shell panes out of a ROW list is the rail's job,
      // and a projection that dropped them would also drop the pane ids that
      // make a `+N` count add up.
      const panes: readonly PaneView[] = paneIds.map((id) => {
        const snap = tracker.snapshot(id);
        const live = explicitAgent(poller.infoFor(id));
        tab.manager.setPaneWorking(id, live !== null && snap?.phase === "working");
        // An agent that ENDED keeps its name on the projection until the end
        // is acknowledged (stage 0, 2026-09-03): the poller says "shell" the
        // moment the agent leaves the foreground, and a row with no agent is
        // not a row — so DL-27.3's `ended` word would have nothing to land
        // on. The tracker's `agentLabel` is the seam: it is kept after the
        // gate closes for exactly this kind of post-run copy.
        const agent =
          live ?? (snap?.phase === "exited" && snap.agentLabel !== null ? snap.agentLabel : null);
        if (live !== null && paneGenerations.get(id)?.agent !== live) {
          // A different agent in the same pane is a new generation; the FIRST
          // agent in a fresh pane is one too. An agent LEAVING is not: the
          // card keeps counting from when the agent started (spec §11.11).
          const replacing = paneGenerations.get(id) !== undefined;
          paneGenerations.set(id, { agent: live, startedAt: now(), running: true });
          if (replacing) {
            // Spec §11.2: the task prompt is dropped on pane close "or
            // generation change". Only the SECOND agent onward — the first
            // agent in a pane is the one `launchTask` just recorded the
            // prompt FOR, and clearing it here would erase the launch that
            // caused this very transition. Without this, claude launched with
            // a task, then replaced by codex in the same pane, would print
            // claude's task on codex's card: the same stale-pin failure the
            // 2026-08-22 rail bug was, one store over.
            forgetTaskPrompt(id);
          }
        }
        const previousGeneration = paneGenerations.get(id);
        if (previousGeneration !== undefined) {
          if (live === null && previousGeneration.running) {
            paneGenerations.set(id, { ...previousGeneration, running: false });
          } else if (live !== null) {
            // A same-name occupant after a shell is still a new conversation.
            // Keep Board uptime semantics, but never inherit the old session.
            paneGenerations.set(id, {
              ...previousGeneration,
              running: true,
              sessionId:
                snap?.sessionId ??
                (previousGeneration.running ? previousGeneration.sessionId : undefined),
            });
          }
        }
        const generation = paneGenerations.get(id);
        return {
          paneId: id,
          agent,
          attention: snap?.attention ?? "none",
          phase: snap?.phase ?? "unknown",
          confidence: snap?.confidence ?? "explicit",
          phaseConfidence: snap?.phaseConfidence ?? "unknown",
          exitCode: snap?.exitCode ?? null,
          sessionId: snap?.sessionId ?? null,
          detail: snap?.detail ?? null,
          hasRun: snap?.hasRun ?? false,
          changedAt: snap?.changedAt ?? 0,
          // `paneId` above is this tab's own `activePaneId()`, already read
          // for the header info — so the rail's focused row (DL-27.22) costs
          // one comparison here and no second call into the manager.
          focused: id === paneId,
          ordinal: paneOrdinalById.get(id),
          startedAt: generation?.startedAt,
          lastAgent: generation?.agent,
          // Read from the tail store rather than tracked here: it is the only
          // module that knows which conversation a pane was in, and the only
          // one that sees the moment that knowledge is about to be dropped
          // (spec §11.11).
          lastSessionId: generation?.sessionId ?? lastSessionIdFor(id),
        };
      });
      return applyTabOverride(
        {
          key: tab.key,
          openedAt: tab.openedAt,
          process: processLabel(info),
          name: null,
          dotColor: null,
          workspacePath: tab.workspacePath,
          agents,
          agentBusy,
          unread: unread.has(tab.key),
          // Additive Attention Rail summary; `agentBusy`/`unread` above keep
          // their existing semantics untouched.
          attention: tracker.summarize(paneIds),
          panes,
        },
        overrides.get(tab.key),
      );
    });
    activeTabIndex.value = active;
    const manager = activeManager();
    const paneId = manager?.activePaneId() ?? null;
    const info = paneId === null ? undefined : poller.infoFor(paneId);
    statusInfo.value = {
      branch: poller.branch(),
      cwd: info?.cwd ?? null,
      agent: explicitAgent(info),
      // Null, not zero: a non-terminal surface owns no panes, and spec §7 asks
      // for the count to be ABSENT rather than reading "0 panes".
      paneCount: surfaces.activeIndex() >= 0 ? null : (manager?.paneCount() ?? 0),
      home,
    };
    // One prune for every per-pane store. `syncViews` runs after every path
    // that can retire a pane — close, detach, tab dispose — so this is the
    // single place that has to know, and an ordinal is never handed back (a
    // reopened pane is a new pane, exactly as a reopened chip is). The task
    // prompt lives in its own module store rather than in this closure, and
    // is dropped here for the same reason and at the same moment.
    for (const id of [...paneOrdinalById.keys()]) {
      if (!live.includes(id)) {
        paneOrdinalById.delete(id);
        paneGenerations.delete(id);
        forgetTaskPrompt(id);
      }
    }
  }

  function allPaneIds(): number[] {
    return tabs.flatMap((tab) => tab.manager.paneIds());
  }

  // Per-pane identity of the last ATTENTION KIND actually forwarded to the
  // notifier — the dedupe key `maybeNotify` uses below. The tracker bumps
  // `revision` on ANY visible-signature change, including a PHASE-ONLY
  // re-emit of an already-latched kind (e.g. the agent→shell poll's
  // working→idle, or `pty:exit`'s idle→exited) — neither changes `attention`.
  // Deduping on raw revision alone (the notifier's own layer) would still
  // fire on those, so this map is the layer that actually prevents the
  // duplicate: only a NEWLY raised or ESCALATED kind gets forwarded.
  const lastNotifiedKind = new Map<number, AttentionKind>();

  /**
   * What each pane launched with. Process classification recovers the BINARY a
   * pane is running, never the flags it was given, so this map is the only
   * record of a pane's command — `captureSession` reads it for the journal.
   */
  const launchCommandByPane = new Map<number, string>();

  /**
   * ONE choke point for every tracker transition that might be worth a
   * native notification — every call site below that gets a non-null
   * snapshot back from a tracker mutation routes it here. Label derivation
   * mirrors the sidebar's own `tab.name ?? workspaceLabel(tab.workspacePath)`
   * (workspace-sidebar.tsx) — never raw terminal/OSC text.
   *
   * Dedupes on the ATTENTION LATCH IDENTITY, not the raw snapshot revision:
   * `snap.attention === "none"` only resets `lastNotifiedKind` (so a future
   * re-raise of any kind notifies again) and never itself notifies; a
   * `snap.attention` equal to the last-forwarded kind is a phase-only
   * re-emit of the same latched attention and is dropped. Only a kind that
   * differs from the last one forwarded (a fresh latch, or an escalation)
   * reaches `notifier.maybeNotify` — which still owns the actionable-kind +
   * background + unsent-revision policy as a harmless second layer.
   */
  function maybeNotify(id: number, snap: PaneAttentionSnapshot): void {
    const prevKind = lastNotifiedKind.get(id) ?? "none";
    lastNotifiedKind.set(id, snap.attention);
    if (snap.attention === "none") {
      return; // reset only — a future re-raise of any kind will notify
    }
    if (snap.attention === prevKind) {
      return; // same latched kind re-emitted (phase-only change) — no dup
    }
    const owner = tabs.find((t) => t.manager.paneIds().includes(id));
    const label =
      (owner ? overrides.get(owner.key)?.name : undefined) ??
      (owner?.workspacePath == null ? "Unknown" : workspaceLabel(owner.workspacePath));
    notifier.maybeNotify({
      paneId: id,
      revision: snap.revision,
      kind: snap.attention,
      workspaceLabel: label,
      agentLabel: snap.agentLabel,
    });
  }

  /** Forget latch-identity dedupe state for panes outside `live`. */
  function pruneNotifiedKinds(live: readonly number[]): void {
    const keep = new Set(live);
    const doomed: number[] = [];
    for (const id of lastNotifiedKind.keys()) {
      if (!keep.has(id)) {
        doomed.push(id);
      }
    }
    for (const id of doomed) {
      lastNotifiedKind.delete(id);
    }
  }

  /** Forget the launch command of panes outside `live`. */
  function pruneLaunchCommands(live: readonly number[]): void {
    const alive = new Set(live);
    for (const id of [...launchCommandByPane.keys()]) {
      if (!alive.has(id)) {
        launchCommandByPane.delete(id);
      }
    }
  }

  /** Forget retry targets whose original pane no longer exists. */
  function pruneTaskPromptPanes(live: readonly number[]): void {
    const alive = new Set(live);
    for (const [tabKey, target] of taskPromptTargetByTab) {
      if (!alive.has(target.paneId)) {
        taskPromptTargetByTab.delete(tabKey);
      }
    }
  }

  const callbacks = {
    onLayoutChange(): void {
      syncViews();
      const live = allPaneIds();
      launcher.prune(live);
      activity.prune(live);
      tracker.prune(live);
      notifier.prune(live);
      pruneNotifiedKinds(live);
      pruneLaunchCommands(live);
      pruneTaskPromptPanes(live);
      // Every pane of every tab is polled now, so a long session would
      // otherwise leave one cache entry behind per pane ever opened.
      poller.prune(live);
      registrySync.prune(live);
    },
    onAttentionSignal(id: number, signal: PaneAttentionSignal): void {
      // Structured OSC 9/777 notification or bell from a pane. Stamp it with
      // the shared clock and hand it to the tracker; the gate drops it for
      // shell / pre-poll panes, and a real change triggers a re-render.
      const signalSnap = tracker.noteSignal(id, {
        kind: "requested",
        source: signal.source,
        observedAt: now(),
      });
      if (signalSnap !== null) {
        maybeNotify(id, signalSnap);
        syncViews();
      }
    },
    onPaneFocus(id: number): void {
      if (!windowFocused) return; // only ack when the window is foreground
      const ackSnap = tracker.acknowledge(id); // clears attention+unread, not phase
      if (ackSnap !== null) {
        // Routes through the same choke point so its "none" resets
        // `lastNotifiedKind` — a genuinely NEW error/warning/etc. raised
        // after this ack must notify again. Acknowledge only happens while
        // the window is foreground, and the notifier is background-only, so
        // this call itself never sends; it only maintains the reset state.
        maybeNotify(id, ackSnap);
        syncViews();
      }
    },
    onActivePaneChange(): void {
      // The rail marks the pane holding the keyboard (DL-27.22), and that row
      // is `PaneView.focused` — a projection of the manager's active id, so
      // the projection has to be rebuilt when the id moves. Unconditional: the
      // guard that makes this cheap is `setActive`'s own early return.
      syncViews();
    },
  };

  /** Create + init a tab; false (and an error note) when spawning fails. */
  async function addTab(
    layout: SerializedNode | null,
    cwds: readonly (string | null)[] = [],
    workspacePath: string | null = null,
  ): Promise<TabEntry | null> {
    const container = document.createElement("div");
    container.className = "tab-stage";
    container.style.display = "none";
    host.appendChild(container);
    const manager = createTerminalManager(container, callbacks, paneIo, managerDeps(nextKey));
    try {
      if (layout === null) {
        await manager.initFresh(cwds[0] ?? null);
      } else {
        await manager.initFromLayout(layout, cwds);
      }
    } catch (err) {
      console.error("Failed to open tab:", err);
      manager.dispose();
      activeManager()?.notifyError(`Failed to open new tab: ${err}`);
      return null;
    }
    // Returned rather than left for the caller to fish out of `tabs`: reading
    // `tabs[tabs.length - 1]` after an await is only correct while no OTHER
    // tab can be pushed across that microtask boundary, and two launches in
    // flight (⌘Enter twice, Quick Launch over the board) make that false — the
    // second tab lands first and the first caller addresses the wrong pane.
    const entry: TabEntry = {
      key: nextKey,
      manager,
      openedAt: nextOpenSequence(),
      // The only place a tab's workspace is ever set — normalize here so every
      // entry point (Open, reopen, live preset) agrees on one spelling.
      workspacePath: workspacePath === null ? null : normalizeWorkspacePath(workspacePath),
    };
    tabs.push(entry);
    nextKey += 1;
    return entry;
  }

  function selectTab(index: number): void {
    if (index < 0 || index >= tabs.length) {
      return;
    }
    // `index === active` is no longer enough to skip: a non-terminal surface
    // may be on top of that same tab, and selecting the tab has to take the
    // stage back. Checked BEFORE the early return for exactly that reason.
    const surfaceWasActive = surfaces.activeIndex() >= 0;
    surfaces.deactivate();
    if (index === active) {
      if (surfaceWasActive) {
        tabs[index].manager.show();
        syncViews();
      }
      return;
    }
    activeManager()?.hide();
    active = index;
    unread.delete(tabs[index].key); // opening the tab clears its unread badge
    tabs[index].manager.show();
    syncViews();
  }

  /**
   * Acknowledge one pane explicitly (spec §11.4).
   *
   * `tracker.acknowledge` lives inside `onPaneFocus` today, so the only way
   * to clear a latch was to FOCUS the pane. The Board's `sent` reply (§7.4)
   * clears one without focusing anything, so the call needs a door of its
   * own. (The plan named a second caller, the step to the full stage; that
   * one goes through `activateForAttention`, which focuses the pane and so
   * already acks — but only while the window is foreground, which is
   * `onPaneFocus`'s own gate and this door's is not.)
   *
   * Selection is deliberately NOT one of them: an ack on select would drop
   * an `asked` card out of the top group the moment the user opened its
   * panel (spec §5.5).
   *
   * Routes through `maybeNotify` for the reason `onPaneFocus` does: that
   * function dedupes on the latch identity in `lastNotifiedKind`, and only a
   * `"none"` snapshot resets it. Acking without the call would leave the key
   * at the acked kind, and this pane's next request of that kind would be
   * dropped as a phase-only re-emit.
   */
  function acknowledgePane(paneId: number): void {
    if (ownerOf(paneId) === undefined) {
      return; // not this window's pane — nothing to acknowledge
    }
    const ackSnap = tracker.acknowledge(paneId);
    if (ackSnap !== null) {
      maybeNotify(paneId, ackSnap);
      syncViews();
    }
  }

  /**
   * Attention-navigation primitive — activates exactly the CANDIDATE pane,
   * never the tab's regular active pane. Same-tab focuses only the
   * candidate; cross-tab switches via `show({ focus: false })` so the old
   * active pane is never (re-)focused/acked, then focuses (acks) only the
   * candidate. Must NOT call public `selectTab()`, which would focus (and
   * ack) the target's own active pane.
   *
   * Validates the candidate is still live on the target BEFORE touching any
   * tab/active state (unknown/dead candidate → complete no-op: no tab
   * change, no ack of any other pane), and everything after validation is a
   * single synchronous block (no `await`) so nothing can invalidate the
   * candidate between the check and the focus call that acks it.
   */
  function activateForAttention(index: number, paneId: number): void {
    const target = tabs[index];
    if (!target || !target.manager.paneIds().includes(paneId)) {
      return; // unknown/dead candidate — no tab change, no ack of any pane
    }
    // The attention rail is jumping to a terminal PANE — a file surface may
    // be on the stage over either the current tab or the target, same-tab or
    // cross-tab. Mirrors `selectTab`'s own `surfaces.deactivate()` (Task 7):
    // without it, focus/ack below lands on a pane the user cannot see while
    // an editor still holds the DOM's keyboard focus.
    surfaces.deactivate();
    if (index === active) {
      target.manager.focusPane(paneId); // same-tab: ack ONLY the candidate
      return;
    }
    // Cross-tab: switch without focusing (thus without acking) the target's
    // own active pane — only the candidate below gets acknowledged.
    activeManager()?.hide();
    active = index;
    unread.delete(target.key); // opening the tab clears legacy unread too
    target.manager.show({ focus: false }); // display + fit only, no focus/ack
    target.manager.focusPane(paneId); // acks ONLY the candidate
    syncViews();
  }

  /**
   * `tracker.actionable()` is already sorted highest-severity-first then
   * oldest-`changedAt`-first; this walks it in order and returns the first
   * candidate that (a) still owns a live pane and (b) matches the optional
   * `tabIndex` scope. A candidate whose owning tab closed mid-scan (dead
   * pane) is skipped in favor of the next one rather than aborting the scan.
   */
  function nextAttentionCandidate(
    tabIndex?: number,
  ): { owningIndex: number; paneId: number } | null {
    for (const cand of tracker.actionable()) {
      const owningIndex = tabs.findIndex((t) => t.manager.paneIds().includes(cand.id));
      if (owningIndex === -1) continue; // pane gone
      if (tabIndex !== undefined && owningIndex !== tabIndex) continue; // scoped to one tab
      return { owningIndex, paneId: cand.id };
    }
    return null; // no candidate → caller no-ops
  }

  function focusNextAttention(tabIndex?: number): void {
    const next = nextAttentionCandidate(tabIndex);
    if (next === null) {
      return; // no candidate anywhere in scope — complete no-op
    }
    activateForAttention(next.owningIndex, next.paneId); // acks exactly that pane
  }

  function hasActionableAttention(tabIndex?: number): boolean {
    return nextAttentionCandidate(tabIndex) !== null;
  }

  /**
   * The identity a pane carries out of this window (spec §10.2). Lives here
   * rather than in TerminalManager because the name override, dot color and
   * workspace are TAB-level state, which only this closure holds.
   */
  function managerDeps(tabKey: number) {
    return {
      ...deps,
      transfer,
      identity: (paneId: number) => {
        const override = overrides.get(tabKey);
        // Read from the live entry, never from a value captured here: a tab
        // is pushed AFTER `createTerminalManager` runs, and an adopted tab
        // takes its workspace from the payload. Capturing would silently
        // drop the workspace on a second hop (A -> B -> C).
        const entry = tabs.find((candidate) => candidate.key === tabKey);
        return {
          agentId: explicitAgent(poller.infoFor(paneId)),
          tabName: override?.name ?? null,
          dotColor: override?.dotColor ?? null,
          workspacePath: entry?.workspacePath ?? null,
        };
      },
    };
  }

  /**
   * Move the focused pane into a brand-new window (spec §10.3). The emptied
   * tab is removed WITHOUT the reopen snapshot `disposeTab` takes: nothing
   * was closed, so there is nothing to reopen — the session is alive in
   * another window.
   */
  async function movePaneToNewWindow(): Promise<void> {
    await movePane({ kind: "new-window" });
  }

  async function movePane(target: DetachTarget): Promise<void> {
    // The transfer transaction is built around handing over a PTY, and a
    // non-terminal surface has none. A no-op with a message, reusing the same
    // refusal shape as the one-pane-window fork rather than inventing a second
    // one (spec §7).
    if (surfaces.activeIndex() >= 0) {
      reportChromeMessage("Only a terminal pane can move to another window.");
      return;
    }
    const index = active;
    const entry = tabs[index];
    const paneId = entry?.manager.activePaneId() ?? null;
    if (!entry || paneId === null) {
      reportChromeMessage("No pane to move.");
      return;
    }
    // A one-pane window has nothing to gain from a NEW window: the move would
    // close this window and open another holding the same pane — geometry
    // lost, and the pane risked through a whole transaction for no observable
    // change. Window-level, not tab-level: a second tab keeps the window
    // alive, so splitting this tab out is a real move. Offering the pane to an
    // EXISTING window stays allowed — that one merges and is meaningful.
    if (target.kind === "new-window" && tabs.length === 1 && entry.manager.paneIds().length === 1) {
      reportChromeMessage("Nothing to move — this is the window's only pane.");
      return;
    }
    const outcome = await entry.manager.detachPaneById(paneId, target);
    if (outcome.kind === "kept") {
      return;
    }
    pruneMovedPane(paneId);
    if (outcome.tabEmpty) {
      removeEmptyTab(entry);
    }
    syncViews();
  }

  /**
   * The per-pane trackers `disposeTab` normally prunes. A moved pane skips
   * that path entirely, so this is not redundant.
   */
  function pruneMovedPane(paneId: number): void {
    const live = allPaneIds().filter((id) => id !== paneId);
    launcher.prune(live);
    activity.prune(live);
    tracker.prune(live);
    notifier.prune(live);
    pruneNotifiedKinds(live);
    pruneLaunchCommands(live);
    pruneTaskPromptPanes(live);
    poller.prune(live);
    registrySync.prune(live);
  }

  /** Remove a tab whose last pane MOVED — no busy guard, no reopen snapshot. */
  function removeEmptyTab(entry: TabEntry): void {
    const removeAt = tabs.indexOf(entry);
    if (removeAt === -1) {
      return;
    }
    const closingActive = removeAt === active;
    const countBefore = tabs.length;
    entry.manager.dispose();
    tabs.splice(removeAt, 1);
    overrides.delete(entry.key);
    unread.delete(entry.key);
    taskPromptTargetByTab.delete(entry.key);
    if (tabs.length === 0) {
      active = -1;
      // Last TAB is not last SURFACE (spec §7): a window may hold only file
      // tabs, and closing the window would take them with it.
      if (surfaces.total() > 0) {
        surfaces.activate(0);
        syncViews();
        return;
      }
      void closeWindow();
      return;
    }
    active = activeAfterClose(removeAt, active, countBefore);
    if (closingActive) {
      tabs[active].manager.show();
    }
  }

  /** Live-adopt into a NEW tab of this already-running window (spec §10.1). */
  async function adoptIntoNewTab(token: string): Promise<boolean> {
    const container = document.createElement("div");
    container.className = "tab-stage";
    container.style.display = "none";
    host.appendChild(container);
    const manager = createTerminalManager(container, callbacks, paneIo, managerDeps(nextKey));
    // Pushed BEFORE the adoption runs, not after. Rust flushes everything it
    // buffered during the transfer as part of `commit_transfer`, which happens
    // INSIDE `initFromAdoption`. Output is routed by scanning `tabs` for the
    // manager owning that pane id, so a manager still outside `tabs` at commit
    // time drops every buffered chunk and any `pty:exit` among them — silently
    // and permanently. `paneIds()` stays empty until the adopt places the pane,
    // so an entry parked here matches nothing until it genuinely owns it.
    const placeholder: TabEntry = {
      key: nextKey,
      manager,
      openedAt: nextOpenSequence(),
      workspacePath: null,
    };
    tabs.push(placeholder);
    const result = await manager.initFromAdoption(token);
    const parked = tabs.indexOf(placeholder);
    if (result.kind === "failed") {
      if (parked !== -1) {
        tabs.splice(parked, 1);
      }
      manager.dispose();
      return false;
    }
    // Replaced, not mutated: `TabEntry.workspacePath` is readonly, and the
    // payload only tells us the workspace once the adoption has landed.
    if (parked !== -1) {
      tabs[parked] = {
        ...placeholder,
        workspacePath:
          result.payload.workspacePath === null
            ? null
            : normalizeWorkspacePath(result.payload.workspacePath),
      };
    }
    if (result.payload.tabName !== null || result.payload.dotColor !== null) {
      overrides.set(nextKey, {
        ...(result.payload.tabName !== null ? { name: result.payload.tabName } : {}),
        ...(result.payload.dotColor !== null ? { dotColor: result.payload.dotColor } : {}),
      });
    }
    nextKey += 1;
    selectTab(tabs.length - 1);
    void poller.poll();
    syncViews();
    return true;
  }

  async function newTab(): Promise<void> {
    // ⌘T hands the app the active tab's workspace and materializes nothing:
    // since `rail-create-consolidation` (2026-09-02) the app answers with the
    // rail card's agent list, free-standing, and a row of THAT list is what
    // starts a process. The Quick Launch fallback stays as the revert seam.
    (deps.onOpenTaskLauncher ?? toggleQuickLaunch)(activeWorkspacePath());
  }

  /**
   * Deep Materialize entry: spawn + optional chrome + select + agent launch.
   * Open board / Layout preset / Closed tab all go here.
   */
  async function materializeEntry(intent: MaterializeIntent): Promise<TabEntry | null> {
    const finishStartupSpawn = beginWindowsStartupSpawn();
    try {
      return await materializeEntryWhilePollingPaused(intent);
    } finally {
      finishStartupSpawn?.();
    }
  }

  async function materializeEntryWhilePollingPaused(
    intent: MaterializeIntent,
  ): Promise<TabEntry | null> {
    // A workspace may own any number of tabs: opening one that already has a
    // tab spawns another rather than focusing the first, so the same repo can
    // run several agent sessions side by side. `workspacePath` is a label the
    // tab carries (sidebar, logo, reopen), never an identity that dedupes.
    const entry = await addTab(intent.layout, intent.cwds, intent.workspacePath ?? null);
    if (entry === null) {
      return null;
    }
    const chrome = intent.chrome;
    if (chrome !== undefined) {
      const override: TabOverride = {
        ...(chrome.name !== undefined ? { name: chrome.name } : {}),
        ...(chrome.dotColor !== undefined ? { dotColor: chrome.dotColor } : {}),
      };
      if (override.name !== undefined || override.dotColor !== undefined) {
        overrides.set(entry.key, override);
      }
    }
    const paneIds = entry.manager.paneIds();
    const pollDeferred = deferWindowsStartupPoll(paneIds);
    // By key, not by "last": a concurrent materialize may have pushed after
    // this one, and selecting its tab would put the user in a pane they did
    // not ask for. Boot restore opts out (`select: false`) and picks the saved
    // tab once at the end — see the field's own note for why that is worth an
    // option rather than always selecting.
    if (intent.select !== false) {
      selectTab(tabs.indexOf(entry));
    }
    if (!pollDeferred) {
      void poller.poll();
    }
    // Each pane types its command once its shell prints the first byte;
    // `null` arms nothing. The id becomes a command line HERE rather than
    // inside the launcher: `arm` still takes a plain string per pane and
    // writes it verbatim, so its readiness/timeout state machine stays out of
    // the catalog's business. A declared agent deleted since the workspace
    // remembered it resolves to null and arms nothing — an empty shell, not a
    // pane that types a stale command. `paneCommands` (session restore) wins
    // per pane over the tab-wide `agent` fallback.
    const agentId = intent.agent ?? null;
    // `undefined` means the caller expressed no opinion, so the agent's own
    // default profile applies; `null` means the caller explicitly asked for
    // the bare command. An agent with no profiles resolves to null either way
    // and takes the catalog's command exactly as before.
    const launchCommand =
      intent.launchCommand === undefined
        ? agentLaunchCommand(
            agentId,
            settings.value.launchProfiles,
            settings.value.defaultLaunchProfiles,
            settings.value.customAgents,
          )
        : intent.launchCommand;
    const fallback =
      agentId === null
        ? null
        : (launchCommand ?? resolveAgentCommand(agentId, settings.value.customAgents));
    if (launchCommand !== null) {
      for (const id of paneIds) {
        launchCommandByPane.set(id, launchCommand);
      }
    }
    // Spec §11.2: a restored pane keeps the task its card was started with.
    // The intent carries the prompts because session restore knows leaves, not
    // pane ids; this is the one place the two meet. Safe against `syncViews`'s
    // generation forget — a fresh pane's FIRST agent is not a replacement, so
    // nothing clears what is recorded here.
    paneIds.forEach((id, index) => {
      const prompt = intent.panePrompts?.[index];
      if (prompt != null) {
        noteTaskPrompt(id, prompt);
      }
    });
    void armLaunch(
      paneIds.map((id, index) => ({
        id,
        command: intent.paneCommands?.[index] ?? fallback,
      })),
    );
    // Usage analytics (spec §4): a launch per pane the CATALOG armed. Panes
    // whose command came in through `paneCommands` are counted by their own
    // call sites (resume/restore), which still hold the per-pane agent id
    // this intent deliberately does not carry.
    if (agentId !== null && fallback !== null) {
      for (const [index] of paneIds.entries()) {
        if (intent.paneCommands?.[index] == null) {
          countAgentLaunch(agentId);
        }
      }
    }
    return entry;
  }

  /**
   * Deep Materialize entry: spawn + optional chrome + select + agent launch.
   * Open board / Layout preset / Closed tab all go here.
   *
   * The boolean face of `materializeEntry`. Every caller but `launchTask` only
   * needs to know whether the tab came up, and keeping this signature is what
   * leaves the R4 seam and its contract test untouched.
   */
  async function materialize(intent: MaterializeIntent): Promise<boolean> {
    return (await materializeEntry(intent)) !== null;
  }

  /** Causal launch destination for Recent activity before the CLI reports its session. */
  async function materializePane(intent: MaterializeIntent) {
    const entry = await materializeEntry(intent);
    const paneId = entry?.manager.paneIds()[0];
    return paneId === undefined
      ? null
      : {
          paneId,
          canFocus: () => ownerOf(paneId) !== undefined && !launcher.failed(paneId),
        };
  }

  /** One tab per Open; CWDs already resolved by the caller. */
  function openFromPreset(
    layout: SerializedNode,
    cwds: readonly (string | null)[],
    options: OpenFromPresetOptions = {},
  ): Promise<boolean> {
    return materialize({
      layout,
      cwds,
      ...(options.workspacePath !== undefined ? { workspacePath: options.workspacePath } : {}),
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
    });
  }

  /**
   * AgentQuickPicker confirm: a single pane in the active tab's workspace,
   * running `agentId` (`null` = Shell only). The active pane's live CWD
   * (not the workspace root) is what the new pane inherits, same as the
   * Layout preset editor's "↑ inherit" — a picker opened from a pane the
   * user has already `cd`'d into should land there, not jump back to the
   * repo root. No tab at all resolves both to `null`, which `materialize`
   * falls back to `$HOME` for, matching a bare `newTab()` pre-cutover.
   */
  async function openQuickAgent(
    agentId: AgentChoice,
    destination: string | null = null,
    profileId?: string | null,
  ): Promise<boolean> {
    // A destination is a worktree the picker offered, so it is BOTH the cwd
    // and the workspace tag: tagging the tab with the worktree it runs in is
    // what puts it under the right rail row. Passing null keeps the original
    // behaviour exactly — the focused pane's live cwd, the active tab's
    // workspace — which is what every host without `git_repository` gets.
    const cwd = destination ?? (await activePaneCwd());
    const workspacePath = destination ?? activeWorkspacePath();
    return materialize({
      layout: BUILT_IN_PRESET.layout,
      cwds: [cwd],
      agent: agentId,
      // Three states, not two, and the difference is load-bearing: an ABSENT
      // argument states no opinion, so `materialize` resolves the agent's
      // default profile; a `null` argument is the picker's "No profile" row and
      // must launch bare even when a default exists. Passing a resolved `null`
      // in both cases would make the default unreachable from every caller that
      // omits the argument.
      ...(profileId === undefined
        ? {}
        : {
            launchCommand: resolveLaunchCommand(agentId, profileId, settings.value.launchProfiles),
          }),
      ...(workspacePath !== null ? { workspacePath } : {}),
    });
  }

  /**
   * Poll until the pane's agent is ready to be handed a first prompt, or the
   * ceiling is reached. Returns whether the gate ever opened.
   *
   * The whole point of doing this BEFORE `injectIntoPane` is that the inject
   * pastes unconditionally: asking it early would put the task prompt into a
   * bare shell, which the design forbids outright. See `task-prompt-send.ts`.
   */
  async function waitForPromptReady(
    paneId: number,
    expectedAgent: string | null,
  ): Promise<{ readonly ready: boolean; readonly info: PaneProcessInfo | null }> {
    const deadline = Date.now() + TASK_PROMPT_READY_TIMEOUT_MS;
    let lastInfo: PaneProcessInfo | null = null;
    for (;;) {
      const [info] = await freshPaneInfo(
        [paneId],
        pty,
        agentProcessMatchers(settings.value.customAgents),
      );
      lastInfo = info ?? null;
      const alive = ownerOf(paneId) !== undefined;
      if (
        promptReadyToSend({
          expectedAgent,
          info,
          attention: paneAttention(paneId),
          alive,
        })
      ) {
        return { ready: true, info: info ?? null };
      }
      // A pane that has left the layout is never coming back; waiting out the
      // full ceiling for it would hold a pending launch open for 90 seconds
      // after the user closed the tab.
      if (!alive || Date.now() >= deadline) {
        return { ready: false, info: lastInfo };
      }
      await new Promise((resolve) => setTimeout(resolve, TASK_PROMPT_POLL_MS));
    }
  }

  /**
   * The task launcher's one entry: materialize a single-pane tab, wait for its
   * agent, and hand it the first prompt exactly once (design §8).
   *
   * It lives HERE, rather than as a poll in `App` over a pane id `materialize`
   * hands back, because pane ids are this module's own currency — R4's seam is
   * only observable while nothing outside it holds one.
   *
   * Every failure keeps the tab standing. A launch that spawns but cannot be
   * prompted is a pane the user can still type into, and destroying it to
   * report a failure would throw away the thing that did work.
   */
  async function launchTask(
    intent: MaterializeIntent,
    prompt: string | null,
  ): Promise<LaunchTaskResult> {
    const entry = await materializeEntry(intent);
    if (entry === null) {
      return { outcome: "spawn-failed", tabKey: null };
    }
    // The surfaces already withhold the prompt while
    // `TASK_PROMPT_STAGING_ENABLED` is false, so this is the second gate rather
    // than the only one — and it is the one that matters, because it is the
    // only place that can promise no caller reaches `waitForPromptReady`'s
    // 90-second ceiling. `started` is the honest outcome: the tab is up and
    // nothing was asked of the agent.
    const text = promptStaging ? (prompt?.trim() ?? "") : "";
    if (text === "") {
      return { outcome: "started", tabKey: entry.key };
    }
    const expectedAgent = intent.agent ?? null;
    if (expectedAgent === null) {
      // A shell pane has no agent to be ready, and typing the prompt into it is
      // exactly the fallback the design forbids. The launcher's own validation
      // refuses this combination, so reaching here means something upstream
      // changed — say so rather than waiting out the ceiling in silence.
      return { outcome: "prompt-not-sent", tabKey: entry.key };
    }
    // From the entry this call created, never from `tabs[tabs.length - 1]`:
    // a second launch in flight can push its tab across the await above, and
    // the prompt would then be typed into somebody else's pane.
    const paneId = entry.manager.paneIds()[0];
    if (paneId === undefined) {
      return { outcome: "prompt-not-sent", tabKey: entry.key };
    }
    const delivery = await deliverTaskPrompt(paneId, text, expectedAgent);
    // Spec §11.2: the Board is the only surface that can say what a pane was
    // opened for, and this is the one moment the text exists in this layer.
    // BOTH successful outcomes record, because `TASK_PROMPT_AUTOSEND` is false
    // and `prompt-pending` is therefore the NORMAL result — a store that only
    // knew `sent` would be empty for almost every launch. The outcome check is
    // what keeps a readiness FAILURE out: that path still answers with a
    // target, so a target-only condition would record a prompt the pane never
    // received.
    if (delivery.outcome === "sent" || delivery.outcome === "prompt-pending") {
      noteTaskPrompt(paneId, text);
    }
    if (!launchClearsDraft(delivery.outcome) && delivery.target !== null) {
      taskPromptTargetByTab.set(entry.key, delivery.target);
    } else {
      taskPromptTargetByTab.delete(entry.key);
    }
    return { outcome: delivery.outcome, tabKey: entry.key };
  }

  function taskPromptTarget(
    paneId: number,
    info: PaneProcessInfo | null,
    expectedAgent: string,
  ): TaskPromptTarget | null {
    if (
      info?.kind !== "agent" ||
      info.agent !== expectedAgent ||
      !Number.isSafeInteger(info.processId) ||
      (info.processId ?? 0) <= 0 ||
      info.cwd === null
    ) {
      return null;
    }
    return { paneId, processId: info.processId as number, cwd: info.cwd, agent: expectedAgent };
  }

  function sameTaskPromptTarget(
    expected: TaskPromptTarget,
    info: PaneProcessInfo | undefined,
  ): boolean {
    return (
      info?.kind === "agent" &&
      info.agent === expected.agent &&
      info.processId === expected.processId &&
      info.cwd === expected.cwd
    );
  }

  async function deliverTaskPrompt(
    paneId: number,
    text: string,
    expectedAgent: string,
    requiredTarget?: TaskPromptTarget,
  ): Promise<TaskPromptDelivery> {
    const readiness = await waitForPromptReady(paneId, expectedAgent);
    // Retry owns a saved process generation. The readiness poll above is an
    // async boundary, so compare its newest snapshot too: the original agent
    // can exit and a same-name replacement can start after the retry's first
    // guard but before paste is queued.
    if (
      requiredTarget !== undefined &&
      !sameTaskPromptTarget(requiredTarget, readiness.info ?? undefined)
    ) {
      return { outcome: "prompt-not-sent", target: null };
    }
    const target = taskPromptTarget(paneId, readiness.info, expectedAgent);
    if (!readiness.ready) {
      return { outcome: "prompt-not-sent", target };
    }
    // ONCE, and by default WITHOUT the trailing Enter — see
    // `TASK_PROMPT_AUTOSEND`, which is false because an agent's first-run
    // "trust this folder" menu is indistinguishable from a ready prompt in
    // every signal Deck has, and Enter there means "yes, I trust it".
    // `"pasted"` means the text is already sitting in the agent's composer, so
    // a retry would duplicate it — that outcome is terminal either way.
    const outcome = await injectIntoPane(paneId, text, {
      autoSend: TASK_PROMPT_AUTOSEND,
      expectedAgent,
    });
    if (outcome === "sent") {
      return { outcome: "sent", target };
    }
    return { outcome: outcome === "pasted" ? "prompt-pending" : "prompt-failed", target };
  }

  async function retryTaskPrompt(
    tabKey: number,
    prompt: string,
    expectedAgent: string,
  ): Promise<LaunchTaskOutcome> {
    const entry = tabs.find((candidate) => candidate.key === tabKey);
    const target = taskPromptTargetByTab.get(tabKey);
    const paneId = target?.paneId;
    const text = prompt.trim();
    if (
      entry === undefined ||
      paneId === undefined ||
      text === "" ||
      !entry.manager.paneIds().includes(paneId)
    ) {
      taskPromptTargetByTab.delete(tabKey);
      return "prompt-not-sent";
    }
    const [info] = await freshPaneInfo(
      [paneId],
      pty,
      agentProcessMatchers(settings.value.customAgents),
    );
    if (
      target === undefined ||
      target.agent !== expectedAgent ||
      !sameTaskPromptTarget(target, info)
    ) {
      taskPromptTargetByTab.delete(tabKey);
      return "prompt-not-sent";
    }
    const delivery = await deliverTaskPrompt(paneId, text, expectedAgent, target);
    // A retry that lands is the same fact as a launch that landed — without
    // this, a pane whose FIRST paste failed would print no Task line for the
    // rest of its life.
    if (delivery.outcome === "sent" || delivery.outcome === "prompt-pending") {
      noteTaskPrompt(paneId, text);
    }
    if (launchClearsDraft(delivery.outcome) || delivery.target === null) {
      taskPromptTargetByTab.delete(tabKey);
    } else {
      taskPromptTargetByTab.set(tabKey, delivery.target);
    }
    return delivery.outcome;
  }

  function canRetryTaskPrompt(tabKey: number): boolean {
    const entry = tabs.find((candidate) => candidate.key === tabKey);
    const paneId = taskPromptTargetByTab.get(tabKey)?.paneId;
    return entry !== undefined && paneId !== undefined && entry.manager.paneIds().includes(paneId);
  }

  function canFocusTaskPrompt(tabKey: number): boolean {
    const entry = tabs.find((candidate) => candidate.key === tabKey);
    const paneId = taskPromptTargetByTab.get(tabKey)?.paneId;
    return entry !== undefined && paneId !== undefined && entry.manager.paneIds().includes(paneId);
  }

  function focusTaskPrompt(tabKey: number): boolean {
    const index = tabs.findIndex((candidate) => candidate.key === tabKey);
    const paneId = taskPromptTargetByTab.get(tabKey)?.paneId;
    if (index < 0 || paneId === undefined || !tabs[index].manager.paneIds().includes(paneId)) {
      taskPromptTargetByTab.delete(tabKey);
      return false;
    }
    activateForAttention(index, paneId);
    return true;
  }

  /** The command a pane started with; null when it had none. */
  function launchCommandFor(paneId: number): string | null {
    return launchCommandByPane.get(paneId) ?? null;
  }

  /** This pane's task prompt as the session schema will accept it back. */
  function capturedTaskPrompt(paneId: number): string | null {
    const prompt = paneTaskPrompts.value.get(paneId);
    return prompt === undefined ? null : capTaskPrompt(prompt);
  }

  /**
   * The `New` row dropped onto a pane: a pane docked INTO the active tab,
   * not a new tab. Every other agent launch materializes a tab, so this is
   * the one place `arm` is called outside `materialize` — which is safe
   * because `arm` merges per pane id rather than replacing the pending set
   * (session restore arms many panes and must not be clobbered).
   *
   * Nobody picks an agent here: the drop IS the confirmation, so the choice
   * comes from what this workspace was last opened with, resolved against a
   * live probe. The probe is awaited for the same reason the Open board
   * awaits it — resolving against a not-yet-answered list would silently
   * spawn a Shell. A failed probe degrades to Shell rather than sinking the
   * drop.
   */
  async function dropAgentPane(targetPaneId: number, edge: Edge): Promise<boolean> {
    const manager = activeManager();
    if (manager === null) {
      return false;
    }
    const customAgents = settings.value.customAgents;
    const detected = await pty.detectAgents(probeNames(customAgents)).catch((err: unknown) => {
      console.warn("detect_agents failed:", err);
      return [];
    });
    const agentId = agentForWorkspace(
      workspacesData.value.recents,
      activeWorkspacePath(),
      agentOptions(detected, customAgents, settings.value.disabledAgents),
    );
    const finishStartupSpawn = beginWindowsStartupSpawn();
    try {
      const paneId = await manager.dockNewPaneAt(targetPaneId, edge);
      if (paneId === null) {
        return false;
      }
      const pollDeferred = deferWindowsStartupPoll([paneId]);
      // The drop states no mode, so the agent's default profile applies — the
      // same rule the Open board gets through `materialize`. Composed here
      // because this is the one launch that does not go through it.
      const launchCommand = agentLaunchCommand(
        agentId,
        settings.value.launchProfiles,
        settings.value.defaultLaunchProfiles,
        customAgents,
      );
      if (launchCommand !== null) {
        launchCommandByPane.set(paneId, launchCommand);
      }
      void armLaunch([
        {
          id: paneId,
          command:
            agentId === null ? null : (launchCommand ?? resolveAgentCommand(agentId, customAgents)),
        },
      ]);
      if (agentId !== null) {
        // Usage analytics (spec §4): the one agent launch outside `materialize`.
        countAgentLaunch(agentId);
      }
      // The docked pane has no process info until the next tick otherwise, so
      // the rail and the tab chip would sit blank for up to the poll interval.
      if (!pollDeferred) {
        void poller.poll();
      }
      syncViews();
      return true;
    } finally {
      finishStartupSpawn?.();
    }
  }

  /** Fresh CWDs via TabMaterialize so a just-cd'd pane saves correctly. */
  async function captureActiveLayout(): Promise<{
    layout: SerializedNode;
    cwds: readonly (string | null)[];
  } | null> {
    const manager = activeManager();
    const layout = manager?.serializeLayout() ?? null;
    if (!manager || layout === null) {
      return null;
    }
    return capturePresetLayout(manager.paneIds(), layout, pty);
  }

  function captureSession(): readonly SessionTab[] {
    return tabs.flatMap((entry) => {
      const layout = entry.manager.serializeLayout();
      if (layout === null) {
        return [];
      }
      const override = overrides.get(entry.key);
      const panes = entry.manager.paneIds().map((id) => {
        const info = poller.infoFor(id);
        return {
          cwd: info?.cwd ?? null,
          agent: info?.agent ?? null,
          // Known limit, recorded not fixed: a pane detached into another
          // window loses this. The map is per TabManager and the adopting
          // window has no entry for it, so its snapshot is null and restore
          // falls back to the bare resume command. Cross-window transfer is a
          // `transfer-client.ts` change and a separate decision.
          launchCommand: launchCommandFor(id),
          // Capped here rather than at the store: the cap is the SCHEMA's
          // bound on what a journal write may cost, and the live map has no
          // reason to hold a shortened copy of what the pane was actually
          // sent. Same limit as `launchCommand` above — a detached pane's
          // prompt does not travel with it.
          taskPrompt: capturedTaskPrompt(id),
          // The conversation a contract-layer source confirmed (stage 1: the
          // Claude registry), so restore reopens it rather than guessing.
          sessionId: tracker.snapshot(id)?.sessionId ?? null,
        };
      });
      return [
        {
          workspacePath: entry.workspacePath,
          layout,
          panes,
          name: override?.name ?? null,
          dotColor: override?.dotColor ?? null,
        },
      ];
    });
  }

  function activePaneCwd(): Promise<string | null> {
    return freshCwd(activeManager()?.activePaneId() ?? null, pty);
  }

  function ownerOf(paneId: number): TabEntry | undefined {
    return tabs.find((tab) => tab.manager.paneIds().includes(paneId));
  }

  /**
   * The Agent Board panel's snapshot of one pane (spec §11.5, DL-34.6).
   *
   * Resolved by pane id through `ownerOf`, never through the active tab: a
   * hidden tab is `display: none` and its xterm instances are all still alive,
   * which is what lets selecting a card leave the tab and the active pane
   * where they are (spec §5.4).
   *
   * The shaping happens HERE rather than in the terminal layer, so
   * `serializeScrollback` keeps answering what the buffer holds —
   * `pane-detach.ts` replays those escapes when a pane travels. `lines` is
   * both the addon's scrollback depth and the row cap: the addon always adds
   * the whole viewport on top of the rows it was asked for, so the raw string
   * runs past `lines` and usually ends in blank rows (spec §7.3).
   */
  function serializePane(paneId: number, lines: number): string | null {
    const raw = ownerOf(paneId)?.manager.serializePane(paneId, lines) ?? null;
    return raw === null ? null : lastRows(stripAnsiSequences(raw), lines);
  }

  /**
   * Whether this window still has that pane, with a PTY that is running.
   *
   * Two facts in one answer on purpose: a caller asking "can this pane still
   * be acted on" needs both, and a pane the window never held is not alive in
   * any sense.
   */
  function paneAlive(paneId: number): boolean {
    return ownerOf(paneId)?.manager.paneAlive(paneId) ?? false;
  }

  /**
   * Restart the agent a pane was running, resuming its conversation
   * (spec §5.6, §11.10).
   *
   * The write is what `AgentLauncher.arm` does — `writePty(command + "\r")`
   * into the pane's live shell — but `arm` itself fires once per pane id and
   * cannot be reused. The task prompt is deliberately NOT re-sent, and the
   * ordinal, the selection and the task line are all kept, because the pane
   * never goes away. `pane-lifecycle`'s respawn is a bare shell and is not
   * this.
   *
   * Answers false rather than writing anything when the pane is unknown, its
   * PTY has exited, an agent is STILL running in it, it never ran one, or that
   * agent has no resume form.
   */
  const restartingPanes = new Set<number>();

  async function restartPane(paneId: number): Promise<boolean> {
    if (restartingPanes.has(paneId)) return false;
    const owner = ownerOf(paneId);
    // An exited PTY still belongs to its tab, so `ownerOf` alone would let a
    // command be typed into a dead session and reported as a restart.
    if (owner === undefined || !owner.manager.paneAlive(paneId)) {
      return false;
    }
    // The poll cache `syncViews` itself reads, rather than the `tabViews`
    // projection this closure writes: same freshness, one fewer hop, and no
    // dependence on a sync having run.
    if (explicitAgent(poller.infoFor(paneId)) !== null) {
      return false; // an agent is still there — Restart is for one that left
    }
    const agent = paneGenerations.get(paneId)?.agent ?? null;
    if (agent === null) {
      return false; // this pane has never run an agent
    }
    const sessionId = paneGenerations.get(paneId)?.sessionId ?? lastSessionIdFor(paneId) ?? null;
    const command = restartCommandFor({
      agent,
      // The id the tail store KEPT on the agent's way out, never the live
      // pairing in `paneSessionIds`: `forget` empties that one at the exact
      // agent → shell transition after which Restart is offered, so reading it
      // would silently degrade every Restart to "latest".
      sessionId,
      launchCommand: launchCommandFor(paneId),
      customAgents: settings.value.customAgents,
    });
    if (command === null) {
      return false;
    }
    // `paneIo`, not `pty`: its `writePty` calls `activity.noteInput(id)` first,
    // which is what keeps the echoed command out of the working spinner.
    // `AgentLauncher` is built on it for exactly this reason.
    restartingPanes.add(paneId);
    try {
      const prepared = await prepareLaunch({ id: paneId, command });
      if (
        disposed ||
        ownerOf(paneId) !== owner ||
        !owner.manager.paneAlive(paneId) ||
        explicitAgent(poller.infoFor(paneId)) !== null ||
        prepared.command === null
      ) {
        return false;
      }
      await paneIo.writePty(paneId, `${prepared.command}\r`);
      if (agent === "claude" && sessionId !== null) {
        tracker.noteMintedSession(paneId, sessionId);
      }
      return true;
    } finally {
      restartingPanes.delete(paneId);
    }
  }

  /**
   * The tracker's read side (gate 2). One function, used by `injectIntoPane`
   * below AND returned on the interface, so the gate and any future reader can
   * never disagree about where a pane's attention comes from.
   */
  function paneAttention(paneId: number): PaneAttentionSnapshot | null {
    return tracker.snapshot(paneId);
  }

  /**
   * Paste-then-maybe-submit for the Prompt Board. The paste is unconditional
   * (it is exactly a ⌘V, and bracketed paste means even a bare shell inserts
   * without executing); the `\r` is not. Ordering is guaranteed by the
   * per-pane write queue, not by waiting: the paste frame is already queued
   * before this function awaits anything, so a `\r` enqueued after the await
   * can only ever land behind it.
   */
  async function injectIntoPane(
    paneId: number,
    text: string,
    opts: { readonly autoSend: boolean; readonly expectedAgent: string | null },
  ): Promise<InjectOutcome> {
    if (injectingPanes.has(paneId)) {
      return "busy";
    }
    injectingPanes.add(paneId);
    try {
      const owner = ownerOf(paneId);
      const attentionBeforePaste = paneAttention(paneId);
      const paste = owner?.manager.pasteIntoPane(paneId, text) ?? null;
      if (paste === null) {
        return "no-target";
      }
      if (!(await paste)) {
        return "failed";
      }
      if (!opts.autoSend) {
        return "pasted";
      }
      const [info] = await freshPaneInfo(
        [paneId],
        pty,
        agentProcessMatchers(settings.value.customAgents),
      );
      // Re-resolved after the await: the tab could have closed across it.
      const stillOwned = ownerOf(paneId);
      const attentionBeforeSubmit = paneAttention(paneId);
      // Focus acknowledges and clears attention. Requiring the same revision at
      // both ends prevents any focus path from erasing a warning/permission latch
      // while paste or fresh pty_info is in flight. Any state change fails closed.
      const attentionStayedStable =
        attentionBeforePaste !== null &&
        attentionBeforeSubmit !== null &&
        attentionBeforePaste.revision === attentionBeforeSubmit.revision;
      const allowed =
        attentionStayedStable &&
        submitAllowed({
          expectedAgent: opts.expectedAgent,
          info,
          attention: attentionBeforeSubmit,
          alive: stillOwned !== undefined,
        });
      if (!allowed || stillOwned === undefined) {
        return "pasted";
      }
      const submit = stillOwned.manager.submitPane(paneId);
      return submit !== null && (await submit) ? "sent" : "pasted";
    } finally {
      injectingPanes.delete(paneId);
    }
  }

  /** A tab with no workspace is always live; an unanswerable check fails open. */
  async function workspaceIsLive(path: string | null): Promise<boolean> {
    if (path === null) {
      return true;
    }
    try {
      const [exists] = await pty.dirsExist([path]);
      return exists !== false;
    } catch (err) {
      console.warn("dirs_exist failed; reopening the tab anyway:", err);
      return true;
    }
  }

  /**
   * Cmd+Shift+T. The folder can be deleted between closing the tab and
   * reopening it (the snapshot survives up to MAX_CLOSED_TABS closes), and
   * spawning at a dead CWD silently lands in `$HOME` while the tab keeps
   * claiming the folder. Dead snapshots are discarded and the next one down
   * the stack is tried instead. Reopen does NOT re-run the agent (agent: null).
   */
  async function reopenTab(): Promise<void> {
    let stack = closedTabs;
    for (;;) {
      const [snapshot, rest] = popClosedTab(stack);
      if (snapshot === null) {
        closedTabs = stack;
        return;
      }
      if (!(await workspaceIsLive(snapshot.workspacePath))) {
        console.warn(`Not reopening tab: workspace ${snapshot.workspacePath} no longer exists`);
        stack = rest; // drop the dead snapshot, try the one below it
        continue;
      }
      if (
        !(await materialize({
          layout: snapshot.layout,
          cwds: snapshot.cwds,
          chrome: materializeChromeFrom(snapshot.name, snapshot.dotColor),
          ...(snapshot.workspacePath !== null ? { workspacePath: snapshot.workspacePath } : {}),
        }))
      ) {
        closedTabs = stack; // spawn failed — keep the snapshot for another try
        return;
      }
      closedTabs = rest;
      return;
    }
  }

  /** Unguarded dispose — Busy already confirmed by CloseCoordinator. */
  async function disposeTab(index: number): Promise<void> {
    const entry = tabs[index];
    if (!entry) {
      return;
    }
    // Snapshot BEFORE dispose — fresh CWDs (same policy as Layout preset).
    // The fresh pty_info is an IPC await, so resolve it before touching any
    // tab state; the positional index can go stale across it (rapid Cmd+W).
    const layout = entry.manager.serializeLayout();
    if (layout !== null) {
      const override = overrides.get(entry.key);
      const cwds = await resolvePaneCwds(entry.manager.paneIds(), "fresh", {
        pty,
      });
      closedTabs = pushClosedTab(
        closedTabs,
        buildClosedTabSnapshot({
          layout,
          name: override?.name ?? null,
          dotColor: override?.dotColor ?? null,
          cwds,
          workspacePath: entry.workspacePath,
        }),
      );
    }
    // Re-derive position from the captured entry: a concurrent close during
    // the await above may have removed/shifted it. -1 → already disposed.
    const removeAt = tabs.indexOf(entry);
    if (removeAt === -1) {
      return;
    }
    const closingActive = removeAt === active;
    const countBefore = tabs.length;
    entry.manager.dispose();
    tabs.splice(removeAt, 1);
    overrides.delete(entry.key);
    unread.delete(entry.key);
    taskPromptTargetByTab.delete(entry.key);
    const live = allPaneIds();
    launcher.prune(live);
    activity.prune(live);
    tracker.prune(live);
    notifier.prune(live);
    pruneNotifiedKinds(live);
    pruneLaunchCommands(live);
    poller.prune(live);
    registrySync.prune(live);
    if (tabs.length === 0) {
      // "Surface", not "tab": a window holding file tabs still has something to
      // show, and closing it would discard them — including unsaved ones, with
      // no prompt, since the busy guard that just ran only knew about panes.
      active = -1;
      if (surfaces.total() > 0) {
        surfaces.activate(0);
        syncViews();
        return;
      }
      // The window STAYS (close model, 2026-08-22, table row 3). Closing the
      // last agent used to close the window — every window was a peer and the
      // last SURFACE took it with them — and the owner reversed that: an empty
      // window keeps its rail, so the projects you were just in are still
      // there, and the stage shows the Open board instead of the grid.
      //
      // The window is still closable, by its own controls; what changed is
      // that closing the last piece of WORK is no longer the same gesture as
      // closing the place you do it in. `flushSettingsSave` went with the
      // close: it existed to get settings to disk before the process could
      // lose them, and nothing here is dying any more.
      //
      // `boardOpen` rather than an `App`-side reaction to an empty
      // `tabViews`: `disposeTab` is the one place that knows the last tab just
      // went, and App already treats the board as uncancellable while no tab
      // is open (`canCancel={tabViews.value.length > 0}`), so the surface it
      // raises here cannot be dismissed into an empty stage.
      boardOpen.value = true;
      syncViews();
      return;
    }
    active = activeAfterClose(removeAt, active, countBefore);
    if (closingActive) {
      tabs[active].manager.show();
    }
    syncViews();
  }

  const close = createCloseCoordinator({
    confirmClose: (paneIds) => confirmClose(paneIds, pty),
    activeManager,
    activeIndex: () => active,
    tabAt: (index) => tabs[index],
    indexOf: (entry) => tabs.findIndex((tab) => tab.manager === entry.manager),
    disposeTab,
  });

  /**
   * Every pane of every tab: the workspace dot must see an agent running in a
   * background pane of a background tab, so polling only the active panes is
   * no longer enough. One `pty_info` IPC takes the whole id list.
   */
  function pollTargets(): number[] {
    if (windowsStartupSpawns > 0) {
      return [];
    }
    const ids = allPaneIds();
    if (windowsStartupPollFallbacks.size === 0) {
      return ids;
    }
    const live = new Set(ids);
    for (const id of [...windowsStartupPollFallbacks.keys()]) {
      if (!live.has(id)) {
        forgetWindowsStartupPoll(id);
      }
    }
    return windowsStartupPollFallbacks.size === 0 ? ids : [];
  }

  function beginWindowsStartupSpawn(): (() => void) | null {
    if (getDesktopEnvironment().platform !== "windows") {
      return null;
    }
    windowsStartupSpawns += 1;
    let finished = false;
    return () => {
      if (finished) {
        return;
      }
      finished = true;
      windowsStartupSpawns -= 1;
    };
  }

  function currentAgentMatchers() {
    return agentProcessMatchers(settings.value.customAgents);
  }

  const poller = createPaneInfoPoller({
    pty,
    targets: pollTargets,
    activePaneId: () => activeManager()?.activePaneId() ?? null,
    agentMatchers: currentAgentMatchers,
    onUpdate(infos) {
      activeManager()?.updatePaneInfo(infos, home);
      // Reconcile the tracker's explicit process gate before this cycle's
      // state is aggregated. Display labels never decide whether the gate
      // opens: only a classified, named agent can do that.
      for (const info of infos) {
        const agent = explicitAgent(info);
        // The activity module's snapshot is read HERE, before `syncViews`
        // below hands the new process label to `activity.noteProcess` and
        // resets the record — so an OSC 9;4 the agent reported before this
        // poll recognised it can seed the gate it is about to open (trust
        // audit §4.5). Order is load-bearing; keep the seed ahead of the sync.
        const snap = tracker.noteProcess(
          info.id,
          agent ?? info.process,
          agent !== null,
          activity.snapshot(info.id),
        );
        if (snap !== null) {
          maybeNotify(info.id, snap);
        }
      }
      // Stage 3's freshness: a contract-layer state nobody has refreshed in
      // two minutes turns inferred, on the same tick the process table is
      // read — the fallback it hands over to. Not routed through
      // `maybeNotify`: the KIND does not change, only its confidence, and
      // the sync below re-renders the hollow mark.
      tracker.tick(now());
      syncViews();
    },
  });

  // The Claude registry joined to this window's panes (agent-signal contract
  // layer, stage 1). Reads the SAME `pty_info` cache the poller keeps — the
  // foreground pid is the join key — and feeds the tracker a fact per Claude
  // pane: its session id, and whether Claude itself reports `waiting`. The
  // host facade answers "unavailable" on Tauri and in the browser preview, and
  // the sync treats that as today's behaviour, so nothing here is host-gated
  // beyond the facade. A `null` seam disables it outright (tests).
  const registryFetch = deps.registry === undefined ? fetchAgentRegistry : deps.registry;
  const registrySync = createAgentRegistrySync({
    fetch: registryFetch ?? (() => Promise.resolve(UNAVAILABLE_REGISTRY)),
    paneIds: allPaneIds,
    agentOf: (id) => explicitAgent(poller.infoFor(id)),
    processIdOf: (id) => {
      const pid = poller.infoFor(id)?.processId;
      return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
    },
    onFact: (id, fact) => {
      const snap = tracker.noteRegistry(id, fact);
      if (snap !== null) {
        maybeNotify(id, snap);
      }
    },
    onApplied: syncViews,
  });

  function forgetWindowsStartupPoll(id: number): boolean {
    const fallback = windowsStartupPollFallbacks.get(id);
    if (fallback === undefined) {
      return false;
    }
    clearTimeout(fallback);
    windowsStartupPollFallbacks.delete(id);
    return true;
  }

  function releaseWindowsStartupPoll(id: number): void {
    forgetWindowsStartupPoll(id);
  }

  function deferWindowsStartupPoll(ids: readonly number[]): boolean {
    if (getDesktopEnvironment().platform !== "windows" || ids.length === 0) {
      return false;
    }
    for (const id of ids) {
      if (windowsStartupReady.delete(id)) {
        continue;
      }
      if (windowsStartupPollFallbacks.has(id)) {
        continue;
      }
      windowsStartupPollFallbacks.set(
        id,
        setTimeout(() => releaseWindowsStartupPoll(id), WINDOWS_STARTUP_POLL_FALLBACK_MS),
      );
    }
    return true;
  }

  /**
   * The strip as the user sees it: every chip, terminal or surface, in the
   * one open order (`lib/strip-order.ts`).
   *
   * Every keyboard path that names a POSITION goes through this — cycling,
   * ⌘1–9 and ⌘9 — so "the third chip" resolves the same way for the keymap
   * as it paints in `TabStrip`. Recomputed per call rather than cached: tabs
   * and surfaces both open and close underneath it, and the list is at most a
   * few dozen entries.
   */
  function stripSlots(): readonly StripSlot[] {
    const visible = deps.visibleTabIndexes?.();
    return mergeStripOrder(
      tabs.map((tab) => ({ openedAt: tab.openedAt })),
      Array.from({ length: surfaces.count() }, (_, index) => ({
        openedAt: surfaces.orderKey?.(index) ?? UNSEQUENCED,
      })),
      stripPreferences.value,
    ).filter(
      (slot) => slot.kind === "surface" || visible === undefined || visible.includes(slot.index),
    );
  }

  /** Take the chip at `position` in the merged strip. Out of range = no-op. */
  function selectStripSlot(position: number): void {
    const slot = stripSlots()[position];
    if (slot === undefined) {
      return;
    }
    if (slot.kind === "tab") {
      selectTab(slot.index);
      return;
    }
    surfaces.activate(slot.index);
  }

  /**
   * ⌘⇧] / ⌘⇧[ — cycle every SURFACE in the strip, not just the terminal tabs.
   *
   * Walks the merged open order (2026-08-16), not the old
   * terminals-then-surfaces segments: a strip whose chips are interleaved
   * would otherwise cycle in an order nothing on screen explains. The
   * `tabs.length < 2` early return this replaced is why one terminal tab plus
   * three file tabs used to do nothing at all: file tabs are the keyboard path
   * to a file (spec §4.3), and that guard silently removed it.
   */
  function cycleTab(step: 1 | -1): void {
    const slots = stripSlots();
    if (slots.length < 2) {
      return;
    }
    const surfaceIndex = surfaces.activeIndex();
    const current = slots.findIndex((slot) =>
      surfaceIndex >= 0
        ? slot.kind === "surface" && slot.index === surfaceIndex
        : slot.kind === "tab" && slot.index === active,
    );
    // No active chip at all (no tabs yet, or an active index nothing owns):
    // step from before the first slot so ⌘⇧] lands on it and ⌘⇧[ on the last.
    const from = current === -1 ? (step === 1 ? -1 : 0) : current;
    selectStripSlot((from + step + slots.length) % slots.length);
  }

  /**
   * Copy `id`'s polled CWD to the clipboard (⌘⇧C / menu Edit ▸ "Copy Working
   * Directory").
   * No-op if the pane is unknown or its CWD has not been polled yet — never
   * copies a stale/empty value. A write failure reports through the active
   * pane's `notifyError` (C5/C6: never swallowed silently).
   */
  function copyPaneCwd(id: number): void {
    const cwd = poller.infoFor(id)?.cwd ?? null;
    if (cwd === null) {
      return;
    }
    navigator.clipboard.writeText(cwd).catch(() => {
      activeManager()?.notifyError("Couldn't copy the working directory");
    });
  }

  /**
   * The Edit menu's Select All / Undo / Redo.
   *
   * These three used to be native Cocoa roles, which run a DOCUMENT-level
   * Chromium command. That reaches a terminal's helper textarea and every
   * chrome `<input>` — and reaches Monaco not at all, because with
   * `editContext` on (its default since 0.52) the caret lives in a
   * `div.native-edit-context` that owns no DOM selection. So a file on the
   * stage answered ⌘A with nothing, and the ⌘C that followed copied only the
   * cursor's line (measured 2026-08-19).
   *
   * The surface gets first refusal; anything it declines falls through to the
   * very command the role used to run, so a terminal, a settings field and the
   * file tree all keep the behaviour they had. `execCommand` is deprecated and
   * still the only synchronous way to ask Chromium for these three.
   */
  function runEditCommand(command: SurfaceEditCommand): void {
    if (surfaces.runEditCommand?.(command) === true) {
      return;
    }
    document.execCommand(command === "select-all" ? "selectAll" : command);
  }

  // Keymap *matching* lives in keymap.ts; this table is the dispatch half —
  // one action, one closure. `select-tab-N` and `select-last-tab` (⌘9) are
  // both handled directly in `dispatchAction`, not through this table.
  const commands = {
    "split-row": () => void splitActive("row"),
    "split-column": () => void splitActive("column"),
    // ⌘W. Two sites, not one: this is `close-pane`, and `close-tab` (⌘⇧W) is
    // the other. Spec §4.3's "⌘W on a file tab closes the file tab" means THIS
    // one, and neither may fall through to the other — a file tab has no pane
    // to close, and closing the terminal tab behind it would be a silent
    // catastrophe.
    "close-pane": () =>
      surfaces.activeIndex() >= 0 ? void surfaces.close() : void close.closePane(),
    "focus-next": () => activeManager()?.cycleFocus(1),
    "focus-prev": () => activeManager()?.cycleFocus(-1),
    "toggle-expand": () => updateSettings({ focusExpand: !settings.value.focusExpand }),
    "new-tab": () => void newTab(),
    "close-tab": () => void close.closeTab(active),
    "next-tab": () => cycleTab(1),
    "prev-tab": () => cycleTab(-1),
    "zoom-in": () => updateSettings({ fontSize: clampFontSize(settings.value.fontSize + 1) }),
    "zoom-out": () => updateSettings({ fontSize: clampFontSize(settings.value.fontSize - 1) }),
    "zoom-reset": () => updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize }),
    "toggle-zoom-pane": () => activeManager()?.toggleZoom(),
    "clear-buffer": () => activeManager()?.clearActive(),
    "copy-selection": () => activeManager()?.copyActiveSelection(),
    // Only ever reached when the predicate said a selection exists, so this
    // never has to decide between copying and interrupting — the interrupt
    // branch is the KEY not being consumed, so xterm encodes it (spec).
    // The clear is synchronous after the text is read: `copyTerminalSelection`
    // writes the clipboard asynchronously, and clearing in its callback could
    // erase a selection the user made in the meantime (spec D4).
    "copy-or-interrupt": () => {
      const manager = activeManager();
      manager?.copyActiveSelection();
      manager?.clearActiveSelection();
    },
    paste: () => activeManager()?.pasteIntoActive(),
    "copy-cwd": () => {
      const paneId = activeManager()?.activePaneId() ?? null;
      if (paneId !== null) {
        copyPaneCwd(paneId);
      }
    },
    "focus-left": () => activeManager()?.focusDirection("left"),
    "focus-right": () => activeManager()?.focusDirection("right"),
    "focus-up": () => activeManager()?.focusDirection("up"),
    "focus-down": () => activeManager()?.focusDirection("down"),
    "swap-left": () => activeManager()?.swapDirection("left"),
    "swap-right": () => activeManager()?.swapDirection("right"),
    "swap-up": () => activeManager()?.swapDirection("up"),
    "swap-down": () => activeManager()?.swapDirection("down"),
    "scroll-page-up": () => activeManager()?.scrollActivePage(-1),
    "scroll-page-down": () => activeManager()?.scrollActivePage(1),
    "scroll-to-top": () => activeManager()?.scrollActiveToEdge("top"),
    "scroll-to-bottom": () => activeManager()?.scrollActiveToEdge("bottom"),
    "reopen-tab": () => void reopenTab(),
    // Never calls `focusNextAttention` directly — routes the request through
    // the optional app seam so the app can run the overlay preflight (Task
    // 15) first. Missing `onRequestAttentionFocus` = safe no-op, never a
    // direct focus/ack.
    "focus-next-attention": () => deps.onRequestAttentionFocus?.(),
    // Never touches `settingsOpen` directly — routes through the optional
    // app seam (mirrors `focus-next-attention` above) so App keeps owning
    // the close+focus-return flow it already owns for every other overlay.
    // Missing `onToggleSettings` = safe no-op, never a direct write.
    "toggle-settings": () => deps.onToggleSettings?.(),
    // Seam style, like `toggle-settings` above and unlike `toggle-prompts`
    // below: this one opens a full-window surface that must close Settings,
    // return focus on Escape, and refuse to open under a modal draft. All
    // three live in App; splitting them would put the mutual-exclusion rule
    // in two files. Missing `onToggleUsage` = safe no-op, never a direct write.
    "toggle-usage": () => deps.onToggleUsage?.(),
    // Writes the signal directly rather than routing through an App seam
    // (unlike toggle-settings): the popover has no draft to protect and no
    // overlay stack to keep consistent.
    //
    // The close branch returns focus HERE, not in the popover: this path
    // unmounts the surface without ever calling its `onClose`, so DL-13.2's
    // "focus returns to the pane that had it" would otherwise be skipped and
    // the caret would land on <body> — the shortcut fires while focus sits on
    // the popover root, a div, so nothing else would take it back.
    "move-pane-to-new-window": () => void movePaneToNewWindow(),
    // The browser is a strip tab whose surface covers the stage: the toggle
    // walks it through take-the-stage / step-back, never through close — the
    // chip's own ✕ is the only close. The view is host-owned, and the store
    // helpers swallow their own transport errors, because a browser surface
    // that fails to open must not take a keystroke's dispatch down with it.
    // `syncViews()` after every branch for the same reason the file side
    // routes `onSurfacesChanged` into `notifySurfacesChanged`: TabManager's
    // derived views cannot see a store-signal transition on their own.
    "toggle-browser": () => {
      if (browserSurfaceActive.value) {
        deactivateBrowserSurface(defaultBrowserClient);
        syncViews();
        activeManager()?.focusActive();
        return;
      }
      // An active file surface steps back first — exactly one surface owns
      // the stage, and this is one of the synchronous paths that keeps it so.
      surfaces.deactivate();
      if (browserOpen.value) {
        activateBrowserSurface();
      } else {
        void openBrowser(
          defaultBrowserClient,
          // Restore the last committed page across relaunch; home is the
          // first-run answer (browser productization §3).
          settings.value.browserLastUrl || settings.value.browserHomeUrl,
        );
      }
      syncViews();
    },
    // The Board is the browser's twin as a stage surface, and its toggle walks
    // the same take-the-stage / step-back path — never through close, since
    // the chip's own ✕ (and ⌘W) are what close the tab (spec §4.4).
    "toggle-agent-board": () => {
      if (agentBoardSurfaceActive.value) {
        stepAgentBoardBack();
        // `syncViews()` because TabManager's derived views cannot see a
        // store-signal transition on their own; `focusActive()` because the
        // keyboard has to land somewhere and the terminal is where it came
        // from — this path unmounts the surface without going through a close
        // callback of the Board's own, so nothing else would hand focus back
        // and the caret would land on <body>. Both copied from
        // `toggle-browser`'s close branch above.
        syncViews();
        activeManager()?.focusActive();
        return;
      }
      // Exactly one surface owns the stage, and this is a synchronous path
      // that keeps it so: the chord reaches the store directly rather than
      // going through `composeSurfaceStrip.activate`, so it must clear the
      // others itself. `takeStageForSurface` (stage-surface-strip.ts) is the
      // chip's version of the same rule; it cannot serve here because it
      // requires the chip to already EXIST, and the chord is what creates it.
      //
      // `surfaces.deactivate()` alone — it already steps the browser back
      // through the client the strip was INJECTED with, and calling
      // `deactivateBrowserSurface(defaultBrowserClient)` here as well would
      // reach past that injection to the real client, which a test cannot
      // stand in for.
      //
      // Deactivate first, THEN open, for two independent reasons. The strip's
      // own `deactivate()` runs `stepBoardBack()` before anything else, so the
      // other order raises the Board and takes it down again in this very
      // block. And `App` runs a "the Board yields" backstop effect that steps
      // the Board off the stage while the browser or a file surface is still
      // active — omitting the deactivate entirely would leave BOTH flags up
      // and have that effect undo the chord a frame later, exactly when a
      // document is open. `activateTerminalSurface()` is synchronous, so
      // deactivating here is what makes the effect a no-op rather than a
      // race.
      surfaces.deactivate();
      openAgentBoard();
      syncViews();
    },
    // Plain setting flips, unlike toggle-browser above: the dock is pure DOM
    // content, so there is no host view to create or tear down. Focus still
    // returns to the pane on close, same reasoning as toggle-browser and
    // toggle-prompts below — this path never goes through a close callback of
    // the dock's own.
    //
    // `toggle-dock` opens the column on whichever tab it last showed;
    // `toggle-explorer` names a tab, so it REVEALS that one (open on it,
    // switch to it, or — only if it is already the tab on screen — close).
    // One chord per surface, and the chord always means "show me this".
    //
    // `focusStage()`, not `activeManager()?.focusActive()`: the column can be
    // put away while a document holds the stage (that is what
    // `isChromeScopedAction` restores), and handing focus to the terminal
    // behind it would take the caret out of the editor the user is looking at.
    "toggle-dock": () => {
      toggleDock();
      if (!settings.value.dockOpen) {
        focusStage();
      }
    },
    "toggle-explorer": () => {
      if (revealDockTab("explorer")) {
        focusStage();
      }
    },
    // Guarded where its two siblings are not, because this tab can be ABSENT:
    // `availableDockTabs` drops it on a host with no `sessions_list`, and
    // `resolveDockTab` then falls the column back to explorer — so an
    // unguarded reveal would answer "Session History" by opening the file
    // explorer. Says so instead, the way `toggle-prompts` says there is no
    // pane to paste into.
    "toggle-sessions": () => {
      if (!sessionsSupported.value) {
        reportChromeMessage("Session history is not available on this host.");
        return;
      }
      if (revealDockTab("sessions")) {
        focusStage();
      }
    },
    "toggle-prompts": () => {
      if (promptsOpen.value) {
        promptsOpen.value = false;
        activeManager()?.focusActive();
        return;
      }
      if ((activeManager()?.activePaneId() ?? null) === null) {
        reportChromeMessage("No pane to paste into.");
        return;
      }
      promptsOpen.value = true;
    },
    find: () => activeManager()?.openSearch(),
    // Not exempted in overlayBlocksAction below: both act on the terminal
    // (highlight/jump inside a pane's buffer), same scope as clear-buffer.
    "find-next": () => activeManager()?.findNext(),
    "find-previous": () => activeManager()?.findPrevious(),
    // Task 6's action; wired here (Task 5 owns this table). `surfaces.save()`
    // is ALREADY a no-op with nothing to save when no file surface is active
    // (`FileSurfaceController.save`, file-surface-controller.ts) — matching
    // the registry's "scoped: no-op when no file tab is active" without a
    // second check here.
    "save-file": () => void surfaces.save(),
    // Flip the document on the stage between the rendered view and its source
    // (design 2026-08-23 §4). Unguarded here: `isActionPerformable` already
    // refused the keystroke unless a surface with two views owns the stage,
    // and a menu click lands on a `toggleView` that is a no-op otherwise.
    "toggle-markdown-view": () => surfaces.toggleView?.(),
    "select-all": () => runEditCommand("select-all"),
    undo: () => runEditCommand("undo"),
    redo: () => runEditCommand("redo"),
    // The overlay scope guard in `dispatchAction` already blocks this while
    // any overlay (including the board) is up — this check is pure business
    // logic (nothing to save with zero tabs), not scope.
    "save-preset": () => {
      if (tabs.length > 0) {
        saveDialogOpen.value = true;
      }
    },
    // Unified onto the same action:/runAction path as every other item
    // (Task 4) — used to reach the app through a dedicated, unguarded
    // `menu:new-preset` Tauri event instead. Sets the same request the live
    // window's "New Layout Preset…" board flow already used.
    "new-preset": () => {
      editorRequest.value = { source: "live" };
    },
  } satisfies Record<(typeof COMMAND_ACTIONS)[number], () => void>;

  /**
   * Ranks of every overlay that is currently open (Open board, Settings, the
   * token usage screen, the session history screen,
   * PresetEditor/SavePresetDialog/AgentQuickPicker share the "modal" rank —
   * see `TIER_RANK`'s doc comment in action-registry.ts for why). Empty when
   * nothing covers the terminal grid.
   *
   * Usage AND session history both reuse `TIER_RANK.settings` rather than
   * getting a member of their own in the `OverlayTier` union. The rank is
   * what an action is compared AGAINST, and each of them covers the grid
   * exactly the way Settings does (all full-window, all above the board, all
   * below a modal draft) — so the comparison they want already exists.
   * Adding a tier per surface would introduce a rank nothing is tiered at,
   * next to `"settings"`, which is already a rank nothing is tiered at. One
   * such rank is a documented deliberate gap; two is a pattern nobody can
   * explain.
   */
  function openOverlayRanks(): readonly number[] {
    const ranks: number[] = [];
    // Settings alone since 2026-08-16: token usage and session history left
    // full-window for tabs of the dock, and a docked column displaces the
    // terminal grid instead of covering it (DL-19.1). A pane-scoped shortcut
    // behind an open dock still has its pane on screen, so blocking it would
    // be the tier model firing at a surface it was not written for.
    if (settingsOpen.value) {
      ranks.push(TIER_RANK.settings);
    }
    if (boardOpen.value) {
      ranks.push(TIER_RANK.board);
    }
    if (
      editorRequest.value !== null ||
      saveDialogOpen.value ||
      agentQuickPickerOpen.value ||
      // The consent dialog is the same `.modal-scrim` genre as the three above
      // and therefore the same rank — but it is the only one a user cannot
      // dismiss (DL-29.9 withdraws both exits), which made its absence here
      // the worst of the four: every chord ran behind a scrim that was not
      // going away until an answer was persisted. Read off the store, not off
      // an `App`-written copy, so the guard and the dialog can never disagree.
      usageConsentOpen.value
    ) {
      ranks.push(TIER_RANK.modal);
    }
    return ranks;
  }

  /**
   * Which kind of thing owns the stage, for `isActionPerformable`.
   *
   * `browserSurfaceActive` is read beside `surfaces.activeIndex()` rather than
   * trusted to be folded into it: the browser tab is a `SurfaceStrip` member,
   * but `openOverlayRanks` above does not mention it, and answering "terminal"
   * while a web view covers the stage would consume a key the page wanted.
   * Reading both fails toward not consuming, which is the safe direction.
   */
  function stageOwner(): StageOwner {
    if (openOverlayRanks().length > 0) {
      return "overlay";
    }
    if (surfaces.activeIndex() >= 0 || browserSurfaceActive.value) {
      return "surface";
    }
    return "terminal";
  }

  function performableContext(): PerformableContext {
    return {
      stageOwner: stageOwner(),
      // `?? false` is the fail-toward-the-PTY rule (spec D5): no manager means
      // no selection means the key is not consumed.
      hasSelection: activeManager()?.activeHasSelection() ?? false,
      // Same direction: a `SurfaceStrip` that does not implement the seam
      // (every fake written before 2026-08-23, and `INERT_SURFACES`) answers
      // "no second view", so the chord is never consumed on its behalf.
      surfaceCanToggleView: surfaces.canToggleView?.() ?? false,
      // `__deckHost` presence — the same one-line tell five modules in
      // `src/host/` already use (e.g. `worktree-host.ts`'s `available`).
      // Read here rather than imported from `electron-updater-adapter.ts`,
      // whose `hasDeckHost()` is private. An unanswered host is a third
      // state, and here it means "no Board", which is the direction that does
      // not consume the chord.
      hostHasAgentBoard: (globalThis as { __deckHost?: unknown }).__deckHost !== undefined,
    };
  }

  /**
   * Single choke point deciding whether `action` may run while an overlay
   * (Settings, Usage, Session history, Open board, PresetEditor,
   * SavePresetDialog, AgentQuickPicker) is covering the terminal grid.
   * Default tier is `"pane"` (rank 0) — blocked whenever ANY
   * overlay is open, since every open overlay's rank is >= 0. Every action
   * that reaches into the terminal/tab/pane state needs this: it is
   * invisible and dangerous while its target is hidden (⌘W closing a pane
   * nobody can see, ⌘K wiping scrollback, etc). A non-`"pane"` tier
   * (`"board"`/`"modal"`) only blocks the action while an overlay ranked at
   * or above it is open.
   *
   * `scope: "always"` (`focus-next-attention`, `toggle-settings`) skips the
   * comparison entirely — see each entry's comment in action-registry.ts for
   * why (a dedicated overlay preflight, or an action that opens/closes the
   * very overlay that would otherwise strand it). Every "switch tabs" action
   * (`select-tab-N`, `select-last-tab`, `next-tab`, `prev-tab`) is exempt
   * through the SEPARATE `isTabSwitchAction` mechanism below, not through
   * `scope` — see its own doc comment for why that's a distinct action
   * family, not a product-level "always" decision.
   */
  function overlayBlocksAction(action: ShortcutAction): boolean {
    const scope = ACTION_SCOPE.get(action);
    if (scope === undefined || scope === "always" || isTabSwitchAction(action)) {
      return false;
    }
    // A file surface owns the stage the same way an overlay does, but it is
    // invisible to `isChromeTextField` (Monaco focuses a plain `<div>`, never
    // an `<input>`/`<textarea>`), so nothing upstream of this guard can tell
    // a "pane"-tiered action it is about to act on a terminal tab hidden
    // behind an open editor. Two exemptions, for two different reasons:
    // `isSurfaceRoutedAction` is "already knows how to reach the surface",
    // `isChromeScopedAction` is "never touches the stage at all". Every other
    // "pane" action targets `activeManager()` directly and must not reach it
    // here.
    if (
      scope === "pane" &&
      surfaces.activeIndex() >= 0 &&
      !isSurfaceRoutedAction(action) &&
      !isChromeScopedAction(action)
    ) {
      return true;
    }
    const targetRank = TIER_RANK[scope];
    return openOverlayRanks().some((rank) => rank >= targetRank);
  }

  /**
   * "pane"-tiered actions that already know how to reach a non-terminal
   * surface themselves: `close-pane` -> `surfaces.close()`, `save-file` ->
   * `surfaces.save()`, `toggle-markdown-view` -> `surfaces.toggleView()` (all
   * three in the `commands` table below),
   * `move-pane-to-new-window`, which refuses with its own chrome message
   * (`movePane` above) rather than acting on `activeManager()`, and
   * `toggle-browser`/`toggle-agent-board`, whose commands ARE surface
   * transitions — blocking one while an editor holds the stage would make the
   * chord a no-op exactly when it is most useful. The Board's is load-bearing
   * in a second way the browser's is not: `composeSurfaceStrip.activeIndex()`
   * answers the BOARD's own slot while the Board holds the stage, so without
   * this exemption ⌘⇧O could open the Board and never close it again.
   * `overlayBlocksAction` exempts exactly these six from the surface block so
   * that surface-aware behavior still runs.
   */
  function isSurfaceRoutedAction(action: ShortcutAction): boolean {
    return (
      action === "close-pane" ||
      action === "save-file" ||
      action === "toggle-markdown-view" ||
      action === "toggle-browser" ||
      action === "toggle-agent-board" ||
      action === "move-pane-to-new-window"
    );
  }

  /**
   * "pane"-tiered actions that act on the CHROME AROUND the stage and never
   * on whatever is holding it — the docked column's three toggles.
   *
   * They keep the `"pane"` tier because an overlay covers the column along
   * with the grid (see each entry in action-registry.ts), so the overlay-rank
   * half of `overlayBlocksAction` still applies to them. A file surface is not
   * an overlay: it takes the STAGE, while the column beside the stage stays on
   * screen — and these three are the only way to put it away. Blocking them
   * behind the surface guard stranded the dock open with a document on the
   * stage, and it failed silently: the `DockToggle` button, the drag-past-the-
   * floor close, the View menu items and ⌘⇧B / ⌘⇧U all did nothing at all
   * (2026-08-17).
   *
   * Deliberately a SECOND set rather than more members of
   * `isSurfaceRoutedAction` above: that one's rule is "already knows how to
   * reach the surface", and these touch no surface and no pane, so the same
   * exemption for the opposite reason would make either comment false.
   *
   * `toggle-prompts` is NOT here and must not be: it pastes into the FOCUSED
   * pane, which a document on the stage hides — blocking it there is the
   * guard working, not the defect this fixes.
   */
  function isChromeScopedAction(action: ShortcutAction): boolean {
    return (
      action === "toggle-dock" ||
      action === "toggle-explorer" ||
      action === "toggle-sessions" ||
      action === "toggle-usage"
    );
  }

  /**
   * True for every "switch which tab is active" action: `select-tab-N` (a
   * fixed index), `select-last-tab` (⌘9, always the last tab), and
   * `next-tab`/`prev-tab` (⌘⇧]/⌘⇧[, cycle by one). Renamed from
   * isTabSelectionAction (decision 3, 2026-07-27 code review): next-tab/
   * prev-tab joined this group when the F1 fix below made select-tab-N/
   * select-last-tab dismiss-then-act while leaving the other two "switch
   * tabs" actions fully blocked — an inconsistency created by that same fix,
   * not a pre-existing one. Shared by the overlay scope guard above and
   * `dispatchAction` below so all four stay in sync as exactly one group.
   */
  function isTabSwitchAction(action: ShortcutAction): boolean {
    return (
      action === "select-last-tab" ||
      action === "next-tab" ||
      action === "prev-tab" ||
      selectTabIndex(action) !== null
    );
  }

  /**
   * A text field belonging to the chrome rather than to a terminal — the tab
   * rename input, the search bar, a settings field. Shortcuts must not fire
   * while one of these holds the caret.
   */
  function isChromeTextField(node: unknown): boolean {
    return (
      (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) &&
      !node.closest(".pane__term")
    );
  }

  /** The dispatch half, shared by the keymap and the menu. */
  function dispatchAction(action: ShortcutAction): void {
    if (overlayBlocksAction(action)) {
      return;
    }
    // `tabs.length > 0` is load-bearing, not defensive noise: with no tab at
    // all there is nothing behind the board to switch TO, so dismissing it
    // would leave an empty `.stage` — no board, no terminal, nothing on
    // screen. That is the app's own default landing state (it always opens on
    // the board, there is no session restore), so a habitual ⌘1 there used to
    // blank the window outright. The board itself already encodes this
    // invariant on the mouse path: `canCancel={tabViews.value.length > 0}`
    // (app.tsx) refuses to let Cancel/Escape close it with zero tabs — this
    // guard is the keyboard half of the same rule.
    // `stripSlots().length` rather than `tabs.length` since 2026-08-16: the
    // guard asks "is there anything behind the board to switch TO", and with
    // "last surface, not last tab" a window can hold zero terminal tabs and
    // still have file chips. Counting only tabs there would let a digit
    // activate a document UNDER a board that never dismissed.
    if (isTabSwitchAction(action) && stripSlots().length > 0) {
      // F1 (2026-07-27 code review): mirrors App.selectTab's click path
      // (app.tsx), which has always cleared boardOpen before switching.
      // Without this, selectTab()'s manager.show() focuses the newly active
      // pane's textarea BEHIND the still-open board (z-30) — every
      // following keystroke, Enter included, silently reaches a hidden
      // shell instead of the terminal the user can see. Unconditional (a
      // no-op when the board is already closed) and does NOT gate on
      // settings/presetEditor/saveDialogOpen either, matching the click
      // path exactly: TabBar sits outside `.stage`, so it is never covered
      // by `.modal-scrim`, and clicking a tab already works over a draft.
      // Decision 3: next-tab/prev-tab dismiss the board the same way — they
      // fall through to `commands[action]?.()` below unchanged, cycleTab
      // itself needs no board-awareness of its own.
      boardOpen.value = false;
    }
    // ⌘1–9 and ⌘9 count CHIPS, not terminal tabs (2026-08-16): the strip is
    // one interleaved row, so "the second chip" has to mean the second thing
    // on screen even when that is a file. The consequence is deliberate and
    // was the user's call — ⌘2 can now land on a document.
    if (action === "select-last-tab") {
      // -1 when the strip is empty — selectStripSlot's own range check no-ops
      // it, same as an out-of-range select-tab-N below.
      selectStripSlot(stripSlots().length - 1);
      return;
    }
    const tabIndex = selectTabIndex(action);
    if (tabIndex !== null) {
      selectStripSlot(tabIndex); // out-of-range indexes are a no-op
      return;
    }
    // `action` is a `COMMAND_ACTIONS` member here at runtime — both
    // `select-last-tab` and every `select-tab-N` already returned above.
    // `selectTabIndex` returns a plain `number | null`, not a type predicate,
    // so TypeScript can't narrow the `select-tab-${number}` template out of
    // `action`'s type on its own; this cast documents that invariant instead
    // of widening `commands` back to `Record<ShortcutAction, ...>`, which
    // would silently defeat the `satisfies` completeness check above.
    commands[action as (typeof COMMAND_ACTIONS)[number]]?.();
  }

  function runAction(action: ShortcutAction): void {
    // A menu accelerator is delivered by the OS *before* the webview sees the
    // key, so it never passes through `handleShortcut` and none of its
    // guards apply. This can't gate on HOW the action arrived (accelerator
    // vs. a deliberate mouse click on the same item) — Tauri's `MenuEvent`
    // carries only an id, nothing to tell them apart — so it gates on the
    // ACTION instead: only `destructive` actions (close-pane, close-tab,
    // clear-buffer — see ActionDefinition.destructive) are suppressed while
    // a chrome text field holds the caret. Without this, ⌘W eaten by the OS
    // while renaming a tab would silently close the pane instead of being
    // ignored. Every other action (dialog-openers, view toggles,
    // find-next/find-previous, navigation…) runs regardless — blocking them
    // was never protecting anything and used to silently swallow a genuine
    // menu click (F-B2) or find-next/find-previous typed straight into the
    // search bar's own input (F-B1).
    if (DESTRUCTIVE_ACTIONS.has(action) && isChromeTextField(document.activeElement)) {
      return;
    }
    dispatchAction(action);
  }

  function handleShortcut(event: KeyboardEvent): void {
    // Never intercept keys the IME is still composing — keyCode 229 catches
    // WebKit events that arrive without isComposing (Vietnamese/CJK input).
    if (event.isComposing || event.keyCode === 229) {
      return;
    }
    // Never fire shortcuts while typing in a text field (same approach as
    // the IME guard above) — e.g. the tab rename input in the popover.
    if (isChromeTextField(event.target)) {
      return;
    }
    // Never fire while a Shortcuts row is recording a replacement chord: the
    // keystroke is the value being set, not a command. Without this, rebinding
    // any bound chord runs its own action first — pressing ⌘W to rebind
    // `close-pane` would kill the pane instead. See `shortcutCaptureActive`.
    if (shortcutCaptureActive.value) {
      return;
    }
    const action = matchBinding(event);
    if (action === null) {
      return;
    }
    // BEFORE preventDefault, never after. `dispatchAction`'s own
    // `overlayBlocksAction` runs too late to stop the key being swallowed, and
    // that ordering is what made a matched-but-blocked chord a dead key over an
    // open document. Returning here leaves the event alone so it reaches
    // whatever holds focus — Monaco, a modal, or the pane's own xterm.
    if (!isActionPerformable(action, performableContext())) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dispatchAction(action);
  }

  async function splitActive(dir: Direction): Promise<void> {
    const manager = activeManager();
    if (manager === null) {
      return;
    }
    const before = new Set(manager.paneIds());
    const finishStartupSpawn = beginWindowsStartupSpawn();
    try {
      await manager.splitActive(dir);
      const spawned = manager.paneIds().filter((id) => !before.has(id));
      deferWindowsStartupPoll(spawned);
    } finally {
      finishStartupSpawn?.();
    }
  }

  /**
   * The rail card's `New split here` (spec
   * `docs/internals/agent-rail.md` — the one
   * fork this work opens, resolved by the owner's "implement this spec").
   *
   * `split-row`/`split-column` act on the ACTIVE pane, and the card that
   * raised the menu may not own it — routing the row through them would split
   * whatever happened to be focused, in a different checkout. Doing it
   * honestly is materialize-then-split, which is `TabManager`'s business (the
   * `launchTask` precedent): the rail passes a PATH and receives a boolean,
   * exactly as the rail's other path-in callbacks do, and no pane id leaves the
   * terminal layer.
   *
   * One departure from the spec's own wording, named: when the checkout has NO
   * tab, this materializes one and STOPS rather than also splitting it. A
   * fresh tab's single pane is already the pane the row promised — splitting
   * it too would spawn a second, unasked-for shell, and "Open a pane beside
   * this tab" has no tab to sit beside.
   */
  async function splitInWorkspace(workspacePath: string): Promise<boolean> {
    const target = normalizeWorkspacePath(workspacePath);
    if (target === null) return false;
    // Containment, not equality (code review, 2026-08-31). The card that
    // raised this row groups its tabs with `worktreeForPath`'s longest-prefix
    // match, so a tab opened at `/repo/wt/packages/web` shows its agents on
    // the card for `/repo/wt`. An exact `===` found nothing there and fell
    // through to `materialize`, so `New split here` — "Open a pane beside this
    // tab" — silently produced a second TAB at the checkout root instead. The
    // prefix test is inlined rather than importing `worktreeForPath`, whose
    // shape is "which of these roots owns this path"; here the root is known
    // and the tabs are the candidates. Nearest tab wins, so a nested tab is
    // preferred over one sitting at the checkout root only when the caller
    // asked for that nested path.
    const owned = (tab: { readonly workspacePath: string | null }): boolean =>
      tab.workspacePath === target ||
      tab.workspacePath?.startsWith(`${target}/`) === true ||
      tab.workspacePath?.startsWith(`${target}\\`) === true;
    const exact = tabs.findIndex((tab) => tab.workspacePath === target);
    const index = exact >= 0 ? exact : tabs.findIndex(owned);
    if (index < 0) {
      return materialize({
        layout: BUILT_IN_PRESET.layout,
        cwds: [target],
        workspacePath: target,
      });
    }
    if (index !== active) {
      selectTab(index);
    }
    await splitActive("row");
    return true;
  }

  // `dispose()` can run while this await is still in flight (a remount mid-
  // init). Pushing into `unlisteners` after that would leak a live listener
  // that keeps feeding a `tabs` array nobody drains anymore — for
  // EVENT_OUTPUT specifically, that means every remount adds one more
  // listener still writing the same PTY bytes into xterm, so terminal
  // content visibly repeats. Route registration through this guard instead.
  async function registerUnlisten(pending: Promise<UnlistenFn>): Promise<void> {
    const unlisten = await pending;
    if (disposed) {
      unlisten();
      return;
    }
    unlisteners.push(unlisten);
  }

  async function init(): Promise<void> {
    try {
      windowFocused = await getCurrentWindow().isFocused();
    } catch (err) {
      console.warn("attention: window isFocused() failed; assuming focused", err);
      windowFocused = true;
    }
    try {
      const unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload }) => {
        windowFocused = payload;
      });
      unlisteners.push(unlistenFocus);
    } catch (err) {
      console.warn(
        "attention: onFocusChanged registration failed; native notifications suppressed",
        err,
      );
    }
    // Cross-window transfer is a Tauri-only surface: outside a webview the
    // event bridge is absent and registration throws synchronously. Guarded
    // like `onFocusChanged` above — the rest of the manager still works.
    try {
      // Destination side: another window prepared a pane for us.
      await registerUnlisten(
        transfer.listenTransferOffer((token) => {
          void adoptIntoNewTab(token);
        }),
      );
      // SOURCE side: the "Move Pane to Window" submenu. Rust cannot start
      // this transfer itself — `prepare_transfer` takes the owning window,
      // Rust cannot see which pane inside a window has focus, and §7.4
      // requires the SOURCE to serialize its buffer between prepare and
      // claim. So the menu click comes back here and this window runs it.
      //
      // This arrives on a DIFFERENT channel from `menu:action`, so
      // `isActionId` never sees it and the payload is validated in
      // `moveToWindowTarget`.
      await registerUnlisten(
        transfer.listenMoveToWindow((targetLabel) => {
          void movePane({ kind: "window", label: targetLabel });
        }),
      );
    } catch (err) {
      console.warn("Cross-window transfer listeners not installed:", err);
    }
    await registerUnlisten(
      pty.listenOutput((id, data) => {
        // macOS keeps first-output readiness. Windows only records this as
        // output; its launcher waits for the structured listener below.
        launcher.noteOutput(id);
        // Legacy agentBusy semantics ride on the working()-flip. Read it around
        // the additive event feed rather than double-parsing the chunk: both
        // `noteOutput` and `noteOutputEvents` mutate the same record, so
        // calling `noteOutputEvents` alone preserves the exact flip signal.
        const before = activity.working(id);
        const transitions = activity.noteOutputEvents(id, data);
        const workingChanged = activity.working(id) !== before;
        for (const tab of tabs) {
          tab.manager.handleOutput(id, data);
        }
        const owner = tabs.find((t) => t.manager.paneIds().includes(id));
        // Feed every ordered transition into the tracker, in order — the
        // process gate drops them when the pane isn't a recognized agent, so
        // never pre-filter here (the tracker owns the gate). A non-null return
        // means a visible change worth re-rendering for.
        let trackerChanged = false;
        for (const transition of transitions) {
          const activitySnap = tracker.noteActivity(id, transition);
          if (activitySnap !== null) {
            trackerChanged = true;
            maybeNotify(id, activitySnap);
          }
        }
        // Per-pane visibility for THIS step only: the window must be
        // foreground, the owner must be the active tab, AND DOM focus must
        // actually rest inside the pane's element — `activePaneId()` alone
        // isn't enough, since a Settings-like overlay can hold DOM focus
        // while a pane stays "active" in the split tree.
        const el = activeManager()?.paneElement(id);
        const domFocused = el != null && el.contains(document.activeElement);
        const visible = windowFocused && owner === tabs[active] && domFocused;
        if (tracker.noteOutputVisibility(id, visible) !== null) {
          trackerChanged = true;
        }
        // Output to a background tab lights its LEGACY unread badge. Only sync
        // on a transition (legacy unread false→true, the pane's working state
        // flips, or a tracker change) — every other chunk is a no-op, so this
        // stays off the hot per-chunk path.
        const unreadChanged =
          owner !== undefined && owner !== tabs[active] && !unread.has(owner.key);
        if (unreadChanged) {
          unread.add(owner.key);
        }
        if (unreadChanged || workingChanged || trackerChanged) {
          syncViews();
        }
        // Re-sync once shortly after this pane's recency window can expire, so
        // the fallback's working→idle flip renders without the poller. In pure
        // silence the tracker never sees an idle event of its own, so when
        // activity has decayed to idle while the tracker still reads working,
        // feed it one synthetic idle transition so it can emit `completed`.
        // OSC-driven panes already go idle via their explicit clear event.
        const pending = activityResync.get(id);
        if (pending !== undefined) {
          clearTimeout(pending);
        }
        activityResync.set(
          id,
          setTimeout(() => {
            activityResync.delete(id);
            if (!activity.working(id) && tracker.snapshot(id)?.phase === "working") {
              const resyncSnap = tracker.noteActivity(id, {
                phase: "idle",
                source: "output-heuristic",
                severity: null,
                oscState: null,
                observedAt: now(),
              });
              if (resyncSnap !== null) {
                maybeNotify(id, resyncSnap);
              }
            }
            syncViews();
          }, 3200),
        );
      }),
    );
    await registerUnlisten(
      pty.listenPromptReady((id) => {
        launcher.notePromptReady(id);
        if (getDesktopEnvironment().platform === "windows" && !forgetWindowsStartupPoll(id)) {
          windowsStartupReady.add(id);
        }
      }),
    );
    await registerUnlisten(
      pty.listenExit((id, exitCode) => {
        forgetWindowsStartupPoll(id);
        windowsStartupReady.delete(id);
        // Note the exit BEFORE fanning out: a multi-pane tab auto-closes the
        // pane inside handleExit, which prunes it from the tracker — running
        // noteExit first updates the live record instead of re-creating one
        // that prune already dropped.
        //
        // Deliberately NOT routed through `maybeNotify`: `noteExit` sets
        // `phase: "exited"` (and, since 2026-09-03, records the status and
        // drops a live agent's requested/completed latch) but never RAISES
        // attention, so any non-null snapshot it returns carries nothing new
        // to notify about — forwarding it could only duplicate a notification
        // already sent (or send a bare "none"/no-op). The tracker bookkeeping
        // and `syncViews` re-render still run as before.
        const exitSnap = tracker.noteExit(id, exitCode);
        for (const tab of tabs) {
          tab.manager.handleExit(id);
        }
        if (exitSnap !== null) {
          syncViews();
        }
      }),
    );
    // Stage 2: the launch config, then the hook/server events. The config is
    // awaited so the first launch after boot is augmented; the subscription
    // is registered like every other host listener.
    if (signalConfigFetch !== null) {
      try {
        signalConfig = await signalConfigFetch();
      } catch (err) {
        console.warn("agent_signal_config failed; launches go out un-augmented:", err);
      }
    }
    if (hookEventsListen !== null) {
      await registerUnlisten(hookEventsListen(onHookEvent));
    }
    await registerUnlisten(
      installFileDrop({
        onOver(x, y) {
          // The board has no drop target — a drop while it is up must not
          // reach the terminal hiding behind it.
          if (boardOpen.value) {
            return;
          }
          activeManager()?.fileDragOver(x, y);
        },
        onDrop(x, y, paths) {
          if (boardOpen.value) {
            return;
          }
          activeManager()?.fileDrop(x, y, paths);
        },
        onLeave() {
          if (boardOpen.value) {
            return;
          }
          activeManager()?.fileDragLeave();
        },
      }),
    );
    window.addEventListener("keydown", handleShortcut, true);
    // Session restore is gone: the app always opens on the Open board, and the
    // user reopens folders from Recents by hand.
    poller.start();
    registrySync.start();
    syncViews();
  }

  return {
    init,
    materialize,
    materializePane,
    openFromPreset,
    openQuickAgent,
    launchTask,
    retryTaskPrompt,
    canRetryTaskPrompt,
    canFocusTaskPrompt,
    focusTaskPrompt,
    launchCommandFor,
    dropAgentPane,
    activeSlotRects() {
      return activeManager()?.slotRects() ?? [];
    },
    activeWorkspacePath,
    captureActiveLayout,
    captureSession,
    activePaneCwd,
    activePaneId() {
      return activeManager()?.activePaneId() ?? null;
    },
    paneAttention,
    acknowledgePane,
    serializePane,
    paneAlive,
    restartPane,
    injectIntoPane,
    newTab,
    movePaneToNewWindow,
    adoptIntoNewTab,
    reopenTab,
    closeTab: (index) => close.closeTab(index),
    closePaneAt: (index, paneId) => close.closePaneAt(index, paneId),
    closeTabs: (indexes) => close.closeTabs(indexes),
    selectTab,
    activateForAttention,
    focusNextAttention,
    hasActionableAttention,
    cycleTab,
    runAction,
    splitActive,
    splitInWorkspace,
    allPaneIds,
    closePane: () => close.closePane(),
    applySettings(next) {
      for (const tab of tabs) {
        tab.manager.applySettings(next);
      }
      // A theme change has to reach the editor too, through the SAME call —
      // otherwise switching theme leaves an open editor in the old palette
      // until it is closed and reopened (spec §7).
      surfaces.applySettings(next);
    },
    focusActive() {
      // With a non-terminal surface active, focus must reach IT — see
      // `focusStage`, which is that rule and is shared with the `commands`
      // table's dock toggles.
      focusStage();
    },
    notifySurfacesChanged() {
      syncViews();
    },
    dispose() {
      disposed = true;
      launcher.dispose();
      poller.stop();
      registrySync.stop();
      for (const pending of activityResync.values()) {
        clearTimeout(pending);
      }
      activityResync.clear();
      for (const pending of launchFollowUpPolls.values()) {
        clearTimeout(pending);
      }
      launchFollowUpPolls.clear();
      for (const fallback of windowsStartupPollFallbacks.values()) {
        clearTimeout(fallback);
      }
      windowsStartupPollFallbacks.clear();
      windowsStartupReady.clear();
      window.removeEventListener("keydown", handleShortcut, true);
      for (const unlisten of unlisteners) {
        unlisten();
      }
      for (const tab of tabs) {
        tab.manager.dispose();
      }
      tabs.length = 0;
      taskPromptTargetByTab.clear();
    },
  };
}
