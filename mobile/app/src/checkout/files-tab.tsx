import { useCallback } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import type { DesktopConnection } from "@/session/connection";
import { RefreshableScroll } from "@/ui/refreshable-scroll";
import { Group, Row } from "@/ui/grouped-list";
import { Txt } from "@/ui/text";
import { childPath, formatSize, parentPath } from "./files-nav";
import { listFiles, readErrorText } from "./remote";
import { useLoad } from "./use-load";

/** Read-only browsing of the checkout (MOB21): folders first, sizes, `..` to go up, a file opens a viewer. */
export function FilesTab({
  connection,
  desktopId,
  root,
  path,
  onPath,
}: {
  readonly connection: DesktopConnection;
  readonly desktopId: string;
  readonly root: string;
  readonly path: string;
  readonly onPath: (path: string) => void;
}) {
  const router = useRouter();
  const load = useCallback(() => listFiles(connection, root, path), [connection, root, path]);
  const { state, refresh } = useLoad(load, readErrorText, `files:${root}:${path}`);
  const up = parentPath(path);

  return (
    <RefreshableScroll onRefresh={refresh}>
      {state.status === "loading" ? <Message text="Loading…" /> : null}
      {state.status === "error" ? <Message text={state.message} tone="danger" /> : null}
      {state.status === "ready" ? (
        <View style={{ gap: 8 }}>
          {path === "" ? null : (
            <View style={{ paddingHorizontal: 20 }}>
              <Txt variant="footnote" tone="faint" numberOfLines={1}>
                {`/${path}`}
              </Txt>
            </View>
          )}
          <Group>
            {up === null ? null : (
              <Row
                title=".."
                icon="arrow.turn.left.up"
                onPress={() => onPath(up)}
                accessibilityLabel="Up one folder"
              />
            )}
            {state.data.length === 0 ? <Row title="Empty folder" /> : null}
            {state.data.map((entry) => {
              const next = childPath(path, entry.name);
              if (next === null) return null; // a name that is not one plain path segment is never opened
              return entry.kind === "dir" ? (
                <Row
                  key={entry.name}
                  title={entry.name}
                  icon="folder"
                  chevron
                  onPress={() => onPath(next)}
                />
              ) : (
                <Row
                  key={entry.name}
                  title={entry.name}
                  icon="doc.text"
                  trailing={
                    <Txt variant="footnote" tone="faint">
                      {formatSize(entry.size)}
                    </Txt>
                  }
                  onPress={() =>
                    router.push({
                      pathname: "/checkout/[desktopId]/file",
                      params: { desktopId, root, path: next },
                    })
                  }
                />
              );
            })}
          </Group>
        </View>
      ) : null}
    </RefreshableScroll>
  );
}

export function Message({
  text,
  tone = "muted",
}: {
  readonly text: string;
  readonly tone?: "muted" | "danger";
}) {
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 32, alignItems: "center" }}>
      <Txt variant="callout" tone={tone} center accessibilityLiveRegion="polite">
        {text}
      </Txt>
    </View>
  );
}
