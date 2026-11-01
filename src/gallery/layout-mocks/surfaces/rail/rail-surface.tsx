import type { SurfaceSpec } from "../surface-types";
import { RAIL_C } from "./rail-option-c";

export const RAIL_SURFACE: SurfaceSpec = {
  id: "rail",
  label: "Rail",
  today:
    "A project, checkout and session tree with a Create row (Worktree, Folder, Agent) above it, a six-button footer and a usage-limit line, resizable and collapsible to a 52px avatar column.",
  picked: "c",
  options: [RAIL_C],
};
