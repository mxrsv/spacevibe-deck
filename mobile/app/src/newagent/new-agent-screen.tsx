import { useCallback, useReducer } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MAX_SEND_CHARS } from "@protocol/limits";
import { displayText } from "@protocol/display-text";
import { setPendingPrompt } from "./guarded-prompt";
import { Message } from "@/checkout/files-tab";
import { useLoad } from "@/checkout/use-load";
import { useHome } from "@/home/use-home";
import type { DesktopEntry } from "@/session/manager";
import { metrics } from "@/theme/tokens";
import { type } from "@/theme/type";
import { useTheme } from "@/theme/use-theme";
import { Chip } from "@/pane/composer";
import { Button } from "@/ui/button";
import { Group, Row, SectionFooter, SectionTitle } from "@/ui/grouped-list";
import { RefreshableScroll } from "@/ui/refreshable-scroll";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";
import {
  canStart,
  initialNewAgent,
  nextStep,
  openErrorText,
  openParams,
  promptToSend,
  reduceNewAgent,
} from "./new-agent-flow";

function readText(error: unknown): string {
  return openErrorText(error);
}

/** The sheet behind "+": desktop (online ones, skipped when there is one), project and checkout, agent, optional prompt (MOB20). */
export function NewAgentScreen({ presetDesktopId }: { readonly presetDesktopId: string | null }) {
  const router = useRouter();
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  const { desktops } = useHome();
  const online = desktops.filter((d) => d.tree.status === "online").map((d) => d.entry);
  const [stored, dispatch] = useReducer(reduceNewAgent, undefined, () =>
    initialNewAgent(
      online.map((e) => e.summary.pairingId),
      presetDesktopId,
    ),
  );
  // A desktop that came online after the sheet opened can still be the only choice.
  const desktopId = stored.desktopId ?? (online.length === 1 ? online[0].summary.pairingId : null);
  const state = desktopId === stored.desktopId ? stored : { ...stored, desktopId };
  const entry = online.find((e) => e.summary.pairingId === desktopId) ?? null;
  const step = nextStep(state);

  const close = (): void => (router.canGoBack() ? router.back() : router.replace("/"));

  async function start(entryToUse: DesktopEntry): Promise<void> {
    const params = openParams(state);
    if (params === null || !canStart(state)) return;
    dispatch({ t: "start" });
    try {
      const { paneId } = await entryToUse.connection.rpc.request("pane.open", params);
      const prompt = promptToSend(state);
      if (prompt !== null) setPendingPrompt(entryToUse.summary.pairingId, paneId, prompt);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({
        pathname: "/pane/[desktopId]/[paneId]",
        params: { desktopId: entryToUse.summary.pairingId, paneId: String(paneId) },
      });
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      dispatch({ t: "failed", message: readText(error) });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <View
        style={{
          paddingTop: 12,
          flexDirection: "row",
          alignItems: "center",
          minHeight: metrics.hit + 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={close}
          style={{
            minHeight: metrics.hit,
            justifyContent: "center",
            paddingHorizontal: 16,
            width: 90,
          }}
        >
          <Txt variant="body" tone="accent">
            Cancel
          </Txt>
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Txt variant="headline" accessibilityRole="header">
            New agent
          </Txt>
        </View>
        <View style={{ width: 90 }} />
      </View>

      {online.length === 0 ? (
        <Message text="No desktop is online. Open Deck on your computer, then try again." />
      ) : (
        <RefreshableScroll onRefresh={async () => {}}>
          {online.length > 1 && presetDesktopId === null ? (
            <>
              <SectionTitle>Desktop</SectionTitle>
              <Group>
                {online.map((e) => (
                  <Row
                    key={e.summary.pairingId}
                    title={e.summary.desktopName}
                    icon="laptopcomputer"
                    trailing={
                      <Symbol
                        name={
                          e.summary.pairingId === desktopId ? "checkmark.circle.fill" : "circle"
                        }
                        size={20}
                        tone={e.summary.pairingId === desktopId ? "accent" : "faint"}
                      />
                    }
                    onPress={() => dispatch({ t: "desktop", id: e.summary.pairingId })}
                  />
                ))}
              </Group>
            </>
          ) : null}
          {entry === null ? null : <Choices entry={entry} state={state} dispatch={dispatch} />}
          {step === "ready" || state.prompt !== "" ? (
            <>
              <SectionTitle>Prompt (optional)</SectionTitle>
              <View style={{ marginHorizontal: metrics.screenInset }}>
                <TextInput
                  accessibilityLabel="Prompt"
                  value={state.prompt}
                  onChangeText={(text) => dispatch({ t: "prompt", text })}
                  placeholder="What should the agent do?"
                  placeholderTextColor={palette.textFaint}
                  multiline
                  maxLength={MAX_SEND_CHARS}
                  style={[
                    type.body,
                    {
                      minHeight: 96,
                      borderRadius: metrics.radiusField,
                      padding: 12,
                      color: palette.text,
                      backgroundColor: palette.group,
                      textAlignVertical: "top",
                    },
                  ]}
                />
              </View>
              <SectionFooter>
                Deck opens the tab without taking focus, and sends the prompt once the agent is
                ready.
              </SectionFooter>
            </>
          ) : null}
          {state.error === null ? null : (
            <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
              <Txt variant="callout" tone="danger" accessibilityLiveRegion="polite">
                {state.error}
              </Txt>
            </View>
          )}
          <View style={{ padding: metrics.screenInset, paddingBottom: insets.bottom + 16 }}>
            <Button
              label={state.phase === "starting" ? "Opening…" : "Open agent"}
              icon="play.fill"
              disabled={entry === null || !canStart(state)}
              onPress={() => entry !== null && void start(entry)}
            />
          </View>
        </RefreshableScroll>
      )}
    </View>
  );
}

function Choices({
  entry,
  state,
  dispatch,
}: {
  readonly entry: DesktopEntry;
  readonly state: ReturnType<typeof initialNewAgent>;
  readonly dispatch: (a: Parameters<typeof reduceNewAgent>[1]) => void;
}) {
  const connection = entry.connection;
  const loadProjects = useCallback(
    async () => (await connection.rpc.request("projects.list", {})).projects,
    [connection],
  );
  const loadAgents = useCallback(
    async () => (await connection.rpc.request("agents.list", {})).agents,
    [connection],
  );
  const projects = useLoad(loadProjects, readText, `projects:${entry.summary.pairingId}`);
  const agents = useLoad(loadAgents, readText, `agents:${entry.summary.pairingId}`);
  return (
    <>
      <SectionTitle>Project</SectionTitle>
      {projects.state.status === "loading" ? <Message text="Loading projects…" /> : null}
      {projects.state.status === "error" ? (
        <Message text={projects.state.message} tone="danger" />
      ) : null}
      {projects.state.status === "ready" && projects.state.data.length === 0 ? (
        <Message text="Deck has no projects open." />
      ) : null}
      {projects.state.status === "ready" && projects.state.data.length > 0 ? (
        <Group>
          {projects.state.data.flatMap((project) =>
            project.checkouts.map((checkout) => {
              const selected = state.checkoutPath === checkout.path;
              return (
                <Row
                  key={`${project.path}:${checkout.path}`}
                  title={displayText(project.name, 80)}
                  subtitle={
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Symbol name="arrow.triangle.branch" size={12} tone="faint" />
                      <Txt variant="footnote" tone="faint" numberOfLines={1}>
                        {displayText(checkout.branch ?? checkout.name, 80)}
                      </Txt>
                    </View>
                  }
                  trailing={
                    <Symbol
                      name={selected ? "checkmark.circle.fill" : "circle"}
                      size={20}
                      tone={selected ? "accent" : "faint"}
                    />
                  }
                  accessibilityLabel={`${project.name}, ${checkout.branch ?? checkout.name}${selected ? ", selected" : ""}`}
                  onPress={() =>
                    dispatch({
                      t: "checkout",
                      projectPath: project.path,
                      checkoutPath: checkout.path,
                    })
                  }
                />
              );
            }),
          )}
        </Group>
      ) : null}
      {state.checkoutPath === null ? null : (
        <>
          <SectionTitle>Agent</SectionTitle>
          {agents.state.status === "loading" ? <Message text="Loading agents…" /> : null}
          {agents.state.status === "error" ? (
            <Message text={agents.state.message} tone="danger" />
          ) : null}
          {agents.state.status === "ready" && agents.state.data.length === 0 ? (
            <Message text="No agent is enabled in Deck." />
          ) : null}
          {agents.state.status === "ready" ? (
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 8,
                paddingHorizontal: metrics.screenInset,
              }}
            >
              {agents.state.data.map((agent) => (
                <Chip
                  key={agent.id}
                  label={displayText(agent.label, 32)}
                  accessibilityLabel={`${agent.label}${state.agent === agent.id ? ", selected" : ""}`}
                  primary={state.agent === agent.id}
                  onPress={() => dispatch({ t: "agent", id: agent.id })}
                />
              ))}
            </View>
          ) : null}
        </>
      )}
    </>
  );
}
