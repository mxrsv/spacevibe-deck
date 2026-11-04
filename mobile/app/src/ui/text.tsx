import type { ReactNode } from "react";
import { Text, type TextProps } from "react-native";
import { type Palette } from "@/theme/tokens";
import { type TypeName, type } from "@/theme/type";
import { useTheme } from "@/theme/use-theme";

export type TextTone = "text" | "muted" | "faint" | "accent" | "danger" | "primaryText";

export function toneColor(palette: Palette, tone: TextTone): string {
  switch (tone) {
    case "muted":
      return palette.textMuted;
    case "faint":
      return palette.textFaint;
    case "accent":
      return palette.accent;
    case "danger":
      return palette.danger;
    case "primaryText":
      return palette.primaryText;
    case "text":
      return palette.text;
  }
}

interface TxtProps extends Omit<TextProps, "style"> {
  readonly variant?: TypeName;
  readonly tone?: TextTone;
  readonly center?: boolean;
  /** Menlo, for code and file contents. */
  readonly monospace?: boolean;
  /** An explicit colour, for the few places a tone does not fit (diff rows). */
  readonly color?: string;
  readonly children: ReactNode;
}

/**
 * Text in one of the iOS text styles. Dynamic Type stays on (`allowFontScaling` is React Native's
 * default), so every size follows the user's setting.
 */
export function Txt({
  variant = "body",
  tone = "text",
  center = false,
  monospace = false,
  color,
  children,
  ...rest
}: TxtProps) {
  const palette = useTheme();
  return (
    <Text
      {...rest}
      style={[
        type[variant],
        { color: color ?? toneColor(palette, tone) },
        monospace ? { fontFamily: "Menlo" } : null,
        center ? { textAlign: "center" } : null,
      ]}
    >
      {children}
    </Text>
  );
}
