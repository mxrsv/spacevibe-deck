import { BROWSER_SURFACE } from "./browser/browser-surface";
import { CHANGES_SURFACE } from "./changes/changes-surface";
import { DIFF_SURFACE } from "./diff/diff-surface";
import { DOCK_SURFACE } from "./dock/dock-surface";
import { RAIL_SURFACE } from "./rail/rail-surface";
import { SETTINGS_SURFACE } from "./settings/settings-surface";
import type { SurfaceSpec } from "./surface-types";

/** Every surface board, in the order the owner reviews them. */
export const SURFACES: readonly SurfaceSpec[] = [
  DOCK_SURFACE,
  CHANGES_SURFACE,
  DIFF_SURFACE,
  BROWSER_SURFACE,
  RAIL_SURFACE,
  SETTINGS_SURFACE,
];
