import type { SurfaceSpec } from "../surface-types";
import { TreeChanges } from "./changes-tree";

export const CHANGES_SURFACE: SurfaceSpec = {
  id: "changes",
  label: "Changes",
  today:
    "The explorer's second view: each changed file with status and +/− against HEAD, for the tab's folder, with a Refresh. Pressing a row opens a Monaco diff column beside the explorer.",
  picked: "b",
  options: [
    {
      id: "b",
      label: "Folder tree",
      concept:
        "Directories fold and collapse, each carrying the roll-up count of what changed beneath it.",
      area: ["chrome-only"],
      frame: "panel",
      width: 340,
      focus: "a-rail-opencode",
      render: (agent) => <TreeChanges key={agent.id} agent={agent} />,
    },
  ],
};
