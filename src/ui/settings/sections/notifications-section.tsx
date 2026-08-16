import { useSignal } from "@preact/signals";
import { settings, updateSettings } from "../../../settings/settings-store";
import { ToggleRow } from "../../controls/config-row";
import { reportPersistError } from "../../../chrome/events";
import { requestAgentNotificationPermission } from "../../../lib/native-notification";

/** The "agent notifications" row — moved verbatim from the settings drawer this screen replaced
 * (Task 4), including its async permission guard. */
export function NotificationsSection() {
  const current = settings.value;
  // Guards the native OS permission prompt: true while a request from THIS
  // click is in flight, so a second click can't fire a second prompt.
  const requesting = useSignal(false);

  // Disabling is immediate and never prompts. Enabling requests OS
  // permission from THIS click only — never at mount/startup/reset — and
  // only flips the setting to true when the user actually grants it.
  const handleAgentNotificationsToggle = async (): Promise<void> => {
    if (requesting.value) {
      // Local guard: blocks re-entry synchronously, before the `requesting`
      // signal write has propagated to a re-rendered (disabled) button.
      return;
    }
    if (current.agentNotifications) {
      updateSettings({ agentNotifications: false });
      return;
    }
    requesting.value = true;
    try {
      const granted = await requestAgentNotificationPermission();
      if (granted) {
        updateSettings({ agentNotifications: true });
      } else {
        reportPersistError("Notification permission was denied.");
      }
    } catch {
      reportPersistError("Couldn't request notification permission.");
    } finally {
      requesting.value = false;
    }
  };

  return (
    <>
      <ToggleRow
        label="Agent notifications"
        desc="Native alert when a background agent finishes or needs you"
        checked={current.agentNotifications}
        disabled={requesting.value}
        onToggle={handleAgentNotificationsToggle}
      />
      <ToggleRow
        label="Restore sessions on launch"
        desc="Reopen last session's tabs and resume agent conversations"
        checked={current.restoreSessions}
        onToggle={() =>
          updateSettings({ restoreSessions: !current.restoreSessions })
        }
      />
    </>
  );
}
