import type { TextStyle } from "react-native";

// iOS text styles at their default Dynamic Type sizes, weights 400 and 600 only (spec decision 27).
// The system font is used by leaving `fontFamily` unset; `allowFontScaling` (the default) scales
// every style with the user's text size.
type Weight = "400" | "600";
interface TypeStyle extends TextStyle {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: Weight;
}

function style(fontSize: number, lineHeight: number, fontWeight: Weight): TypeStyle {
  return { fontSize, lineHeight, fontWeight };
}

export const type = {
  largeTitle: style(34, 41, "600"),
  title1: style(28, 34, "600"),
  title2: style(22, 28, "600"),
  title3: style(20, 25, "600"),
  headline: style(17, 22, "600"),
  body: style(17, 22, "400"),
  callout: style(16, 21, "400"),
  subheadline: style(15, 20, "400"),
  subheadlineStrong: style(15, 20, "600"),
  footnote: style(13, 18, "400"),
  caption1: style(12, 16, "400"),
  caption2: style(11, 13, "400"),
} as const;

export type TypeName = keyof typeof type;
