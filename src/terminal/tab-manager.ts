import { getCurrentWindow } from "../host/window-host";
import type { UnlistenFn } from "../host/bridge";
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
import type { PaneAgent, PaneProcessInfo } from "../lib/process-info";
import type { DetachTarget } from "./pane-detach";
import { defaultTransferClient, type TransferClient } from "./transfer-client";
import { normalizeWorkspacePath, workspaceLabel } from "../lib/workspace-label";
import { sendAgentNotification } from "../lib/native-notification";
import { getDesktopEnvironment } from "../lib/platform";
import type { AgentChoice } from "../lib/workspace-recents";
import {
  agentProcessMatchers,
  resolveAgentCommand,
} from "../lib/agent-catalog";
import {
  MACOS_KEYMAP,
  matchBinding,
  selectTabIndex,
  WINDOWS_KEYMAP,
  type ShortcutAction,
} from "./keymap";
import {
  ACTION_REGISTRY,
  TIER_RANK,
  type ActionDefinition,
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
import { freshCwd, freshPaneInfo } from "./pane-info";
import {
  defaultPtyClient,
  type PtyClient,
} from "./pty-client";
import { submitAllowed, type InjectOutcome } from "../prompts/inject";
import { defaultBrowserClient } from "../browser/browser-client";
import { browserOpen, closeBrowser, openBrowser } from "../browser/browser-store";
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
  requestTabOptionsKey,
  statusInfo,
  tabViews,
  type TabOverride,
} from "./tabs-store";
import type { TabDotColor } from "../lib/tab-colors";
import {
  boardOpen,
  editorRequest,
  promptsOpen,
  reportChromeMessage,
  saveDialogOpen,
  settingsOpen,
  shortcutCaptureActive,
  usageOpen,
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

/**
 * Ids with `destructive: true` in the registry — read by `runAction` below.
 * See `ActionDefinition.destructive`'s doc comment (action-registry.ts) for
 * the full reasoning (F-B1/F-B2, 2026-07-27 code review).
 */
const DESTRUCTIVE_ACTIONS: ReadonlySet<string> = new Set(
  ACTION_REGISTRY.filter(
    (action: ActionDefinition) => action.destructive === true,
  ).map((action) => action.id),
);

/**
 * The ids `commands` implements — 42 entries, verified against the live
 * `commands` table, Task 4's `copy-selection`/`paste` included, the Prompt
 * Board's `toggle-prompts`, the browser panel's `toggle-browser` and the
 * token usage screen's `toggle-usage` alongside them. (Line numbers are
 * deliberately not cited: they rotted within one feature of being written.)
 *
 * Declared at module scope so `dispatch-coverage.test.ts` can assert that no
 * keymap binding points at an action nothing dispatches — the defect behind
 * prior review H1 and pre-ship audit A4, which a keymap-only test cannot see.
 */
const COMMAND_ACTIONS = [
  "clear-buffer",
  "close-pane",
  "close-tab",
  "copy-cwd",
  "copy-selection",
  "find",
  "find-next",
  "find-previous",
  "focus-down",
  "focus-left",
  "focus-next",
  "focus-next-attention",
  "focus-prev",
  "focus-right",
  "focus-up",
  "move-pane-to-new-window",
  "new-preset",
  "new-tab",
  "next-tab",
  "open-tab-options",
  "paste",
  "prev-tab",
  "reopen-tab",
  "save-preset",
  "scroll-page-down",
  "scroll-page-up",
  "scroll-to-bottom",
  "scroll-to-top",
  "split-column",
  "split-row",
  "swap-down",
  "swap-left",
  "swap-right",
  "swap-up",
  "toggle-browser",
  "toggle-expand",
  "toggle-prompts",
  "toggle-settings",
  "toggle-usage",
  "toggle-zoom-pane",
  "zoom-in",
  "zoom-out",
  "zoom-reset",
] as const satisfies readonly ShortcutAction[];

/**
 * Every action `dispatchAction` can actually run: `COMMAND_ACTIONS` plus the
 * ids it resolves inline, before consulting the table — `select-last-tab` and
 * the `select-tab-N` family, both handled by the `selectTabIndex` branch.
 *
 * `select-tab-N` membership is read straight off `MACOS_KEYMAP`/
 * `WINDOWS_KEYMAP`, not hand-listed 1..8: `ACTION_REGISTRY` deliberately
 * carries no `select-tab-N` rows at all (see its own doc comment, just above
 * `ActionId`), so mapping its ids can never produce one — confirmed by
 * `npx tsc --noEmit` rejecting that exact approach (the mapped id union never
 * includes the `select-tab-${number}` literal `ShortcutAction` allows) and by
 * the filter matching zero entries at runtime.
 *
 * IMPORTANT, read before trusting this set for that family: mirroring
 * `select-tab-N` off the SAME two keymaps `dispatch-coverage.test.ts` iterates
 * makes that test TAUTOLOGICAL for this family — "is this keymap action
 * dispatchable" is true by construction, regardless of what `dispatchAction`
 * actually does with it. If a future change removes or breaks the
 * `selectTabIndex(action) !== null` early-return in `dispatchAction` below,
 * every `select-tab-N` chord would silently stop switching tabs (H1/A4's
 * exact failure mode) and `dispatch-coverage.test.ts` would stay green
 * throughout, because its target set was copied from the same data under
 * test, not from `dispatchAction`'s real behavior. The direct test
 * "dispatches a select-tab-N chord to actually switch tabs" in
 * `tab-manager.test.ts` (not `dispatch-coverage.test.ts`) is what actually
 * covers this family — it drives a real chord through `handleShortcut` and
 * asserts the tab genuinely changed, so it fails if that early-return ever
 * breaks. `COMMAND_ACTIONS` above has no such gap: every one of its ids is
 * matched against the real `commands` table, an independent data source.
 *
 * Declared at module scope so `dispatch-coverage.test.ts` can assert that no
 * keymap binding points at an action nothing dispatches — the defect behind
 * prior review H1 and pre-ship audit A4, which a keymap-only test cannot see.
 */
export const DISPATCHABLE_ACTIONS: ReadonlySet<ShortcutAction> =
  new Set<ShortcutAction>([
    ...COMMAND_ACTIONS,
    "select-last-tab",
    ...[...MACOS_KEYMAP, ...WINDOWS_KEYMAP]
      .map((binding) => binding.action)
      .filter((action) => /^select-tab-\d+$/.test(action)),
  ]);

const WINDOWS_AGENT_TIMEOUT_MESSAGE =
  "PowerShell was not ready in time. Launch the agent manually.";

function explicitAgent(info: PaneProcessInfo | undefined): PaneAgent | null {
  if (info?.kind !== "agent" || info.agent === null) {
    return null;
  }
  const agent = info.agent.trim();
  return agent.length > 0 ? agent : null;
}

function processLabel(info: PaneProcessInfo | undefined): string | null {
  return explicitAgent(info) ?? info?.process ?? null;
}

interface TabEntry {
  readonly key: number;
  readonly manager: TerminalManager;
  /**
   * The directory picked on Open, fixed for the tab's life — one per tab, but
   * several tabs may share one workspace. Never re-derived from a pane's live
   * CWD (a `cd` must not rename the tab).
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
 * Non-terminal surfaces sharing the tab strip.
 *
 * TabManager knows only that they EXIST and can be activated — never what they
 * hold. That is the file-explorer spec's §2.3 seam stated as a type:
 * `TabManager` gains no knowledge of files and the file store gains no
 * knowledge of PTYs, and this interface is the entire vocabulary between them.
 *
 * NOTHING IMPLEMENTS THIS TODAY. The file model behind it landed
 * (`src/files/`), but the chrome that would mount it is deliberately left to
 * the Electron redesign, so every window runs on `INERT_SURFACES` below. The
 * seam stays because the invariants it encodes — "last surface, not last tab",
 * a combined cycle index space, `movePane`'s refusal — are the ones that are
 * expensive to retrofit and cheap to keep proven.
 *
 * Every method has a no-op default (`INERT_SURFACES`), so a caller that passes
 * nothing gets exactly the behaviour that shipped before the seam existed.
 */
export interface SurfaceStrip {
  /** Surfaces in the strip right now — the segment after the terminal tabs. */
  count(): number;
  /** Surfaces anywhere in this window, including ones not in the strip. The
   * "last surface, not last tab" rule asks this one. */
  total(): number;
  /** Index within the strip's segment, or -1 when a terminal tab is active. */
  activeIndex(): number;
  /** Activate the surface at `index` within the segment. */
  activate(index: number): void;
  /** A terminal tab is taking the stage. */
  deactivate(): void;
  /** Give the active surface keyboard focus. */
  focus(): void;
  /** Close the active surface, running its own guard first. */
  close(): Promise<void>;
  /** Save the active surface; a no-op when it has nothing to save. */
  save(): Promise<void>;
  applySettings(next: Settings): void;
}

/** Terminals only: no surfaces, nothing to activate. Today's every window. */
const INERT_SURFACES: SurfaceStrip = {
  count: () => 0,
  total: () => 0,
  activeIndex: () => -1,
  activate: () => {},
  deactivate: () => {},
  focus: () => {},
  close: () => Promise.resolve(),
  save: () => Promise.resolve(),
  applySettings: () => {},
};

/**
 * Optional seams for TabManager, layered flat over TerminalManagerDeps so
 * every existing `{ createPane }` (or omitted) caller keeps compiling.
 */
export interface TabManagerDeps extends TerminalManagerDeps {
  /**
   * Surfaces in the strip that are not terminal tabs. No production caller
   * passes one yet (see `SurfaceStrip`); absent = none, and every behaviour
   * below is unchanged.
   */
  surfaces?: SurfaceStrip;
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
   * ⌘⇧U (`toggle-usage`) and the menu's "Token Usage…" item route here rather
   * than writing `usageOpen` directly — the same reason `onToggleSettings`
   * above exists. App owns the open/close+focus-return flow AND the
   * Settings/Usage mutual exclusion (spec §Surface, major M4); writing the
   * signal from here would put half of that rule in a second place. Missing
   * = no-op, same as the other two seams.
   */
  onToggleUsage?: () => void;
  /**
   * Test seam — defaults to a real `createAgentNotifier` wired to the live
   * settings store, live window focus, and the Task 20 Tauri adapter.
   * Injected notifier wins, so tests never hit the real native API.
   */
  notifier?: AgentNotifier;
  /** Test seam for the shared non-blocking chrome message surface. */
  onAgentLaunchTimeout?: (message: string) => void;
  /**
   * Close THIS window. Defaults to `getCurrentWindow().close()`; Rust owns
   * "was that the last window" (spec §9.5). Test seam.
   */
  closeWindow?: () => Promise<void>;
  /** Test seam — defaults to the real Tauri transfer client. */
  transfer?: TransferClient;
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
  /** Workspace of the active tab; null when it has none (or no tab). */
  activeWorkspacePath(): string | null;
  /** Live layout + fresh per-pane CWDs for save-as-preset; null when no tab. */
  captureActiveLayout(): Promise<{
    layout: SerializedNode;
    cwds: readonly (string | null)[];
  } | null>;
  /** Fresh CWD of the focused pane (editor "↑ inherit" from a live window). */
  activePaneCwd(): Promise<string | null>;
  /** The focused pane of the active tab; null when there is no tab. */
  activePaneId(): number | null;
  /** Attention snapshot for one pane — the tracker's read side (gate 2). */
  paneAttention(paneId: number): PaneAttentionSnapshot | null;
  /**
   * Paste `text` into `paneId`, then submit only when the triple gate still
   * holds (spec §7). Never throws: a failed gate degrades to `"pasted"`, a
   * failed paste to `"failed"`, an overlapping attempt to `"busy"`, and an
   * unknown pane to `"no-target"`.
   */
  injectIntoPane(
    paneId: number,
    text: string,
    opts: { readonly autoSend: boolean; readonly expectedAgent: string | null },
  ): Promise<InjectOutcome>;
  newTab(): Promise<void>;
  /** Move the focused pane into a brand-new window (spec §10.3). */
  movePaneToNewWindow(): Promise<void>;
  /** Live-adopt an offered pane into a NEW tab of this window (spec §10.1). */
  adoptIntoNewTab(token: string): Promise<boolean>;
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
  /**
   * Re-derive the tab views and status after a non-terminal surface changed.
   *
   * `syncViews` runs on the 2 s process poll and on pane events, neither of
   * which a file tab produces — without this, activating one would leave the
   * status bar reading the terminal's pane count until the next poll tick.
   */
  notifySurfacesChanged(): void;
  dispose(): void;
}

export function createTabManager(
  host: HTMLElement,
  pty: PtyClient = defaultPtyClient,
  deps: TabManagerDeps = {},
): TabManager {
  const tabs: TabEntry[] = [];
  const unlisteners: UnlistenFn[] = [];
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
  const reportAgentLaunchTimeout =
    deps.onAgentLaunchTimeout ?? reportChromeMessage;
  const launcher = createAgentLauncher(paneIo, {
    platform: environment.platform,
    onTimeout: () => {
      reportAgentLaunchTimeout(WINDOWS_AGENT_TIMEOUT_MESSAGE);
    },
  });

  function activeManager(): TerminalManager | null {
    return active >= 0 && active < tabs.length ? tabs[active].manager : null;
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
        activity.noteProcess(id, processLabel(poller.infoFor(id)));
      }
      const agentBusy = paneIds.some(
        (id) =>
          explicitAgent(poller.infoFor(id)) !== null && activity.working(id),
      );
      return applyTabOverride(
        {
          key: tab.key,
          process: processLabel(info),
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
    statusInfo.value = {
      branch: poller.branch(),
      cwd: info?.cwd ?? null,
      agent: explicitAgent(info),
      // Null, not zero: a non-terminal surface owns no panes, and spec §7 asks
      // for the count to be ABSENT rather than reading "0 panes".
      paneCount: surfaces.activeIndex() >= 0 ? null : (manager?.paneCount() ?? 0),
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
    const manager = createTerminalManager(
      container,
      callbacks,
      paneIo,
      managerDeps(nextKey),
    );
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
    if (
      target.kind === "new-window" &&
      tabs.length === 1 &&
      entry.manager.paneIds().length === 1
    ) {
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
    poller.prune(live);
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
    const manager = createTerminalManager(
      container,
      callbacks,
      paneIo,
      managerDeps(nextKey),
    );
    // Pushed BEFORE the adoption runs, not after. Rust flushes everything it
    // buffered during the transfer as part of `commit_transfer`, which happens
    // INSIDE `initFromAdoption`. Output is routed by scanning `tabs` for the
    // manager owning that pane id, so a manager still outside `tabs` at commit
    // time drops every buffered chunk and any `pty:exit` among them — silently
    // and permanently. `paneIds()` stays empty until the adopt places the pane,
    // so an entry parked here matches nothing until it genuinely owns it.
    const placeholder: TabEntry = { key: nextKey, manager, workspacePath: null };
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
        ...(result.payload.tabName !== null
          ? { name: result.payload.tabName }
          : {}),
        ...(result.payload.dotColor !== null
          ? { dotColor: result.payload.dotColor }
          : {}),
      });
    }
    nextKey += 1;
    selectTab(tabs.length - 1);
    void poller.poll();
    syncViews();
    return true;
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
    // A workspace may own any number of tabs: opening one that already has a
    // tab spawns another rather than focusing the first, so the same repo can
    // run several agent sessions side by side. `workspacePath` is a label the
    // tab carries (sidebar, logo, reopen), never an identity that dedupes.
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
    // (Shell only / reopen) arms nothing. The id becomes a command line HERE
    // rather than inside the launcher: `arm` still takes a plain string and
    // writes it verbatim, so its readiness/timeout state machine stays out of
    // the catalog's business. A declared agent deleted since the workspace
    // remembered it resolves to null and arms nothing — an empty shell, not a
    // pane that types a stale command.
    const agentId = intent.agent ?? null;
    launcher.arm(
      entry.manager.paneIds(),
      agentId === null
        ? null
        : resolveAgentCommand(agentId, settings.value.customAgents),
    );
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

  function ownerOf(paneId: number): TabEntry | undefined {
    return tabs.find((tab) => tab.manager.paneIds().includes(paneId));
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
      // Every window is a peer (spec §2, §9.5): the last SURFACE closes THIS
      // window, and the host decides whether that was also the last window and
      // the process should exit. CloseCoordinator already ran the busy guard
      // here, so nothing prompts twice.
      //
      // "Surface", not "tab": a window holding file tabs still has something to
      // show, and closing it would discard them — including unsaved ones, with
      // no prompt, since the busy guard that just ran only knew about panes.
      active = -1;
      if (surfaces.total() > 0) {
        surfaces.activate(0);
        syncViews();
        return;
      }
      try {
        await flushSettingsSave();
      } catch (err: unknown) {
        console.warn("Flush before window close failed:", err);
      }
      await closeWindow();
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
        const snap = tracker.noteProcess(
          info.id,
          agent ?? info.process,
          agent !== null,
        );
        if (snap !== null) {
          maybeNotify(info.id, snap);
        }
      }
      syncViews();
    },
  });

  /**
   * ⌘⇧] / ⌘⇧[ — cycle every SURFACE in the strip, not just the terminal tabs.
   *
   * The strip is the terminal tabs followed by the non-terminal segment, so the
   * cycle runs over one combined index space. The old `tabs.length < 2` early
   * return is why one terminal tab plus three file tabs used to do nothing at
   * all: file tabs are the keyboard path to a file (spec §4.3), and that guard
   * silently removed it.
   */
  function cycleTab(step: 1 | -1): void {
    const surfaceCount = surfaces.count();
    const total = tabs.length + surfaceCount;
    if (total < 2) {
      return;
    }
    const surfaceIndex = surfaces.activeIndex();
    const current = surfaceIndex >= 0 ? tabs.length + surfaceIndex : active;
    const next = (current + step + total) % total;
    if (next < tabs.length) {
      selectTab(next);
      return;
    }
    surfaces.activate(next - tabs.length);
  }

  /**
   * Copy `id`'s polled CWD to the clipboard (⌘⇧C / menu Edit ▸ "Copy Working
   * Directory", Task 3 of docs/plans/2026-07-27-keyboard-parity.md).
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
    "copy-selection": () => activeManager()?.copyActiveSelection(),
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
    // Opens the same rename/dot-color popover the tab click already opens —
    // TabPopover itself is unchanged, this only adds the keyboard trigger.
    // Unknown active tab (no tabs yet) → no-op, nothing to request.
    "open-tab-options": () => {
      const tab = tabs[active];
      if (tab) {
        requestTabOptionsKey.value = tab.key;
      }
    },
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
    // overlay stack to keep consistent — the same reason `open-tab-options`
    // sets `requestTabOptionsKey` itself.
    //
    // The close branch returns focus HERE, not in the popover: this path
    // unmounts the surface without ever calling its `onClose`, so DL-13.2's
    // "focus returns to the pane that had it" would otherwise be skipped and
    // the caret would land on <body> — the shortcut fires while focus sits on
    // the popover root, a div, so nothing else would take it back.
    "move-pane-to-new-window": () => void movePaneToNewWindow(),
    // The panel is host-owned: this only flips the signal the chrome reads
    // and tells the host to create or tear down the native view. Both store
    // helpers swallow their own transport errors, because a browser panel
    // that fails to open must not take a keystroke's dispatch down with it.
    "toggle-browser": () => {
      if (browserOpen.value) {
        void closeBrowser(defaultBrowserClient);
        activeManager()?.focusActive();
        return;
      }
      void openBrowser(defaultBrowserClient, settings.value.browserHomeUrl);
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
   * token usage screen, PresetEditor/SavePresetDialog share the "modal" rank
   * — see `TIER_RANK`'s doc comment in action-registry.ts for why). Empty
   * when nothing covers the terminal grid.
   *
   * Usage reuses `TIER_RANK.settings` rather than getting a member of its own
   * in the `OverlayTier` union. The rank is what an action is compared
   * AGAINST, and Usage covers the grid exactly the way Settings does (both
   * full-window, both above the board, both below a modal draft) — so the
   * comparison it wants already exists. Adding a fifth tier would introduce a
   * rank nothing is tiered at, next to `"settings"`, which is already a rank
   * nothing is tiered at. One such rank is a documented deliberate gap; two
   * is a pattern nobody can explain.
   */
  function openOverlayRanks(): readonly number[] {
    const ranks: number[] = [];
    if (settingsOpen.value || usageOpen.value) {
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
   * very overlay that would otherwise strand it). Every "switch tabs" action
   * (`select-tab-N`, `select-last-tab`, `next-tab`, `prev-tab`) is exempt
   * through the SEPARATE `isTabSwitchAction` mechanism below, not through
   * `scope` — see its own doc comment for why that's a distinct action
   * family, not a product-level "always" decision.
   */
  function overlayBlocksAction(action: ShortcutAction): boolean {
    const scope = ACTION_SCOPE.get(action);
    if (
      scope === undefined ||
      scope === "always" ||
      isTabSwitchAction(action)
    ) {
      return false;
    }
    const targetRank = TIER_RANK[scope];
    return openOverlayRanks().some((rank) => rank >= targetRank);
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
    // `tabs.length > 0` is load-bearing, not defensive noise: with no tab at
    // all there is nothing behind the board to switch TO, so dismissing it
    // would leave an empty `.stage` — no board, no terminal, nothing on
    // screen. That is the app's own default landing state (it always opens on
    // the board, there is no session restore), so a habitual ⌘1 there used to
    // blank the window outright. The board itself already encodes this
    // invariant on the mouse path: `canCancel={tabViews.value.length > 0}`
    // (app.tsx) refuses to let Cancel/Escape close it with zero tabs — this
    // guard is the keyboard half of the same rule.
    if (isTabSwitchAction(action) && tabs.length > 0) {
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
    if (
      DESTRUCTIVE_ACTIONS.has(action) &&
      isChromeTextField(document.activeElement)
    ) {
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
      pty.listenPromptReady((id) => {
        launcher.notePromptReady(id);
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
    // Session restore is gone: the app always opens on the Open board, and the
    // user reopens folders from Recents by hand.
    poller.start();
    syncViews();
  }

  return {
    init,
    materialize,
    openFromPreset,
    activeWorkspacePath() {
      return active >= 0 && active < tabs.length
        ? tabs[active].workspacePath
        : null;
    },
    captureActiveLayout,
    activePaneCwd,
    activePaneId() {
      return activeManager()?.activePaneId() ?? null;
    },
    paneAttention,
    injectIntoPane,
    newTab,
    movePaneToNewWindow,
    adoptIntoNewTab,
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
      // A theme change has to reach the editor too, through the SAME call —
      // otherwise switching theme leaves an open editor in the old palette
      // until it is closed and reopened (spec §7).
      surfaces.applySettings(next);
    },
    focusActive() {
      // With a non-terminal surface active, focus must reach IT. The failure
      // mode is silent: focus lands on a pane the user cannot see and their
      // keystrokes go to a shell (spec §7).
      if (surfaces.activeIndex() >= 0) {
        surfaces.focus();
        return;
      }
      activeManager()?.focusActive();
    },
    notifySurfacesChanged() {
      syncViews();
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
