import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { choiceInput } from "@/choices/parse-choices";
import { formatAge } from "@/desktops/status-line";
import { useNow } from "@/desktops/use-now";
import type { DesktopEntry } from "@/session/manager";
import { metrics } from "@/theme/tokens";
import { type } from "@/theme/type";
import { useTheme } from "@/theme/use-theme";
import { Button } from "@/ui/button";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";
import type { NeedsItem } from "./needs-you";
import { openPane } from "./open-pane";
import { agentSymbol, paneName, paneTime } from "./pane-state";
import { sendErrorText, sendKeys, sendReply } from "./send-to-pane";
import { usePaneChoices } from "./use-pane-choices";

const SHORT_LABEL = 16;

/**
 * A waiting pane on Home (direction E): who is waiting and where, what it stopped on, and the
 * quickest answer: a button per numbered option, a Reply field for a question, Open for a failure.
 */
export function PinnedCard({
  item,
  entry,
}: {
  readonly item: NeedsItem;
  readonly entry: DesktopEntry;
}) {
  const palette = useTheme();
  const router = useRouter();
  const now = useNow();
  const { pane } = item;
  const choices = usePaneChoices(entry.connection, pane);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const time = paneTime(pane);
  const open = (): void => openPane(router, item.desktopId, pane.paneId, true);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReplying(false);
      setDraft("");
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setProblem(sendErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        marginHorizontal: metrics.screenInset,
        borderRadius: metrics.radiusGroup,
        backgroundColor: palette.group,
        padding: 14,
        gap: 10,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${paneName(pane)}, ${item.project} ${item.checkout}, ${pane.attention === "error" ? "failed" : "needs you"}`}
        accessibilityHint="Opens the pane"
        onPress={open}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: metrics.hit }}
      >
        <Symbol name={agentSymbol(pane.agent)} size={20} tone="accent" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="headline" numberOfLines={1}>
            {paneName(pane)}
          </Txt>
          <Txt variant="footnote" tone="faint" numberOfLines={1}>
            {item.project} · {item.checkout}
          </Txt>
        </View>
        <Txt variant="footnote" tone="faint">
          {time === null ? "" : formatAge(time, now)}
        </Txt>
      </Pressable>

      {pane.lastLine === "" ? null : (
        <View style={{ borderRadius: 8, padding: 8, backgroundColor: palette.terminalBg }}>
          <Txt variant="footnote" numberOfLines={3}>
            {pane.lastLine}
          </Txt>
        </View>
      )}

      {pane.attention === "error" ? (
        <View style={{ flexDirection: "row" }}>
          <Button label="Open" icon="arrow.up.right" onPress={open} />
        </View>
      ) : choices !== null && !replying ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {choices.map((choice) => (
            <ChoiceButton
              key={choice.number}
              number={choice.number}
              label={choice.label}
              primary={choice.number === 1}
              disabled={busy}
              onPress={() =>
                void run(() => sendKeys(entry.connection, pane.paneId, choiceInput(choice)))
              }
            />
          ))}
        </View>
      ) : replying ? (
        <View style={{ gap: 8 }}>
          <TextInput
            accessibilityLabel={`Reply to ${paneName(pane)}`}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Reply to ${paneName(pane)}`}
            placeholderTextColor={palette.textFaint}
            multiline
            autoFocus
            style={[
              type.callout,
              {
                minHeight: metrics.hit,
                borderRadius: metrics.radiusField,
                padding: 10,
                color: palette.text,
                backgroundColor: palette.ground,
              },
            ]}
          />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button
              label="Send"
              icon="arrow.up"
              disabled={busy || draft.trim() === ""}
              onPress={() => void run(() => sendReply(entry.connection, pane.paneId, draft))}
            />
            <Button label="Cancel" kind="plain" onPress={() => setReplying(false)} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: "row" }}>
          <Button label="Reply" icon="arrowshape.turn.up.left" onPress={() => setReplying(true)} />
        </View>
      )}
      {problem === null ? null : (
        <Txt variant="footnote" tone="danger" accessibilityLiveRegion="polite">
          {problem}
        </Txt>
      )}
    </View>
  );
}

function ChoiceButton({
  number,
  label,
  primary,
  disabled,
  onPress,
}: {
  readonly number: number;
  readonly label: string;
  readonly primary: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  const palette = useTheme();
  const short =
    label.length > SHORT_LABEL ? `${label.slice(0, SHORT_LABEL - 1).trimEnd()}…` : label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${number}. ${label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: metrics.hit,
        borderRadius: metrics.radiusField,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        backgroundColor: primary ? palette.primary : palette.iconBox,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      <Txt variant="caption1" tone={primary ? "primaryText" : "faint"}>
        {number}
      </Txt>
      <Txt variant="subheadline" tone={primary ? "primaryText" : "text"} numberOfLines={1}>
        {short}
      </Txt>
    </Pressable>
  );
}
