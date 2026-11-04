/**
 * The paired phones, as one `safeStorage` envelope in `mobile-pairings.json` (mobile design §3,
 * MOB3). The records hold the long-term keys of every pairing, so two rules shape the file:
 *
 *  - **No plaintext fallback.** When the OS cannot encrypt, nothing is written and `add` refuses
 *    with a reason the Settings section shows.
 *  - **A file that cannot be read is write-locked.** It may hold keys nobody can re-derive, so no
 *    write replaces it (AGENTS.md trap): `add`, `remove` and `touch` refuse until the owner
 *    deletes it by hand. The bytes stay recoverable.
 *
 * File IO and encryption are injected like `electron/account/session-store.ts`; keys never reach
 * a log line, `workspaces.json`, `session.json` or telemetry.
 */
import type { SessionCipher, SessionFileIo } from "../account/session-store";

export interface StoredPairing {
  readonly pairingId: string;
  readonly relayUrl: string;
  readonly phoneName: string;
  readonly phoneModel: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number | null;
  /** Everything below is base64url key material. */
  readonly dsk: string;
  readonly ppk: string;
  readonly pairKey: string;
  readonly desktopToken: string;
}

/**
 * A pairing whose keys are already deleted but whose relay room is not yet known to be gone.
 * Only what a revoke needs to reach the relay: no key that opens a session.
 */
export interface RevokingRecord {
  readonly pairingId: string;
  readonly relayUrl: string;
  readonly desktopToken: string;
}

export type PairingFileState = "none" | "ok" | "unreadable";
export type StoreRefusal = "encryption-unavailable" | "unreadable";

export interface PairingStore {
  load(): Promise<PairingFileState>;
  list(): readonly StoredPairing[];
  get(pairingId: string): StoredPairing | null;
  encryptionAvailable(): boolean;
  /** Why a pairing cannot be saved right now, or null. Loads the file first. */
  refusal(): Promise<StoreRefusal | null>;
  add(record: StoredPairing): Promise<{ ok: true } | { ok: false; reason: StoreRefusal }>;
  /** Deletes the keys at once; the relay room is tracked in `revoking()` until `finishRevoke`. */
  remove(pairingId: string): Promise<boolean>;
  revoking(): readonly RevokingRecord[];
  /** The relay confirmed (or no longer knows) the pairing. */
  finishRevoke(pairingId: string): Promise<void>;
  /** Records when the phone was last online; written at most once a minute. */
  touch(pairingId: string, at: number): void;
}

const ENVELOPE_VERSION = 1;
/** `lastSeenAt` changes on every connect; the file is rewritten for it at most this often. */
export const TOUCH_PERSIST_MS = 60_000;

const KEY_FIELDS = ["dsk", "ppk", "pairKey", "desktopToken"] as const;

function isRevoking(value: unknown): value is RevokingRecord {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node.pairingId === "string" &&
    typeof node.relayUrl === "string" &&
    typeof node.desktopToken === "string"
  );
}

function isStoredPairing(value: unknown): value is StoredPairing {
  if (typeof value !== "object" || value === null) return false;
  const node = value as Record<string, unknown>;
  return (
    typeof node.pairingId === "string" &&
    typeof node.relayUrl === "string" &&
    typeof node.phoneName === "string" &&
    typeof node.phoneModel === "string" &&
    typeof node.pairedAt === "number" &&
    (node.lastSeenAt === null || typeof node.lastSeenAt === "number") &&
    KEY_FIELDS.every((field) => typeof node[field] === "string")
  );
}

export function createPairingStore(deps: {
  readonly io: SessionFileIo;
  readonly cipher: SessionCipher;
  readonly now?: () => number;
  readonly report?: (message: string) => void;
}): PairingStore {
  const now = deps.now ?? Date.now;
  const records = new Map<string, StoredPairing>();
  const pendingRevokes = new Map<string, RevokingRecord>();
  let state: PairingFileState = "none";
  let loading: Promise<PairingFileState> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let lastPersistedAt = 0;

  async function readFile(): Promise<PairingFileState> {
    let raw: string | null;
    try {
      raw = await deps.io.read();
    } catch {
      return "unreadable";
    }
    if (raw === null) return "none";
    try {
      const envelope: unknown = JSON.parse(raw);
      const node = envelope as { v?: unknown; data?: unknown };
      if (node.v !== ENVELOPE_VERSION || typeof node.data !== "string") return "unreadable";
      const plain = deps.cipher.decryptString(Buffer.from(node.data, "base64"));
      const parsed: unknown = JSON.parse(plain);
      // Files written before revokes were durable hold the bare array of pairings.
      const body = Array.isArray(parsed) ? { pairings: parsed, revoking: [] } : parsed;
      const content = body as { pairings?: unknown; revoking?: unknown };
      if (!Array.isArray(content.pairings)) return "unreadable";
      for (const entry of content.pairings) {
        if (isStoredPairing(entry)) records.set(entry.pairingId, entry);
      }
      for (const entry of Array.isArray(content.revoking) ? content.revoking : []) {
        if (isRevoking(entry)) pendingRevokes.set(entry.pairingId, entry);
      }
      return "ok";
    } catch {
      // Not decryptable on this machine or profile, or not our envelope.
      records.clear();
      pendingRevokes.clear();
      return "unreadable";
    }
  }

  function load(): Promise<PairingFileState> {
    loading ??= readFile().then((result) => {
      state = result;
      return result;
    });
    return loading;
  }

  /** One queued write; never throws. A failed write keeps the in-memory record for this run. */
  function persist(): Promise<void> {
    writing = writing.then(async () => {
      try {
        if (records.size === 0 && pendingRevokes.size === 0) {
          if (state === "ok") {
            await deps.io.remove();
            state = "none";
          }
          return;
        }
        if (!deps.cipher.isEncryptionAvailable()) return;
        const data = deps.cipher
          .encryptString(
            JSON.stringify({
              pairings: [...records.values()],
              revoking: [...pendingRevokes.values()],
            }),
          )
          .toString("base64");
        await deps.io.write(JSON.stringify({ v: ENVELOPE_VERSION, data }));
        state = "ok";
        lastPersistedAt = now();
      } catch {
        deps.report?.("Deck: the paired-phones file could not be saved");
      }
    });
    return writing;
  }

  return {
    load,
    list: () => [...records.values()],
    get: (pairingId) => records.get(pairingId) ?? null,
    encryptionAvailable: () => deps.cipher.isEncryptionAvailable(),
    async refusal() {
      await load();
      if (state === "unreadable") return "unreadable";
      return deps.cipher.isEncryptionAvailable() ? null : "encryption-unavailable";
    },
    async add(record) {
      await load();
      if (state === "unreadable") return { ok: false, reason: "unreadable" };
      if (!deps.cipher.isEncryptionAvailable())
        return { ok: false, reason: "encryption-unavailable" };
      records.set(record.pairingId, record);
      await persist();
      return { ok: true };
    },
    async remove(pairingId) {
      await load();
      if (state === "unreadable") return false;
      const record = records.get(pairingId);
      if (record === undefined) return false;
      records.delete(pairingId);
      pendingRevokes.set(pairingId, {
        pairingId,
        relayUrl: record.relayUrl,
        desktopToken: record.desktopToken,
      });
      await persist();
      return true;
    },
    revoking: () => [...pendingRevokes.values()],
    async finishRevoke(pairingId) {
      await load();
      if (state === "unreadable" || !pendingRevokes.delete(pairingId)) return;
      await persist();
    },
    touch(pairingId, at) {
      const record = records.get(pairingId);
      if (record === undefined || state === "unreadable") return;
      records.set(pairingId, { ...record, lastSeenAt: at });
      if (now() - lastPersistedAt >= TOUCH_PERSIST_MS) void persist();
    },
  };
}

/**
 * `safeStorage` on Linux can report itself available while using the `basic_text` backend, whose
 * key is hard-coded: the "encryption" protects nothing. Pairing keys must not be written under
 * it, so that backend counts as unavailable (the visible refusal is the existing one).
 */
export function guardedCipher(
  cipher: SessionCipher,
  platform: NodeJS.Platform,
  backend: () => string | null | undefined,
): SessionCipher {
  return {
    isEncryptionAvailable: () => {
      if (!cipher.isEncryptionAvailable()) return false;
      return !(platform === "linux" && backend() === "basic_text");
    },
    encryptString: (plain) => cipher.encryptString(plain),
    decryptString: (encrypted) => cipher.decryptString(encrypted),
  };
}
