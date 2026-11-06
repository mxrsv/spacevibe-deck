import { useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme/use-theme";
import { metrics } from "@/theme/tokens";
import { type } from "@/theme/type";
import { Button, IconButton } from "@/ui/button";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";
import { usePairing } from "./use-pairing";

const FRAME = 248;

/**
 * Scan the QR in Deck's Settings → Mobile (camera, QR only) or paste the code (the Simulator has no
 * camera). The code is checked locally first: an expired code never reaches the relay.
 */
export function PairScreen({ onClose }: { readonly onClose: () => void }) {
  const palette = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const { state, readCode, confirm, reset } = usePairing(onClose);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const scanning = state.phase === "idle" && !typing;

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {permission?.granted === true ? (
        <CameraView
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanning ? ({ data }) => readCode(data) : undefined}
        />
      ) : null}

      <View style={{ paddingTop: insets.top, paddingHorizontal: 8, flexDirection: "row" }}>
        <IconButton name="xmark" label="Close" onPress={onClose} />
      </View>

      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 }}
      >
        {permission?.granted === true ? (
          <View
            accessible={false}
            style={{
              width: FRAME,
              height: FRAME,
              borderRadius: 24,
              borderWidth: 4,
              borderColor: "rgba(255,255,255,0.85)",
            }}
          />
        ) : (
          <View style={{ alignItems: "center", gap: 12, maxWidth: 320 }}>
            <Symbol name="camera.fill" size={40} tone="primaryText" />
            <Txt variant="body" tone="primaryText" accessibilityRole="text">
              Allow the camera to scan the code in Deck, or enter the code by hand.
            </Txt>
            {permission !== null && !permission.canAskAgain ? (
              <Button
                label="Open Settings"
                kind="plain"
                onPress={() => void Linking.openSettings()}
              />
            ) : (
              <Button label="Allow camera" onPress={() => void requestPermission()} />
            )}
          </View>
        )}
        <View style={{ alignItems: "center", gap: 4 }}>
          <Txt variant="title3" tone="primaryText">
            Scan the code in Deck
          </Txt>
          <Txt variant="subheadline" tone="primaryText">
            Settings → Mobile → Pair a phone
          </Txt>
          <View style={{ flexDirection: "row", gap: 6, alignItems: "center", marginTop: 8 }}>
            <Symbol name="lock.fill" size={13} tone="primaryText" />
            <Txt variant="footnote" tone="primaryText">
              End-to-end encrypted, no account
            </Txt>
          </View>
        </View>
      </View>

      <View
        style={{
          padding: metrics.screenInset,
          paddingBottom: insets.bottom + metrics.screenInset,
          gap: 12,
          backgroundColor: palette.ground,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
        }}
      >
        {state.phase === "found" || state.phase === "pairing" ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Symbol name="laptopcomputer" size={24} />
              <View style={{ flex: 1 }}>
                <Txt variant="headline" numberOfLines={1}>
                  {state.qr.desktopName}
                </Txt>
                <Txt variant="footnote" tone="faint">
                  Code matches
                </Txt>
              </View>
            </View>
            <Button
              label={state.phase === "pairing" ? "Pairing…" : "Pair"}
              icon="link"
              disabled={state.phase === "pairing"}
              onPress={() => void confirm()}
            />
            {state.phase === "found" ? (
              <Button label="Cancel" kind="plain" onPress={reset} />
            ) : null}
          </>
        ) : state.phase === "failed" ? (
          <>
            <Txt variant="callout" tone="danger" accessibilityLiveRegion="polite">
              {state.message}
            </Txt>
            <Button label="Try again" onPress={reset} />
          </>
        ) : typing ? (
          <>
            <TextInput
              accessibilityLabel="Pairing code"
              value={draft}
              onChangeText={setDraft}
              placeholder="deck-pair:…"
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              multiline
              style={[
                type.callout,
                {
                  minHeight: metrics.hit * 1.5,
                  borderRadius: metrics.radiusField,
                  padding: 12,
                  color: palette.text,
                  backgroundColor: palette.group,
                },
              ]}
            />
            <Button
              label="Use code"
              disabled={draft.trim() === ""}
              onPress={() => {
                readCode(draft);
                setTyping(false);
              }}
            />
            <Button label="Cancel" kind="plain" onPress={() => setTyping(false)} />
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enter the code by hand"
            onPress={() => setTyping(true)}
            style={{ minHeight: metrics.hit, alignItems: "center", justifyContent: "center" }}
          >
            <Txt variant="callout" tone="accent">
              Enter the code by hand
            </Txt>
          </Pressable>
        )}
      </View>
    </View>
  );
}
