/**
 * The phone ↔ desktop protocol version (spec MOB10). Both sides send it in the handshake; a peer
 * outside `[PROTOCOL_MIN, PROTOCOL_VERSION]` is refused and told which side must update. Raise
 * `PROTOCOL_VERSION` for any change a peer one version older cannot read, and `PROTOCOL_MIN` when
 * this side stops reading the older shape. EAS Update ships on one channel per version (MOB24), so
 * an over-the-air update never crosses a break.
 */
export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MIN = 1;

export type VersionVerdict = "ok" | "update-phone" | "update-desktop";

/**
 * Whether two peers can talk, judged by either side from both ranges. The side whose newest
 * version is below the other's minimum is the one to update.
 */
export function judgeVersion(
  phone: { readonly version: number; readonly min: number },
  desktop: { readonly version: number; readonly min: number },
): VersionVerdict {
  if (phone.version < desktop.min) return "update-phone";
  if (desktop.version < phone.min) return "update-desktop";
  return "ok";
}
