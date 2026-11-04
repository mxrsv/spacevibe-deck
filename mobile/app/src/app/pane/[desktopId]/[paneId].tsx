import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useDesktopEntries } from "@/app-state/app-provider";
import { paneName } from "@/home/pane-state";
import { sendKeys, sendReply } from "@/home/send-to-pane";
import { usePaneChoices } from "@/home/use-pane-choices";
import { useHome, useTreeSnapshot } from "@/home/use-home";
import { Composer } from "@/pane/composer";
import { LiveAccessory } from "@/pane/live-accessory";
import { PaneHeader } from "@/pane/pane-header";
import { TerminalView } from "@/terminal/terminal-view";
import { usePaneTerminal } from "@/terminal/use-pane-terminal";
import { zoomLabel } from "@/terminal/zoom";
import { useTheme } from "@/theme/use-theme";
import { Txt } from "@/ui/text";
import type { Tree } from "@protocol/tree";
import type { DesktopEntry } from "@/session/manager";

function findPane(tree: Tree | null, paneId: number) {
  for (const project of tree?.projects ?? []) {
    for (const checkout of project.checkouts) {
      const pane = checkout.panes.find((p) => p.paneId === paneId);
      if (pane !== undefined) return { pane, project: project.name, checkout: checkout.name };
    }
  }
  return null;
}

function PaneBody({
  entry,
  paneId,
  fromNeeds,
}: {
  readonly entry: DesktopEntry;
  readonly paneId: number;
  readonly fromNeeds: boolean;
}) {
  const router = useRouter();
  const palette = useTheme();
  const [live, setLive] = useState(false);
  const { tree } = useTreeSnapshot(entry.connection);
  const { needs } = useHome();
  const terminal = usePaneTerminal(entry, paneId, live);

  const found = findPane(tree, paneId);
  const choices = usePaneChoices(entry.connection, found?.pane ?? null);

  const desktopId = entry.summary.pairingId;
  const position = needs.all.findIndex(
    (i) => i.desktopId === desktopId && i.pane.paneId === paneId,
  );
  const go = (offset: number) => () => {
    const target = needs.all[position + offset];
    if (target !== undefined) {
      router.replace({
        pathname: "/pane/[desktopId]/[paneId]",
        params: { desktopId: target.desktopId, paneId: String(target.pane.paneId), from: "needs" },
      });
    }
  };
  const pager =
    fromNeeds && position >= 0
      ? {
          index: position,
          count: needs.all.length,
          previous: position > 0 ? go(-1) : null,
          next: position < needs.all.length - 1 ? go(1) : null,
        }
      : null;

  const name = found === null ? "Pane" : paneName(found.pane);
  const subtitle =
    found === null ? entry.summary.desktopName : `${found.project} · ${found.checkout}`;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: palette.ground }}
    >
      <PaneHeader
        title={name}
        subtitle={subtitle}
        pager={pager}
        live={live}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        onToggleLive={() => setLive((on) => !on)}
      />
      <View style={{ flex: 1 }}>
        <TerminalView
          state={terminal.state}
          problem={terminal.problem}
          bridge={terminal.bridge}
          setWebView={terminal.setWebView}
          setWidth={terminal.setWidth}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${zoomLabel(terminal.cols, terminal.zoom)}. Tap for a larger text size`}
          accessibilityHint="Pinch the terminal to change the size"
          onPress={() => terminal.stepZoom(1)}
          onLongPress={terminal.resetZoom}
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            minHeight: 28,
            paddingHorizontal: 10,
            borderRadius: 14,
            justifyContent: "center",
            backgroundColor: palette.group,
          }}
        >
          <Txt variant="caption1" tone="muted">
            {zoomLabel(terminal.cols, terminal.zoom)}
          </Txt>
        </Pressable>
      </View>
      {live ? (
        <LiveAccessory onKey={terminal.sendKeys} onExit={() => setLive(false)} />
      ) : (
        <Composer
          agentName={name}
          choices={choices}
          onSend={(text) => sendReply(entry.connection, paneId, text)}
          onKeys={(data) => sendKeys(entry.connection, paneId, data)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

export default function PaneScreen() {
  const { desktopId, paneId, from } = useLocalSearchParams<{
    desktopId: string;
    paneId: string;
    from?: string;
  }>();
  const router = useRouter();
  const entry = useDesktopEntries().find((e) => e.summary.pairingId === desktopId) ?? null;
  const id = Number(paneId);
  const palette = useTheme();
  if (entry === null || !Number.isSafeInteger(id)) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          backgroundColor: palette.ground,
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Txt variant="callout" tone="muted">
          This pane is no longer available.
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Desktops"
          onPress={() => openPaneHome(router)}
        >
          <Txt variant="headline" tone="accent">
            Back to Desktops
          </Txt>
        </Pressable>
      </View>
    );
  }
  // Keyed so moving to another pane remounts it with a fresh subscription and composer.
  return (
    <PaneBody key={`${desktopId}:${id}`} entry={entry} paneId={id} fromNeeds={from === "needs"} />
  );
}

function openPaneHome(router: ReturnType<typeof useRouter>): void {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}
