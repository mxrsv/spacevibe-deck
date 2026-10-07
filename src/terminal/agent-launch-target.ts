import type { DesktopPlatform } from "../lib/platform";

export type AgentLaunchTarget =
  | {
      readonly kind: "split";
      readonly workspacePath: string;
      readonly tabKey: number;
      readonly paneId: number;
    }
  | { readonly kind: "first-pane"; readonly workspacePath: string }
  /**
   * A space of its own although the folder already has a tab: captured when
   * the focused pane is in another checkout (RAIL4, DL-27.26 amended
   * 2026-10-07), or derived by the page from a press on `New space`.
   */
  | { readonly kind: "new-space"; readonly workspacePath: string };

/** What a Run press asks for: the captured target as it stands, or a space. */
export type AgentLaunchPlacement = "target" | "new-space";

export interface LaunchTargetTab {
  readonly key: number;
  readonly workspacePath: string | null;
  readonly paneId: number | null;
}

export interface AgentLaunchReceipt {
  readonly tabKey: number;
  readonly paneId: number;
  readonly canFocus: () => boolean;
}

export type AgentLaunchResult =
  | { readonly kind: "spawned"; readonly receipt: AgentLaunchReceipt }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly message: string };

/** Comparison keys only: never pass these normalized strings to the host. */
function comparisonKey(path: string, platform: DesktopPlatform): string {
  const value =
    platform === "windows" ? path.trim().replace(/\\/g, "/").toLowerCase() : path.trim();
  return value.replace(/\/+$/, "") || "/";
}

function contains(root: string, path: string): boolean {
  return path === root || path.startsWith(root === "/" ? "/" : `${root}/`);
}

export function resolveAgentLaunchTarget(
  workspacePath: string,
  tabs: readonly LaunchTargetTab[],
  activeKey: number | null,
  checkoutRoots: readonly string[] = [],
  platform: DesktopPlatform = "macos",
): AgentLaunchTarget | null {
  const workspace = workspacePath.trim();
  if (!workspace) return null;
  const root = comparisonKey(workspace, platform);
  const roots = [...checkoutRoots, workspace].map((path) => comparisonKey(path, platform));
  const matching = tabs.filter((tab) => {
    if (tab.workspacePath === null || tab.paneId === null) return false;
    const path = comparisonKey(tab.workspacePath, platform);
    const owner = roots
      .filter((candidate) => contains(candidate, path))
      .sort((a, b) => b.length - a.length)[0];
    return owner === root;
  });
  if (matching.length === 0) return { kind: "first-pane", workspacePath: workspace };
  // RAIL4: split only beside the focused pane, and only when it belongs to
  // this checkout. A checkout whose tabs sit in the background gets a space
  // of its own rather than a split into a tab the user is not looking at.
  const target = matching.find((tab) => tab.key === activeKey);
  return target === undefined
    ? { kind: "new-space", workspacePath: workspace }
    : { kind: "split", workspacePath: workspace, tabKey: target.key, paneId: target.paneId! };
}
