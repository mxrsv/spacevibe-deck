import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDesktopEntries } from "@/app-state/app-provider";
import { CodeLines } from "@/checkout/code-lines";
import { baseName, isNormalPath } from "@/checkout/files-nav";
import { Message } from "@/checkout/files-tab";
import { readErrorText, readFile } from "@/checkout/remote";
import { useLoad } from "@/checkout/use-load";
import { useTheme } from "@/theme/use-theme";
import { NavBar } from "@/ui/nav-bar";
import { Txt } from "@/ui/text";

const MAX_COLUMNS = 400;

/** A read-only text viewer (MOB21). Binary files and cut-off files say so instead of pretending. */
export default function FileScreen() {
  const { desktopId, root, path } = useLocalSearchParams<{
    desktopId: string;
    root: string;
    path: string;
  }>();
  const router = useRouter();
  const palette = useTheme();
  const entry = useDesktopEntries().find((e) => e.summary.pairingId === desktopId) ?? null;
  const safe = path !== undefined && path !== "" && isNormalPath(path);
  const load = useCallback(async () => {
    if (entry === null || root === undefined || !safe) throw new Error("unavailable");
    return readFile(entry.connection, root, path);
  }, [entry, root, path, safe]);
  const { state } = useLoad(load, readErrorText, `file:${root}:${path}`);
  const lines = useMemo(
    () =>
      state.status === "ready" && !state.data.binary
        ? state.data.text.split("\n").map((text) => ({ text }))
        : [],
    [state],
  );
  const widest = useMemo(
    () =>
      Math.min(
        MAX_COLUMNS,
        lines.reduce((m, l) => Math.max(m, l.text.length), 0),
      ),
    [lines],
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <NavBar
        backLabel="Files"
        title={baseName(path ?? "")}
        subtitle={path}
        onBack={() => router.back()}
      />
      {state.status === "loading" ? <Message text="Loading…" /> : null}
      {state.status === "error" ? <Message text={state.message} tone="danger" /> : null}
      {state.status === "ready" && state.data.binary ? <Message text="Binary file" /> : null}
      {state.status === "ready" && !state.data.binary ? (
        <>
          {state.data.truncated ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              <Txt variant="footnote" tone="faint">
                Showing the first 512 KB
              </Txt>
            </View>
          ) : null}
          <CodeLines lines={lines} numbered widestChars={widest} />
        </>
      ) : null}
    </View>
  );
}
