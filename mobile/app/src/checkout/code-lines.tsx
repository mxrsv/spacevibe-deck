import { FlatList, ScrollView, View } from "react-native";
import { useTheme } from "@/theme/use-theme";
import type { Palette } from "@/theme/tokens";
import { Txt } from "@/ui/text";
import type { DiffLineKind } from "./diff-lines";

export interface CodeLine {
  readonly text: string;
  readonly kind?: DiffLineKind;
}

const LINE_HEIGHT = 18;
const FONT_SIZE = 12;
const CHAR_WIDTH = FONT_SIZE * 0.602;
const GUTTER = 44;

function colours(
  palette: Palette,
  kind: DiffLineKind | undefined,
): { color: string; background: string } {
  switch (kind) {
    case "add":
      return { color: palette.text, background: palette.status.done + "26" };
    case "remove":
      return { color: palette.text, background: palette.status.failed + "26" };
    case "hunk":
      return { color: palette.accent, background: palette.iconBox };
    case "meta":
      return { color: palette.textFaint, background: "transparent" };
    default:
      return { color: palette.text, background: "transparent" };
  }
}

/**
 * Read-only monospace lines: virtualised (a 512 KB file is thousands of rows), one row per line
 * at a fixed height, scrolling sideways instead of wrapping. The text is rendered as plain
 * `Text`, never as markup, whatever the file contains.
 */
export function CodeLines({
  lines,
  numbered,
  widestChars,
}: {
  readonly lines: readonly CodeLine[];
  readonly numbered: boolean;
  readonly widestChars: number;
}) {
  const palette = useTheme();
  const width = (numbered ? GUTTER : 0) + Math.ceil(widestChars * CHAR_WIDTH) + 24;
  return (
    <ScrollView
      horizontal
      style={{ flex: 1 }}
      showsHorizontalScrollIndicator
      contentContainerStyle={{ minWidth: "100%" }}
    >
      <FlatList
        data={lines}
        style={{ width, backgroundColor: palette.terminalBg }}
        keyExtractor={(_line, index) => String(index)}
        initialNumToRender={60}
        windowSize={11}
        getItemLayout={(_data, index) => ({
          length: LINE_HEIGHT,
          offset: LINE_HEIGHT * index,
          index,
        })}
        renderItem={({ item, index }) => {
          const c = colours(palette, item.kind);
          return (
            <View
              style={{ height: LINE_HEIGHT, flexDirection: "row", backgroundColor: c.background }}
            >
              {numbered ? (
                <View style={{ width: GUTTER, paddingRight: 8, alignItems: "flex-end" }}>
                  <Txt
                    variant="caption1"
                    tone="faint"
                    numberOfLines={1}
                    allowFontScaling={false}
                    monospace
                  >
                    {String(index + 1)}
                  </Txt>
                </View>
              ) : null}
              <Txt
                variant="caption1"
                numberOfLines={1}
                allowFontScaling={false}
                monospace
                color={c.color}
              >
                {item.text === "" ? " " : item.text}
              </Txt>
            </View>
          );
        }}
      />
    </ScrollView>
  );
}
