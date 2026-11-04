import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { SFSymbol } from "expo-symbols";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { Symbol } from "./symbol";
import { Txt } from "./text";

/** A rounded group on the ground, the iOS inset-grouped look of the mock. No separators inside (the mock's "Lines" decision). */
export function Group({ children }: { readonly children: ReactNode }) {
  const palette = useTheme();
  return (
    <View
      style={{
        marginHorizontal: metrics.screenInset,
        borderRadius: metrics.radiusGroup,
        backgroundColor: palette.group,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { readonly children: string }) {
  return (
    <View
      accessibilityRole="header"
      style={{ paddingTop: 16, paddingBottom: 6, paddingHorizontal: metrics.screenInset + 4 }}
    >
      <Txt variant="footnote" tone="faint">
        {children}
      </Txt>
    </View>
  );
}

export function SectionFooter({ children }: { readonly children: string }) {
  return (
    <View style={{ paddingTop: 8, paddingBottom: 6, paddingHorizontal: metrics.screenInset + 4 }}>
      <Txt variant="footnote" tone="faint">
        {children}
      </Txt>
    </View>
  );
}

/** The 28 pt tinted square that holds a row's symbol. */
export function IconBox({ children }: { readonly children: ReactNode }) {
  const palette = useTheme();
  return (
    <View
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.iconBox,
      }}
    >
      {children}
    </View>
  );
}

interface RowProps {
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly icon?: SFSymbol;
  readonly iconTone?: "muted" | "accent";
  readonly titleTone?: "text" | "accent" | "danger";
  readonly trailing?: ReactNode;
  readonly chevron?: boolean;
  readonly onPress?: () => void;
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly disabled?: boolean;
}

/**
 * One row: icon box, title, optional second line, trailing content. Two-line rows are 60 pt,
 * one-line rows 48 pt; both are minimum heights so large Dynamic Type grows them.
 */
export function Row({
  title,
  subtitle,
  icon,
  iconTone = "muted",
  titleTone = "text",
  trailing,
  chevron = false,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
}: RowProps) {
  const palette = useTheme();
  const content = (
    <>
      {icon !== undefined ? (
        <IconBox>
          <Symbol name={icon} tone={iconTone} />
        </IconBox>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Txt variant="subheadlineStrong" tone={titleTone} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle !== undefined ? subtitle : null}
      </View>
      {trailing}
      {chevron ? <Symbol name="chevron.right" size={14} tone="faint" /> : null}
    </>
  );
  const style = {
    minHeight: subtitle !== undefined ? metrics.rowTwoLine : metrics.rowOneLine,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
  };
  if (onPress === undefined) {
    return (
      <View style={style} accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [style, pressed ? { backgroundColor: palette.pressed } : null]}
    >
      {content}
    </Pressable>
  );
}
