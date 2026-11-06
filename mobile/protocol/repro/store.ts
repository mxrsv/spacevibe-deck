/** The repro client's pairing file. Plaintext on purpose: it is a developer tool, never shipped. */
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export interface ReproPairing {
  readonly version: 1;
  readonly relayUrl: string;
  readonly pairingId: string;
  readonly desktopName: string;
  readonly pairedAt: number;
  /** base64url of each secret below. */
  readonly phoneToken: string;
  readonly pairKey: string;
}

export const DEFAULT_STORE = "./.deck-repro.json";

export function loadPairing(file: string): ReproPairing | null {
  if (!existsSync(file)) return null;
  const value = JSON.parse(readFileSync(file, "utf8")) as Partial<ReproPairing>;
  if (value.version !== 1 || typeof value.pairingId !== "string") {
    throw new Error(`${file} is not a repro pairing file`);
  }
  return value as ReproPairing;
}

export function savePairing(file: string, pairing: ReproPairing): void {
  writeFileSync(file, JSON.stringify(pairing, null, 2) + "\n", { mode: 0o600 });
  // `mode` only applies when the file is created; tighten one that already existed.
  chmodSync(file, 0o600);
  console.error(
    `Saved ${file} (mode 0600). It holds this pairing's keys in plaintext because this is a dev tool: delete it when you are done.`,
  );
}

export function deletePairing(file: string): void {
  if (existsSync(file)) unlinkSync(file);
}
