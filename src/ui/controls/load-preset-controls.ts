import { inject } from "vitest";
import type * as PresetControls from "./preset-controls";

declare module "vitest" {
  interface ProvidedContext {
    /** `file://` URL of the Preact bundle of `preset-controls.ts`, set by the global setup. */
    presetControlsUrl: string;
  }
}

/**
 * The Base UI controls as the tests must load them: from the bundle that
 * `scripts/preset-controls-bundle.mjs` builds with the React aliases applied. Importing
 * `./button` and friends directly would load real React through Node (see that script).
 */
export function loadPresetControls(): Promise<typeof PresetControls> {
  return import(/* @vite-ignore */ inject("presetControlsUrl"));
}
