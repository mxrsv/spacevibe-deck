import { View } from "react-native";
import { useConnectionSnapshot } from "@/app-state/app-provider";
import type { DesktopEntry } from "@/session/manager";
import { Row } from "@/ui/grouped-list";
import { StatusDot } from "@/ui/status-dot";
import { Txt } from "@/ui/text";
import { osSymbol, statusLine } from "./status-line";
import { useNow } from "./use-now";

/** One paired desktop: name, OS icon, presence dot and the line MOB2/MOB10/MOB11 call for. */
export function DesktopRow({
  entry,
  onPress,
}: {
  readonly entry: DesktopEntry;
  readonly onPress: () => void;
}) {
  const snapshot = useConnectionSnapshot(entry.connection);
  const now = useNow();
  const line = statusLine(entry.summary, snapshot, now);
  return (
    <Row
      title={entry.summary.desktopName}
      icon={osSymbol(entry.summary.os)}
      chevron
      onPress={onPress}
      accessibilityLabel={`${entry.summary.desktopName}, ${line.text}`}
      accessibilityHint="Opens this desktop"
      subtitle={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <StatusDot kind={line.dot} />
          <View style={{ flex: 1 }}>
            <Txt variant="footnote" tone="faint" numberOfLines={2}>
              {line.text}
            </Txt>
          </View>
        </View>
      }
    />
  );
}
