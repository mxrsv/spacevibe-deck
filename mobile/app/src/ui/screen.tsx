import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { Txt } from "./text";

interface ScreenProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Controls to the right of the large title (a plus, a close). */
  readonly accessory?: ReactNode;
}

/** A scrolling screen with the iOS large title on the grouped ground. */
export function Screen({ title, children, accessory }: ScreenProps) {
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.ground }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 32 }}
      contentInsetAdjustmentBehavior="never"
      keyboardShouldPersistTaps="handled"
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
