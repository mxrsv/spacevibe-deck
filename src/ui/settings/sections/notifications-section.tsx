import { settings } from "../../../settings/settings-store";
import { ToggleRow } from "../../controls/config-row";
import { getDesktopEnvironment } from "../../../lib/platform";
import { Button } from "../../controls/button";
import {
  openingNotificationSettings,
  openSystemNotificationSettings,
  requestingNotifications,
  toggleAgentNotifications,
} from "../agent-notifications";

/** Deck controls alert delivery; the OS controls authorization and badges. */
export function NotificationsSection() {
  const current = settings.value;
  return (
    <>
      <ToggleRow
        settingKey="agentNotifications"
        desc="Native alert when a background agent finishes or needs you"
        note={
          getDesktopEnvironment().platform !== "unsupported" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={openingNotificationSettings.value}
              onClick={openSystemNotificationSettings}
            >
              Open System Settings
            </Button>
          ) : undefined
        }
        checked={current.agentNotifications}
        disabled={requestingNotifications.value}
        onToggle={toggleAgentNotifications}
      />
    </>
  );
}
