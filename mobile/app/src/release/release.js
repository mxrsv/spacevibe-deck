// CommonJS on purpose: `app.config.ts` is loaded by Expo's config loader, which cannot resolve
// TypeScript modules it imports. The protocol version is read from its source file rather than
// imported for the same reason; eas-config.test.ts checks it against the real export.
const fs = require("node:fs");
const path = require("node:path");

const versionSource = fs.readFileSync(
  path.resolve(__dirname, "../../../protocol/src/version.ts"),
  "utf8",
);
const match = /export const PROTOCOL_VERSION = (\d+);/.exec(versionSource);
if (match === null) throw new Error("PROTOCOL_VERSION not found in mobile/protocol/src/version.ts");
const PROTOCOL_VERSION = Number(match[1]);

module.exports = {
  /** Expo SDK 58's minimum (expo-build-properties refuses less; React Native 0.88 alone would allow 15.1). */
  IOS_DEPLOYMENT_TARGET: "16.4",
  BUNDLE_ID: "dev.spacevibe.deck.mobile",
  APPLE_TEAM_ID: "DJDD3T8LH7",
  PROTOCOL_VERSION,
  // Binaries and over-the-air updates only meet when they speak the same protocol (MOB24): the
  // runtime version of a build names its protocol, and so does every EAS update channel.
  RUNTIME_VERSION: `protocol-${PROTOCOL_VERSION}`,
  CHANNEL_PREFIX: `protocol-${PROTOCOL_VERSION}`,
};
