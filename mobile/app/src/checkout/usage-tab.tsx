import { useCallback } from "react";
import { View } from "react-native";
import type { DesktopConnection } from "@/session/connection";
import { metrics } from "@/theme/tokens";
import { useNow } from "@/desktops/use-now";
import { formatAge } from "@/desktops/status-line";
import { Group, SectionFooter, SectionTitle } from "@/ui/grouped-list";
import { RefreshableScroll } from "@/ui/refreshable-scroll";
import { Txt } from "@/ui/text";
import { Message } from "./files-tab";
import { getUsage, readErrorText } from "./remote";
import { useLoad } from "./use-load";
import {
  agentLabel,
  formatCost,
  formatTokens,
  unpricedNote,
  type UsageRange,
  type UsageWindow,
} from "./usage-format";

function Figures({ window, label }: { readonly window: UsageWindow; readonly label: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${formatCost(window.costUsd)}, ${formatTokens(window.tokens)} tokens`}
      style={{
        minHeight: metrics.rowOneLine,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Txt variant="subheadlineStrong" numberOfLines={1}>
          {label}
        </Txt>
      </View>
      <Txt variant="footnote" tone="faint">{`${formatTokens(window.tokens)} tokens`}</Txt>
      <View style={{ minWidth: 72, alignItems: "flex-end" }}>
        <Txt variant="subheadlineStrong">{formatCost(window.costUsd)}</Txt>
      </View>
    </View>
  );
}

function RangeBlock({ title, range }: { readonly title: string; readonly range: UsageRange }) {
  const note = unpricedNote(range);
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Group>
        <Figures window={range} label="Total" />
        {range.byAgent.map(({ agent, window }) => (
          <Figures key={agent} window={window} label={agentLabel(agent)} />
        ))}
      </Group>
      {note === null ? null : <SectionFooter>{note}</SectionFooter>}
    </>
  );
}

/** The desktop's usage numbers (MOB21), the same ones its usage tab shows: today and the last 7 days, tokens and estimated cost. */
export function UsageTab({ connection }: { readonly connection: DesktopConnection }) {
  const now = useNow();
  const load = useCallback(() => getUsage(connection), [connection]);
  const { state, refresh } = useLoad(load, readErrorText, "usage");
  return (
    <RefreshableScroll onRefresh={refresh}>
      {state.status === "loading" ? <Message text="Loading…" /> : null}
      {state.status === "error" ? <Message text={state.message} tone="danger" /> : null}
      {state.status === "ready" ? (
        <>
          <RangeBlock title="Today" range={state.data.today} />
          <RangeBlock title="Last 7 days" range={state.data.last7Days} />
          <SectionFooter>
            {`Estimated API cost from the desktop's own price table${state.data.scannedAtMs === null ? "" : `, scanned ${formatAge(state.data.scannedAtMs, now)}`}.`}
          </SectionFooter>
        </>
      ) : null}
    </RefreshableScroll>
  );
}
