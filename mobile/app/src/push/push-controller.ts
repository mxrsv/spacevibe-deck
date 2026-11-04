import type { ClientToRelay } from "@protocol/relay-messages";
import {
  planPush,
  registrationMessage,
  type EnvironmentFacts,
  type PushPlan,
} from "./push-environment";

export type PermissionStatus = "granted" | "denied" | "undetermined";

/** The platform calls the controller needs, so it runs in plain Node under test. */
export interface NotificationApi {
  permission(): Promise<PermissionStatus>;
  requestPermission(): Promise<PermissionStatus>;
  /** The Expo push token (Expo Go) or the APNs device token (builds). */
  token(plan: Exclude<PushPlan, { mode: "unavailable" }>): Promise<string>;
  /** Drops the remote-notification registration (the OFF switch). */
  unregister(): Promise<void>;
}

export type PushStatus =
  | { readonly state: "unavailable"; readonly reason: string }
  | { readonly state: "off" }
  | { readonly state: "denied" }
  | { readonly state: "on" }
  | { readonly state: "error" };

export interface PushController {
  readonly plan: PushPlan;
  status(): PushStatus;
  subscribe(listener: () => void): () => void;
  /**
   * Brings the registration in line with the preference. `ask` allows the OS permission prompt:
   * pass it only when the user did something that explains it (turning the switch on, finishing
   * a pairing), never at launch.
   */
  sync(wanted: boolean, ask: boolean): Promise<void>;
  /** The token rotated (the OS told us): fetch the current one again. */
  refreshToken(): Promise<void>;
  /** What to tell the relay on every `ready`: null while off, denied, unavailable or without a token. */
  registration(): ClientToRelay | null;
}

export function createPushController(
  facts: EnvironmentFacts,
  api: NotificationApi,
): PushController {
  const plan = planPush(facts);
  const listeners = new Set<() => void>();
  let status: PushStatus =
    plan.mode === "unavailable" ? { state: "unavailable", reason: plan.reason } : { state: "off" };
  let token: string | null = null;
  let wantedNow = false;

  const set = (next: PushStatus): void => {
    status = next;
    for (const listener of [...listeners]) listener();
  };

  async function fetchToken(): Promise<void> {
    if (plan.mode === "unavailable") return;
    try {
      token = await api.token(plan);
      set({ state: "on" });
    } catch {
      token = null;
      set({ state: "error" });
    }
  }

  return {
    plan,
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async sync(wanted, ask) {
      if (plan.mode === "unavailable") return;
      wantedNow = wanted;
      if (!wanted) {
        // OFF: stop the OS registration and never re-register. The relay has no "clear" message, so
        // its stored token stays until the next one replaces it; with this phone no longer asking
        // the OS for one, and a revoke deleting the pairing, that is the whole off switch.
        token = null;
        await api.unregister().catch(() => {});
        set({ state: "off" });
        return;
      }
      let permission = await api.permission();
      if (permission === "undetermined" && ask) permission = await api.requestPermission();
      if (!wantedNow) return; // switched off while the prompt was up
      if (permission === "denied") {
        token = null;
        set({ state: "denied" });
        return;
      }
      if (permission === "undetermined") {
        set({ state: "off" }); // wanted, but not asked yet: nothing is registered
        return;
      }
      await fetchToken();
    },
    async refreshToken() {
      if (wantedNow && status.state === "on") await fetchToken();
    },
    registration: () => (status.state === "on" ? registrationMessage(plan, token) : null),
  };
}
