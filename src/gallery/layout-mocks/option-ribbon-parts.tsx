import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  GitBranchIcon,
  MoreHorizontalIcon,
  SidebarRightIcon,
  UnfoldMoreIcon,
} from "@hugeicons/core-free-icons";
import { AGENTS, SPACES, placeOf, type MockAgent } from "./layout-fixture";

const ICONS = {
  chevron: ArrowDown01Icon,
  branch: GitBranchIcon,
  more: MoreHorizontalIcon,
  dock: SidebarRightIcon,
  overflow: UnfoldMoreIcon,
} as const;

export function RibbonIcon({ name, size = 14 }: { name: keyof typeof ICONS; size?: number }) {
  return <HugeiconsIcon icon={ICONS[name]} size={size} strokeWidth={1.8} aria-hidden="true" />;
}

/** The agents of one project in space order, then pane order. */
export function agentsOfProject(projectId: string): readonly MockAgent[] {
  return AGENTS.filter((agent) => placeOf(agent).project.id === projectId).sort(
    (a, b) => spaceIndex(a) - spaceIndex(b) || paneIndex(a) - paneIndex(b),
  );
}

function spaceIndex(agent: MockAgent): number {
  return SPACES.findIndex((space) => space.id === agent.spaceId);
}

function paneIndex(agent: MockAgent): number {
  return placeOf(agent).space.paneIds.indexOf(agent.id);
}

export function totals(agent: MockAgent) {
  const { changes } = placeOf(agent).checkout;
  return {
    files: changes.length,
    added: changes.reduce((sum, change) => sum + change.added, 0),
    removed: changes.reduce((sum, change) => sum + change.removed, 0),
  };
}
