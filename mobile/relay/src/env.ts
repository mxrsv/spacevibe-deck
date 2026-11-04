import type { PairingRoom } from "./pairing-room";

/** Bindings of the relay Worker (`wrangler.jsonc`) and its secrets. */
export interface Env {
  readonly PAIRINGS: DurableObjectNamespace<PairingRoom>;
  /** The iOS app's bundle id; APNs rejects a push whose topic is not the token's app. */
  readonly APNS_TOPIC: string;
  /** Secrets, set by the owner with `wrangler secret put`. Absent means push is a counted no-op. */
  readonly APNS_KEY_P8?: string;
  readonly APNS_KEY_ID?: string;
  readonly APNS_TEAM_ID?: string;
}
