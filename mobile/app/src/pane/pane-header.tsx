import { useMemo } from "react";
import { PanResponder, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { metrics } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";
import { IconButton } from "@/ui/button";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";

interface Pager {
  readonly index: number;
  readonly count: number;
  readonly previous: (() => void) | null;
  readonly next: (() => void) | null;
}

const MAX_DOTS = 7;
const SWIPE_PX = 50;

/** Back to Desktops, the agent and `project · checkout`, the waiting-pane pager (MOB16) and the Live toggle. */
export function PaneHeader({
  title,
  subtitle,
  pager,
  live,
  onBack,
  onToggleLive,
  onMenu,
}: {
  readonly title: string;
  readonly subtitle: string;
  readonly pager: Pager | null;
  readonly live: boolean;
  readonly onBack: () => void;
  readonly onToggleLive: () => void;
  readonly onMenu: (() => void) | null;
}) {
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  // A horizontal swipe on the header moves to the next or previous waiting pane.
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderRelease: (_e, g) => {
          if (g.dx <= -SWIPE_PX) pager?.next?.();
          else if (g.dx >= SWIPE_PX) pager?.previous?.();
        },
      }),
    [pager],
  );
  return (
    <View
      {...responder.panHandlers}
      style={{ paddingTop: insets.top, backgroundColor: palette.ground, paddingBottom: 6 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", minHeight: metrics.hit }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Desktops"
          onPress={onBack}
          style={{
            minHeight: metrics.hit,
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 8,
            gap: 2,
          }}
        >
          <Symbol name="chevron.left" size={18} tone="accent" />
          <Txt variant="body" tone="accent">
            Desktops
          </Txt>
        </Pressable>
        <View style={{ flex: 1, alignItems: "center", minWidth: 0 }}>
          <Txt variant="headline" numberOfLines={1}>
            {title}
          </Txt>
          <Txt variant="footnote" tone="faint" numberOfLines={1}>
            {subtitle}
          </Txt>
        </View>
        <View style={{ width: 110, flexDirection: "row", justifyContent: "flex-end" }}>
          {onMenu === null ? null : (
            <IconButton name="ellipsis.circle" label="Files, changes and usage" onPress={onMenu} />
          )}
          <IconButton
            name={live ? "keyboard.fill" : "keyboard"}
            label={live ? "Turn off Live mode" : "Turn on Live mode"}
            onPress={onToggleLive}
          />
        </View>
      </View>
      {pager === null || pager.count < 2 ? null : (
        <View
          style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous waiting pane"
            disabled={pager.previous === null}
            onPress={() => pager.previous?.()}
            hitSlop={14}
          >
            <Symbol
              name="chevron.left"
              size={10}
              tone={pager.previous === null ? "faint" : "accent"}
            />
          </Pressable>
          <View
            accessible
            accessibilityLabel={`Waiting pane ${pager.index + 1} of ${pager.count}`}
            style={{ flexDirection: "row", gap: 5 }}
          >
            {Array.from({ length: Math.min(pager.count, MAX_DOTS) }, (_, i) => (
              <View
                key={i}
                style={{
                  width: i === Math.min(pager.index, MAX_DOTS - 1) ? 14 : 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor:
                    i === Math.min(pager.index, MAX_DOTS - 1)
                      ? palette.status.needsYou
                      : palette.separator,
                }}
              />
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next waiting pane"
            disabled={pager.next === null}
            onPress={() => pager.next?.()}
            hitSlop={14}
          >
            <Symbol
              name="chevron.right"
              size={10}
              tone={pager.next === null ? "faint" : "accent"}
            />
          </Pressable>
        </View>
      )}
    </View>
  );
}
