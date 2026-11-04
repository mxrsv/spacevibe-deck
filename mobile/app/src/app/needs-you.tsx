import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PinnedCard } from "@/home/pinned-card";
import { useHome } from "@/home/use-home";
import { useTheme } from "@/theme/use-theme";
import { IconButton } from "@/ui/button";
import { Screen } from "@/ui/screen";
import { Txt } from "@/ui/text";

/** Every waiting pane, newest first: the list behind "See all". */
export default function NeedsYouScreen() {
  const router = useRouter();
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  const { needs, desktops, refresh } = useHome();
  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: 4 }}>
        <IconButton name="chevron.left" label="Back" onPress={() => router.back()} />
      </View>
      <View style={{ flex: 1, marginTop: -insets.top }}>
        <Screen title={`Needs you · ${needs.all.length}`} onRefresh={refresh}>
          <View style={{ gap: 12, paddingTop: 8 }}>
            {needs.all.length === 0 ? (
              <View style={{ paddingHorizontal: 20 }}>
                <Txt variant="callout" tone="muted">
                  Nothing is waiting for you.
                </Txt>
              </View>
            ) : null}
            {needs.all.map((item) => {
              const entry = desktops.find(
                (d) => d.entry.summary.pairingId === item.desktopId,
              )?.entry;
              return entry === undefined ? null : (
                <PinnedCard
                  key={`${item.desktopId}:${item.pane.paneId}`}
                  item={item}
                  entry={entry}
                />
              );
            })}
          </View>
        </Screen>
      </View>
    </View>
  );
}
