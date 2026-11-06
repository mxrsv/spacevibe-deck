import { describe, expect, it } from "vitest";
import { planPush, registrationMessage, type EnvironmentFacts } from "./push-environment";

const facts = (over: Partial<EnvironmentFacts>): EnvironmentFacts => ({
  executionEnvironment: "standalone",
  projectId: null,
  isDev: false,
  pushEnvOverride: null,
  ...over,
});

describe("planPush", () => {
  it("uses Expo's token in Expo Go when an EAS project is configured, else push is unavailable", () => {
    expect(planPush(facts({ executionEnvironment: "storeClient", projectId: "abc" }))).toEqual({
      mode: "expo",
      projectId: "abc",
    });
    expect(planPush(facts({ executionEnvironment: "storeClient" }))).toEqual({
      mode: "unavailable",
      reason: "Push needs a development build or a configured EAS project",
    });
  });

  it("uses the APNs token in a build: sandbox for a debug build, production otherwise", () => {
    expect(planPush(facts({ isDev: true }))).toEqual({ mode: "apns", env: "sandbox" });
    expect(planPush(facts({ isDev: false }))).toEqual({ mode: "apns", env: "production" });
    expect(planPush(facts({ executionEnvironment: "bare", isDev: true }))).toEqual({
      mode: "apns",
      env: "sandbox",
    });
  });

  it("lets app config override the environment, but only to a valid one", () => {
    expect(planPush(facts({ isDev: true, pushEnvOverride: "production" }))).toEqual({
      mode: "apns",
      env: "production",
    });
    expect(planPush(facts({ isDev: false, pushEnvOverride: "sandbox" }))).toEqual({
      mode: "apns",
      env: "sandbox",
    });
    expect(planPush(facts({ isDev: true, pushEnvOverride: "staging" }))).toEqual({
      mode: "apns",
      env: "sandbox",
    });
  });
});

describe("registrationMessage", () => {
  it("is the relay's push-token message with the kind and env of the plan", () => {
    expect(registrationMessage({ mode: "apns", env: "sandbox" }, "ab12cd34ef56")).toEqual({
      t: "push-token",
      kind: "apns",
      token: "ab12cd34ef56",
      env: "sandbox",
    });
    expect(registrationMessage({ mode: "expo", projectId: "p" }, "ExponentPushToken[xyz]")).toEqual(
      {
        t: "push-token",
        kind: "expo",
        token: "ExponentPushToken[xyz]",
        env: "production",
      },
    );
  });

  it("is null without a token or when push is unavailable", () => {
    expect(registrationMessage({ mode: "apns", env: "production" }, null)).toBeNull();
    expect(registrationMessage({ mode: "apns", env: "production" }, "")).toBeNull();
    expect(registrationMessage({ mode: "unavailable", reason: "x" }, "t")).toBeNull();
  });
});
