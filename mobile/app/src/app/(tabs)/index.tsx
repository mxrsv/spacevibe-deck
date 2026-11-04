import { View } from "react-native";
import { useRouter } from "expo-router";
import { useDesktopEntries } from "@/app-state/app-provider";
import { DesktopRow } from "@/desktops/desktop-row";
import { DesktopTree } from "@/desktops/desktop-tree";
import { Button, IconButton } from "@/ui/button";
import { Group } from "@/ui/grouped-list";
import { Screen } from "@/ui/screen";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";

export default function DesktopsScreen() {
  const router = useRouter();
  const entries = useDesktopEntries();
  return (
    <Screen
      title="Desktops"
      accessory={
        <IconButton name="plus" label="Pair a desktop" onPress={() => router.push("/pair")} />
      }
    >
      {entries.length === 0 ? (
        <View style={{ alignItems: "center", gap: 12, paddingHorizontal: 32, paddingTop: 64 }}>
          <Symbol name="laptopcomputer" size={48} tone="faint" />
          <Txt variant="title3">No desktops yet</Txt>
          <Txt variant="callout" tone="muted" center>
            Open Settings → Mobile in Deck on your computer and choose Pair a phone.
          </Txt>
          <Button
            label="Pair a desktop"
            icon="qrcode.viewfinder"
            onPress={() => router.push("/pair")}
          />
        </View>
      ) : (
        <View style={{ gap: 16 }}>
          {entries.map((entry) => (
            <View key={entry.summary.pairingId}>
              <Group>
                <DesktopRow
                  entry={entry}
                  onPress={() =>
                    router.push({
                      pathname: "/desktop/[id]",
                      params: { id: entry.summary.pairingId },
                    })
                  }
                />
              </Group>
              <DesktopTree entry={entry} />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}
