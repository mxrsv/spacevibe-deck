# SpaceVibe Deck for iPhone (Expo app)

The phone companion to SpaceVibe Deck: see every agent pane on your desktops, and answer the ones
that need you. Spec: [mobile-companion](../../docs/specs/2026-11-04-mobile-companion.md). The wire
protocol is shared with the desktop and the relay in [`../protocol`](../protocol).

## Run it on your iPhone (a Mac with no Xcode)

1. Install **Expo Go** from the App Store on the iPhone.
2. From the repository root: `npm --prefix mobile run setup` (installs `mobile/`, the relay and this app).
3. `cd mobile/app && npx expo start --go` (or `npm start`, which adds `--go`), then scan the QR code in the terminal with the iPhone's Camera
   app; it opens in Expo Go. The Mac and the iPhone must be on the same network. If they are not,
   use `npx expo start --go --tunnel`. The `--go` matters: with `expo-dev-client` installed, a plain
   `expo start` serves a development build, and Expo Go cannot open its QR code.
4. In Deck on the computer: Settings → Mobile → Pair a phone. In the app: Settings → Pair a desktop,
   and scan the code. No camera (the Simulator)? Choose "Enter the code by hand" and paste the
   `deck-pair:` text.

For the pairing to work the desktop and the phone must reach the same relay
(`DECK_RELAY_URL`, default `https://api.deck.spacevibe.dev/relay`). To try against a local
`wrangler dev` relay, start Deck with `DECK_RELAY_URL=http://<your-mac-ip>:8787/relay` in an
unpackaged run.

## What does not work in Expo Go

- **Encrypted push** needs the Notification Service Extension (Swift, reads the push key from the
  shared Keychain group). Expo Go cannot load it: that needs a development build or a TestFlight
  build (a later task). Expo Go gets only the generic "An agent needs you" line, if at all.
- **The Keychain access group** the extension shares is not available to Expo Go's own sandbox;
  pairings made in Expo Go are stored under Expo Go and are lost when it is deleted.

## Checks

`npm run check` here (also run by `npm --prefix mobile run check`):

- `typecheck`: `tsc` for the app (no Node types, so Node-only code cannot slip into it), then for tests.
- `lint`: oxlint with `--deny-warnings`.
- `test`: vitest, pure modules only (crypto, pairing flow, session and connection logic, stores).
- `bundle`: `expo export --platform ios` into a temp directory outside the repo, proving Metro can
  bundle the app without Xcode.

## Layout

- `src/app/`: Expo Router routes. Tabs: Desktops, Settings. Modal: pair. Detail: `desktop/[id]`.
- `src/crypto/`: the noble-based `CryptoProvider`, checked against `protocol/src/test-vectors.json`.
- `src/pairing/`: scan, parse, claim, pair-hello, Keychain store (several desktops per phone).
- `src/session/`: relay link, secure channel, RPC, reconnect, version verdicts, `revoke`. A new
  transport (the LAN path, T10) implements `Link` in `relay-link.ts`.
- `src/lock/`: Face ID or passcode at launch and after 5 minutes in the background.
- `src/desktops/desktop-tree.tsx`: the placeholder T7 fills with each desktop's tree.
- `src/theme/`, `src/ui/`: tokens from the direction mock, iOS text styles, small shared pieces.

## Release (steps for the owner; none has been performed)

Nothing here is run by the repository's checks, and no agent runs `eas` against an account.
The configuration is in `eas.json`, `app.config.ts` and `src/release/release.ts`.

**Rule: bump the channels with the protocol.** The runtime version and every EAS channel in
`eas.json` start with `protocol-<PROTOCOL_VERSION>`. When `PROTOCOL_VERSION` in
`../protocol/src/version.ts` changes, change the channels in `eas.json` to match; `npm run check`
fails until you do (`src/release/eas-config.test.ts`). That keeps a JavaScript update from ever
reaching a binary built for another protocol.

Minimum iOS: 16.4 (Expo SDK 58's minimum, `IOS_DEPLOYMENT_TARGET`; React Native 0.88 alone would allow 15.1, but `expo-build-properties` refuses anything lower).

1. `eas init` creates the EAS project and prints its id. Export it for every build and update:
   `EAS_PROJECT_ID=<id>`. Without it the app has no update URL, and Expo Go and local runs are
   unaffected. The `owner` field is left unset so the project belongs to your account.
2. App Store Connect: create the app record for `dev.spacevibe.deck.mobile`, then put its numeric
   App Store Connect app id into `eas.json` (`submit.production.ios.ascAppId`, now a placeholder).
3. Apple Developer portal (team `DJDD3T8LH7`): on the App ID `dev.spacevibe.deck.mobile` and on
   `dev.spacevibe.deck.mobile.NotificationService` enable Push Notifications, App Groups
   (`group.dev.spacevibe.deck.mobile`) and Keychain Sharing.
4. Create an APNs key (.p8) and give its key id, team id and contents to the relay as Worker
   secrets `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`.
5. Your iPhone: register it under the team, then `eas build --profile development --platform ios`
   and install the build. This is the build with encrypted push and the extension.
6. TestFlight public beta: `eas build --profile production --platform ios`, then
   `eas submit --profile production --platform ios`. The first build of a public beta goes through
   Beta App Review.
7. JavaScript-only updates to builds of the current protocol:
   `eas update --channel protocol-1 --message "..."`.

### Expo Go, tomorrow (no account)

`npm --prefix mobile run setup`, then `cd mobile/app && npx expo start --go`, and open it in Expo Go
(see above). Pairing, the terminal, files, changes, usage and the LAN path work. The only thing that
needs an Expo account is push in Expo Go (an EAS project id for Expo's token), and encrypted push
needs the development build from step 5.
