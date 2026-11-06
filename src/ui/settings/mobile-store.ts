import { signal } from "@preact/signals";
import {
  cancelMobilePairing,
  getMobileState,
  listenMobileChanged,
  revokeMobilePhone,
  startMobilePairing,
} from "../../host/mobile-host";
import { DISABLED_MOBILE_STATE, type MobilePhone, type MobileState } from "../../lib/mobile-state";
import { isReleaseSwitchEnabled } from "../../lib/release-switches";
import { rendererReleaseSwitches } from "../../terminal/action-availability";

/** Read at render time, never into a constant (release-switch convention). */
export function mobileCompanionEnabled(): boolean {
  return isReleaseSwitchEnabled("mobileCompanion", rendererReleaseSwitches());
}

/**
 * The Mobile section's state (R5: module signals, window-scoped). Main owns the truth; this is
 * the last `mobile_state` it answered, refreshed on `mobile:changed`.
 */
export const mobileState = signal<MobileState>(DISABLED_MOBILE_STATE);

/** Why the last attempt to show a code failed; null once a code is showing or the dialog closed. */
export const pairError = signal<string | null>(null);
/** Whether the pairing dialog is open; it can stay open on an error or an expired code. */
export const pairDialogOpen = signal(false);
/** A start is in flight (registering with the relay); the button waits. */
export const pairStarting = signal(false);
/** The phone whose revoke the user is being asked to confirm. */
export const revokeTarget = signal<MobilePhone | null>(null);

let unlisten: (() => void) | null = null;
let listening: Promise<void> | null = null;

export async function refreshMobile(): Promise<void> {
  const next = await getMobileState();
  const hadPending = mobileState.value.pending !== null;
  const known = new Set(mobileState.value.phones.map((phone) => phone.pairingId));
  mobileState.value = next;
  // A phone that appeared while a code was waiting means the scan worked: the dialog's job is done.
  if (
    pairDialogOpen.value &&
    hadPending &&
    next.pending === null &&
    next.phones.some((phone) => !known.has(phone.pairingId))
  ) {
    pairDialogOpen.value = false;
  }
}

/** Start reading main's state and following its changes. Idempotent; pair it with `stopMobile`. */
export function startMobile(): Promise<void> {
  listening ??= (async () => {
    await refreshMobile();
    unlisten = await listenMobileChanged(() => void refreshMobile());
  })();
  return listening;
}

export function stopMobile(): void {
  unlisten?.();
  unlisten = null;
  listening = null;
}

export async function showPairingCode(): Promise<void> {
  if (pairStarting.value) return;
  pairDialogOpen.value = true;
  pairError.value = null;
  pairStarting.value = true;
  try {
    const result = await startMobilePairing();
    mobileState.value = result;
    pairError.value = result.error?.message ?? null;
  } finally {
    pairStarting.value = false;
  }
}

export async function cancelPairing(): Promise<void> {
  pairDialogOpen.value = false;
  pairError.value = null;
  mobileState.value = await cancelMobilePairing();
}

export async function confirmRevoke(): Promise<void> {
  const target = revokeTarget.value;
  revokeTarget.value = null;
  if (target === null) return;
  mobileState.value = await revokeMobilePhone(target.pairingId);
}
