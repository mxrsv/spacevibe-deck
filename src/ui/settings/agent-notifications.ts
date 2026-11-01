import { signal } from "@preact/signals";
import { reportPersistError } from "../../chrome/events";
import { openNotificationSettings } from "../../host/shell-host";
import { requestAgentNotificationPermission } from "../../lib/native-notification";
import { settings, updateSettings } from "../../settings/settings-store";

/*
 * The agent-notifications switch is not a plain setting: turning it on asks the
 * host whether alerts can be delivered. Every switch for the key (the legacy
 * section's and Command Settings') goes through here so none of them can turn it
 * on without that check.
 */

/** True while the support check is in flight; the switch reads it to stay inert. */
export const requestingNotifications = signal(false);
export const openingNotificationSettings = signal(false);

/**
 * Disabling is immediate. Enabling checks host support; on Electron the OS owns
 * authorization when the first alert is posted.
 */
export async function toggleAgentNotifications(): Promise<void> {
  if (requestingNotifications.value) {
    // Blocks re-entry synchronously, before the signal write has reached a re-rendered switch.
    return;
  }
  if (settings.value.agentNotifications) {
    updateSettings({ agentNotifications: false });
    return;
  }
  requestingNotifications.value = true;
  try {
    const granted = await requestAgentNotificationPermission();
    if (granted) {
      updateSettings({ agentNotifications: true });
    } else {
      reportPersistError("Notifications are not supported on this system.");
    }
  } catch {
    reportPersistError("Couldn't enable notifications. Try again.");
  } finally {
    requestingNotifications.value = false;
  }
}

export async function openSystemNotificationSettings(): Promise<void> {
  if (openingNotificationSettings.value) return;
  openingNotificationSettings.value = true;
  try {
    if (!(await openNotificationSettings())) throw new Error("Notification settings unavailable");
  } catch {
    reportPersistError(
      "Couldn't open System Settings. Open Notifications in your system settings.",
    );
  } finally {
    openingNotificationSettings.value = false;
  }
}
