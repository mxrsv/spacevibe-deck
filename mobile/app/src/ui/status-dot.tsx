import { View } from "react-native";
import { useTheme } from "@/theme/use-theme";

export type DotKind = "online" | "offline" | "problem" | "needsYou";

/** The mock's 8 pt presence dot; the status text beside it is what screen readers get. */
export function StatusDot({ kind }: { readonly kind: DotKind }) {
  const palette = useTheme();
  const color = {
    online: palette.status.done,
    offline: palette.status.idle,
    problem: palette.status.failed,
    needsYou: palette.status.needsYou,
  }[kind];
  return (
    <View
      accessible={false}
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }}
    />
  );
}
