import { View } from "react-native";
import type { DesktopEntry } from "@/session/manager";
import { Group, Row } from "@/ui/grouped-list";
import { Txt } from "@/ui/text";
import type { NeedsYou } from "./needs-you";
import { PinnedCard } from "./pinned-card";

/** "Needs you · N", pinned above everything on Home (MOB16, decision 25), with See all past three. */
export function NeedsYouSection({
  needs,
  entries,
  showAll,
}: {
  readonly needs: NeedsYou;
  readonly entries: readonly DesktopEntry[];
  readonly showAll: () => void;
}) {
  if (needs.all.length === 0) return null;
  return (
    <View style={{ gap: 10, paddingBottom: 8 }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
        <Txt variant="subheadlineStrong" accessibilityRole="header" tone="accent">
          {`Needs you · ${needs.all.length}`}
        </Txt>
      </View>
      {needs.pinned.map((item) => {
        const entry = entries.find((e) => e.summary.pairingId === item.desktopId);
        return entry === undefined ? null : (
          <PinnedCard key={`${item.desktopId}:${item.pane.paneId}`} item={item} entry={entry} />
        );
      })}
      {needs.more > 0 ? (
        <Group>
          <Row title={`See all ${needs.all.length}`} chevron onPress={showAll} titleTone="accent" />
        </Group>
      ) : null}
    </View>
  );
}
