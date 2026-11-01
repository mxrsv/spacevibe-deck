import type { SurfaceSpec } from "../surface-types";
import { BrowserPaired } from "./browser-option-d";

const FOCUS = "a-filters-gemini";

export const BROWSER_SURFACE: SurfaceSpec = {
  id: "browser",
  label: "Browser",
  today:
    "A browser chip on the strip (⌘⇧I) whose surface is a native WebContentsView occupying the whole stage, opening on the home address from Settings. A dev-servers chip lists local servers to open in it. Inspect grabs an element for the agent.",
  picked: "d",
  options: [
    {
      id: "d",
      label: "Beside, expands to the stage",
      concept:
        "b and a mixed: the preview opens beside the agent's terminal and zooms to the stage like a pane (⌘⇧↵) with the agent's state on its toolbar; sending an element from the stage puts the terminal back beside it.",
      area: ["terminal-area"],
      focus: FOCUS,
      frame: "shell",
      dock: "closed",
      slots: { stage: (agent) => <BrowserPaired agent={agent} /> },
    },
  ],
};
