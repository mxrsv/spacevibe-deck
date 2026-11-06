# Mobile companion

> For maintainers. Using Deck? See [docs/user/](../user/).

The iPhone companion pairs with a running Deck and reaches every pane through it. The desktop
stays the source of truth: the phone is a view and a keyboard, and nothing runs on it. The whole
feature sits behind the `mobileCompanion` release switch in
[`release-switches.ts`](../../src/lib/release-switches.ts); with it off, Deck builds no service,
shows no Settings section, opens no relay socket and listens on no port. The requirements are in
the [spec](../specs/2026-11-04-mobile-companion.md).

## Three code bases, one contract

`mobile/` holds three packages, each with its own lockfile, run by `npm run mobile:check`. The
root's lint, `tsc`, vitest and prettier skip it on purpose.

- [`mobile/protocol/`](../../mobile/protocol/src/index.ts) is plain TypeScript with no
  dependencies: message types and parsers, the protocol version, framing, key derivation and the
  secure channel. The desktop, the relay and the phone all import it. Its core files compile under
  the root's TS 5.6 with CommonJS and Node types and under the app's TS 6 with React Native types,
  so they use no Node globals, no DOM, no `URL` setters and no WebCrypto. Only
  [`crypto-node.ts`](../../mobile/protocol/src/crypto-node.ts) touches `node:crypto`.
- [`mobile/relay/`](../../mobile/relay/README.md) is the Cloudflare Worker at
  `api.deck.spacevibe.dev/relay/*`, one Durable Object per pairing.
- [`mobile/app/`](../../mobile/app/README.md) is the Expo app. It runs in Expo Go except for the
  push extension, which needs an EAS build.

The desktop side is [`electron/mobile/`](../../electron/mobile/service.ts) plus a renderer
bridge, [`mobile-bridge.ts`](../../src/terminal/mobile-bridge.ts).

## Pairing

One pairing is one desktop and one phone. Three phones on one desktop are three pairings, each
with its own keys. The desktop creates a pairing id, a one-time secret, its own X25519 key pair and
a bearer token, and registers the pairing with the relay. The QR holds the relay URL, the id, the
desktop's public key, the secret, the expiry (five minutes) and the desktop's name
([`qr.ts`](../../mobile/protocol/src/qr.ts)).

The relay never sees the secret. It gets `sha256(claimToken)`, where `claimToken` is an HKDF of the
secret, so the phone can claim the pairing at the relay once, but the relay cannot produce the
phone's proof. That proof is the `pair-hello` box: sealed with a key derived from the X25519 secret
and the QR secret ([`pairing.ts`](../../mobile/protocol/src/pairing.ts)). The desktop opens it,
marks the secret used and stores the record. A second `pair-hello`, valid or not, is refused as
`used`, and both sides refuse an expired code. A bad proof does not burn the code on the desktop,
but the relay's claim is spent by the first phone that makes it, so a phone that drops after
claiming needs a new code.

Keys live in `safeStorage` on the desktop (`mobile-pairings.json`, one encrypted envelope, the way
[`session-store.ts`](../../electron/account/session-store.ts) keeps the account) and in the
Keychain on the phone. When `safeStorage` cannot encrypt, pairing is refused with a reason; there is
no plaintext fallback. An unreadable pairings file is write-locked like every other store.

## The secure channel

Every transport, relay socket or LAN socket, starts a fresh session
([`channel.ts`](../../mobile/protocol/src/channel.ts)). The phone sends `hello` with an ephemeral
X25519 key, the desktop answers `welcome` with its own, and both derive the session's two
directional ChaCha20-Poly1305 keys from that exchange, salted with the pairing key and bound to the
handshake transcript ([`keys.ts`](../../mobile/protocol/src/keys.ts)). A relay that swaps an
ephemeral key or a version field derives nothing useful, and the first sealed frame fails.

- **Counters are per session and in order.** A frame that fails to open is dropped and counted,
  never logged; sixteen failures close the session. Because keys are new on every connection, a
  restart or a second transport can never reuse a nonce.
- **The desktop answers nothing before key confirmation:** the phone's first sealed message
  (`session.start`) must open before any request is served.
- **Versions are judged from both ranges** ([`version.ts`](../../mobile/protocol/src/version.ts)).
  The side whose newest version is below the other's minimum is named, and the phone blocks that
  desktop with "update Deck" or "update this app". EAS Update ships on one channel per protocol
  version, so an over-the-air update never crosses a break.
- **Large bodies are chunked** (snapshots, files, diffs) below the 96 KiB message cap, and the
  response comes before its chunks.

## The relay

The relay forwards binary frames it cannot read and speaks its own small JSON protocol in text
frames ([`relay-messages.ts`](../../mobile/protocol/src/relay-messages.ts)): auth, the one-time
claim, the push token, push, revoke and presence. It stores, per pairing, the token hashes, the
claim hash until it is used, the expiry, last-seen times and the push token — nothing else
([`pairing-room.ts`](../../mobile/relay/src/pairing-room.ts)). Its one log line takes a closed
event name and a number, so no code path can log a token, a frame or an address. A canary test
proves terminal text never reaches storage or logs.

The relay is account-less (spec decision 10), so its limits in
[`limits.ts`](../../mobile/protocol/src/limits.ts) are the guard against abuse: frame size, a
per-socket message rate, a push rate and two sockets per role. A third socket closes the oldest,
so a phone that lost its network without a close frame can always come back. Close codes map to
text the phone shows.

Push leaves the relay as APNs (or Expo's push service in Expo Go) with a generic alert, "An agent
needs you", and the sealed copy in `d.c`. Only the phone's Notification Service Extension, holding
the pairing's push key from a shared Keychain group, can turn it into "Claude Code needs
attention". Whether a Worker's `fetch` reaches APNs over HTTP/2 is checked only after a deploy.

## The LAN path

When phone and desktop share a network, the desktop offers its private addresses in the `desktop`
event and the phone opens a direct socket with the same handshake
([`lan-listener.ts`](../../electron/mobile/lan-listener.ts)). The listener carries the same sealed
channel as the relay and only decides who may open a socket:

- **Private IPv4 only.** It binds each RFC 1918 address separately (10/8, 172.16/12,
  192.168/16), never a wildcard, so it never answers on a public interface. Private ranges include
  café and hotel networks, so what protects it there is the pairing key and the limits below.
  Interfaces are re-read every 30 s.
- **Only while needed:** the switch is on and at least one phone is paired. The last revoke stops
  it.
- **Narrow surface.** The path must carry a known pairing id; everything else, plain HTTP included,
  gets an empty 404. At most eight WebSockets and twice that many raw connections; a connection
  that has not upgraded, or whose channel is not open, within 5 s is closed, so idle sockets cannot
  exhaust Deck's file descriptors.
- **Binary only.** The hand-written RFC 6455 server
  ([`ws-server.ts`](../../electron/mobile/ws-server.ts)) accepts masked binary frames of at most
  128 KiB, because the LAN path carries exactly the relay's peer frames. No dependency was added
  for it. The Origin header is not checked: who may talk is decided by the pairing key.

The first bind can raise the macOS firewall's "accept incoming connections" prompt. Declining it
only costs the fast path; the phone stays on the relay.

## How a phone command reaches a pane

The phone is the user, not an agent, so it acts on every pane in every window (decision 22). That
is wider than the `deck` CLI, whose scope lives inside `createPaneCommands`. The phone therefore
never goes through those commands; its executor
([`phone-executor.ts`](../../electron/mobile/phone-executor.ts)) uses its own instance of the
control forwarder, which delivers a `control:command` to the owning window and awaits the reply.

- **Send** to an agent pane is the control `send` (paste, then a gated Enter) with the agent the
  pane mirror reports as `expectedAgent`. A shell pane has no agent to gate on, so its text goes
  through the input path with `\r`.
- **Open** has no caller pane. It routes to the window that holds the project, else the focused
  window, else the main one, through a synthetic pane id mapped to that window, so the forwarder
  and the CLI's twelve pinned command keys stay unchanged. Focus does not move. The phone sends
  its prompt itself, after the agent first reads idle and its screen shows no question, because a
  first-run trust dialog also reads as idle.
- **Paths** for files, changes and open must be a project or checkout some window reported.

## Keystrokes, the stream and echo

**Phone keystrokes never reach a PTY from main.** They travel main → renderer →
`paneIo.writePty`, because echo suppression is a renderer concern: output within 300 ms of input is
ignored by the activity heuristic only when the input went through `paneIo`. A write from main
would read every echo as work, and each keystroke would end in a false `completed` push.

The terminal stream is the raw `@xterm/addon-serialize` snapshot followed by the same pane's live
output, both from the renderer ([`mobile-bridge.ts`](../../src/terminal/mobile-bridge.ts)). The
bridge flushes the pane's xterm first, buffers output that arrives meanwhile, and sends snapshot,
buffer, then live data, so nothing is lost or doubled. The phone draws at the desktop pane's own
size and scales its font to fit; it never resizes the pane.

The tree is built in the renderer with the rail's own grouping and overlaid in main with the pane
mirror, polled every two seconds only while a phone listens.

## Push, keep-awake and focus

Phone push branches from the renderer's notifier decision
([`agent-notifier.ts`](../../src/terminal/agent-notifier.ts)) before the desktop's notification
setting is read (decision 24), for `requested` and `completed` only, with its own revision dedupe
and the window-focus gate. Main then drops it while any Deck window has focus (decision 23), seals
it with each phone's push key and hands it to that phone's relay socket.

While at least one pane works and at least one phone is paired, main holds a
`prevent-app-suspension` power-save blocker
([`keep-awake.ts`](../../electron/mobile/keep-awake.ts)). A laptop lid closed on battery still
sleeps the machine.

## Windows

Nothing here is gated on `hooksSupported()`: the pane mirror and the renderer's control listener
run on every host. On Windows, attention comes only from OSC signals, the bell and the heuristic,
so `requested` can be missed — which is why the phone's home keeps the whole tree under the pinned
Needs you section, with every row's last line and age.
