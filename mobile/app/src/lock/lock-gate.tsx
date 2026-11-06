import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, View } from "react-native";
import { usePrefsState } from "@/app-state/app-provider";
import { useTheme } from "@/theme/use-theme";
import { Button } from "@/ui/button";
import { Symbol } from "@/ui/symbol";
import { Txt } from "@/ui/text";
import { authenticate } from "./authenticate";
import {
  initialLock,
  onBackground,
  onEnabledChange,
  onForeground,
  onUnlocked,
  shouldAutoPrompt,
  type LockState,
} from "./lock-state";

/**
 * Nothing of the app renders until it is unlocked (MOB4): while locked, or while the preferences
 * are still being read, the children are not mounted at all, so no content can show behind the
 * lock or in the app switcher.
 */
export function LockGate({ children }: { readonly children: ReactNode }) {
  const palette = useTheme();
  const { loaded, prefs } = usePrefsState();
  const [lock, setLock] = useState<LockState | null>(null);
  const [away, setAway] = useState(false);
  const prompting = useRef(false);
  const promptEnded = useRef<number | null>(null);

  // The first state is decided once the preference is known (locked at launch when it is on), and
  // follows later changes of the preference. Derived while rendering, not in an effect, so the
  // children never mount for a frame before the lock exists.
  if (loaded && lock === null) {
    setLock(initialLock(prefs.faceIdLock));
  } else if (lock !== null && lock.enabled !== prefs.faceIdLock) {
    setLock(onEnabledChange(lock, prefs.faceIdLock));
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAway(state !== "active");
      if (state === "background") setLock((s) => (s === null ? s : onBackground(s, Date.now())));
      if (state === "active") setLock((s) => (s === null ? s : onForeground(s, Date.now())));
    });
    return () => subscription.remove();
  }, []);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const result = await authenticate("Unlock SpaceVibe Deck");
      if (result !== "cancelled") setLock((s) => (s === null ? s : onUnlocked(s)));
    } finally {
      prompting.current = false;
      promptEnded.current = Date.now();
    }
  }, []);

  const locked = lock === null || lock.locked;
  useEffect(() => {
    // Not right after a prompt closed: the closing Face ID sheet makes the app active again, and a
    // cancelled prompt must not come straight back (the Unlock button is the deliberate retry).
    if (
      loaded &&
      shouldAutoPrompt({ locked: lock?.locked === true }, away, Date.now(), promptEnded.current)
    ) {
      void unlock();
    }
  }, [loaded, lock?.locked, away, unlock]);

  const coverStyle = {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 16,
    backgroundColor: palette.ground,
  };
  if (locked) {
    return (
      <View style={coverStyle}>
        <Symbol name="lock.fill" size={40} tone="muted" />
        {loaded ? (
          <>
            <Txt variant="title3">Deck is locked</Txt>
            <Button label="Unlock" icon="faceid" onPress={() => void unlock()} />
          </>
        ) : null}
      </View>
    );
  }
  // Inactive or in the app switcher: keep the screens mounted (so a pulled-down notification
  // centre does not reset navigation) but cover them, so the switcher's snapshot shows no content.
  return (
    <View style={{ flex: 1 }}>
      {children}
      {away && prefs.faceIdLock ? (
        <View style={[coverStyle, { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }]}>
          <Symbol name="lock.fill" size={40} tone="muted" />
        </View>
      ) : null}
    </View>
  );
}
