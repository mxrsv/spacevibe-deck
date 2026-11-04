import { useCallback, useRef, useState } from "react";
import * as Haptics from "expo-haptics";
import type { PairingQr } from "@protocol/qr";
import { useServices } from "@/app-state/app-provider";
import { deviceCrypto } from "@/crypto/device-crypto";
import { createRnSocket } from "@/session/socket";
import { pairErrorText, pairWithDesktop, readPairingCode } from "./pair-flow";

export type PairState =
  | { readonly phase: "idle" }
  | { readonly phase: "found"; readonly qr: PairingQr }
  | { readonly phase: "pairing"; readonly qr: PairingQr }
  | { readonly phase: "failed"; readonly message: string };

/** The pairing screen's state: a code is read, the user confirms the desktop it names, then pairing runs. */
export function usePairing(onPaired: () => void) {
  const { manager, pairingDeps, push, prefs } = useServices();
  const [state, setState] = useState<PairState>({ phase: "idle" });
  // The camera reports the same QR many times a second; the ref makes the phase check immediate.
  const phase = useRef<PairState["phase"]>("idle");
  const move = useCallback((next: PairState) => {
    phase.current = next.phase;
    setState(next);
  }, []);

  const fail = useCallback(
    (message: string) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      move({ phase: "failed", message });
    },
    [move],
  );

  const readCode = useCallback(
    (text: string) => {
      if (phase.current !== "idle") return;
      const read = readPairingCode(text, Date.now());
      if (!read.ok) return fail(pairErrorText(read.error));
      void Haptics.selectionAsync();
      move({ phase: "found", qr: read.qr });
    },
    [fail, move],
  );

  const confirm = useCallback(async () => {
    if (state.phase !== "found") return;
    const { qr } = state;
    move({ phase: "pairing", qr });
    try {
      const result = await pairWithDesktop(
        {
          crypto: deviceCrypto,
          socketFactory: createRnSocket,
          now: Date.now,
          phone: pairingDeps.phone,
        },
        qr,
      );
      if (!result.ok) return fail(pairErrorText(result.error));
      await manager.addPairing(result.pairing);
      // A finished pairing is the moment push makes sense to the user: the one place the OS
      // permission prompt may appear unasked (the Settings switch is the other).
      void push
        .sync(prefs.getSnapshot().prefs.notifications, true)
        .then(() => manager.announcePush());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onPaired();
    } catch {
      fail("Could not save this pairing on the phone. Try again.");
    }
  }, [state, move, fail, manager, pairingDeps, onPaired, push, prefs]);

  const reset = useCallback(() => move({ phase: "idle" }), [move]);

  return { state, readCode, confirm, reset };
}
