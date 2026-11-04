import { useCallback, useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { ChangeEntry } from "@protocol/results";
import type { DesktopConnection } from "@/session/connection";
import { useTheme } from "@/theme/use-theme";
import { RefreshableScroll } from "@/ui/refreshable-scroll";
import { Group, Row } from "@/ui/grouped-list";
import { Txt } from "@/ui/text";
import { baseName, dirName } from "./files-nav";
import { Message } from "./files-tab";
import { listChanges, readErrorText } from "./remote";
import { useLoad } from "./use-load";

const BADGE: Record<string, string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  renamed: "R",
  untracked: "?",
  conflicted: "U",
};

export function statusBadge(status: string): string {
  return BADGE[status] ?? (status === "" ? "·" : status.slice(0, 1).toUpperCase());
}

/** The checkout's changed files (MOB21): status badge, name and folder, `+added −removed`; a row opens its diff. */
export function ChangesTab({
  connection,
  desktopId,
  root,
  onCount,
}: {
  readonly connection: DesktopConnection;
  readonly desktopId: string;
  readonly root: string;
  readonly onCount: (count: number | null) => void;
}) {
  const router = useRouter();
  const palette = useTheme();
  const load = useCallback(() => listChanges(connection, root), [connection, root]);
  const { state, refresh } = useLoad(load, readErrorText, `changes:${root}`);
  const count = state.status === "ready" ? state.data.length : null;
  useEffect(() => {
    onCount(count);
  }, [count, onCount]);

  const body =
    state.status === "loading" ? (
      <Message text="Loading…" />
    ) : state.status === "error" ? (
      <Message text={state.message} tone="danger" />
    ) : state.data.length === 0 ? (
      <Message text="No changes: the working tree is clean." />
    ) : null;
  const colour = (c: ChangeEntry): string =>
    c.status === "added" || c.status === "untracked"
      ? palette.status.done
      : c.status === "deleted"
        ? palette.status.failed
        : palette.accent;
  return (
    <RefreshableScroll onRefresh={refresh}>
      {body}
      {state.status === "ready" && state.data.length > 0 ? (
        <Group>
          {state.data.map((change) => (
            <Row
              key={change.path}
              title={baseName(change.path)}
              subtitle={
                <Txt variant="footnote" tone="faint" numberOfLines={1}>
                  {dirName(change.path) === "" ? "/" : dirName(change.path)}
                </Txt>
              }
              trailing={
                <View style={{ flexDirection: "row", gap: 6 }}>
                  {change.added > 0 ? (
                    <Txt variant="footnote" color={palette.status.done}>{`+${change.added}`}</Txt>
                  ) : null}
                  {change.removed > 0 ? (
                    <Txt
                      variant="footnote"
                      color={palette.status.failed}
                    >{`−${change.removed}`}</Txt>
                  ) : null}
                </View>
              }
              accessibilityLabel={`${change.status} ${change.path}, ${change.added} added, ${change.removed} removed`}
              leading={
                <View style={{ width: 28, alignItems: "center" }}>
                  <Txt variant="subheadlineStrong" color={colour(change)}>
                    {statusBadge(change.status)}
                  </Txt>
                </View>
              }
              onPress={() =>
                router.push({
                  pathname: "/checkout/[desktopId]/diff",
                  params: { desktopId, root, path: change.path },
                })
              }
            />
          ))}
        </Group>
      ) : null}
    </RefreshableScroll>
  );
}
