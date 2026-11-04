/**
 * What the Settings → Mobile section reads (mobile spec MOB1-3): the paired phones, whether the
 * computer can protect their keys, and the pairing that is waiting for a scan. Main builds it
 * (`electron/mobile/service.ts`), the renderer parses it again with `parseMobileState`, because
 * an IPC reply is not trusted just for coming from our own process.
 *
 * Keys, tokens and the pairing secret never appear here; the QR text is the one secret-bearing
 * string, shown only while a pairing is pending and good for five minutes.
 */
export interface MobilePhone {
  readonly pairingId: string;
  readonly name: string;
  readonly model: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number | null;
  readonly online: boolean;
}

export interface MobileState {
  /** False while the `mobileCompanion` switch is off: the section is not drawn at all. */
  readonly enabled: boolean;
  readonly encryptionAvailable: boolean;
  readonly phones: readonly MobilePhone[];
  readonly pending: { readonly qr: string; readonly expiresAt: number } | null;
}

export type MobileStartResult = MobileState & {
  /** Why a pairing could not start; `message` is a sentence the section shows. */
  readonly error: { readonly reason: string; readonly message: string } | null;
};

export const DISABLED_MOBILE_STATE: MobileState = {
  enabled: false,
  encryptionAvailable: false,
  phones: [],
  pending: null,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePhone(value: unknown): MobilePhone | null {
  if (!isRecord(value)) return null;
  const { pairingId, name, model, pairedAt, lastSeenAt, online } = value;
  if (
    typeof pairingId !== "string" ||
    typeof name !== "string" ||
    typeof model !== "string" ||
    typeof pairedAt !== "number" ||
    (lastSeenAt !== null && typeof lastSeenAt !== "number") ||
    typeof online !== "boolean"
  ) {
    return null;
  }
  return { pairingId, name, model, pairedAt, lastSeenAt, online };
}

/** The checked state, or the disabled one for anything outside the shape. */
export function parseMobileState(value: unknown): MobileState {
  if (!isRecord(value) || value.enabled !== true || !Array.isArray(value.phones)) {
    return DISABLED_MOBILE_STATE;
  }
  const phones = value.phones.map(parsePhone);
  if (phones.some((phone) => phone === null)) return DISABLED_MOBILE_STATE;
  const pending = value.pending;
  const parsedPending =
    isRecord(pending) && typeof pending.qr === "string" && typeof pending.expiresAt === "number"
      ? { qr: pending.qr, expiresAt: pending.expiresAt }
      : null;
  return {
    enabled: true,
    encryptionAvailable: value.encryptionAvailable === true,
    phones: phones as MobilePhone[],
    pending: parsedPending,
  };
}

export function parseMobileStartResult(value: unknown): MobileStartResult {
  const state = parseMobileState(value);
  const error =
    isRecord(value) &&
    isRecord(value.error) &&
    typeof value.error.reason === "string" &&
    typeof value.error.message === "string"
      ? { reason: value.error.reason, message: value.error.message }
      : null;
  return { ...state, error };
}
