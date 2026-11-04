// Expo config plugin: adds the NotificationService extension that decrypts sealed pushes.
// Applied at prebuild only, so it never touches Expo Go. See README.md.
const path = require("node:path");
const { withEntitlementsPlist, withXcodeProject } = require("expo/config-plugins");
const { APP_GROUP, KEYCHAIN_ACCESS_GROUP, NSE_BUNDLE_ID, NSE_TARGET_NAME } = require("./constants");
const { addExtensionTarget } = require("./add-extension-target");

const TARGET_DIR = path.resolve(__dirname, "../../targets/notification-service");

/**
 * The extension's entitlements. Also written into targets/.../NotificationService.entitlements
 * and handed to EAS, which signs app extensions from this list rather than from the project.
 */
function extensionEntitlements() {
  return {
    "com.apple.security.application-groups": [APP_GROUP],
    "keychain-access-groups": [KEYCHAIN_ACCESS_GROUP],
  };
}

/**
 * The main app's entitlements. The shared keychain group is the app's only (hence default) group,
 * so expo-secure-store items written without an `accessGroup` land where the extension can read.
 */
function applyAppEntitlements(entitlements) {
  const groups = new Set(entitlements["com.apple.security.application-groups"] ?? []);
  groups.add(APP_GROUP);
  return {
    ...entitlements,
    "com.apple.security.application-groups": [...groups],
    "keychain-access-groups": [KEYCHAIN_ACCESS_GROUP],
  };
}

function applyEasExtension(config) {
  const extra = config.extra ?? {};
  const eas = extra.eas ?? {};
  const build = eas.build ?? {};
  const experimental = build.experimental ?? {};
  const ios = experimental.ios ?? {};
  const others = (ios.appExtensions ?? []).filter((entry) => entry.targetName !== NSE_TARGET_NAME);
  return {
    ...config,
    extra: {
      ...extra,
      eas: {
        ...eas,
        build: {
          ...build,
          experimental: {
            ...experimental,
            ios: {
              ...ios,
              appExtensions: [
                ...others,
                {
                  targetName: NSE_TARGET_NAME,
                  bundleIdentifier: NSE_BUNDLE_ID,
                  entitlements: extensionEntitlements(),
                },
              ],
            },
          },
        },
      },
    },
  };
}

function withNotificationServiceExtension(config) {
  const withEas = applyEasExtension(config);
  const withEntitlements = withEntitlementsPlist(withEas, (modConfig) => {
    modConfig.modResults = applyAppEntitlements(modConfig.modResults);
    return modConfig;
  });
  return withXcodeProject(withEntitlements, (modConfig) => {
    addExtensionTarget(modConfig.modResults, {
      sourceDir: TARGET_DIR,
      iosDir: modConfig.modRequest.platformProjectRoot,
      version: modConfig.version ?? "1.0.0",
      buildNumber: modConfig.ios?.buildNumber ?? "1",
      teamId: modConfig.ios?.appleTeamId,
    });
    return modConfig;
  });
}

module.exports = withNotificationServiceExtension;
module.exports.applyAppEntitlements = applyAppEntitlements;
module.exports.applyEasExtension = applyEasExtension;
module.exports.extensionEntitlements = extensionEntitlements;
