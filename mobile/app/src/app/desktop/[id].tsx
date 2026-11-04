import { Alert, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useConnectionSnapshot, useDesktopEntries, useServices } from "@/app-state/app-provider";
import { osLabel, pathLabel, statusLine } from "@/desktops/status-line";
import { useNow } from "@/desktops/use-now";
import type { DesktopEntry } from "@/session/manager";
import { IconButton } from "@/ui/button";
import { Group, Row, SectionFooter, SectionTitle } from "@/ui/grouped-list";
import { Screen } from "@/ui/screen";
import { Txt } from "@/ui/text";
import { useTheme } from "@/theme/use-theme";

function Value({ children }: { readonly children: string }) {
  return (
    <Txt variant="callout" tone="faint" numberOfLines={1}>
      {children}
    </Txt>
  );
}

function Detail({ entry }: { readonly entry: DesktopEntry }) {
  const router = useRouter();
  const { manager } = useServices();
  const snapshot = useConnectionSnapshot(entry.connection);
  const now = useNow();
  const { summary } = entry;
  const line = statusLine(summary, snapshot, now);

  const forget = (): void => {
    Alert.alert(
      `Forget ${summary.desktopName}?`,
      "This phone stops connecting to it, deletes its keys and asks the relay to remove the pairing. Pair again to reconnect.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget this desktop",
          style: "destructive",
          onPress: () => {
            void manager.forget(summary.pairingId).then(({ revokedOnRelay }) => {
              router.back();
              if (!revokedOnRelay) {
                Alert.alert(
                  "Removed from this phone",
                  `The relay could not be reached, so ${summary.desktopName} may still list this phone. Remove it in Deck's Settings → Mobile.`,
                );
              }
            });
          },
        },
      ],
    );
  };

  const canRetry = snapshot.status !== "online" && snapshot.status !== "revoked";
  return (
    <>
      <SectionTitle>This desktop</SectionTitle>
      <Group>
        <Row title="Name" trailing={<Value>{summary.desktopName}</Value>} />
        <Row title="System" trailing={<Value>{osLabel(summary.os)}</Value>} />
        <Row
          title="Connected through"
          trailing={
            <Value>
              {snapshot.status === "online" ? pathLabel(snapshot.path) : "Not connected"}
            </Value>
          }
        />
        <Row
          title="Paired"
          trailing={<Value>{new Date(summary.pairedAt).toLocaleDateString("en")}</Value>}
        />
        <Row title="Status" trailing={<Value>{line.text}</Value>} />
      </Group>
      {snapshot.problem !== null ? <SectionFooter>{snapshot.problem}</SectionFooter> : null}
      {canRetry ? (
        <>
          <SectionTitle>Connection</SectionTitle>
          <Group>
            <Row
              title="Reconnect"
              icon="arrow.clockwise"
              iconTone="accent"
              titleTone="accent"
              onPress={() => entry.connection.retryNow()}
            />
          </Group>
        </>
      ) : null}
      <View style={{ height: 24 }} />
      <Group>
        <Row
          title="Forget this desktop"
          icon="trash"
          titleTone="danger"
          onPress={forget}
          accessibilityHint="Removes the pairing from this phone and from the relay"
        />
      </Group>
    </>
  );
}

export default function DesktopDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  const entries = useDesktopEntries();
  const entry = entries.find((e) => e.summary.pairingId === id) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <View style={{ paddingTop: insets.top, paddingHorizontal: 4 }}>
        <IconButton name="chevron.left" label="Back" onPress={() => router.back()} />
      </View>
      {entry === null ? (
        <View style={{ padding: 24 }}>
          <Txt variant="callout" tone="muted">
            This desktop is no longer paired.
          </Txt>
        </View>
      ) : (
        <View style={{ flex: 1, marginTop: -insets.top }}>
          <Screen title={entry.summary.desktopName}>
            <Detail entry={entry} />
          </Screen>
        </View>
      )}
    </View>
  );
}
