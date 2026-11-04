import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useDesktopEntries, usePrefsState, useServices } from "@/app-state/app-provider";
import { DesktopRow } from "@/desktops/desktop-row";
import { authenticate } from "@/lock/authenticate";
import { Group, Row, SectionFooter, SectionTitle } from "@/ui/grouped-list";
import { Screen } from "@/ui/screen";
import { SwitchRow } from "@/ui/switch-row";

export default function SettingsScreen() {
  const router = useRouter();
  const { prefs: controller, versionLine } = useServices();
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
          value={prefs.notifications}
          onValueChange={(on) => void controller.update({ notifications: on })}
        />
      </Group>
      <SectionFooter>{versionLine}</SectionFooter>
    </Screen>
  );
}
