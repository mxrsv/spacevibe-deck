import { getDesktopEnvironment } from "../../lib/platform";
import { Chip } from "../blocks/chip";
import { Switch } from "../controls/switch";
import {
  openingNotificationSettings,
  openSystemNotificationSettings,
  requestingNotifications,
  toggleAgentNotifications,
} from "../settings/agent-notifications";

interface NotificationsControlProps {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled: boolean;
}

/** The agent-notifications switch, which asks the host before it turns on, and the way to the OS pane. */
export function NotificationsControl({ label, checked, disabled }: NotificationsControlProps) {
  return (
    <span className="flex items-center gap-2">
      <Switch
        aria-label={label}
        checked={checked}
        disabled={disabled || requestingNotifications.value}
        onCheckedChange={() => void toggleAgentNotifications()}
      />
      {getDesktopEnvironment().platform !== "unsupported" ? (
        <Chip
          disabled={disabled || openingNotificationSettings.value}
          onClick={openSystemNotificationSettings}
        >
          Open System Settings
        </Chip>
      ) : null}
    </span>
  );
}
