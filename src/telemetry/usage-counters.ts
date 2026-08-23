/**
 * Renderer-side counting for the opt-in usage analytics (spec §3, §4).
 *
 * This module knows nothing about the network and holds no identifier: every
 * count is a fire-and-forget `telemetry_count` through the host facade, and
 * main decides whether consent allows it to land. Where the host cannot
 * answer at all (Tauri, browser preview) every function is a no-op.
 *
 * Metric meanings are spec §4's, fixed here with their sources:
 * - an agent LAUNCH is materialization issuing an agent command, resumed
 *   agents included — not a conversation, not a session;
 * - a surface OPEN is browser/explorer/usage changing from not visible to
 *   visible; repeated hide/show transitions count again;
 * - `maxTabs`/`maxPanes` are high-water marks main folds from gauge reports
 *   read off `tabViews`;
 * - `restoredSessions` is boot restore materializing at least one pane.
 */
import { effect } from "@preact/signals";
import { available, telemetryCount } from "../host/telemetry-host";
import { agentPayloadKey, type SurfaceKey } from "./payload";

/** A launch of a named agent. Callers never pass a plain shell here. */
export function countAgentLaunch(agentId: string): void {
  if (!available || agentId.length === 0) {
    return;
  }
  // The fold to the closed key set happens HERE, so a user-typed custom agent
  // id never leaves the renderer (spec §4).
  telemetryCount({ kind: "agent", key: agentPayloadKey(agentId), value: 1 });
}

export function countSurfaceOpen(surface: SurfaceKey): void {
  if (!available) {
    return;
  }
  telemetryCount({ kind: "surface", key: surface, value: 1 });
}

/** Boot restore materialized at least one pane this run. */
export function countRestoredSessions(): void {
  if (!available) {
    return;
  }
  telemetryCount({ kind: "restored", key: "", value: 1 });
}

export interface UsageCounterSources {
  /** Open tab count, read reactively off `tabViews`. */
  tabCount(): number;
  /** Total pane count across every tab, read reactively off `tabViews`. */
  paneCount(): number;
  browserVisible(): boolean;
  explorerVisible(): boolean;
  usageVisible(): boolean;
}

/**
 * One window-scoped effect (the `session-journal` shape) that turns signal
 * changes into counts. Surface opens are EDGES: the first tick seeds the
 * previous values, so a boot-persisted open dock reads as state, not as an
 * open. Tab/pane counts go up as gauges on every change; main folds the
 * per-day maximum, so day rollover happens in exactly one place.
 */
export function installUsageCounterEffects(sources: UsageCounterSources): () => void {
  if (!available) {
    return () => {};
  }
  let seeded = false;
  let prevBrowser = false;
  let prevExplorer = false;
  let prevUsage = false;
  let prevTabs = -1;
  let prevPanes = -1;
  return effect(() => {
    const tabs = sources.tabCount();
    const panes = sources.paneCount();
    const browser = sources.browserVisible();
    const explorer = sources.explorerVisible();
    const usage = sources.usageVisible();
    if (seeded) {
      if (browser && !prevBrowser) {
        countSurfaceOpen("browser");
      }
      if (explorer && !prevExplorer) {
        countSurfaceOpen("explorer");
      }
      if (usage && !prevUsage) {
        countSurfaceOpen("usage");
      }
    }
    seeded = true;
    prevBrowser = browser;
    prevExplorer = explorer;
    prevUsage = usage;
    if (tabs !== prevTabs) {
      prevTabs = tabs;
      telemetryCount({ kind: "tabs", key: "", value: tabs });
    }
    if (panes !== prevPanes) {
      prevPanes = panes;
      telemetryCount({ kind: "panes", key: "", value: panes });
    }
  });
}
