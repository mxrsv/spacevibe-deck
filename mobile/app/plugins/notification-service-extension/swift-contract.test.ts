import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) => readFileSync(path.resolve(here, relative), "utf8");
const require = createRequire(import.meta.url);
const constants = require("./constants.js") as typeof import("./constants");
const plugin = require("./withNotificationServiceExtension.js") as {
  (config: object): { mods?: { ios?: Record<string, unknown> }; extra?: any };
  applyAppEntitlements(entitlements: object): Record<string, unknown>;
  applyEasExtension(config: object): { extra: any };
  extensionEntitlements(): Record<string, unknown>;
};

const swift = read("../../targets/notification-service/NotificationService.swift");
const infoPlist = read("../../targets/notification-service/Info.plist");
const entitlementsPlist = read(
  "../../targets/notification-service/NotificationService.entitlements",
);
const pushTs = read("../../../protocol/src/push.ts");
const keysTs = read("../../../protocol/src/keys.ts");

describe("Swift extension ↔ push.ts contract", () => {
  it("opens with the same AAD the sender seals with", () => {
    const aad = /AAD_PUSH = "([^"]+)"/.exec(keysTs)?.[1];
    expect(aad).toBe("deck/v1/push");
    expect(pushTs).toContain("AAD_PUSH");
    expect(swift).toContain(`Data("${aad}".utf8)`);
  });

  it("splits a 12-byte nonce and a 16-byte tag like sealPush lays them out", () => {
    expect(pushTs).toMatch(/NONCE_BYTES = 12/);
    expect(swift).toMatch(/nonceLength = 12/);
    expect(swift).toMatch(/tagLength = 16/);
    expect(swift).toContain("ChaChaPoly.open");
  });

  it("reads the push envelope keys d.p and d.c and the payload fields push.ts writes", () => {
    expect(swift).toContain('userInfo["d"]');
    expect(swift).toContain('d?["p"]');
    expect(swift).toContain('d?["c"]');
    for (const field of ["title", "body", "paneId", "kind"]) {
      expect(pushTs).toContain(`${field}`);
      expect(swift).toContain(`json["${field}"]`);
    }
  });

  it("never hands the app a route: it strips paneId, pairingId and kind from userInfo on every path", () => {
    expect(swift).toContain('untrustedKeys = ["paneId", "pairingId", "kind"]');
    expect(swift).not.toContain('userInfo["paneId"] =');
    expect(swift).not.toContain('userInfo["pairingId"] =');
    expect(swift).toContain("deliver(Self.stripped(request.content))");
    expect(swift).toContain("self.original = Self.stripped(request.content)");
  });

  it("looks the key up with the service, access group and key encoding the app writes", () => {
    // expo-secure-store appends ":no-auth" to the service when requireAuthentication is false.
    expect(swift).toContain(`"${constants.PUSH_KEYCHAIN_SERVICE}:no-auth"`);
    expect(swift).toContain(`"${constants.ACCESS_GROUP_INFO_KEY}"`);
    expect(swift).toContain("kSecAttrGeneric as String: Data(pairingId.utf8)");
    for (const file of [infoPlist, entitlementsPlist]) {
      expect(file).toContain(constants.KEYCHAIN_ACCESS_GROUP);
    }
    expect(infoPlist).toContain(`<key>${constants.ACCESS_GROUP_INFO_KEY}</key>`);
    expect(entitlementsPlist).toContain(constants.APP_GROUP);
  });

  it("registers as a user-notifications service extension", () => {
    expect(infoPlist).toContain("com.apple.usernotifications.service");
    expect(infoPlist).toContain("$(PRODUCT_MODULE_NAME).NotificationService");
    expect(swift).toContain("class NotificationService: UNNotificationServiceExtension");
  });

  it("falls back to the original content on failure and on expiry, and logs nothing", () => {
    expect(swift).toContain("serviceExtensionTimeWillExpire");
    expect(swift).toContain("deliver(request.content)");
    expect(swift).not.toMatch(/\b(print|NSLog|os_log|Logger)\b/);
  });
});

describe("config plugin", () => {
  it("adds the app group and the shared keychain group to the app's entitlements", () => {
    const result = plugin.applyAppEntitlements({
      "aps-environment": "development",
      "com.apple.security.application-groups": ["group.other"],
    });
    expect(result).toEqual({
      "aps-environment": "development",
      "com.apple.security.application-groups": ["group.other", constants.APP_GROUP],
      "keychain-access-groups": [constants.KEYCHAIN_ACCESS_GROUP],
    });
    expect(plugin.applyAppEntitlements(result)).toEqual(result);
  });

  it("registers the extension for EAS once, keeping other extensions", () => {
    const base = {
      name: "x",
      slug: "x",
      extra: {
        eas: { build: { experimental: { ios: { appExtensions: [{ targetName: "Other" }] } } } },
      },
    };
    const once = plugin.applyEasExtension(base);
    const twice = plugin.applyEasExtension(once);
    const extensions = twice.extra.eas.build.experimental.ios.appExtensions;
    expect(extensions).toEqual([
      { targetName: "Other" },
      {
        targetName: constants.NSE_TARGET_NAME,
        bundleIdentifier: constants.NSE_BUNDLE_ID,
        entitlements: plugin.extensionEntitlements(),
      },
    ]);
    expect(constants.NSE_BUNDLE_ID).toBe("dev.spacevibe.deck.mobile.NotificationService");
  });

  it("hooks the entitlements and Xcode project mods on a minimal config", () => {
    const config = plugin({
      name: "x",
      slug: "x",
      ios: { bundleIdentifier: constants.MAIN_BUNDLE_ID },
    });
    expect(Object.keys(config.mods?.ios ?? {}).sort()).toEqual(["entitlements", "xcodeproj"]);
    expect(config.extra.eas.build.experimental.ios.appExtensions).toHaveLength(1);
  });
});
