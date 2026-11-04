# SpaceVibe Deck for iPhone (Expo app)

The phone companion to SpaceVibe Deck: see every agent pane on your desktops, and answer the ones
that need you. Spec: [mobile-companion](../../docs/specs/2026-11-04-mobile-companion.md). The wire
protocol is shared with the desktop and the relay in [`../protocol`](../protocol).

## Run it on your iPhone (a Mac with no Xcode)

1. Install **Expo Go** from the App Store on the iPhone.
2. From the repository root: `npm --prefix mobile run setup` (installs `mobile/`, the relay and this app).
3. `cd mobile/app && npx expo start`, then scan the QR code in the terminal with the iPhone's Camera
   app; it opens in Expo Go. The Mac and the iPhone must be on the same network. If they are not,
   use `npx expo start --tunnel`.
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
