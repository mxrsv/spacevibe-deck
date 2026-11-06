import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { Symbol } from "./symbol";
import { Txt } from "./text";

/** A pushed screen's bar: "‹ Back", the centred title and subtitle, and an optional control on the right. */
export function NavBar({
  backLabel,
  title,
  subtitle,
  onBack,
  right,
}: {
  readonly backLabel: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly right?: ReactNode;
}) {
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: palette.ground, paddingBottom: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: metrics.hit }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to ${backLabel}`}
          onPress={onBack}
          style={{
            width: 110,
            minHeight: metrics.hit,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 8,
            gap: 2,
          }}
        >
          <Symbol name="chevron.left" size={18} tone="accent" />
          <Txt variant="body" tone="accent" numberOfLines={1}>
            {backLabel}
          </Txt>
        </Pressable>
        <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
          <Txt variant="headline" numberOfLines={1} accessibilityRole="header">
            {title}
          </Txt>
          {subtitle === undefined ? null : (
            <Txt variant="footnote" tone="faint" numberOfLines={1}>
              {subtitle}
            </Txt>
          )}
        </View>
        <View style={{ width: 110, alignItems: "flex-end" }}>{right}</View>
      </View>
    </View>
  );
}
