import type { Direction, Edge, SerializedNode } from "../lib/split-tree";
import type { PaneRect } from "../lib/pane-geometry";
import type { SessionTab } from "../lib/session-schema";
import type { TransferClient } from "./transfer-client";
import type { AgentChoice } from "../lib/workspace-recents";
import type { ShortcutAction } from "./keymap";
import type { TerminalManager, TerminalManagerDeps } from "./terminal-manager";
import type { PaneAttentionSnapshot } from "./agent-attention";
import type { AgentNotifier } from "./agent-notifier";
import type { InjectOutcome } from "../prompts/inject";
import type { MaterializeIntent } from "./tab-materialize";
import type { Settings } from "../settings/settings-schema";
import type { SurfaceStrip } from "./surface-strip";

/**
 * Internal to the tab-manager module: `createTabManager` (`tab-manager.ts`)
 * is the only consumer, and it imports this type directly rather than
 * through a re-export — nothing outside the module needs it.
 */
export interface TabEntry {
  readonly key: number;
  readonly manager: TerminalManager;
  /**
   * This tab's place in the strip's one open order (`lib/open-sequence.ts`).
   * Separate from `key`, which is an identity and happens to be allocated in
   * creation order: the order key is shared with surfaces this manager knows
   * nothing about, so it cannot come from a counter only tabs advance.
   */
  readonly openedAt: number;
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
   * ⌘⇧U (`toggle-usage`) and the menu's "Token Usage" item route here rather
   * than reaching into the dock directly — the same reason `onToggleSettings`
   * above exists. App owns the reveal+focus-return flow for every surface it
   * mounts; duplicating half of it here is how the two would drift. Missing
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
  /**
   * AgentQuickPicker confirm: single pane, active tab's workspace, no
   * workspace/preset step — the `+` button's fast path (`newTab()`).
   */
  /**
   * `destination` is a worktree path the quick picker offered; it becomes
   * both the new tab's cwd and its workspace tag. Omit (or pass null) to keep
   * the focused pane's live cwd and the active tab's workspace.
   */
  openQuickAgent(
    agentId: AgentChoice,
    destination?: string | null,
  ): Promise<boolean>;
  /**
   * The `New` row dropped onto a pane: dock a pane on `edge` of
   * `targetPaneId` inside the ACTIVE tab and launch the agent that tab's
   * workspace was last opened with. No picker step, so the agent comes from
   * memory alone — an unknown workspace takes the first detected agent, and a
   * host that detects none opens a plain shell.
   *
   * The one materialization path that adds a pane to a LIVE tab instead of
   * creating a tab (`openQuickAgent` and every preset/board open create one).
   * Resolves `false` when nothing was created.
   */
  dropAgentPane(targetPaneId: number, edge: Edge): Promise<boolean>;
  /** Live pane geometry of the active tab, for a drag started off the stage. */
  activeSlotRects(): readonly PaneRect[];
  /** Workspace of the active tab; null when it has none (or no tab). */
  activeWorkspacePath(): string | null;
  /** Live layout + fresh per-pane CWDs for save-as-preset; null when no tab. */
  captureActiveLayout(): Promise<{
    layout: SerializedNode;
    cwds: readonly (string | null)[];
  } | null>;
  /**
   * Polled snapshot of every tab for the session journal. No IPC and no
   * awaits — reads the 2 s poll cache, which is the deliberate accuracy
   * bound for a journal that survives power-off (there is no "at quit"
   * moment to be fresher at).
   */
  captureSession(): readonly SessionTab[];
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
