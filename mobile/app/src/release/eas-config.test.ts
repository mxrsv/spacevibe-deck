import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@protocol/version";
import {
  APPLE_TEAM_ID,
  BUNDLE_ID,
  CHANNEL_PREFIX,
  PROTOCOL_VERSION as CONFIG_PROTOCOL_VERSION,
  IOS_DEPLOYMENT_TARGET,
  RUNTIME_VERSION,
} from "./release";

const root = path.resolve(import.meta.dirname, "../..");
const eas = JSON.parse(readFileSync(path.join(root, "eas.json"), "utf8")) as {
  build: Record<string, { channel?: string; env?: Record<string, string> }>;
  submit: { production: { ios: { appleTeamId: string } } };
};

describe("release configuration (MOB24)", () => {
  it("reads the protocol version the app really speaks", () => {
    expect(CONFIG_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
  });

  it("names the protocol in the runtime version and every channel, so an update never crosses a protocol break", () => {
    expect(RUNTIME_VERSION).toBe(`protocol-${PROTOCOL_VERSION}`);
    expect(CHANNEL_PREFIX).toBe(`protocol-${PROTOCOL_VERSION}`);
    const profiles = Object.entries(eas.build);
    expect(profiles.map(([name]) => name).sort()).toEqual(["development", "preview", "production"]);
    for (const [name, profile] of profiles) {
      expect(profile.channel, `${name} channel`).toBeDefined();
      const channel = profile.channel as string;
      // "protocol-1" and "protocol-1-preview" pass; "protocol-10" must not pass for protocol 1.
      expect(
        channel === CHANNEL_PREFIX || channel.startsWith(`${CHANNEL_PREFIX}-`),
        `${name}: ${channel}`,
      ).toBe(true);
    }
  });

  it("tells the push entitlement rule which profile is building", () => {
    for (const [name, profile] of Object.entries(eas.build)) {
      expect(profile.env?.EAS_BUILD_PROFILE).toBe(name);
    }
  });

  it("pins the deployment target, bundle id and team", () => {
    expect(IOS_DEPLOYMENT_TARGET).toBe("16.4");
    expect(BUNDLE_ID).toBe("dev.spacevibe.deck.mobile");
    expect(eas.submit.production.ios.appleTeamId).toBe(APPLE_TEAM_ID);
    expect(APPLE_TEAM_ID).toBe("DJDD3T8LH7");
  });

  it("the Expo config uses them (deployment target, runtime version, bundle id)", async () => {
    const { default: config } = await import("../../app.config");
    expect(config.runtimeVersion).toBe(RUNTIME_VERSION);
    expect(config.ios?.bundleIdentifier).toBe(BUNDLE_ID);
    const plugins = JSON.stringify(config.plugins);
    expect(plugins).toContain(`"deploymentTarget":"${IOS_DEPLOYMENT_TARGET}"`);
    expect(config.owner).toBeUndefined();
  });
});
