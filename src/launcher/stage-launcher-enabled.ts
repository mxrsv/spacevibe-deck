import { isReleaseSwitchEnabled } from "../lib/release-switches";
import { rendererReleaseSwitches } from "../terminal/action-availability";

/**
 * The launcher in the stage (spec 2026-11-04-launcher-in-stage). It needs the project rail too:
 * the rail stays up at zero tabs and the launcher takes the Open board's place beside it.
 * Read at render time, never into a constant (release-switch convention).
 */
export function stageLauncherEnabled(): boolean {
  const switches = rendererReleaseSwitches();
  return (
    isReleaseSwitchEnabled("stageLauncher", switches) &&
    isReleaseSwitchEnabled("projectRail", switches)
  );
}
