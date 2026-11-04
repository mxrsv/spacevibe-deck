// Shared by the config plugin and the app (CommonJS so both a Node config plugin and Metro can
// load it). The Swift extension repeats these strings; swift-contract.test.ts pins them together.
const MAIN_BUNDLE_ID = "dev.spacevibe.deck.mobile";
const NSE_TARGET_NAME = "NotificationService";
const NSE_BUNDLE_ID = `${MAIN_BUNDLE_ID}.${NSE_TARGET_NAME}`;
const APP_GROUP = `group.${MAIN_BUNDLE_ID}`;
// `$(AppIdentifierPrefix)` is the team id plus a dot; Xcode fills it in when it signs.
const KEYCHAIN_ACCESS_GROUP = `$(AppIdentifierPrefix)${MAIN_BUNDLE_ID}.shared`;
// expo-secure-store `keychainService` for the push key; the library appends ":no-auth".
const PUSH_KEYCHAIN_SERVICE = `${MAIN_BUNDLE_ID}.push`;
// Info.plist key (in the extension) that carries the resolved access group string.
const ACCESS_GROUP_INFO_KEY = "DeckKeychainAccessGroup";

module.exports = {
  MAIN_BUNDLE_ID,
  NSE_TARGET_NAME,
  NSE_BUNDLE_ID,
  APP_GROUP,
  KEYCHAIN_ACCESS_GROUP,
  PUSH_KEYCHAIN_SERVICE,
  ACCESS_GROUP_INFO_KEY,
};
