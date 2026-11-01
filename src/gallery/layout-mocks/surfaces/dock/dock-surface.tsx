import type { SurfaceSpec } from "../surface-types";
import { stackedSlots } from "./dock-stacked";

export const DOCK_SURFACE: SurfaceSpec = {
  id: "dock",
  label: "Dock",
  today:
    "A right side panel (⌘⇧J) with three tabs (File explorer ⌘⇧B, Token usage ⌘⇧U, Session history ⌘⇧Y). It is a column that shrinks the stage, drag-resizable with a 360px floor. Changes is the explorer's second view, scoped to the tab's folder.",
  picked: "c",
  options: [
    {
      id: "c",
      label: "Stacked sections",
      concept:
        "One scroll of collapsible sections (Ask, Changes, In this space, Usage, Files, History), nothing behind a tab. OD-4: open by default at a fixed 320px with no resize; under 1360px it becomes a 32px edge handle that opens a sheet over the stage with a scrim. OD-5: global tools stay in the rail footer.",
      area: ["chrome-only"],
      frame: "shell",
      slots: stackedSlots,
    },
  ],
};
