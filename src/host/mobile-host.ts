/**
 * Renderer facade for the iPhone companion (spec 2026-11-04-mobile-companion), Electron-only like
 * the other `src/host/` files for new channels. Two halves:
 *
 *  - the Settings section's commands (`mobile_state`, `mobile_pair_start`, `mobile_pair_cancel`,
 *    `mobile_revoke`) and the `mobile:changed` event;
 *  - what the terminal layer does for a phone: answer main's queries, stream a pane, take a
 *    phone's keystrokes, report a push decision.
 *
 * Nothing here throws into the UI loop. Where the bridge is absent (the browser preview, a test)
 * the commands answer the disabled state and the reports are dropped after one warning.
 * Flat payloads per R6: the object literals are what `scripts/electron-ipc-contract.test.ts` reads.
 */
import { invoke, listen, type UnlistenFn } from "./bridge";
import {
  DISABLED_MOBILE_STATE,
  parseMobileStartResult,
  parseMobileState,
  type MobileStartResult,
  type MobileState,
} from "../lib/mobile-state";

function hostPresent(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    (globalThis as { __deckHost?: unknown }).__deckHost !== undefined
  );
}

export async function getMobileState(): Promise<MobileState> {
  if (!hostPresent()) return DISABLED_MOBILE_STATE;
  try {
    return parseMobileState(await invoke<unknown>("mobile_state", {}));
  } catch (error) {
    console.warn("mobile_state failed:", error);
    return DISABLED_MOBILE_STATE;
  }
}

export async function startMobilePairing(): Promise<MobileStartResult> {
  const unavailable: MobileStartResult = {
    ...DISABLED_MOBILE_STATE,
    error: { reason: "unavailable", message: "Phone pairing is not available here." },
  };
  if (!hostPresent()) return unavailable;
  try {
    return parseMobileStartResult(await invoke<unknown>("mobile_pair_start", {}));
  } catch (error) {
    console.warn("mobile_pair_start failed:", error);
    return unavailable;
  }
}

export async function cancelMobilePairing(): Promise<MobileState> {
  if (!hostPresent()) return DISABLED_MOBILE_STATE;
  try {
    return parseMobileState(await invoke<unknown>("mobile_pair_cancel", {}));
  } catch (error) {
    console.warn("mobile_pair_cancel failed:", error);
    return DISABLED_MOBILE_STATE;
  }
}

export async function revokeMobilePhone(pairingId: string): Promise<MobileState> {
  if (!hostPresent()) return DISABLED_MOBILE_STATE;
  try {
    return parseMobileState(await invoke<unknown>("mobile_revoke", { pairingId }));
  } catch (error) {
    console.warn("mobile_revoke failed:", error);
    return DISABLED_MOBILE_STATE;
  }
}

/** Hear that the paired list or a phone's presence changed; re-read `getMobileState`. */
export async function listenMobileChanged(handler: () => void): Promise<UnlistenFn> {
  if (!hostPresent()) return () => {};
  return listen<unknown>("mobile:changed", () => handler());
}

// ------------------------------------------------------------------ the terminal layer's half

export type MobileQueryKind = "tree" | "projects" | "agents";
export type MobileStreamKind = "snapshot" | "data" | "resize" | "end";

export interface MobileStreamPiece {
  readonly subscriptionId: string;
  readonly paneId: number;
  readonly kind: MobileStreamKind;
  readonly data: string;
  readonly cols: number;
  readonly rows: number;
}

let warnedAbsent = false;

function guarded(name: string, send: () => Promise<unknown>): void {
  if (!hostPresent()) {
    if (!warnedAbsent) {
      warnedAbsent = true;
      console.warn(`${name} skipped: the Deck host bridge is unavailable`);
    }
    return;
  }
  try {
    send().catch((error: unknown) => console.warn(`${name} failed:`, error));
  } catch (error) {
    console.warn(`${name} failed:`, error);
  }
}

export function listenMobileQueries(handler: (request: unknown) => void): Promise<UnlistenFn> {
  return hostPresent()
    ? listen<unknown>("mobile:query-request", ({ payload }) => handler(payload))
    : Promise.resolve(() => {});
}

export function listenMobileStreamSubscribe(
  handler: (request: unknown) => void,
): Promise<UnlistenFn> {
  return hostPresent()
    ? listen<unknown>("mobile:stream-subscribe", ({ payload }) => handler(payload))
    : Promise.resolve(() => {});
}

export function listenMobileStreamUnsubscribe(
  handler: (request: unknown) => void,
): Promise<UnlistenFn> {
  return hostPresent()
    ? listen<unknown>("mobile:stream-unsubscribe", ({ payload }) => handler(payload))
    : Promise.resolve(() => {});
}

export function listenMobileInput(handler: (request: unknown) => void): Promise<UnlistenFn> {
  return hostPresent()
    ? listen<unknown>("mobile:input", ({ payload }) => handler(payload))
    : Promise.resolve(() => {});
}

export function reportMobileQuery({
  requestId,
  kind,
  payload,
}: {
  readonly requestId: string;
  readonly kind: MobileQueryKind;
  readonly payload: unknown;
}): void {
  guarded("mobile_query_report", () =>
    invoke<boolean>("mobile_query_report", { requestId, kind, payload }),
  );
}

export function sendMobileStreamData({
  subscriptionId,
  paneId,
  kind,
  data,
  cols,
  rows,
}: MobileStreamPiece): void {
  guarded("mobile_stream_data", () =>
    invoke<boolean>("mobile_stream_data", { subscriptionId, paneId, kind, data, cols, rows }),
  );
}

export function sendMobilePush({
  paneId,
  kind,
  title,
  body,
}: {
  readonly paneId: number;
  readonly kind: "requested" | "completed";
  readonly title: string;
  readonly body: string;
}): void {
  guarded("mobile_push", () => invoke<boolean>("mobile_push", { paneId, kind, title, body }));
}
