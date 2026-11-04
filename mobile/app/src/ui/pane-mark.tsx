import { View } from "react-native";
import { useTheme } from "@/theme/use-theme";
import type { MarkKind } from "@/home/pane-state";

/** The rail's state mark: ring for working, square for failed, a dot for the rest. */
export function PaneMark({ kind }: { readonly kind: MarkKind }) {
  const palette = useTheme();
  const color = {
    needsYou: palette.status.needsYou,
    working: palette.status.working,
    done: palette.status.done,
    failed: palette.status.failed,
    idle: palette.status.idle,
  }[kind];
  const shape =
    kind === "working"
      ? { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: color }
      : kind === "failed"
        ? { width: 9, height: 9, borderRadius: 3, backgroundColor: color }
        : { width: 9, height: 9, borderRadius: 5, backgroundColor: color };
  return (
    <View
      accessible={false}
      style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
    >
      <View style={shape} />
    </View>
  );
}
