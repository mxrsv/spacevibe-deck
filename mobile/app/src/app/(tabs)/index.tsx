import { View } from "react-native";
import { useRouter } from "expo-router";
import { DesktopTree } from "@/desktops/desktop-tree";
import { DesktopRow } from "@/desktops/desktop-row";
import { NeedsYouSection } from "@/home/needs-you-section";
import { useHome } from "@/home/use-home";
import { Button, IconButton } from "@/ui/button";
import { Group } from "@/ui/grouped-list";
import { Screen } from "@/ui/screen";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";

/** Home (direction E): Needs you pinned on top, then every desktop's tree. */
export default function DesktopsScreen() {
  const router = useRouter();
  const { desktops, needs, refresh } = useHome();
  const entries = desktops.map((d) => d.entry);
  return (
    <Screen
      title="Desktops"
      onRefresh={refresh}
      accessory={
        <IconButton name="plus" label="Pair a desktop" onPress={() => router.push("/pair")} />
      }
    >
      {desktops.length === 0 ? (
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
        <View style={{ gap: 8 }}>
          <NeedsYouSection
            needs={needs}
            entries={entries}
            showAll={() => router.push("/needs-you")}
          />
          {entries.map((entry) => (
            <View key={entry.summary.pairingId} style={{ paddingTop: 8 }}>
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
