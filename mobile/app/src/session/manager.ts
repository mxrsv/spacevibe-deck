import type { CryptoProvider } from "@protocol/crypto";
import {
  pairingKeys,
  summarize,
  type PairingStore,
  type PairingSummary,
  type StoredPairing,
} from "@/pairing/pairing-store";
import { createDesktopConnection, type DesktopConnection } from "./connection";
import { createRelayLink } from "./relay-link";
import { revokeOnRelay } from "./revoke-client";
import type { SocketFactory } from "./socket";

export interface DesktopEntry {
  readonly summary: PairingSummary;
  readonly connection: DesktopConnection;
}

export interface SessionManager {
  /** The same array until a desktop is added or forgotten, so it is safe as a store snapshot. */
  getEntries(): readonly DesktopEntry[];
  subscribe(listener: () => void): () => void;
  /** Reads the Keychain and opens a connection for every stored pairing. */
  load(): Promise<void>;
  addPairing(pairing: StoredPairing): Promise<void>;
  /** Sends `revoke` to the relay, then forgets the keys. `revokedOnRelay` is false when that could not be confirmed. */
  forget(pairingId: string): Promise<{ readonly revokedOnRelay: boolean }>;
  /** Foreground starts every connection, background stops them (iOS suspends sockets anyway). */
  setActive(active: boolean): void;
  find(pairingId: string): DesktopEntry | null;
}

export interface ManagerDeps {
  readonly store: PairingStore;
  readonly crypto: CryptoProvider;
  readonly socketFactory: SocketFactory;
  readonly session: { readonly device: string; readonly appVersion: string };
}

export function createSessionManager(deps: ManagerDeps): SessionManager {
  const listeners = new Set<() => void>();
  const stored = new Map<string, StoredPairing>();
  let entries: readonly DesktopEntry[] = [];
  let active = false;

  function publish(next: readonly DesktopEntry[]): void {
    entries = next;
    for (const listener of [...listeners]) listener();
  }

  function open(pairing: StoredPairing): DesktopEntry {
    const keys = pairingKeys(pairing);
    const connection = createDesktopConnection({
      pairing: { pairingId: pairing.pairingId, pairKey: keys.pairKey },
      crypto: deps.crypto,
      session: deps.session,
      openLink: (kind, handlers) =>
        kind === "relay"
          ? createRelayLink({
              socketFactory: deps.socketFactory,
              relayUrl: pairing.relayUrl,
              pairingId: pairing.pairingId,
              phoneToken: keys.phoneToken,
              handlers,
            })
          : null, // T10 adds the LAN link here
    });
    if (active) connection.start();
    return { summary: summarize(pairing), connection };
  }

  return {
    getEntries: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load() {
      const pairings = await deps.store.list();
      for (const entry of entries) entry.connection.stop();
      stored.clear();
      for (const pairing of pairings) stored.set(pairing.pairingId, pairing);
      publish(pairings.map(open));
    },
    async addPairing(pairing) {
      await deps.store.save(pairing);
      stored.set(pairing.pairingId, pairing);
      publish([...entries.filter((e) => e.summary.pairingId !== pairing.pairingId), open(pairing)]);
    },
    async forget(pairingId) {
      const entry = entries.find((e) => e.summary.pairingId === pairingId);
      const pairing = stored.get(pairingId);
      if (entry === undefined || pairing === undefined) return { revokedOnRelay: true };
      entry.connection.stop();
      // A desktop that already revoked this phone has nothing left on the relay to delete.
      const alreadyGone = entry.connection.getSnapshot().status === "revoked";
      const revokedOnRelay =
        alreadyGone ||
        (await revokeOnRelay({
          socketFactory: deps.socketFactory,
          relayUrl: pairing.relayUrl,
          pairingId,
          phoneToken: pairing.phoneToken,
        }));
      await deps.store.remove(pairingId);
      stored.delete(pairingId);
      publish(entries.filter((e) => e.summary.pairingId !== pairingId));
      return { revokedOnRelay };
    },
    setActive(next) {
      active = next;
      for (const entry of entries) {
        if (next) entry.connection.start();
        else entry.connection.stop();
      }
    },
    find: (pairingId) => entries.find((e) => e.summary.pairingId === pairingId) ?? null,
  };
}
