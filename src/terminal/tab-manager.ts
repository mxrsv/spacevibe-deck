import { homeDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  clampFontSize,
  DEFAULT_SETTINGS,
  type Settings,
} from "../settings/settings-schema";
import {
  flushSettingsSave,
  settings,
  updateSettings,
} from "../settings/settings-store";
import { type Direction, type SerializedNode } from "../lib/split-tree";
import { isAgent } from "../lib/process-info";
import { normalizeWorkspacePath, workspaceLabel } from "../lib/workspace-label";
import { sendAgentNotification } from "../lib/native-notification";
import type { AgentChoice } from "../lib/workspace-recents";
import { matchBinding, selectTabIndex, type ShortcutAction } from "./keymap";
import {
  ACTION_REGISTRY,
  TIER_RANK,
  type OverlayTier,
} from "./action-registry";
import { installFileDrop } from "./file-drop";
import {
  createTerminalManager,
  type TerminalManager,
  type TerminalManagerDeps,
} from "./terminal-manager";
import { createPaneInfoPoller } from "./pane-info-poller";
import { createAgentActivity } from "./agent-activity";
import {
  createAgentAttentionTracker,
  type AttentionKind,
  type PaneAttentionSnapshot,
} from "./agent-attention";
import { createAgentNotifier, type AgentNotifier } from "./agent-notifier";
import type { PaneAttentionSignal } from "./pane";
import {
  popClosedTab,
  pushClosedTab,
  type ClosedTabSnapshot,
} from "./closed-tabs";
import { confirmClose } from "./close-guard";
import { createCloseCoordinator } from "./close-coordinator";
import { activeAfterClose } from "./tab-close";
import { freshCwd } from "./pane-info";
import { defaultPtyClient, type PtyClient } from "./pty-client";
import { createAgentLauncher } from "./agent-launch";
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
  type TabOverride,
} from "./tabs-store";
import type { TabDotColor } from "../lib/tab-colors";
import {
  boardOpen,
  editorRequest,
  saveDialogOpen,
  settingsOpen,
} from "../chrome/events";

/**
 * `action.scope` per id, from the single source of truth
 * (`src/terminal/action-registry.ts`) instead of a hardcoded list — read by
 * `overlayBlocksAction` below. Module-level: the registry is static, so this
 * is computed once per module load, not once per `createTabManager` call.
 */
const ACTION_SCOPE: ReadonlyMap<string, OverlayTier | "always"> = new Map(
  ACTION_REGISTRY.map((action) => [action.id, action.scope] as const),
);

interface TabEntry {
  readonly key: number;
  readonly manager: TerminalManager;
  /**
   * Workspace ≡ Tab: the directory picked on Open, fixed for the tab's life.
   * Never re-derived from a pane's live CWD (a `cd` must not rename the tab).
   */
  readonly workspacePath: string | null;
}

/** Options for materializing one tab from a preset layout. */
export interface OpenFromPresetOptions {
  readonly workspacePath?: string;
  /** Agent CLI to launch in every new pane; `null`/absent = Shell only. */
  readonly agent?: AgentChoice;
}

/**
 * Optional seams for TabManager, layered flat over TerminalManagerDeps so
 * every existing `{ createPane }` (or omitted) caller keeps compiling.
 */
export interface TabManagerDeps extends TerminalManagerDeps {
  /**
   * Cmd+Shift+A routes here instead of calling `focusNextAttention`
   * directly, so the app can run the same overlay preflight as a status-dot
   * click (Task 15) before any pane is actually focused. Missing = no-op.
   */
  onRequestAttentionFocus?: (tabIndex?: number) => void;
  /**
   * ⌘, (`toggle-settings`) and the menu's "Settings…" item route here instead
   * of writing `settingsOpen` directly — same shape as
   * `onRequestAttentionFocus` above. App owns the open/close+focus-return
   * flow (it already does for every other overlay: board, PresetEditor,
   * SavePresetDialog all close from app.tsx, never from TabManager), so this
   * seam keeps that single owner instead of splitting the toggle logic
   * between here and there. Missing = no-op, same as the attention seam.
   */
  onToggleSettings?: () => void;
  /**
   * Test seam — defaults to a real `createAgentNotifier` wired to the live
   * settings store, live window focus, and the Task 20 Tauri adapter.
   * Injected notifier wins, so tests never hit the real native API.
   */
  notifier?: AgentNotifier;
}

/** Owns all tabs: routing, keyboard, agent launch; info polling lives in PaneInfoPoller. */
export interface TabManager {
  /** Install listeners + start polling. The app always opens on the board. */
  init(): Promise<void>;
  /** Materialize one tab from a MaterializeIntent (Open / Closed / preset). */
  materialize(intent: MaterializeIntent): Promise<boolean>;
  /** Materialize one tab from a preset layout + resolved CWDs; launches the agent. */
  openFromPreset(
    layout: SerializedNode,
    cwds: readonly (string | null)[],
    options?: OpenFromPresetOptions,
  ): Promise<boolean>;
  /** Index of the tab owning `path`, or -1 — Open dedupes against this. */
  findTabByWorkspace(path: string): number;
  /** Workspace of the active tab; null when it has none (or no tab). */
  activeWorkspacePath(): string | null;
  /** Live layout + fresh per-pane CWDs for save-as-preset; null when no tab. */
  captureActiveLayout(): Promise<{
    layout: SerializedNode;
    cwds: readonly (string | null)[];
  } | null>;
  /** Fresh CWD of the focused pane (editor "↑ inherit" from a live window). */
  activePaneCwd(): Promise<string | null>;
  newTab(): Promise<void>;
  /** Reopen the most recently closed tab (⌘⇧T); skips dead workspaces. */
  reopenTab(): Promise<void>;
  /** Close a tab after the busy guard; every pane's process is checked. */
  closeTab(index: number): Promise<void>;
  selectTab(index: number): void;
  /**
   * Internal attention-navigation primitive (Task 12/15) — NOT the
   * user-facing tab switch (`selectTab` stays that). Activates exactly the
   * candidate pane: same-tab focuses only it; cross-tab switches without
   * focusing the target's own active pane, so only the candidate is ever
   * acknowledged. Unknown/dead candidate → complete no-op.
   */
  activateForAttention(index: number, paneId: number): void;
  /**
   * Jump to the next actionable Attention Rail candidate — highest severity
   * first, then oldest `changedAt` (matches `tracker.actionable()`'s sort).
   * Omitted `tabIndex` scans every tab; a given `tabIndex` scopes the scan to
   * that tab only. Routes through `activateForAttention`, which acks exactly
   * the chosen candidate. A dead/unowned candidate is skipped in favor of the
   * next one; an empty scan (or an unknown `tabIndex`) is a complete no-op.
   */
  focusNextAttention(tabIndex?: number): void;
  /**
   * Pure query mirroring `focusNextAttention`'s candidate scan (same
   * ordering, same optional `tabIndex` scoping) without touching any
   * UI/tracker state — the app-level overlay preflight (Task 15) uses this
   * to decide whether the shortcut/click has anything to do.
   */
  hasActionableAttention(tabIndex?: number): boolean;
  /** Set or clear (null) a custom tab name; overrides the process label. */
  renameTab(index: number, name: string | null): void;
  /** Set or clear (null) a custom tab dot color token. */
  setTabDotColor(index: number, color: TabDotColor | null): void;
  cycleTab(step: 1 | -1): void;
  /**
   * Run a keymap action that did NOT arrive as a key event — today only the
   * macOS menu, whose accelerators the OS consumes before the webview ever
   * sees them. Shares the one dispatch table with `handleShortcut` so a menu
   * item and its shortcut can never drift apart.
   */
  runAction(action: ShortcutAction): void;
  splitActive(dir: Direction): Promise<void>;
  /** Every pane id across every tab (quit-path busy guard). */
  allPaneIds(): number[];
  /** Close the focused pane (busy-guarded); last pane in tab closes the tab. */
  closePane(): Promise<void>;
  applySettings(next: Settings): void;
  focusActive(): void;
  dispose(): void;
}

export function createTabManager(
  host: HTMLElement,
  pty: PtyClient = defaultPtyClient,
  deps: TabManagerDeps = {},
): TabManager {
  const tabs: TabEntry[] = [];
  const unlisteners: UnlistenFn[] = [];
  // Per-tab user overrides (rename, dot color), keyed by tab key —
  // merged over process-derived values on every syncViews.
  const overrides = new Map<number, TabOverride>();
  // Tabs with output arrived while in the background, keyed by tab key.
  // In-memory only (like busy) — a background pane's output lights the badge,
  // opening the tab clears it.
  const unread = new Set<number>();
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
  let home = "";
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
  const launcher = createAgentLauncher(paneIo);

  function activeManager(): TerminalManager | null {
    return active >= 0 && active < tabs.length ? tabs[active].manager : null;
  }

  /** Index of the tab owning `path` (normalized both sides), or -1. */
  function findWorkspaceIndex(path: string): number {
    const target = normalizeWorkspacePath(path);
    if (target === null) {
      return -1;
    }
    return tabs.findIndex((tab) => tab.workspacePath === target);
  }

  function syncViews(): void {
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
        activity.noteProcess(id, poller.infoFor(id)?.process ?? null);
      }
      const agentBusy = paneIds.some(
        (id) =>
          isAgent(poller.infoFor(id)?.process ?? null) && activity.working(id),
      );
      return applyTabOverride(
        {
          key: tab.key,
          process: info?.process ?? null,
          name: null,
          dotColor: null,
          workspacePath: tab.workspacePath,
          agentBusy,
          unread: unread.has(tab.key),
          // Additive Attention Rail summary; `agentBusy`/`unread` above keep
          // their existing semantics untouched.
          attention: tracker.summarize(paneIds),
        },
        overrides.get(tab.key),
      );
    });
    activeTabIndex.value = active;
    const manager = activeManager();
    const paneId = manager?.activePaneId() ?? null;
    const info = paneId === null ? undefined : poller.infoFor(paneId);
    const process = info?.process ?? null;
    statusInfo.value = {
      branch: poller.branch(),
      cwd: info?.cwd ?? null,
      agent: isAgent(process) ? process : null,
      paneCount: manager?.paneCount() ?? 0,
      home,
    };
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
      (owner?.workspacePath == null
        ? "Unknown"
        : workspaceLabel(owner.workspacePath));
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

  const callbacks = {
    onLayoutChange(): void {
      syncViews();
      const live = allPaneIds();
      launcher.prune(live);
      activity.prune(live);
      tracker.prune(live);
      notifier.prune(live);
      pruneNotifiedKinds(live);
      // Every pane of every tab is polled now, so a long session would
      // otherwise leave one cache entry behind per pane ever opened.
      poller.prune(live);
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
  };

  /** Create + init a tab; false (and an error note) when spawning fails. */
  async function addTab(
    layout: SerializedNode | null,
    cwds: readonly (string | null)[] = [],
    workspacePath: string | null = null,
  ): Promise<boolean> {
    const container = document.createElement("div");
    container.className = "tab-stage";
    container.style.display = "none";
    host.appendChild(container);
    const manager = createTerminalManager(container, callbacks, paneIo, deps);
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
      return false;
    }
    tabs.push({
      key: nextKey,
      manager,
      // The only place a tab's workspace is ever set — normalize here so every
      // entry point (Open, reopen, live preset) agrees on one spelling.
      workspacePath:
        workspacePath === null ? null : normalizeWorkspacePath(workspacePath),
    });
    nextKey += 1;
    return true;
  }

  function selectTab(index: number): void {
    if (index < 0 || index >= tabs.length || index === active) {
      return;
    }
    activeManager()?.hide();
    active = index;
    unread.delete(tabs[index].key); // opening the tab clears its unread badge
    tabs[index].manager.show();
    syncViews();
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
      const owningIndex = tabs.findIndex((t) =>
        t.manager.paneIds().includes(cand.id),
      );
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

  function setOverride(index: number, patch: TabOverride): void {
    const entry = tabs[index];
    if (!entry) {
      return;
    }
    const next = { ...(overrides.get(entry.key) ?? {}), ...patch };
    if (next.name === undefined && next.dotColor === undefined) {
      overrides.delete(entry.key);
    } else {
      overrides.set(entry.key, next);
    }
    syncViews();
  }

  async function newTab(): Promise<void> {
    // New tab goes through the Open board (workspace ∥ preset ∥ agent).
    boardOpen.value = true;
  }

  /**
   * Deep Materialize entry: spawn + optional chrome + select + agent launch.
   * Open board / Layout preset / Closed tab all go here.
   */
  async function materialize(intent: MaterializeIntent): Promise<boolean> {
    // Workspace ≡ Tab (1:1): a workspace that already has a tab is never opened
    // a second time — focus the existing tab instead. This enforces the
    // invariant at the one choke point every entry uses (Open board, New preset
    // from a live window, Cmd+Shift+T reopen), not just in the Open handler.
    if (intent.workspacePath !== undefined) {
      const existing = findWorkspaceIndex(intent.workspacePath);
      if (existing !== -1) {
        selectTab(existing);
        return true;
      }
    }
    if (
      !(await addTab(intent.layout, intent.cwds, intent.workspacePath ?? null))
    ) {
      return false;
    }
    const entry = tabs[tabs.length - 1];
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
    selectTab(tabs.length - 1);
    void poller.poll();
    // Each pane types its agent once its shell prints the first byte; `null`
    // (Shell only / reopen) arms nothing.
    launcher.arm(entry.manager.paneIds(), intent.agent ?? null);
    return true;
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
      ...(options.workspacePath !== undefined
        ? { workspacePath: options.workspacePath }
        : {}),
      ...(options.agent !== undefined ? { agent: options.agent } : {}),
    });
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

  function activePaneCwd(): Promise<string | null> {
    return freshCwd(activeManager()?.activePaneId() ?? null, pty);
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
        console.warn(
          `Not reopening tab: workspace ${snapshot.workspacePath} no longer exists`,
        );
        stack = rest; // drop the dead snapshot, try the one below it
        continue;
      }
      if (
        !(await materialize({
          layout: snapshot.layout,
          cwds: snapshot.cwds,
          chrome: materializeChromeFrom(snapshot.name, snapshot.dotColor),
          ...(snapshot.workspacePath !== null
            ? { workspacePath: snapshot.workspacePath }
            : {}),
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
    const live = allPaneIds();
    launcher.prune(live);
    activity.prune(live);
    tracker.prune(live);
    notifier.prune(live);
    pruneNotifiedKinds(live);
    poller.prune(live);
    if (tabs.length === 0) {
      // Closing the last tab quits the app. CloseCoordinator
      // already ran the busy guard, so exit directly — no second dialog.
      active = -1;
      try {
        await flushSettingsSave();
      } catch (err: unknown) {
        console.warn("Flush before quit failed:", err);
      }
      await pty.confirmQuit();
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
    return allPaneIds();
  }

  const poller = createPaneInfoPoller({
    pty,
    targets: pollTargets,
    activePaneId: () => activeManager()?.activePaneId() ?? null,
    onUpdate(infos) {
      activeManager()?.updatePaneInfo(infos, home);
      // Reconcile the tracker's process gate before this cycle's state is
      // aggregated: opening/closing the gate and the agent→shell inferred
      // completion both key off the last polled process.
      for (const info of infos) {
        const snap = tracker.noteProcess(
          info.id,
          info.process,
          isAgent(info.process),
        );
        if (snap !== null) {
          maybeNotify(info.id, snap);
        }
      }
      syncViews();
    },
  });

  function cycleTab(step: 1 | -1): void {
    if (tabs.length < 2) {
      return;
    }
    selectTab((active + step + tabs.length) % tabs.length);
  }

  // Keymap *matching* lives in keymap.ts; this table is the dispatch half —
  // one action, one closure. `select-tab-N` and `select-last-tab` (⌘9) are
  // both handled directly in `dispatchAction`, not through this table.
  const commands: Partial<Record<ShortcutAction, () => void>> = {
    "split-row": () => void splitActive("row"),
    "split-column": () => void splitActive("column"),
    "close-pane": () => void close.closePane(),
    "focus-next": () => activeManager()?.cycleFocus(1),
    "focus-prev": () => activeManager()?.cycleFocus(-1),
    "toggle-expand": () =>
      updateSettings({ focusExpand: !settings.value.focusExpand }),
    "new-tab": () => void newTab(),
    "close-tab": () => void close.closeTab(active),
    "next-tab": () => cycleTab(1),
    "prev-tab": () => cycleTab(-1),
    "zoom-in": () =>
      updateSettings({ fontSize: clampFontSize(settings.value.fontSize + 1) }),
    "zoom-out": () =>
      updateSettings({ fontSize: clampFontSize(settings.value.fontSize - 1) }),
    "zoom-reset": () => updateSettings({ fontSize: DEFAULT_SETTINGS.fontSize }),
    "toggle-zoom-pane": () => activeManager()?.toggleZoom(),
    "clear-buffer": () => activeManager()?.clearActive(),
    "focus-left": () => activeManager()?.focusDirection("left"),
    "focus-right": () => activeManager()?.focusDirection("right"),
    "focus-up": () => activeManager()?.focusDirection("up"),
    "focus-down": () => activeManager()?.focusDirection("down"),
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
    find: () => activeManager()?.openSearch(),
    // Not exempted in overlayBlocksAction below: both act on the terminal
    // (highlight/jump inside a pane's buffer), same scope as clear-buffer.
    "find-next": () => activeManager()?.findNext(),
    "find-previous": () => activeManager()?.findPrevious(),
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
  };

  /**
   * Ranks of every overlay that is currently open (Open board, Settings,
   * PresetEditor/SavePresetDialog share the "modal" rank — see
   * `TIER_RANK`'s doc comment in action-registry.ts for why). Empty when
   * nothing covers the terminal grid.
   */
  function openOverlayRanks(): readonly number[] {
    const ranks: number[] = [];
    if (settingsOpen.value) {
      ranks.push(TIER_RANK.settings);
    }
    if (boardOpen.value) {
      ranks.push(TIER_RANK.board);
    }
    if (editorRequest.value !== null || saveDialogOpen.value) {
      ranks.push(TIER_RANK.modal);
    }
    return ranks;
  }

  /**
   * Single choke point deciding whether `action` may run while an overlay
   * (Open board, Settings, PresetEditor, SavePresetDialog) is covering the
   * terminal grid. Default tier is `"pane"` (rank 0) — blocked whenever ANY
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
   * very overlay that would otherwise strand it). Tab-jump actions (`select-tab-N`,
   * `select-last-tab`) are exempt through the SEPARATE `isTabSelectionAction`
   * mechanism below, not through `scope` — see its own doc comment for why
   * that's a distinct action family, not a product-level "always" decision.
   */
  function overlayBlocksAction(action: ShortcutAction): boolean {
    const scope = ACTION_SCOPE.get(action);
    if (
      scope === undefined ||
      scope === "always" ||
      isTabSelectionAction(action)
    ) {
      return false;
    }
    const targetRank = TIER_RANK[scope];
    return openOverlayRanks().some((rank) => rank >= targetRank);
  }

  /**
   * True for both flavors of "jump to a tab" action: `select-tab-N` (a fixed
   * index) and `select-last-tab` (⌘9, always the last tab). Shared by the
   * overlay scope guard above and `dispatchAction` below so the two stay in
   * sync as exactly the same action group.
   */
  function isTabSelectionAction(action: ShortcutAction): boolean {
    return action === "select-last-tab" || selectTabIndex(action) !== null;
  }

  /**
   * A text field belonging to the chrome rather than to a terminal — the tab
   * rename input, the search bar, a settings field. Shortcuts must not fire
   * while one of these holds the caret.
   */
  function isChromeTextField(node: unknown): boolean {
    return (
      (node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement) &&
      !node.closest(".pane__term")
    );
  }

  /** The dispatch half, shared by the keymap and the menu. */
  function dispatchAction(action: ShortcutAction): void {
    if (overlayBlocksAction(action)) {
      return;
    }
    if (action === "select-last-tab") {
      // -1 when there are no tabs yet — selectTab's own range check no-ops
      // it, same as an out-of-range select-tab-N below.
      selectTab(tabs.length - 1);
      return;
    }
    const tabIndex = selectTabIndex(action);
    if (tabIndex !== null) {
      selectTab(tabIndex); // out-of-range indexes are a no-op
      return;
    }
    commands[action]?.();
  }

  function runAction(action: ShortcutAction): void {
    // A menu accelerator is delivered by the OS *before* the webview sees the
    // key, so it never passes through `handleShortcut` and none of its guards
    // apply. Re-apply the text-field one here, or ⌘W while renaming a tab
    // closes the pane instead of being ignored.
    if (isChromeTextField(document.activeElement)) {
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
    const action = matchBinding(event);
    if (action === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dispatchAction(action);
  }

  function splitActive(dir: Direction): Promise<void> {
    return activeManager()?.splitActive(dir) ?? Promise.resolve();
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
      console.warn(
        "attention: window isFocused() failed; assuming focused",
        err,
      );
      windowFocused = true;
    }
    try {
      const unlistenFocus = await getCurrentWindow().onFocusChanged(
        ({ payload }) => {
          windowFocused = payload;
        },
      );
      unlisteners.push(unlistenFocus);
    } catch (err) {
      console.warn(
        "attention: onFocusChanged registration failed; native notifications suppressed",
        err,
      );
    }
    await registerUnlisten(
      pty.listenOutput((id, data) => {
        // The launcher waits for a pane's first byte before typing its agent;
        // route every chunk to it before fanning out to the tabs.
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
          owner !== undefined &&
          owner !== tabs[active] &&
          !unread.has(owner.key);
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
            if (
              !activity.working(id) &&
              tracker.snapshot(id)?.phase === "working"
            ) {
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
      pty.listenExit((id) => {
        // Note the exit BEFORE fanning out: a multi-pane tab auto-closes the
        // pane inside handleExit, which prunes it from the tracker — running
        // noteExit first updates the live record instead of re-creating one
        // that prune already dropped.
        //
        // Deliberately NOT routed through `maybeNotify`: `noteExit` only ever
        // sets `phase: "exited"` and never touches `attention`, so any
        // non-null snapshot it returns is a phase-only re-emit of whatever
        // was already latched — forwarding it can only ever duplicate a
        // notification already sent (or send a bare "none"/no-op). The
        // tracker bookkeeping and `syncViews` re-render still run as before.
        const exitSnap = tracker.noteExit(id);
        for (const tab of tabs) {
          tab.manager.handleExit(id);
        }
        if (exitSnap !== null) {
          syncViews();
        }
      }),
    );
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
    try {
      home = await homeDir();
    } catch {
      home = "";
    }
    // Session restore is gone: the app always opens on the Open board, and the
    // user reopens folders from Recents by hand.
    poller.start();
    syncViews();
  }

  return {
    init,
    materialize,
    openFromPreset,
    findTabByWorkspace: findWorkspaceIndex,
    activeWorkspacePath() {
      return active >= 0 && active < tabs.length
        ? tabs[active].workspacePath
        : null;
    },
    captureActiveLayout,
    activePaneCwd,
    newTab,
    reopenTab,
    closeTab: (index) => close.closeTab(index),
    selectTab,
    activateForAttention,
    focusNextAttention,
    hasActionableAttention,
    renameTab(index, name) {
      const trimmed = name?.trim() ?? "";
      setOverride(index, { name: trimmed === "" ? undefined : trimmed });
    },
    setTabDotColor(index, color) {
      setOverride(index, { dotColor: color ?? undefined });
    },
    cycleTab,
    runAction,
    splitActive,
    allPaneIds,
    closePane: () => close.closePane(),
    applySettings(next) {
      for (const tab of tabs) {
        tab.manager.applySettings(next);
      }
    },
    focusActive() {
      activeManager()?.focusActive();
    },
    dispose() {
      disposed = true;
      launcher.dispose();
      poller.stop();
      for (const pending of activityResync.values()) {
        clearTimeout(pending);
      }
      activityResync.clear();
      window.removeEventListener("keydown", handleShortcut, true);
      for (const unlisten of unlisteners) {
        unlisten();
      }
      for (const tab of tabs) {
        tab.manager.dispose();
      }
      tabs.length = 0;
    },
  };
}
