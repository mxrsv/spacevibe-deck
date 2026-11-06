import { useState, type ReactNode } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { Txt } from "./text";

interface ScreenProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Controls to the right of the large title (a plus, a close). */
  readonly accessory?: ReactNode;
  /** Pull to refresh; the spinner shows until the promise settles. */
  readonly onRefresh?: () => Promise<void>;
}

/** A scrolling screen with the iOS large title on the grouped ground. */
export function Screen({ title, children, accessory, onRefresh }: ScreenProps) {
  const [refreshing, setRefreshing] = useState(false);
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.ground }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh === undefined ? undefined : (
          <RefreshControl
            refreshing={refreshing}
            tintColor={palette.textFaint}
            onRefresh={() => {
              setRefreshing(true);
              void onRefresh().finally(() => setRefreshing(false));
            }}
          />
        )
      }
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: metrics.screenInset + 4,
          paddingBottom: 8,
          minHeight: metrics.hit,
        }}
      >
        <View style={{ flex: 1 }}>
          <Txt variant="largeTitle" accessibilityRole="header" numberOfLines={2}>
            {title}
          </Txt>
        </View>
        {accessory}
      </View>
      {children}
    </ScrollView>
  );
}
