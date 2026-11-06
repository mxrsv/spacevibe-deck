import type { LanAddress } from "@protocol/messages";

/** At most this many addresses are tried, in the order the desktop lists them. */
export const MAX_LAN_CANDIDATES = 4;

/** 10/8, 172.16/12, 192.168/16: the private ranges the desktop listens on. Never loopback, link-local, CGNAT or public. */
export function isPrivateIPv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = octets;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * The addresses worth trying out of what the desktop sent. The desktop is trusted for its own
 * name but not for where the phone connects: anything but a private IPv4 address with a real
 * port is ignored, so a confused or hostile desktop cannot aim the phone at a public host.
 */
export function lanCandidates(offered: readonly LanAddress[]): LanAddress[] {
  const seen = new Set<string>();
  const out: LanAddress[] = [];
  for (const { host, port } of offered) {
    if (!isPrivateIPv4(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    const key = `${host}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ host, port });
    if (out.length >= MAX_LAN_CANDIDATES) break;
  }
  return out;
}

export function sameAddresses(a: readonly LanAddress[], b: readonly LanAddress[]): boolean {
  return a.length === b.length && a.every((x, i) => x.host === b[i].host && x.port === b[i].port);
}

export function lanSocketUrl(address: LanAddress, pairingId: string): string {
  return `ws://${address.host}:${address.port}/v1/${pairingId}/socket`;
}
