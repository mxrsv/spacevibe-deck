import type { PaneProcessInfo } from "../lib/process-info";
import { countLeaves, type SerializedNode } from "../lib/split-tree";
import type { TabDotColor } from "../lib/tab-colors";
import type { AgentChoice } from "../lib/workspace-recents";
import { freshPaneInfo } from "./pane-info";
import { defaultPtyClient, type PtyClient } from "./pty-client";
import type { ClosedTabSnapshot } from "./closed-tabs";

/**
 * How per-pane CWDs are gathered when snapshotting or materializing a Tab.
 *
 * - `fresh` — one-shot `pty_info` (Layout preset save, Closed tab snapshot)
 * - `polled` — TabManager's 2s poll cache (chrome only; not for persistence)
 * - `none` — no CWDs; spawn falls back to `$HOME`
 * - `given` — caller already resolved CWDs (Open board, reopen stack)
 */
export type CwdPolicy = "fresh" | "polled" | "none" | "given";

/** Zip pane ids against a polled info map; null when unknown. Pure. */
export function zipPolledCwds(
  paneIds: readonly number[],
  infoByPane: ReadonlyMap<number, PaneProcessInfo>,
): readonly (string | null)[] {
  return paneIds.map((id) => infoByPane.get(id)?.cwd ?? null);
}

/** Zip pane ids against a fresh `pty_info` result list. Pure. */
export function zipFreshCwds(
  paneIds: readonly number[],
  infos: readonly PaneProcessInfo[],
): readonly (string | null)[] {
  const byId = new Map(infos.map((info) => [info.id, info] as const));
  return paneIds.map((id) => byId.get(id)?.cwd ?? null);
}

/**
 * Resolve per-pane CWDs under an explicit policy.
 * `given` returns `provided` (or [] when omitted).
 * `none` always returns [] — spawn then falls back to `$HOME`.
 */
export async function resolvePaneCwds(
  paneIds: readonly number[],
  policy: CwdPolicy,
  options: {
    polled?: ReadonlyMap<number, PaneProcessInfo>;
    provided?: readonly (string | null)[];
    pty?: PtyClient;
  } = {},
): Promise<readonly (string | null)[]> {
  switch (policy) {
    case "none":
      return [];
    case "given":
      return options.provided ?? [];
    case "polled":
      return zipPolledCwds(paneIds, options.polled ?? new Map());
    case "fresh": {
      const infos = await freshPaneInfo(
        paneIds,
        options.pty ?? defaultPtyClient,
      );
      return zipFreshCwds(paneIds, infos);
    }
  }
}

/**
 * Layout preset editor (live window): each leaf uses its preset CWD when set,
 * otherwise inherits the focused pane's CWD.
 */
export function resolveInheritedCwds(
  layout: SerializedNode,
  presetCwds: readonly (string | null)[] | undefined,
  inherit: string | null,
): readonly (string | null)[] {
  return Array.from(
    { length: countLeaves(layout) },
    (_, index) => presetCwds?.[index] ?? inherit,
  );
}

/** Assemble a Closed tab snapshot once CWDs are already resolved. */
export function buildClosedTabSnapshot(input: {
  layout: SerializedNode;
  name: string | null;
  dotColor: TabDotColor | null;
  cwds: readonly (string | null)[];
  workspacePath: string | null;
}): ClosedTabSnapshot {
  return {
    layout: input.layout,
    name: input.name,
    dotColor: input.dotColor,
    cwds: input.cwds,
    workspacePath: input.workspacePath,
  };
}

/** Live Layout + fresh CWDs for save-as-preset. */
export async function capturePresetLayout(
  paneIds: readonly number[],
  layout: SerializedNode,
  pty: PtyClient = defaultPtyClient,
): Promise<{ layout: SerializedNode; cwds: readonly (string | null)[] }> {
  const cwds = await resolvePaneCwds(paneIds, "fresh", { pty });
  return { layout, cwds };
}

/** Optional tab chrome applied under the new tab key after spawn. */
export interface MaterializeChrome {
  readonly name?: string;
  readonly dotColor?: TabDotColor;
}

/**
 * Single interface for Open board / Closed tab / Layout preset.
 * TabManager.materialize owns the implementation.
 */
export interface MaterializeIntent {
  readonly layout: SerializedNode | null;
  readonly cwds: readonly (string | null)[];
  /**
   * Agent CLI to launch in every new pane once its shell is ready; `null` (or
   * absent) leaves the panes as plain shells. Open board sets it; Closed tab
   * reopen passes `null` (⌘⇧T does not re-run agents).
   */
  readonly agent?: AgentChoice;
  /**
   * The command the agent launches with. `undefined` = resolve the agent's
   * default preset (Open board, rail drop, a plain reopen); `null` = launch
   * the bare binary even if a default exists (the quick picker's "No preset"
   * row). Resolved inside `materialize`, so no caller has to look a preset up.
   */
  readonly launchCommand?: string | null;
  /**
   * Per-pane launch commands, zipped to leaves left-to-right. When present it
   * overrides `agent` per pane (a null slot leaves that pane a plain shell).
   * Session restore is the caller: each pane resumes its own conversation.
   */
  readonly paneCommands?: readonly (string | null)[];
  readonly chrome?: MaterializeChrome;
  /** Workspace the new tab belongs to; absent = a tab with no workspace. */
  readonly workspacePath?: string;
}

/** Build chrome overrides from a Closed tab snapshot. */
export function materializeChromeFrom(
  name: string | null | undefined,
  dotColor: TabDotColor | null | undefined,
): MaterializeChrome | undefined {
  const chrome: MaterializeChrome = {
    ...(name != null ? { name } : {}),
    ...(dotColor != null ? { dotColor } : {}),
  };
  if (chrome.name === undefined && chrome.dotColor === undefined) {
    return undefined;
  }
  return chrome;
}
