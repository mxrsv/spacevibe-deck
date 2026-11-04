import { Pressable, View } from "react-native";
import type { SFSymbol } from "expo-symbols";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { Symbol } from "./symbol";
import { Txt } from "./text";

interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly icon?: SFSymbol;
  readonly kind?: "primary" | "plain";
  readonly disabled?: boolean;
}

/** The primary action (ivory fill, no edge, as the desktop's) or a plain accent-coloured text button. */
export function Button({ label, onPress, icon, kind = "primary", disabled = false }: ButtonProps) {
  const palette = useTheme();
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: metrics.hit,
        borderRadius: metrics.radiusField,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary ? palette.primary : "transparent",
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon !== undefined ? (
          <Symbol name={icon} tone={primary ? "primaryText" : "accent"} />
        ) : null}
        <Txt variant="headline" tone={primary ? "primaryText" : "accent"}>
          {label}
        </Txt>
      </View>
    </Pressable>
  );
}

/** A 44 pt square tap target for an icon (close, add). */
export function IconButton({
  name,
  label,
  onPress,
}: {
  readonly name: SFSymbol;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: metrics.hit,
        height: metrics.hit,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Symbol name={name} size={22} tone="accent" />
    </Pressable>
  );
}
