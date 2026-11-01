import type { SurfaceSpec } from "../surface-types";
import { DiffQueue } from "./diff-queue";

export const DIFF_SURFACE: SurfaceSpec = {
  id: "diff",
  label: "Diff",
  today:
    "Pressing a Changes row opens a Monaco diff column beside the explorer (inside the dock). Line comments to the running agent are being built: select lines, press a chord, and a composer sends one line `In <path>:L<a>-L<b>: <comment>` to the checkout's agent pane by bracketed paste.",
  picked: "c",
  options: [
    {
      id: "c",
      label: "Hunk review queue",
      concept:
        "One hunk at a time in the stage with Next/Previous, mark reviewed and a progress count; the composer sits beside the hunk.",
      area: ["terminal-area"],
      frame: "shell",
      dock: "closed",
      slots: { stage: (agent) => <DiffQueue agent={agent} /> },
    },
  ],
};
