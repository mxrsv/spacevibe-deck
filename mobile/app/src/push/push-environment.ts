import type { ClientToRelay, PushEnv, PushKind } from "@protocol/relay-messages";

/** What `Constants` and the build say about where this app runs. */
export interface EnvironmentFacts {
  /** `Constants.executionEnvironment`: "storeClient" is Expo Go. */
  readonly executionEnvironment: string;
  /** `Constants.expoConfig.extra.eas.projectId`, when the project is configured for EAS. */
  readonly projectId: string | null;
  /** `__DEV__`: a debug (development client) build. */
  readonly isDev: boolean;
  /** `extra.pushEnv` in app.config, an explicit override for unusual builds. */
  readonly pushEnvOverride: string | null;
}

export type PushPlan =
  /** Expo Go cannot load the extension; Expo's push service carries the (generic) notification. */
  | { readonly mode: "expo"; readonly projectId: string }
  /** A development or production build: the APNs device token, with the extension decrypting. */
  | { readonly mode: "apns"; readonly env: PushEnv }
  | { readonly mode: "unavailable"; readonly reason: string };

export const EXPO_GO_UNAVAILABLE = "Push needs a development build or a configured EAS project";

/**
 * Where the token comes from and which APNs host the relay must use. A debug build is signed with
 * the development `aps-environment`, so its tokens only work on the sandbox host; a release build
 * (TestFlight, App Store, ad hoc) uses production. `extra.pushEnv` overrides the rule. Expo Go's
 * tokens always go through Expo's service, which talks to production APNs itself.
 */
export function planPush(facts: EnvironmentFacts): PushPlan {
  if (facts.executionEnvironment === "storeClient") {
    return facts.projectId === null
      ? { mode: "unavailable", reason: EXPO_GO_UNAVAILABLE }
      : { mode: "expo", projectId: facts.projectId };
  }
  const override = facts.pushEnvOverride;
  const env: PushEnv =
    override === "sandbox" || override === "production"
      ? override
      : facts.isDev
        ? "sandbox"
        : "production";
  return { mode: "apns", env };
}

export function tokenKind(plan: Exclude<PushPlan, { mode: "unavailable" }>): PushKind {
  return plan.mode === "expo" ? "expo" : "apns";
}

/** The relay message that registers a token (design §5), or null when there is nothing to register. */
export function registrationMessage(plan: PushPlan, token: string | null): ClientToRelay | null {
  if (plan.mode === "unavailable" || token === null || token === "") return null;
  return {
    t: "push-token",
    kind: tokenKind(plan),
    token,
    env: plan.mode === "expo" ? "production" : plan.env,
  };
}
