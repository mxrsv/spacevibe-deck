import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDesktopEntries } from "@/app-state/app-provider";
import { CodeLines } from "@/checkout/code-lines";
import { classifyDiff, widestLine } from "@/checkout/diff-lines";
import { baseName, isNormalPath } from "@/checkout/files-nav";
import { Message } from "@/checkout/files-tab";
import { readDiff, readErrorText } from "@/checkout/remote";
import { useLoad } from "@/checkout/use-load";
import { useTheme } from "@/theme/use-theme";
import { NavBar } from "@/ui/nav-bar";

/** One file's unified diff, read-only, coloured by line kind and scrolling sideways (MOB21). */
export default function DiffScreen() {
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
    return readDiff(entry.connection, root, path);
  }, [entry, root, path, safe]);
  const { state } = useLoad(load, readErrorText, `diff:${root}:${path}`);
  const lines = useMemo(() => (state.status === "ready" ? classifyDiff(state.data) : []), [state]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <NavBar
        backLabel="Changes"
        title={baseName(path ?? "")}
        subtitle={path}
        onBack={() => router.back()}
      />
      {state.status === "loading" ? <Message text="Loading…" /> : null}
      {state.status === "error" ? <Message text={state.message} tone="danger" /> : null}
      {state.status === "ready" && lines.length === 0 ? (
        <Message text="No textual changes to show." />
      ) : null}
      {state.status === "ready" && lines.length > 0 ? (
        <CodeLines lines={lines} numbered={false} widestChars={widestLine(lines)} />
      ) : null}
    </View>
  );
}
