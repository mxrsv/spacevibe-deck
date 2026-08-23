import { ArrowSquareOut } from "@phosphor-icons/react";
import { useSignal } from "@preact/signals";
import { openUrl } from "../host/shell-host";
import { reportChromeMessage } from "../chrome/events";
import { USAGE_PRIVACY_URL } from "../telemetry/usage-notice";
import { setTelemetryEnabled } from "../telemetry/consent-store";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { Modal } from "./modal";

/**
 * The usage-analytics consent dialog (DL-29.9 — the decision modal;
 * owner-decided 2026-08-22, replacing the DL §30 consent ROW the spec's §6
 * first shipped). Electron only.
 *
 * Rendered only where `shouldShowUsageNotice` says so — `App` owns that call,
 * so this component is state-free and a gallery specimen can mount it
 * directly. It asks for a DECISION: no ✕, and BOTH shell exits are withdrawn
 * (`dismissOnScrim` and `dismissOnEscape` false) because every way out must
 * persist an answer. Each button persists through main, whose
 * `telemetry:state-changed` broadcast dismisses the dialog in every window at
 * once — so it is seen once per install, not once per launch. Settings →
 * Privacy remains the way to reverse either answer.
 *
 * Focus starts on the PANEL, not the primary button (DL-29.2): a reflexive
 * Enter right after launch must not opt anyone into anything.
 *
 * Copy carries spec §6's pinned phrases ("optional usage stats", the
 * exclusions) reshaped for a dialog, plus the Settings &rarr; Privacy pointer
 * a surface with no other exit owes the reader. It never says "anonymous" —
 * the copy test pins all of it.
 */
export function UsageConsentModal() {
  /**
   * In flight, so a second press cannot start a second write.
   *
   * Both buttons go, not just the pressed one: the two calls are a decision,
   * and letting "Not now" land on top of an in-flight "Share" would settle the
   * question by whichever IPC answered last. The `PrivacySection` switch has
   * carried the same guard since it shipped; the dialog was the copy without
   * it.
   */
  const busy = useSignal(false);
  const decide = (enabled: boolean) => {
    if (busy.value) {
      return;
    }
    busy.value = true;
    setTelemetryEnabled(enabled)
      .catch(() => {
        // The one failure a user can act on here: the decision did not persist.
        // An opt-IN leaves the dialog up on purpose — main rolls that back
        // rather than claim a consent that never reached disk.
        //
        // A failed "Not now" leaves by a different road, and it is worth being
        // exact about which: main keeps `declined` in memory and BROADCASTS it
        // (pinned by `electron/telemetry/service.test.ts`), so the dialog goes
        // even on a read-only disk — but it goes through
        // `telemetry:state-changed`, never through this call's return value,
        // because a failed write rejects before there is one. If that listener
        // never attached, the decline is stranded. Known, narrow, and not
        // papered over here: the renderer does not own consent and must not
        // move the signal on its own.
        reportChromeMessage("Could not save your usage-stats choice");
      })
      .finally(() => {
        busy.value = false;
      });
  };
  return (
    <Modal
      panelClass="usage-consent"
      label="Usage stats"
      dismissOnScrim={false}
      dismissOnEscape={false}
      // Unreachable: both shell exits are withdrawn above, and the buttons
      // below persist their own answers. The shell still requires a handler.
      onDismiss={() => {}}
    >
      <h1 class="usage-consent__title">Help improve Deck</h1>
      <p class="usage-consent__message">
        Share optional usage stats. No code, paths or prompts — and you can change your answer any
        time in Settings &rarr; Privacy.
      </p>
      <button
        type="button"
        class="usage-link"
        onClick={() => {
          void openUrl(USAGE_PRIVACY_URL).catch(() => {
            reportChromeMessage(`Could not open ${USAGE_PRIVACY_URL}`);
          });
        }}
      >
        <span>What Deck sends</span>
        <DeckIcon icon={ArrowSquareOut} size={CHROME_ICON} />
      </button>
      <div class="usage-consent__actions">
        {/* Sharing first and accented, but focus does NOT start here — see
            the component note. `is-primary` is the save-preset convention. */}
        <button type="button" class="is-primary" disabled={busy.value} onClick={() => decide(true)}>
          Share usage stats
        </button>
        <button type="button" disabled={busy.value} onClick={() => decide(false)}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
