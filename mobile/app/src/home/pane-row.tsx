import { Pressable, View } from "react-native";
import type { TreePane } from "@protocol/tree";
import { formatAge } from "@/desktops/status-line";
import { useNow } from "@/desktops/use-now";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { PaneMark } from "@/ui/pane-mark";
import { Txt } from "@/ui/text";
import { MARK_TEXT, markKind, paneName, paneTime } from "./pane-state";

/** One pane in the tree: the rail's mark, its name, its last line and how long ago (MOB16). */
export function PaneRow({
  pane,
  onPress,
}: {
  readonly pane: TreePane;
  readonly onPress: () => void;
}) {
  const palette = useTheme();
  const now = useNow();
  const kind = markKind(pane);
  const time = paneTime(pane);
  const age = time === null ? "" : formatAge(time, now);
  const name = paneName(pane);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${MARK_TEXT[kind]}${pane.lastLine === "" ? "" : `, ${pane.lastLine}`}${age === "" ? "" : `, ${age}`}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: metrics.rowTwoLine,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 14,
        backgroundColor:
          kind === "needsYou" ? palette.needsYouBg : pressed ? palette.pressed : "transparent",
      })}
    >
      <PaneMark kind={kind} />
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Txt variant="subheadlineStrong" numberOfLines={1}>
              {name}
            </Txt>
          </View>
          <Txt variant="footnote" tone="faint">
            {age}
          </Txt>
        </View>
        <Txt variant="footnote" tone="faint" numberOfLines={1}>
          {pane.lastLine === "" ? pane.title : pane.lastLine}
        </Txt>
      </View>
    </Pressable>
  );
}
