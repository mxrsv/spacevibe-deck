import { isReleaseSwitchEnabled } from "../../lib/release-switches";
import { rendererReleaseSwitches } from "../../terminal/action-availability";
import { SettingsScreen } from "../settings/settings-screen";
import { CommandSettings } from "./command-settings";

interface SettingsSurfaceProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * The one mount `app.tsx` has for Settings. The switch is read when this
 * renders, never into a constant, so a packaged build keeps the screen it
 * shipped with and a development build shows Command Settings. Every way in
 * (the rail footer, the chord, the menu, `openSettingsAt`) sets the same
 * `settingsOpen` signal, so this is the only place the choice is made.
 */
export function SettingsSurface({ open, onClose }: SettingsSurfaceProps) {
  return isReleaseSwitchEnabled("commandSettings", rendererReleaseSwitches()) ? (
    <CommandSettings open={open} onClose={onClose} />
  ) : (
    <SettingsScreen open={open} onClose={onClose} />
  );
}
