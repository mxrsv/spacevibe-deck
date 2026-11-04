# Notification Service Extension (encrypted push)

The relay can only send a generic push ("An agent needs you"). This extension runs on the phone
just before the notification is shown, opens the sealed copy in `d.c` with the pairing's push key
and replaces the title and body with the real text. On any failure (no key, bad tag, timeout) the
generic notification is shown unchanged.

## What the plugin does at prebuild

`withNotificationServiceExtension.js` (in `app.config.ts` `plugins`):

- adds App Group `group.dev.spacevibe.deck.mobile` and Keychain group
  `$(AppIdentifierPrefix)dev.spacevibe.deck.mobile.shared` to the app's entitlements. The shared
  group is the app's only keychain group, so `expo-secure-store` items written without an
  `accessGroup` land in it;
- adds the `NotificationService` target (`dev.spacevibe.deck.mobile.NotificationService`, Swift 5)
  to the generated Xcode project, copying `targets/notification-service/*`;
- registers the extension under `extra.eas.build.experimental.ios.appExtensions` so EAS signs it.

## Where it works

Only in an EAS development or production build. Expo Go cannot load app extensions: there the push
shows the generic line and the app decrypts the payload when it is opened.

## The key contract (app and extension must agree)

Store the push key with `expo-secure-store`:

- `keychainService`: `PUSH_KEYCHAIN_SERVICE` from `constants.js` (the library stores it as
  `<service>:no-auth`)
- key: the pairing id; value: base64url of the 32-byte push key
- `keychainAccessible: AFTER_FIRST_UNLOCK` (the extension runs while the phone is locked)
- no `accessGroup` needed (see above)

`swift-contract.test.ts` pins these strings and `push.ts`'s AAD and layout against the Swift file.

## Owner steps (not performed by any agent)

1. Apple Developer portal: on the App ID `dev.spacevibe.deck.mobile` enable **App Groups**
   (`group.dev.spacevibe.deck.mobile`) and **Keychain Sharing**; create the App ID
   `dev.spacevibe.deck.mobile.NotificationService` with the same two capabilities.
2. Create an APNs key (.p8) and give its key id, team id and contents to the relay as Worker
   secrets `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`.
3. Run an EAS build; let EAS create the provisioning profile for the extension.
