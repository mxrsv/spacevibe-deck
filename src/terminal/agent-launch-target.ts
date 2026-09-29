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
   * The user asked for a space of its own although the folder already has a
   * tab. Never captured: `resolveAgentLaunchTarget` only answers `split` or
   * `first-pane`, and the page derives this from a press on `New space`.
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
  const target =
    matching.find((tab) => tab.key === activeKey) ??
    matching.find((tab) => comparisonKey(tab.workspacePath!, platform) === root) ??
    matching[0];
  return target === undefined
    ? { kind: "first-pane", workspacePath: workspace }
    : { kind: "split", workspacePath: workspace, tabKey: target.key, paneId: target.paneId! };
}
