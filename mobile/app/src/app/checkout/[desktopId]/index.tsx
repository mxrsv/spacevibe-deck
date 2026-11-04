import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDesktopEntries } from "@/app-state/app-provider";
import { ChangesTab } from "@/checkout/changes-tab";
import { baseName } from "@/checkout/files-nav";
import { FilesTab, Message } from "@/checkout/files-tab";
import { UsageTab } from "@/checkout/usage-tab";
import { useTheme } from "@/theme/use-theme";
import { NavBar } from "@/ui/nav-bar";
import { Segmented } from "@/ui/segmented";

type Tab = "files" | "changes" | "usage";

/** A checkout's Files, Changes and Usage (MOB21), all read-only. */
export default function CheckoutScreen() {
  const { desktopId, root, name } = useLocalSearchParams<{
    desktopId: string;
    root: string;
    name?: string;
  }>();
  const router = useRouter();
  const palette = useTheme();
  const entry = useDesktopEntries().find((e) => e.summary.pairingId === desktopId) ?? null;
  const [tab, setTab] = useState<Tab>("files");
  const [path, setPath] = useState("");
  const [changes, setChanges] = useState<number | null>(null);

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <NavBar
        backLabel="Back"
        title={name ?? baseName(root ?? "")}
        subtitle={entry?.summary.desktopName}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />
      {entry === null || root === undefined ? (
        <Message text="This desktop is no longer paired." />
      ) : (
        <>
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { id: "files", label: "Files" },
              { id: "changes", label: changes === null ? "Changes" : `Changes ${changes}` },
              { id: "usage", label: "Usage" },
            ]}
          />
          {tab === "files" ? (
            <FilesTab
              connection={entry.connection}
              desktopId={entry.summary.pairingId}
              root={root}
              path={path}
              onPath={setPath}
            />
          ) : tab === "changes" ? (
            <ChangesTab
              connection={entry.connection}
              desktopId={entry.summary.pairingId}
              root={root}
              onCount={setChanges}
            />
          ) : (
            <UsageTab connection={entry.connection} />
          )}
        </>
      )}
    </View>
  );
}
