import { useCallback, useSyncExternalStore } from "react";
import { useRouter } from "expo-router";
import { useDesktopEntries, usePrefsState, useServices } from "@/app-state/app-provider";
import { DesktopRow } from "@/desktops/desktop-row";
import { authenticate } from "@/lock/authenticate";
import { Group, Row, SectionFooter, SectionTitle } from "@/ui/grouped-list";
import { Screen } from "@/ui/screen";
import { SwitchRow } from "@/ui/switch-row";

export default function SettingsScreen() {
  const router = useRouter();
  const { prefs: controller, versionLine, push, manager } = useServices();
  const pushStatus = useSyncExternalStore(push.subscribe, push.status);
  const { prefs } = usePrefsState();
  const entries = useDesktopEntries();

  // Turning the lock off asks for it first: otherwise whoever holds an unlocked phone could
  // remove the protection the lock exists for.
  const setLock = useCallback(
    async (on: boolean) => {
      if (!on && (await authenticate("Turn off the lock")) === "cancelled") return;
      await controller.update({ faceIdLock: on });
    },
    [controller],
  );

  // The switch shows what is true: on only while a token is registered. Turning it on is the
  // moment the OS permission prompt may appear.
  const setNotifications = useCallback(
    async (on: boolean) => {
      await controller.update({ notifications: on });
      await push.sync(on, on);
      manager.announcePush();
    },
    [controller, push, manager],
  );
  const notificationsNote =
    pushStatus.state === "unavailable"
      ? pushStatus.reason
      : pushStatus.state === "denied"
        ? "Notifications are off for Deck in iOS Settings. Turn them on there."
        : pushStatus.state === "error"
          ? "Could not register for notifications. Try again later."
          : null;

  return (
    <Screen title="Settings">
      <SectionTitle>Desktops</SectionTitle>
      <Group>
        {entries.map((entry) => (
          <DesktopRow
            key={entry.summary.pairingId}
            entry={entry}
            onPress={() =>
              router.push({ pathname: "/desktop/[id]", params: { id: entry.summary.pairingId } })
            }
          />
        ))}
        <Row
          title="Pair a desktop"
          icon="qrcode.viewfinder"
          iconTone="accent"
          titleTone="accent"
          onPress={() => router.push("/pair")}
        />
      </Group>

      <SectionTitle>This phone</SectionTitle>
      <Group>
        <SwitchRow
          title="Unlock with Face ID"
          icon="faceid"
          value={prefs.faceIdLock}
          onValueChange={(on) => void setLock(on)}
        />
        <SwitchRow
          title="Notifications"
          icon="bell"
          value={prefs.notifications && pushStatus.state === "on"}
          disabled={pushStatus.state === "unavailable"}
          onValueChange={(on) => void setNotifications(on)}
        />
      </Group>
      {notificationsNote === null ? null : <SectionFooter>{notificationsNote}</SectionFooter>}
      <SectionFooter>{versionLine}</SectionFooter>
    </Screen>
  );
}
