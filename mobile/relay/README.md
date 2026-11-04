# Deck mobile relay

The relay the iPhone companion and the desktop meet at. It is a Cloudflare Worker with one
Durable Object per pairing, and it is **blind**: the phone and the desktop seal every frame with
keys the relay never sees (spec MOB7), so the relay only pairs two sockets and forwards bytes.
The design contract is spec [MOB2, MOB6–8, MOB22–23](../../docs/specs/2026-11-04-mobile-companion.md)
`current`; the message parsers, close codes and limits are in [`protocol/`](../protocol/src/relay-messages.ts)
`current`. The Worker is [`src/index.ts`](src/index.ts) `current`, the pairing object is
[`src/pairing-room.ts`](src/pairing-room.ts) `current`, the push sender is [`src/push.ts`](src/push.ts)
`current`, and the deployment configuration is [`wrangler.jsonc`](wrangler.jsonc) `current`.

## Routes

The Worker is routed at `api.deck.spacevibe.dev/relay/*` and strips a leading `/relay`, so
`wrangler dev` serves the same paths at `/`.

| Route                              | Does                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/health`                   | `{ ok: true, protocol }`                                                                                                   |
| `POST /v1/pairings`                | Registers a pairing (JSON, at most 4 KiB). 201; 409 if the id exists; 400 for a bad body or an `expiresAt` in the past or more than 10 minutes ahead |
| `GET /v1/pairings/:id/socket`      | WebSocket upgrade into that pairing's Durable Object (`idFromName(id)`); 426 without an upgrade                            |

Everything else is 404. After the upgrade the socket speaks the JSON text messages of
`relay-messages.ts` (`auth`, `claim`, `push-token`, `push`, `revoke`, `ping` in; `ready`, `peer`,
`revoked`, `error`, `pong` out) and forwards **binary** messages between the two roles.

## What it stores, and what it never stores

One record per pairing, under the single Durable Object storage key `pairing`: the pairing id, the
SHA-256 hashes of the desktop token, the phone token and the claim token, the expiry and creation
times, the two last-seen times, and the phone's push token (kind, token, sandbox or production).

It never stores or logs frame bytes, push payloads, raw tokens, request headers or IP addresses.
The only log line is `{ event, n }` from a closed vocabulary ([`src/log.ts`](src/log.ts) `current`),
and invocation logs are off because a request URL contains the pairing id. The canary test
([`src/canary.test.mjs`](src/canary.test.mjs) `current`) pushes known strings through a pairing and
scans every stored key and every log line for them.

An unclaimed pairing is deleted by an alarm at its expiry; `revoke` from either side deletes
everything at once and later connects get `unknown`. Sockets use the Hibernation API, so an idle
pairing costs no duration, and keep-alive pings are answered by the runtime without waking it.

## Limits

From [`protocol/src/limits.ts`](../protocol/src/limits.ts) `current`, enforced per pairing because
the relay has no accounts: frames up to 128 KiB (`4413`), 400 messages per 10 s per socket as a
token bucket (`4429`), two live sockets per role (a newer one closes the oldest with `4430`), 30
pushes a minute (extra pushes are dropped, not errors), 10 s to authenticate (`4400`).
Registration is unauthenticated by design, so it is limited to 10 per minute per client address
by the Workers Rate Limiting binding `REGISTER_LIMITER` (429 over it; the address is a rate-limit
key held by Cloudflare, never stored or logged by the relay). An unclaimed pairing vanishes after
at most 10 minutes. A claimed one is deleted by an alarm once both sides have been absent for 30
days (`RELAY_IDLE_PAIRING_MS`); the alarm is set when the last socket leaves and cleared when one
returns, never per message. At most 4 sockets per pairing may wait unauthenticated; a newer one
closes the oldest with `auth-timeout`, so knowing a pairing id cannot slow a live pairing.

The per-socket rate buckets and the push window live in memory and reset when the object
hibernates. That is accepted: persisting them would cost a storage write per message.

The relay uses up the claim before the desktop sees the phone's proof (`pair-hello`). A socket
that drops right after the claim therefore burns that QR; the desktop then shows a new code.

## Run locally

```sh
cd mobile/relay
npm install
npm run dev     # wrangler dev on 0.0.0.0:8787, so a phone on the same Wi-Fi can reach it
npm run check   # typecheck + tests (Miniflare, no Cloudflare account needed)
npm run build   # wrangler deploy --dry-run --outdir dist
```

Point a development Deck at it with `DECK_RELAY_URL=http://<mac-lan-ip>:8787 npm run electron:dev`;
the QR then carries that `http://` address and the phone connects to it directly. Push is a no-op
locally unless you export the three APNs secrets into a `.dev.vars` file (git-ignored here; never commit it).

## Deploy (owner actions, not run by agents)

1. Create an APNs key (Certificates, Identifiers & Profiles, Keys, enable Apple Push Notifications)
   and note its Key ID and your Team ID.
2. From `mobile/relay/`, with a logged-in Wrangler:

   ```sh
   npx wrangler secret put APNS_KEY_P8     # paste the .p8 file's contents
   npx wrangler secret put APNS_KEY_ID
   npx wrangler secret put APNS_TEAM_ID
   npx wrangler deploy
   ```

   `APNS_TOPIC` is a plain variable in `wrangler.jsonc` (`dev.spacevibe.deck.mobile`).
3. `wrangler.jsonc` routes `api.deck.spacevibe.dev/relay/*` on zone `spacevibe.dev`. The analytics
   Worker owns the rest of `api.deck.spacevibe.dev` as a custom domain; confirm in the dashboard
   that the more specific route wins before relying on it.
4. The Durable Object class is SQLite-backed (`new_sqlite_classes`), which the Workers Free plan
   allows. Deployment does not publish a desktop or phone release.

## Open question: APNs over HTTP/2 from a Worker

APNs requires HTTP/2. Whether a Worker's `fetch` negotiates HTTP/2 to `api.push.apple.com` is
**unverified** (spec Risks, S2) and can only be checked after deploy: pair a development build,
send a push, and read the `push-sent` or `push-failed` counts in the Worker's logs. If it fails,
the Expo push path (`kind: "expo"`, also what Expo Go uses) already works through `exp.host`,
and a small HTTP/2 forwarder would be the next step. The sealed push is carried whole in the APNs
payload, which Apple limits to 4 KiB, so the desktop keeps sealed pushes well under the 4 KiB
relay limit.

## Tests

`node --test src/*.test.mjs` bundles the Worker with esbuild, runs it in Miniflare with real
WebSockets and Durable Objects, and replaces the outbound network with a fake, so no test reaches
Apple or Expo. A timer test waits for the 10 s auth timeout, so the suite takes about 15 seconds.
