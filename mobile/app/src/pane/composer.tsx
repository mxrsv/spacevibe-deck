import { useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { type Choice, choiceInput } from "@/choices/parse-choices";
import { sendErrorText } from "@/home/send-to-pane";
import { metrics } from "@/theme/tokens";
import { type } from "@/theme/type";
import { useTheme } from "@/theme/use-theme";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";

const ESC = "\x1b";

/** The reply field (MOB19: sends the text and submits it) with quick numbered-choice chips and `esc` above it. */
export function Composer({
  agentName,
  choices,
  onSend,
  onKeys,
}: {
  readonly agentName: string;
  readonly choices: readonly Choice[] | null;
  readonly onSend: (text: string) => Promise<void>;
  readonly onKeys: (data: string) => Promise<void>;
}) {
  const palette = useTheme();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(action: () => Promise<void>, onDone?: () => void): Promise<void> {
    setBusy(true);
    setProblem(null);
    try {
      await action();
      void Haptics.selectionAsync();
      onDone?.();
    } catch (error) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setProblem(sendErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  const canSend = draft.trim() !== "" && !busy;
  return (
    <View
      style={{
        backgroundColor: palette.ground,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 8,
        gap: 8,
      }}
    >
      {choices === null ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8 }}
        >
          {choices.map((choice) => (
            <Chip
              key={choice.number}
              label={
                choice.label.length > 16 ? `${choice.label.slice(0, 15).trimEnd()}…` : choice.label
              }
              prefix={String(choice.number)}
              accessibilityLabel={`${choice.number}. ${choice.label}`}
              primary={choice.number === 1}
              disabled={busy}
              onPress={() => void run(() => onKeys(choiceInput(choice)))}
            />
          ))}
          <Chip
            label="esc"
            accessibilityLabel="Escape"
            disabled={busy}
            onPress={() => void run(() => onKeys(ESC))}
          />
        </ScrollView>
      )}
      {problem === null ? null : (
        <Txt variant="footnote" tone="danger" accessibilityLiveRegion="polite">
          {problem}
        </Txt>
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
        <TextInput
          accessibilityLabel={`Reply to ${agentName}`}
          value={draft}
          onChangeText={setDraft}
          placeholder={`Reply to ${agentName}`}
          placeholderTextColor={palette.textFaint}
          multiline
          style={[
            type.body,
            {
              flex: 1,
              maxHeight: 120,
              minHeight: metrics.hit,
              borderRadius: 22,
              paddingHorizontal: 16,
              paddingTop: 10,
              paddingBottom: 10,
              color: palette.text,
              backgroundColor: palette.group,
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
          disabled={!canSend}
          onPress={() =>
            void run(
              () => onSend(draft),
              () => setDraft(""),
            )
          }
          style={{
            width: metrics.hit,
            height: metrics.hit,
            borderRadius: 22,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: canSend ? palette.primary : palette.iconBox,
          }}
        >
          <Symbol name="arrow.up" size={18} tone={canSend ? "primaryText" : "faint"} />
        </Pressable>
      </View>
    </View>
  );
}

export function Chip({
  label,
  prefix,
  primary = false,
  disabled = false,
  accessibilityLabel,
  onPress,
}: {
  readonly label: string;
  readonly prefix?: string;
  readonly primary?: boolean;
  readonly disabled?: boolean;
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
}) {
  const palette = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: metrics.hit,
        minWidth: metrics.hit,
        paddingHorizontal: 14,
        borderRadius: metrics.radiusField,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        backgroundColor: primary ? palette.primary : palette.iconBox,
        opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
      })}
    >
      {prefix === undefined ? null : (
        <Txt variant="caption1" tone={primary ? "primaryText" : "faint"}>
          {prefix}
        </Txt>
      )}
      <Txt variant="subheadline" tone={primary ? "primaryText" : "text"} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}
