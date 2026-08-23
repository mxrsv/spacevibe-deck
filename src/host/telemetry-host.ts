/**
 * The three usage-analytics channels, over the host bridge (spec §3).
 *
 * Fail-soft by contract, like `external-apps-host.ts`: a host with no handler
 * — Tauri, or a browser `npm run dev` preview — must read as "this host does
 * not do analytics", never as an error. On Tauri the consequences are exactly
 * the spec's: `available` is false, so the renderer never counts, the consent
 * row never renders and nothing is ever sent.
 *
 * Flat payload keys per R6 — `scripts/electron-ipc-contract.test.ts` reads the
 * object literals below, so the keys have to be written here rather than
 * spread in from an `args` identifier.
 */
import { invoke } from "./bridge";

/**
 * Whether THIS host can answer these channels at all.
 *
 * Read off `window.__deckHost` directly rather than by trying a call, exactly
 * as `external-apps-host.ts` does and for the same reason: `invoke` throws
 * when the bridge is missing, and a thrown call is not the same answer as
 * "this host does not do that".
 */
export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

export type TelemetryConsent = "unanswered" | "enabled" | "declined" | "unreadable";

export interface TelemetryState {
  readonly consent: TelemetryConsent;
  readonly consentVersion: number;
}

const CONSENT_VALUES: readonly TelemetryConsent[] = [
  "unanswered",
  "enabled",
  "declined",
  "unreadable",
];

function asTelemetryState(raw: unknown): TelemetryState | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (!CONSENT_VALUES.includes(source.consent as TelemetryConsent)) {
    return null;
  }
  return {
    consent: source.consent as TelemetryConsent,
    consentVersion: typeof source.consentVersion === "number" ? source.consentVersion : 0,
  };
}

export interface TelemetryCountArgs {
  readonly kind: string;
  readonly key: string;
  readonly value: number;
}

/**
 * Fire and forget: no caller awaits this and no UI state reads its result
 * (spec §5's governing failure rule). Main re-validates everything.
 */
export function telemetryCount({ kind, key, value }: TelemetryCountArgs): void {
  if (!available) {
    return;
  }
  try {
    invoke<void>("telemetry_count", { kind, key, value }).catch(() => {
      // A host that cannot count is indistinguishable from one that can.
    });
  } catch {
    // A bridge that throws synchronously (a test stub, a partial host) must
    // not take the launch path down with it — counting is never load-bearing.
  }
}

/** Main-owned consent state, or null where the host cannot answer. */
export async function telemetryState(): Promise<TelemetryState | null> {
  if (!available) {
    return null;
  }
  try {
    return asTelemetryState(await invoke<unknown>("telemetry_state", {}));
  } catch {
    return null;
  }
}

/**
 * Change consent. Rejects with a user-facing message when the write did not
 * persist — the Privacy section must never claim a change main did not keep.
 */
export async function telemetrySetEnabled(enabled: boolean): Promise<TelemetryState | null> {
  return asTelemetryState(await invoke<unknown>("telemetry_set_enabled", { enabled }));
}
