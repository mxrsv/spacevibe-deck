import { b64urlDecode } from "@protocol/encoding";
import { OS_NAMES } from "@protocol/messages";
import type { KeyValueStore } from "@/storage/key-value";

export type DesktopOs = (typeof OS_NAMES)[number] | "unknown";

/**
 * One pairing as kept in the Keychain (design §3): every secret is base64url text. Never logged,
 * never shown, never sent anywhere but into the crypto functions.
 */
export interface StoredPairing {
  readonly pairingId: string;
  readonly relayUrl: string;
  readonly desktopName: string;
  readonly os: DesktopOs;
  readonly pairedAt: number;
  readonly psk: string;
  readonly dpk: string;
  readonly pairKey: string;
  readonly pushKey: string;
  readonly phoneToken: string;
}

/** What the UI may hold: the pairing without a single key. */
export interface PairingSummary {
  readonly pairingId: string;
  readonly relayUrl: string;
  readonly desktopName: string;
  readonly os: DesktopOs;
  readonly pairedAt: number;
}

export function summarize(pairing: StoredPairing): PairingSummary {
  const { pairingId, relayUrl, desktopName, os, pairedAt } = pairing;
  return { pairingId, relayUrl, desktopName, os, pairedAt };
}

export function osOf(value: string): DesktopOs {
  return OS_NAMES.find((name) => name === value) ?? "unknown";
}

/** The pairing's keys as bytes, decoded at the moment a connection needs them. */
export function pairingKeys(pairing: StoredPairing): {
  readonly pairKey: Uint8Array;
  readonly pushKey: Uint8Array;
  readonly phoneToken: string;
} {
  return {
    pairKey: b64urlDecode(pairing.pairKey),
    pushKey: b64urlDecode(pairing.pushKey),
    phoneToken: pairing.phoneToken,
  };
}

const INDEX_KEY = "deck.pairings";
const recordKey = (pairingId: string): string => `deck.pairing.${pairingId}`;

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Null for anything that is not a complete record, so a corrupt entry is skipped, not trusted. */
export function parseStoredPairing(text: string | null): StoredPairing | null {
  if (text === null) return null;
  try {
    const v: unknown = JSON.parse(text);
    if (typeof v !== "object" || v === null) return null;
    const r = v as Record<string, unknown>;
    if (
      !isString(r.pairingId) ||
      !isString(r.relayUrl) ||
      !isString(r.desktopName) ||
      !isString(r.psk) ||
      !isString(r.dpk) ||
      !isString(r.pairKey) ||
      !isString(r.pushKey) ||
      !isString(r.phoneToken) ||
      typeof r.os !== "string" ||
      typeof r.pairedAt !== "number"
    ) {
      return null;
    }
    return {
      pairingId: r.pairingId,
      relayUrl: r.relayUrl,
      desktopName: r.desktopName,
      os: osOf(r.os),
      pairedAt: r.pairedAt,
      psk: r.psk,
      dpk: r.dpk,
      pairKey: r.pairKey,
      pushKey: r.pushKey,
      phoneToken: r.phoneToken,
    };
  } catch {
    return null;
  }
}

export interface PairingStore {
  list(): Promise<StoredPairing[]>;
  save(pairing: StoredPairing): Promise<void>;
  remove(pairingId: string): Promise<void>;
}

/** Several desktops per phone (MOB5): an index of ids, one Keychain item per pairing. */
export function createPairingStore(kv: KeyValueStore): PairingStore {
  async function readIndex(): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse((await kv.get(INDEX_KEY)) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter(isString) : [];
    } catch {
      return [];
    }
  }
  return {
    async list() {
      const found: StoredPairing[] = [];
      for (const id of await readIndex()) {
        const record = parseStoredPairing(await kv.get(recordKey(id)));
        if (record !== null) found.push(record);
      }
      return found.sort((a, b) => a.pairedAt - b.pairedAt);
    },
    async save(pairing) {
      // Record first, index second: a crash in between leaves an unlisted item, never a listed hole.
      await kv.set(recordKey(pairing.pairingId), JSON.stringify(pairing));
      const index = await readIndex();
      if (!index.includes(pairing.pairingId)) {
        await kv.set(INDEX_KEY, JSON.stringify([...index, pairing.pairingId]));
      }
    },
    async remove(pairingId) {
      const index = await readIndex();
      await kv.set(INDEX_KEY, JSON.stringify(index.filter((id) => id !== pairingId)));
      await kv.delete(recordKey(pairingId));
    },
  };
}
