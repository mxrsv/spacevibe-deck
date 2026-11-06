import { Pressable, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import { ACCESSORY_KEYS } from "@/terminal/keys";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { Txt } from "@/ui/text";

/** Live mode's row above the keyboard (MOB18): the Live indicator, then the keys a soft keyboard lacks. */
export function LiveAccessory({
  onKey,
  onExit,
}: {
  readonly onKey: (sequence: string) => void;
  readonly onExit: () => void;
}) {
  const palette = useTheme();
  return (
    <View
      style={{
        backgroundColor: palette.ground,
        paddingVertical: 6,
        paddingLeft: 8,
        flexDirection: "row",
        gap: 6,
        alignItems: "center",
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Live mode is on. Tap to turn it off"
        onPress={onExit}
        style={{
          minHeight: metrics.hit,
          paddingHorizontal: 12,
          borderRadius: metrics.radiusField,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          backgroundColor: palette.accent,
        }}
      >
        <View
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.primaryText }}
        />
        <Txt variant="subheadlineStrong" tone="primaryText">
          Live
        </Txt>
      </Pressable>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={{ gap: 6, paddingRight: 8 }}
      >
        {ACCESSORY_KEYS.map((key) => (
          <Pressable
            key={key.id}
            accessibilityRole="button"
            accessibilityLabel={key.description}
            onPress={() => {
              void Haptics.selectionAsync();
              onKey(key.sequence);
            }}
            style={({ pressed }) => ({
              minHeight: metrics.hit,
              minWidth: metrics.hit,
              paddingHorizontal: 10,
              borderRadius: metrics.radiusField,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? palette.pressed : palette.iconBox,
            })}
          >
            <Txt variant="subheadline">{key.label}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
