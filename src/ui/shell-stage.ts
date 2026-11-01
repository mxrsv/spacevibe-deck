import { isReleaseSwitchEnabled } from "../lib/release-switches";
import { rendererReleaseSwitches } from "../terminal/action-availability";

/** The class `App` puts on `.stage` while the flush stage is on; `31-shell-stage.css` keys on it. */
export const STAGE_FLUSH_CLASS = "stage--flush";

/** Read at render time, never into a constant (release-switch convention). */
export function shellStageEnabled(): boolean {
  return isReleaseSwitchEnabled("shellStage", rendererReleaseSwitches());
}
