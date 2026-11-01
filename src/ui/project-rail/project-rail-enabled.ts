import { isReleaseSwitchEnabled } from "../../lib/release-switches";
import { rendererReleaseSwitches } from "../../terminal/action-availability";

/** Read at render time, never into a constant (release-switch convention). */
export function projectRailEnabled(): boolean {
  return isReleaseSwitchEnabled("projectRail", rendererReleaseSwitches());
}
