import type { SurfaceSpec } from "../surface-types";
import { SETTINGS_A } from "./settings-option-a";

export const SETTINGS_SURFACE: SurfaceSpec = {
  id: "settings",
  label: "Settings",
  today:
    "A whole-window screen: a 220px rail of ten categories with a search field, one category's rows at a time and a per-page reset; ⌘, opens it, Esc goes back to the terminals.",
  picked: "a",
  options: [SETTINGS_A],
};
