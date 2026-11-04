# Mobile companion: control a running Deck from an iPhone

Date: 2026-11-04
Status: Draft for the owner's review. The direction was decided in chat on 2026-11-04, after an
intent interview and four rounds of questions.
- **The owner's picks:** items 1–20 under [Decisions](#decisions-owner-2026-11-04), plus items
  25–27, which the owner picked on 2026-11-05 from a direction mock (scratch, outside the repo:
  `~/scratch/spacevibe-deck/mobile-mock-2026-11-05/`).
- **Defaults this spec adds:** items 21–24, plus the numbers it chose. Those numbers are the QR
  expiry (MOB1), the revoke window (MOB2), the relock delay (MOB4) and the 9-of-10 latency bar
  (Acceptance).
- **Approval:** the owner accepts or changes the defaults when approving the plan.

Nothing is built.
Depends on: the [agent orchestration](2026-11-03-agent-orchestration.md) spec shipping, because
the phone reuses the main → renderer operations behind `deck pane open|send|read|wait`.
Execution: [implementation plan](../plans/2026-11-05-mobile-companion.md) (gitignored, primary
checkout only; draft awaiting the owner's approval).
Baseline: local `main` `c4ebaf7c`, 59 commits ahead of `origin/main`.
Hosts: the desktop side runs on macOS and Windows. The phone side is iOS only in this scope.

## Purpose

Today Deck can only be driven from the machine it runs on. An agent that stops on a question
while the user is away from the desk waits until the user comes back. This spec adds an iPhone
app that pairs with a running Deck and shows its panes and their state. From the phone the user
can type into any pane, answer and approve agents, open a new agent with a prompt, and read
files, changes and token usage. Push notifications reach the phone when an agent needs the user
or finishes. The desktop stays the source of truth: the phone is a view and a keyboard, never a
second place where agents run.

## Decisions (owner, 2026-11-04)

1. **A product feature for Deck users, not a personal tool.** It ships, so it works off the
   home network, is installable from Apple's channels and has a privacy notice.
   - Turned down: a personal web page reached over Tailscale or the LAN.
2. **Parity target: reference app A's mobile companion, limited to what Deck desktop already
   has.** Desktop features A's phone reaches but Deck lacks are built on the desktop first and
   come to the phone later (see [Out of scope](#out-of-scope)).
   - Turned down: building those desktop features in this scope; phone-only features.
3. **A full interactive terminal.** The terminal view is the default. Live mode, an accessory key
   row and scrollback are included. A parsed chat view waits with the desktop features of
   decision 2.
   - Turned down: a text snapshot of the screen with reply buttons.
4. **A native app built with Expo (React Native), iOS first.** iPhone is the target; iPad runs
   the iPhone layout. Android comes later.
   - Turned down: a PWA, whose iOS push needs a home-screen install and which has no store
     presence; native Swift.
5. **Push when a pane's attention becomes `requested` or `completed`**, with the copy the
   desktop notifier already uses.
6. **Reachable from anywhere through a cloud relay**, with a direct LAN path when phone and
   desktop share a network.
   - Turned down: LAN only.
7. **Deck must be running.** The phone shows a desktop as offline when Deck is closed or
   unreachable. While a pane is working and a phone is paired, Deck keeps the machine awake.
   - Turned down: building `keep-agents-running` (a daemon that owns the PTYs) first.
8. **Free.** No tier gate.
9. **Starts after the `deck` CLI ships.**
10. **Pairing by QR code, with no account**, including over the relay. The QR carries the key
    material. This differs deliberately from reference app A, which needs sign-in for its relay;
    Deck's accounts are not shipped. An account gate on the relay may come later.
11. **End-to-end encryption.** The relay sees pairing and device identifiers, timestamps and
    frame sizes, never terminal text, file contents or notification copy.
    - Turned down: TLS only, with a relay that can read content.
12. **Desktop hosts: macOS and Windows.**
13. **Every pane is visible and controllable**, shells included.
    - Turned down: agent panes only.
14. **Face ID or the passcode unlocks the app**, on by default. Revoking a phone from Deck's
    Settings still works.
15. **The app lives in `mobile/` in this repo.**
    - Turned down: a new repository, which is a workspace-level fork.
16. **The relay is a Cloudflare Worker with one Durable Object per pairing**, separate from the
    analytics Worker, in the same Cloudflare account.
    - Turned down: a Node container with Postgres, as reference app A runs.
17. **The relay answers at `api.deck.spacevibe.dev/relay/*`**, routed to its own Worker.
    - Turned down: a new `relay.` subdomain, which is a workspace-level fork.
18. **The phone sends no analytics.** The desktop counts mobile use in its existing daily
    payload.
19. **EAS Build and EAS Update** (Expo's cloud build and over-the-air JavaScript updates).
    Releases go to a public TestFlight beta first and to the App Store once the
    [acceptance](#acceptance) list passes.
    - Turned down: local fastlane builds with store-only updates.
20. **Name and identifier: "SpaceVibe Deck", bundle ID `dev.spacevibe.deck.mobile`.** The
    store name matches the desktop release's `productName`. The bundle ID is separate from
    the desktop's `dev.spacevibe.deck`.

Defaults this spec adds:

21. **Gated by a release switch `mobileCompanion`** in
    [`release-switches.ts`](../../src/lib/release-switches.ts), off outside dev builds until
    acceptance. With the switch off, Deck shows no pairing UI, opens no relay connection and
    listens on no LAN port.
22. **The phone acts on every pane in every window.** This is wider than the `deck` CLI, whose
    caller acts only on itself and the panes it opened. A paired phone is the user, not an agent.
23. **Push is suppressed while a Deck window is focused**, the same condition the desktop
    notifier uses, so the phone stays quiet while the user sits at the desk.
24. **Phone push ignores the desktop's notification setting.** The phone app has its own
    switch for it, so turning off desktop banners does not silence the phone.

Picked on the direction mock (owner, 2026-11-05):

25. **Home is every desktop's tree, with the waiting panes pinned on top** (MOB16). Deck can
    miss a needs-you, so the full tree stays on Home:
    - **The heuristic:** without an explicit signal it can only produce `completed`.
    - **Windows:** has no hooks.
    - **A first-run trust dialog:** reads as idle.

    The pinned section gives the fast path.
    - Turned down: a queue-only home (a missed pane vanishes from it); a timeline home; one
      desktop at a time.
26. **Icons are SF Symbols.**
    - Turned down: Deck's Hugeicons, which would match the desktop but not iOS.
27. **Text uses the iOS text styles** at their default Dynamic Type sizes, at weights 400 and 600
    only.
    - Turned down: the desktop's 14/12 scale, which is too small on a phone.

## How the reference apps do it

These notes were read on 2026-11-04 from each app's public documentation, and for reference
app A also its MIT source. The apps are not named in this repository.

- **Reference app A** (the parity target):
  - **Platform:** an Expo and React Native app with xterm.js inside a WebView. It ships on the
    App Store and as an Android APK, both in beta.
  - **Pairing:** QR scan or a one-time code. A relay is preferred, and sign-in is needed only
    for the relay. A LAN or Tailscale address can be used instead, and also serves as a fast
    path.
  - **Encryption:** end-to-end, using libsodium.
  - **Terminal:**
    - The terminal view is the default, with a chat view per supported agent.
    - The terminal fits the screen width, with a per-device text size from 50 to 200% and
      pinch zoom.
    - Live mode sends every keystroke to the PTY. There is an accessory row and hydrated
      scrollback.
  - **Push:** sent when an agent finishes, mirroring the desktop's notifications.
  - **Versioning:** a versioned protocol blocks a host that is too old.
  - **Desktop:** must be running.
  - **Size:**
    - `mobile/` holds about 4,300 files.
    - The relay holds about 290 files, on Postgres.
- **Reference app B:**
  - **Platform:** iPhone and iPad, on its paid tier.
  - **Pairing:** an account sign-in plus a "Remote Access" switch on the desktop.
  - **Desktop:** the computer must stay "awake, online, and running" the app.
- **An agent CLI vendor's remote control:**
  - **Transport:** outbound HTTPS only.
  - **Encryption:** none end to end; transcripts are stored on the vendor's servers.
  - **Pairing:** a QR code.
  - **Push:** sent when an action is required.
- **An open-source mobile client:** a relay designed to stay blind to user content, QR pairing,
  and push sent from a Cloudflare Worker.

## Requirements

### Pairing and identity

- **MOB1**: Settings has a **Mobile** section with **Pair a phone**.
  - **The QR:** it holds the relay URL, a pairing id, the desktop's public key and a one-time
    secret. It expires after 5 minutes.
  - **Completing the pairing:** the phone scans it, both sides derive the pair's keys, and the
    pairing completes once the secret is used.
  - **Rejected codes:** an expired or reused secret is rejected on both sides.
- **MOB2**: The Mobile section lists the paired phones, each with its name, the date it was
  paired and when it was last seen. **Revoke** deletes the desktop's key for that phone and
  tells the relay to drop the pairing. Within 10 seconds the phone shows that desktop as
  revoked and can no longer reach it.
- **MOB3**: Key material is stored in each platform's secure store:
  - **Desktop:** Electron `safeStorage`, as
    [`session-store.ts`](../../electron/account/session-store.ts) already does.
  - **Phone:** the iOS Keychain.
  - **Everywhere else:** keys never appear in `workspaces.json`, `session.json`, logs or
    telemetry.
- **MOB4**: The app unlocks with Face ID or the passcode at launch and after 5 minutes in the
  background. This is on by default, and the app's settings can turn it off.
- **MOB5**: One phone can pair with several desktops, and one desktop with several phones. The
  phone's home screen lists every paired desktop.

### Transport

- **MOB6**: The relay is a separate Cloudflare Worker, routed at `api.deck.spacevibe.dev/relay/*`,
  with one Durable Object per pairing.
  - **Sockets:** WebSockets use the Hibernation API, so an idle pairing costs no duration.
  - **What the relay stores:** pairing ids, device ids, the APNs device token and last-seen
    times. Nothing else.
  - **Secrets:** the APNs key lives in Worker secrets.
- **MOB7**: Every frame between phone and desktop is sealed with the pair's keys, using
  authenticated encryption, and the relay forwards it as opaque bytes.
  - **Frames:** a frame that fails authentication is dropped and logged as a count, never as
    content.
  - **Test:** canary text is sent through a pairing, and a test then scans the relay's
    Durable Object storage and logs and finds no trace of it.
- **MOB8**: Each pairing has limits on message rate, frame size and concurrent connections.
  - **Over the limit:** the relay closes the socket with a code the phone shows.
  - **Values:** the numbers are set in the plan.
  - **Why:** these limits are the guard against abuse of an account-less relay (decision 10).
- **MOB9**: The LAN path. When phone and desktop share a network, the desktop offers its
  private-interface address over the encrypted channel, and the phone connects directly with
  the same encryption. If that fails, it falls back to the relay.
  - **When the desktop listens:** only while the switch is on and at least one phone is paired.
  - **Where it listens:** only on private interfaces, never `0.0.0.0` on a public interface.
  - **Visibility:** the phone's host details show which path is in use.
- **MOB10**: Both sides send a protocol version in the handshake.
  - **If they are incompatible:** the phone blocks that desktop and says which side to update.
  - **Phone side:** TestFlight or App Store.
  - **Desktop side:** Deck's updater.
- **MOB11**: When Deck is closed or the desktop is unreachable, the phone shows that desktop
  offline with its last-seen time, and reconnects on its own when the desktop comes back.

### Desktop

- **MOB12**: While at least one pane is working and at least one phone is paired, Deck holds
  an Electron `powerSaveBlocker` (`prevent-app-suspension`), and it releases the blocker when
  either condition ends. The user guide states that closing a laptop lid on battery still
  sleeps the machine.
- **MOB13**: Phone commands reach PTYs only through the operations the `deck` CLI uses:
  - **Open:** the materialize seam.
  - **Send:** `injectIntoPane`, behind the process gate.
  - **Read:** the pane serializer.
  - **Wait:** the attention mirror.

  Live-mode keystrokes add one operation, a raw write to the pane's PTY. There is no second
  path into the PTY layer, and no new PTY, window, tab or layout seam (R4).
- **MOB14**: Viewing a pane from the phone never resizes the desktop pane or its PTY.
- **MOB15**: On Windows, every operation in MOB13 and the attention mirror must work. The
  orchestration spec builds those operations for macOS and Linux only and leaves Windows out of
  its scope, so this spec adds Windows (see [Risks](#risks)). Hook transport is off on `win32`
  (`hooksSupported()`), so attention there comes only from OSC signals, the bell and the
  heuristic. The user guide states that `requested` can be missed on Windows.

### Phone: desktops, panes and the terminal

- **MOB16**: The home screen lists desktops, each with its machine name, OS and online state.
  Inside a desktop the order is projects, then checkouts, then panes, with the phase and
  attention states the rail shows.
  - **Every pane row:** shows the pane's last line and its age, so a pane whose attention Deck
    missed still reads as stuck.
  - **Above the tree:** a **Needs you** section pins up to 3 panes whose attention is `requested`
    or `error`, newest first. More than 3 adds **See all**.
  - **Answering from the pinned section:**
    - **A numbered choice:** when the pane's screen ends in a numbered option list (`1.`, `2.` …),
      each option is a button that sends its digit.
    - **A question:** a reply field that sends like MOB19.
    - **A failure:** an open action.
  - **Inside a pane opened from there:** a pager moves to the next waiting pane.
  - **Tabs:** Desktops and Settings.
- **MOB17**: The terminal view renders the pane with xterm.js.
  - **Size:** it fits the desktop pane's columns to the screen width. Text size runs from 50 to
    200% over that, with pinch zoom snapping to the same steps, and is kept per device.
  - **Opening:** scrollback is filled in from the desktop, then the stream goes live.
- **MOB18**: Live mode sends each keystroke straight to the PTY.
  - **Accessory row:** Esc, Tab, Shift+Tab, Ctrl+C, the four arrows and Enter.
  - **Keyboard:** autocorrect and autocapitalize are off.
  - **Approving and answering:** agent permission and question prompts are answered by
    typing, like on the desktop. The only parsed buttons are MOB16's numbered choices, found
    from the screen text and the same for every agent.
- **MOB19**: Outside Live mode, a composer sends its text the way `deck pane send` does: paste,
  then a gated Enter.
- **MOB20**: **New agent** asks for a desktop, then a project and checkout, then an agent from
  that desktop's agent list, plus an optional prompt.
  - **On the desktop:** the tab appears at once, and the desktop's focus does not move.
  - **Sending the prompt:** it follows the guarded flow of the orchestration spec, because a
    first-run trust dialog reads as idle.
- **MOB21**: The phone can read three things, none of them editable:
  - **Files:** the checkout's file tree, with text files opening as read-only text.
  - **Changes:** the list with status and added and removed lines, plus a read-only diff.
  - **Token usage:** the same numbers as the desktop tab.

### Notifications

- **MOB22**: Push fires on the events the desktop notifier forwards (attention `requested` and
  `completed`, deduped on the latch identity; see [terminal.md](../internals/terminal.md)).
  - **When the phone gets it:** independent of the desktop's notification setting
    (decision 24), and suppressed while a Deck window is focused (decision 23).
  - **Speed:** delivery must meet the [acceptance](#acceptance) latency.
- **MOB23**: Push copy is end-to-end encrypted.
  - **Desktop:** encrypts the copy (workspace label, agent label and the fixed phrase) with
    the phone's key.
  - **Relay:** sends APNs a mutable-content payload holding only that ciphertext.
  - **Phone:** a Notification Service Extension decrypts it.
  - **Fallback:** if decryption fails, the notification reads "An agent needs you".
  - **Tapping:** opens that pane.

### Release and distribution

- **MOB24**: EAS Build produces the iOS binary. EAS Update ships JavaScript updates on a
  channel per protocol version, so an over-the-air update never crosses a protocol break.
  - **Before acceptance:** a public TestFlight beta.
  - **After acceptance:** the App Store.
- **MOB25**: The minimum iOS version, the Expo SDK and the native modules are fixed in the plan.
  Adding them is the expected dependency/bundle fork.

### Privacy, analytics and documentation

- **MOB26**: A new dated privacy notice under `marketing/public/privacy/<date>/` states what
  the relay receives:
  - **Received:** identifiers, timestamps, sizes, the APNs token, and IP addresses at
    Cloudflare.
  - **Never received:** terminal text, file contents and notification copy.

  The App Store privacy answers match the notice.
- **MOB27**: The desktop's daily payload gains mobile counters: paired phones, phone sessions,
  phone sends and phone-opened agents.
  - **Contract:** this changes [telemetry.md](../internals/telemetry.md) and the payload
    validation in [`backend/`](../../backend/README.md).
  - **Order:** the backend deploys before the client release that sends them.
- **MOB28**: Documentation:
  - **User guide:** a `docs/user/` page covers pairing, revoking, offline, keep-awake and the
    Windows limit. Its translations follow the repo's rule.
  - **Internals:** a page records the pairing protocol, the encryption and its traps.

## Acceptance

- **Push and reply:**
  - **Setup:** the phone on cellular, the desktop on its own network.
  - **Latency:** over 10 tries, push arrives within 5 seconds of a pane becoming `requested`
    in at least 9 of them.
  - **Reply:** a reply typed on the phone lands in that pane, and the agent continues.
  - **Pinned answer:** a numbered choice pressed in the pinned Needs you section lands in that
    pane. Neither the agent nor the pane's tab has to be opened.
- **Live mode:** typing works in a shell and in an agent's TUI, and the desktop pane keeps its
  size.
- **New agent:** opened from the phone with a prompt in an existing project. The tab appears on
  the desktop at once.
- **No content on the relay:** MOB7's canary test passes.
- **LAN path:**
  - **Same Wi-Fi:** the phone reports the LAN path.
  - **Leaving the network:** the phone moves to the relay without re-pairing.
- **Revoke:** a revoked phone loses access within 10 seconds (MOB2).
- **Installation:** the app installs from TestFlight, and an EAS Update reaches the installed
  app.
- **Tests:**
  - **Units:** pairing (expiry, reuse), framing and authentication failure, limits, the version
    gate, the keep-awake rule (MOB12) and push suppression (decision 23).
  - **IPC:** new channels are pinned in `scripts/electron-ipc-contract.test.ts`.
- **Owner's walk:** on a real iPhone against `electron:dev`, as the final task. No Playwright
  launch of the app unless the owner asks.

## Out of scope

The following are not in this scope:

- **Other platforms and layouts:** Android, and an iPad layout.
- **Desktop features A's phone reaches but Deck lacks** (decision 2):
  - staging, committing, PR review and merge;
  - a parsed chat view per agent CLI;
  - creating a workspace from an issue tracker;
  - switching agent accounts and seeing rate limits;
  - synced quick commands;
  - sending files or images from the phone.
- **The browser tab mirror:** it is the named next release.
- **Agents that survive quitting Deck.**
- **An account requirement.**
- **Other languages:** R1 keeps everything in English.
- **Writes from the phone:** editing files on the phone, and git writes of any kind.
- **Self-hosted relays.**
- **Teams and sharing a desktop with another person.**

## Risks

- **Size.**
  - **Comparison:** reference app A's phone app and relay together hold about 4,600 files.
  - **Approach:** the plan cuts this scope into slices that each ship behind the switch.
- **Expected forks for the plan to name** (`AGENTS.md` Forks):
  - **Dependency and bundle:** Expo, React Native and native modules in a new `mobile/`
    package.
  - **Release and signing:** EAS, TestFlight, App Store, and an APNs key.
  - **A new Worker and its secrets.**
  - **The LAN listener as a network surface:** it needs a security review.
- **A new UI stack.** React Native cannot reuse `src/ui/controls` or the DL classes. The
  direction is picked on a mock before code (`CLAUDE.md` `<frontend>`).
- **An account-less relay can be abused.** MOB8's limits are the guard. An account gate stays
  possible later.
- **Encrypted push is unverified on two counts.** The plan's first spike settles both:
  - **The extension:** encrypted push needs a Notification Service Extension inside an Expo app.
  - **APNs:** the relay Worker must be able to reach APNs directly, which requires HTTP/2 and
    token auth. If it cannot, a push service carries the ciphertext instead, and the privacy
    notice (MOB26) names that service.
- **First-launch firewall prompts.** The LAN listener may trigger one on macOS and Windows.
- **Windows** (MOB15):
  - **Operations:** whether the operations the phone reuses run on `win32` at all is unchecked.
    The orchestration spec scoped them to macOS and Linux.
  - **Attention:** fidelity is lower without hooks.
- **App Store review** of a remote-terminal app is untested.
- **Costs**, read on 2026-11-04:
  - **Durable Objects on the Workers Free plan:** 100,000 requests and 13,000 GB-s a day.
    Hibernating objects are not billed for duration.
  - **EAS Free:** 15 iOS builds a month at low priority, and 1,000 Update monthly active users.
    Starter is $19 a month.

## Open questions

- **Where the relay Worker's source lives.** Candidates: `backend/relay/`, or a new top-level
  directory, which needs the owner's OK.
- **App Store name.** Whether "SpaceVibe Deck" is free on the App Store is only known at
  registration.
- **Accessory row.** Whether it needs more keys after the owner's walk.
