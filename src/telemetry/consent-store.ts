/**
 * Window-scoped view over MAIN-owned consent state (R5, spec §3).
 *
 * The renderer never holds the truth: it asks over `telemetry_state`, changes
 * it over `telemetry_set_enabled`, and follows `telemetry:state-changed` so
 * one window's decision dismisses the consent row in every window (spec §6).
 * No daily id ever arrives here — the reply carries consent alone.
 */
import { computed, signal, type ReadonlySignal } from "@preact/signals";
import { listen } from "../host/bridge";
import {
  available,
  telemetrySetEnabled,
  telemetryState,
  type TelemetryConsent,
} from "../host/telemetry-host";
import { shouldShowUsageNotice } from "./usage-notice";

/**
 * `loading` until the first answer lands; `unavailable` where the host has no
 * handler (Tauri, browser preview) or the IPC read itself failed — both keep
 * the consent row off and the Privacy switch disabled, which is fail-closed.
 */
export type TelemetryConsentPhase = TelemetryConsent | "loading" | "unavailable";

export const telemetryConsent = signal<TelemetryConsentPhase>(
  available ? "loading" : "unavailable",
);

/**
 * Whether the consent dialog is on screen — ONE source, read by both the
 * component that renders it and the guard that has to know a modal is up.
 *
 * `App` used to answer this for itself and tell nobody, so `openOverlayRanks()`
 * could not see the dialog and every chord kept running behind its scrim: ⌘T
 * spawned a pane and took focus, ⌘, opened Settings underneath it at a lower
 * z-index, ⌘W closed a pane nobody could see. A `computed` rather than a
 * signal `App` writes during render: the dialog's presence IS a function of
 * consent, and a written copy would lag it by a frame — the frame a launch-time
 * modal is most likely to be raced in.
 */
export const usageConsentOpen: ReadonlySignal<boolean> = computed(() =>
  shouldShowUsageNotice({ electronHost: available, consent: telemetryConsent.value }),
);

let loadStarted = false;

function adoptConsent(raw: unknown): void {
  if (typeof raw !== "object" || raw === null) {
    return;
  }
  const consent = (raw as { consent?: unknown }).consent;
  if (
    consent === "unanswered" ||
    consent === "enabled" ||
    consent === "declined" ||
    consent === "unreadable"
  ) {
    telemetryConsent.value = consent;
  }
}

/** Ask once per window; every later change arrives over the event. */
export async function ensureTelemetryStateLoaded(): Promise<void> {
  if (!available || loadStarted) {
    return;
  }
  loadStarted = true;
  void listen<unknown>("telemetry:state-changed", adoptConsent).catch(() => {
    // A host without the event still answers the initial read below.
  });
  const state = await telemetryState();
  if (state === null) {
    telemetryConsent.value = "unavailable";
    return;
  }
  telemetryConsent.value = state.consent;
}

/**
 * Persist a consent decision. Rejects when main could not persist it — the
 * caller surfaces that error; the signal only moves on a confirmed answer.
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const state = await telemetrySetEnabled(enabled);
  if (state === null) {
    // A reply that does not parse is a host that did not answer, and it must
    // read as failure rather than as silence. It used to resolve here: the
    // signal stayed where it was, the caller's `catch` never ran, and on the
    // consent dialog — which has no other way out — that is a button doing
    // nothing at all, twice, with nothing said. `telemetryState`'s read may
    // degrade to `unavailable`; a WRITE may not degrade to anything.
    throw new Error("The usage-stats setting could not be saved.");
  }
  telemetryConsent.value = state.consent;
}

/** Test seam: forget the window-scoped load so a fresh mount asks again. */
export function resetTelemetryConsentStore(): void {
  loadStarted = false;
  telemetryConsent.value = available ? "loading" : "unavailable";
}
