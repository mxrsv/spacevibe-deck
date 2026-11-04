# Mobile companion: control a running Deck from an iPhone

Record: Active task plan, approved by the owner on 2026-11-05 for a full build in one cloud run:
"xong cho prompt để build luôn bản mobile này, cần build đầy đủ code luôn, rồi để mai tôi test
sau". The approval was read as covering:
- **The approval items as recommended:**
  - the spec's defaults 21–24 and its chosen numbers;
  - the forks table;
  - the relay at `mobile/relay/`;
  - the Operating contract.
- **The CLI gate is waived** (spec decision 9 superseded).
- **T5's mock stop moves into T14's single eye batch.**
- **Spikes that need a Mac do not stop the run.** S1–S3 become items to verify on the Mac; the
  build takes the primary approach behind an interface.
- **Not built yet.**
- **Started:** 2026-11-05.
- **Spec:** [Mobile companion](../specs/2026-11-04-mobile-companion.md) (MOB1–28, decisions 1–27).
- **Direction mock (picked, E):** pushed on branch `mock/mobile-companion-2026-11-05`, under
  `mock/mobile-companion-2026-11-05/`. That branch is never merged. To read it, run
  `git fetch origin mock/mobile-companion-2026-11-05` then `git worktree add /tmp/mock
  FETCH_HEAD`.
- **Committed for cloud runs** on 2026-11-05, although `docs/plans/` is gitignored. The owner
  said: "push lên remote, tôi sẽ run session này trên cloud". This follows `e3b269a9`. The
  committed copy is the one to update; a local session pulls before editing it.
- **Base revision:** `origin/main` `32ac87cf` plus this plan's commit. The dock test that
  `207c717e` broke was fixed by its owner in `32ac87cf`.
- **Gate to start building:** none any more. The owner waived it on 2026-11-05. The CLI
  ([orchestration plan](2026-11-03-agent-orchestration.md)) is on `main` behind `agentControl`.
  The phone uses its forwarder code, not its switch.

## Requirements reference and delivery scope

MOB1–28 of the spec, in the slices below, plus one final owner walk with eye approval. Out:
everything under the spec's Out of scope, the browser-tab mirror (the next release) and Android.

## Code facts the approach rests on (read 2026-11-05)

- **The phase/attention mirror runs on every host.**
  - **Where it lives:** `createPaneMirror` is built unconditionally (`electron/main.ts:204-206`).
    `registerControl` wires its report channel on every host (`electron/main.ts:562-570`).
  - **What is gated:** only the CLI router waits on `hooksSupported() && agentControl`
    (`electron/main.ts:201-221`).
- **The renderer always listens for control commands.**
  - **Listener:** `listenControlCommands` (`src/terminal/tab-manager.ts:271-276`).
  - **Handler:** `src/terminal/control-commands.ts` has open, send (`injectIntoPane`),
    read (`serializePane`) and close. It carries no scope check.
  - **Consequence:** Windows can be served once main has a forwarder that does not depend on
    hooks.
- **The CLI's scope is enforced inside the main-side commands**, not in the router:
  - `control-pane-commands.ts:164` and `:209-222` call `openedBy.mayAct(caller, target, …)` and
    `tokenFor(caller)`;
  - `open` records the new pane against a caller pane (`:250-265`).

  So the phone cannot reuse `createPaneCommands`. It builds on the layer below it:
  `control-forward.ts`, the forwarder that delivers to the owning window and awaits the reply.
- **Echo suppression is a renderer concern.**
  - **The rule:** output within `DEFAULT_ECHO_MS` = 300 ms of the user's own input is ignored
    by the heuristic (`src/terminal/agent-activity.ts:94`, `:183`).
  - **Where input is noted:** input reaches `activity.noteInput` only through `paneIo.writePty`
    (`tab-manager.ts:310`, `:2239`).

  Phone keystrokes must therefore travel main → renderer → `paneIo.writePty`. Writing to the
  PTY from main would read the echo as work, and every keystroke would end in a false
  `completed` push.
- **Serializer.** `pane.ts:531-533` uses `@xterm/addon-serialize`, which gives ANSI output with
  scrollback. `deck read` strips that (`control-commands.ts:167-171`). The phone's terminal
  needs the raw ANSI snapshot, followed in order by live output from the same renderer.
- **The notifier is renderer-side.**
  - **The gate:** `maybeNotify` returns early on `!isEnabled() || isWindowFocused()` or kind
    `none`/`warning`, then dedupes on revision (`src/terminal/agent-notifier.ts:93-101`).
  - **The copy:** `KIND_PHRASE` is `finished` / `needs attention` / `error` (`:58-62`).
  - **Consequence:** phone push should branch from that decision, not be re-derived in main.
- **Other facts:**
  - **Secure storage:** there is a `safeStorage` precedent in `electron/account/session-store.ts`.
  - **Switches:** release switches live in `src/lib/release-switches.ts:14-28`.
  - **Electron:** `^43.8.1`.
  - **Backend:** an independent Cloudflare Worker on `api.deck.spacevibe.dev`
    (`backend/README.md`).
- **This machine has no Xcode**: `xcodebuild` reports Command Line Tools only. There is
  therefore no iOS Simulator.
- **Reference app A's streaming notes (MIT, principles only):**
  - **Message queues:** queue messages until the WebView reports ready and again until
    xterm has initialized.
  - **Subscribing:** a subscribe sends a scrollback snapshot and then live data.
  - **Reconnecting:** replay subscriptions after a reconnect.
  - **Debugging:** build a no-phone repro client first, and debug the bridge with it before
    touching the phone UI.

## Approach

- **One contract, three consumers.**
  - **What it is:** `mobile/protocol/` is plain TypeScript with no dependencies. It holds the
    message types, the protocol version, the framing and the crypto interface.
  - **Who imports it:** `electron/mobile/` (desktop), `mobile/relay/` (the Worker) and
    `mobile/app/` (the phone). The structure template asks for exactly this: shared logic
    defined once, as types.
- **Crypto.** Keys are agreed with X25519 and HKDF-SHA256. Frames are sealed with
  ChaCha20-Poly1305, with a nonce counter per direction.
  - **Desktop:** `node:crypto`, so no new dependency.
  - **Phone:** `@noble/curves` and `@noble/ciphers`.
  - **Interop:** proven by shared test vectors in `mobile/protocol/`.
  - **What the QR carries:** relay URL, pairing id, the desktop's public key, the one-time
    secret and the expiry (MOB1).
- **Desktop service `electron/mobile/`**, built only while the `mobileCompanion` switch is on:
  - pairing and paired-phone records, with keys in `safeStorage` (MOB1–3);
  - the relay client and, later, the LAN listener;
  - a **phone executor**: forwarder-based, scoped to all panes (decision 22), with a callerless
    `open` that names a project and checkout instead of a caller pane;
  - a **stream bridge**: subscribe → the renderer sends the ANSI snapshot, then forwards that
    pane's live output in order. The order holds because both come from the renderer;
  - **keep-awake**: `powerSaveBlocker` while at least one pane is working and at least one phone
    is paired (MOB12);
  - **push**: the renderer notifier's decision, taken before `isEnabled()` (decision 24), with
    dedupe and the focus gate kept (decision 23), and sent to main. Main seals the copy for each
    phone and hands it to the relay (MOB22–23);
  - a **version gate** in the handshake (MOB10).
- **Relay `mobile/relay/`.** This answers the spec's open question with a third option under the
  `mobile/` directory the owner already approved (decision 15).
  - **Shape:** a Cloudflare Worker routed at `api.deck.spacevibe.dev/relay/*` (decision 17),
    with one Durable Object per pairing, the WebSocket Hibernation API and per-pairing limits
    (MOB6, MOB8).
  - **Revoke:** the relay drops the pairing on revoke (MOB2).
  - **APNs:** the relay sends to APNs, or through a fallback if spike S2 rules a direct send out.
  - **What it stores:** ids, the APNs token and last-seen times only.
- **Phone app `mobile/app/`:** Expo with React Native. It has its own `package.json`, lockfile,
  type check, lint and tests, run from `mobile/`.
  - **Navigation:** Expo Router.
  - **Native modules:**
    - `react-native-webview` with xterm.js for the terminal;
    - `expo-camera` for the QR scan;
    - `expo-secure-store` for keys;
    - `expo-local-authentication` for Face ID;
    - `expo-notifications` plus a Notification Service Extension for push;
    - `expo-symbols` for SF Symbols.
  - **Look:** Deck's graphite / Deck Light grounds and states, ported to a React Native theme
    module. Text uses the iOS text styles (decisions 26–27).
- **Numbered choices (MOB16, MOB18).** One agent-agnostic parser reads the screen's last option
  list (`❯? N. text`). It is tested on captured Claude Code, Codex and opencode screens.
- **No-phone repro first.** `mobile/protocol/` ships a Node test client that pairs, subscribes,
  sends and reads through the real relay protocol. Every desktop slice is proven with it before
  any phone UI exists.

## Expected forks (authorized when the owner approves this plan)

| #   | Fork in `AGENTS.md`                         | Where this plan touches it                                                                                         | Option taken                                                                                                                 |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| F1  | Dependency configuration                    | `mobile/app/package.json` (Expo SDK, the modules above, `@noble/*`); `mobile/relay/package.json` (Wrangler); `ws` only if T9 needs a LAN server | Separate packages under `mobile/`; the root `package.json` gains no runtime dependency                                         |
| F2  | Bundle, signing, release channel, updater   | EAS Build and Update, an App Store Connect record, bundle ID `dev.spacevibe.deck.mobile`, an APNs key, TestFlight  | iOS only; Update channels per protocol version (MOB24); the desktop's electron-builder, updater and signing are untouched     |
| F3  | PTY ownership                               | The stream bridge reads the pane's output in the renderer; phone input goes through `paneIo.writePty`               | No write path in main; no PTY tap in main; the only additions are renderer-side subscriptions                                 |
| F4  | Tab materialization, window coordinator     | Callerless `open` from the phone picks the window that holds the project, or else the focused window                 | Reuse `MaterializeIntent`; the desktop's focus does not move (MOB20)                                                          |
| F5  | New IPC channels and events                 | Pairing UI ↔ main, stream subscribe/data, phone input, push decision                                               | Pinned in `scripts/electron-ipc-contract.test.ts` and `electron/wire-contract.test.ts` in the same PR                           |
| F6  | A network listener                          | The LAN listener (MOB9)                                                                                             | Private interfaces only, only while paired and switched on, the same encryption; a security review before merge              |
| F7  | Telemetry contract                          | Mobile counters in the daily payload (MOB27)                                                                        | The backend validation deploys before the client release (backend README rule)                                               |
| F8  | Lint/test exempt paths (R9)                 | Root vitest, `tsc`, oxlint, prettier, `check-changed.sh`, the pre-push sibling lookup and CI all exclude `mobile/`  | Each exclusion carries a comment naming what it protects; `mobile/` gets its own check command; the PR says so for the owner |

A fork this table does not name stops the run.

## Checkout contract

The desktop-side and protocol slices follow the orchestration plan's pattern:
- **Worktree:** one PR per slice, from `git worktree add .claude/worktrees/<slug> -b
  worktree-<slug> main`, with `npm install` inside.
- **Merging:** merged the same day by a rebase, a fast-forward and removing the worktree.
- **The phone app:** lives in the same worktrees; `npm install` runs inside `mobile/app/` too.
- **This plan:** committed (see Record). Update it in the checkout you work in, and commit it.
- **Pushing:** push from a clean `/tmp` worktree, never from the primary. The primary's hook
  also runs the nested `.claude/worktrees` suites.

**Cloud run (the full build of 2026-11-05).** A Claude Code cloud session works on a fresh Linux
clone of `origin/main`. This replaces the local worktree, fast-forward and push steps.
- **Branch and PR:** one branch, `claude/mobile-companion`, with one commit per task (T1–T13), a
  push after each commit, and one draft PR against `main` opened after the first commit. The
  owner tests the whole of it and merges.
- **Installing:** the session runs `npm install` at the root and inside each `mobile/` package.
- **GitHub:** if `gh pr` fails with 403 (the proxy refuses GraphQL), use `gh api` (REST).
- **What the cloud cannot do:** macOS, Xcode, an iPhone, a headed `electron:dev`, deploying,
  or store actions. So:
  - **Every task:** builds its full code with its unit and contract tests.
  - **Mac-only checks** (S1–S3, device runs, Simulator shots, the `electron:dev` repro run, the
    LAN path on a real network): listed in Verification as "verify on the Mac".
  - **Owner actions:** prepared as config (Wrangler, `eas.json`, `app.config`), never run.
- **Tomorrow's test path:** the owner's Mac has no Xcode, so the app must run in **Expo Go**.
  - **Native builds:** everything except the push extension works without a custom native
    build; push feature-detects and says it needs a dev build.
  - **Relay:** runs locally with `wrangler dev`. The desktop reads its relay URL from Deck's
    one env/config module (E5): `DECK_RELAY_URL`, defaulting to
    `https://api.deck.spacevibe.dev/relay`.

## Tasks

- [x] **T0: Record.** This plan is written and the spec's Execution line links here
  (2026-11-05).
- [ ] **S0: Spikes.** These run in scratch only and change no repo code. **Proposal: run them
  before the CLI ships**, so each risk is known early. This needs the owner's OK, because it
  bends decision 9. Each result goes into Verification; a spike that fails stops the run and
  brings the spec question to the owner.
  - **S1:** decrypt a mutable-content push in a Notification Service Extension inside an Expo
    app. Needs an EAS dev build on a registered iPhone.
  - **S2:** a Cloudflare Worker sends to APNs, which needs HTTP/2 and token auth. If it cannot,
    name the push service that carries the ciphertext instead.
  - **S3:** xterm.js in a React Native WebView:
    - a 64-column Claude Code screen at fit-to-width, with pinch zoom from 50 to 200%;
    - a raw ANSI snapshot followed by a live stream, using the ready queues.
  - **S4:** test vectors for X25519, HKDF and ChaCha20-Poly1305 that pass in both `node:crypto`
    and `@noble/*`.
  - **S5:** Electron 43's Node has a global `WebSocket` client usable in main. If it does not,
    the relay client needs `ws` (F1).
- [x] **T1: Isolation of `mobile/` from root tooling (F8).** Done 2026-11-05 in `a0f60dc`.
  - **Excluded from:** root vitest, `tsconfig`, `.oxlintrc.json` (with an R9 comment),
    prettier, `scripts/check-changed.sh`, the `.githooks/pre-push` sibling lookup and CI paths.
  - **Added:** a `mobile/` check script.
  - **Verify:** a deliberately broken file under `mobile/` is invisible to `npm test` and
    `npm run lint`, and is caught by the `mobile/` check.
- [x] **T2: Protocol and crypto (`mobile/protocol/`).** Done 2026-11-05.
  - **Contents:** types, version, framing, the crypto interface with a Node implementation, the
    S4 vectors, and the no-phone repro client.
  - **Covers:** MOB7 (framing and auth failure) and MOB10.
  - **Verify:** unit tests.
- [x] **T3: Relay (`mobile/relay/`).** Done 2026-11-05; deploying stays the owner's.
  - **Contents:** the Durable Object per pairing, hibernation, limits, revoke, APNs, minimal
    storage, and the canary test (MOB7). Covers MOB2, MOB6 and MOB8.
  - **Verify:** Wrangler local tests. The repro client pairs and exchanges frames through
    `wrangler dev`.
  - **Deploying the route and secrets is an owner action.**
- [x] **T4: Desktop service (`electron/mobile/`) behind `mobileCompanion`.** Done 2026-11-05. Covers MOB1–3, MOB5,
  MOB10–15 and decisions 21–24.
  - **Contents:**
    - the switch;
    - pairing records in `safeStorage`;
    - the relay client;
    - the phone executor (all panes, callerless `open`, F4);
    - the stream bridge and the renderer input path (F3);
    - keep-awake;
    - the push decision branch in `agent-notifier.ts`;
    - the version gate.
  - **No gate on `hooksSupported()`.**
  - **IPC (F5):** pinned.
  - **Verify:** the repro client against `electron:dev` with an isolated userData.
    - open, send, read and wait on every pane;
    - a keystroke echo produces no `working`;
    - a snapshot plus the stream draws a Claude Code TUI correctly;
    - no push while a Deck window is focused.
- [ ] **T5: Desktop Settings → Mobile.**
  - **Mock, no early stop** (the owner's 2026-11-05 full-build call): build a gallery specimen
    from the real Settings rows and controls. It holds Pair a phone, the QR dialog, the paired
    list and revoke. Then build the surface from the same parts. The owner judges both by eye in
    T14.
  - **Covers:** MOB1 (QR, 5-minute expiry) and MOB2 (list, revoke within 10 seconds).
  - **Verify:** renderer tests; the repro client sees a revoke.
- [x] **T6: Phone app shell (`mobile/app/`).** Done 2026-11-05 (committed before T4, which was still running).
  - **Contents:** the Expo project, a theme module from Deck's tokens, SF Symbols, the text
    styles, the Face ID lock (MOB4), QR pairing (MOB1, MOB3), Settings (desktops, online and
    offline, toggles), and the offline and version states (MOB10–11).
  - **Verify:** Simulator screenshots next to the mock in both themes, with each difference
    measured.
  - **Needs Xcode:** an owner action, due before this task.
- [x] **T7: Home and pane (MOB16–19).** Done 2026-11-05 (committed before T4).
  - **Home:** tree E with the pinned Needs you section and See all. Every row shows its last line
    and age.
  - **Answers:** the numbered-choice parser with tests on captured Claude Code, Codex and opencode
    screens; reply; open; and the pager.
  - **Terminal:** the terminal view, Live mode with the accessory row, and the composer.
  - **Verify:** parser tests; Simulator and real-device runs against `electron:dev`; a pinned
    answer lands without opening the pane.
- [x] **T8: New agent, Files, Changes, Usage (MOB20–21).** Done 2026-11-05; the desktop handlers landed with T4's executor.
  - **New agent:** `open` follows the orchestration spec's guarded flow, because a first-run
    trust dialog reads as idle.
  - **Verify:** a tab appears on the desktop and its focus does not move.
- [x] **T9: Push end to end (MOB22–23).** Done 2026-11-05 as code and config (before T5); the extension builds only in an EAS build.
  - **Contents:** APNs registration, the NSE decrypt with its generic fallback line, and tap to
    open the pane.
  - **Verify:** the acceptance latency of 9 of 10 within 5 seconds on cellular, and the
    focused-window mute.
- [ ] **T10: LAN path (MOB9, F6).**
  - **Contents:** the address offered over the channel; a direct connection with the same
    encryption; relay fallback; the path shown in host details.
  - **Security:** run `security-review` before merge, and note the firewall prompt in the user
    guide.
  - **Verify:** same Wi-Fi uses LAN; leaving the network moves to the relay without re-pairing.
- [x] **T11: Telemetry and privacy (MOB26–27, F7).** Done 2026-11-05 (before T5 and T8, which were still running); the backend deploy and the migration stay the owner's.
  - **Telemetry:** the counters, `internals/telemetry.md`, and the backend validation, deployed
    first.
  - **Privacy:** a new dated notice under `marketing/public/privacy/<date>/`; the App Store
    privacy answers match it.
- [ ] **T12: Docs (MOB28).**
  - **User guide:** `docs/user/mobile.md`, covering pairing, revoke, offline, keep-awake and the
    Windows limit, plus its `vi` translation (then `npm run docs:translations -- --stamp
    vi/mobile`).
  - **Internals:** `docs/internals/mobile.md`, covering the protocol, the encryption and the
    traps. Plus glossary terms and the `docs/README.md` index.
- [ ] **T13: Release pipeline (MOB24–25).**
  - **Contents:** the EAS project; Update channels per protocol version; the minimum iOS
    version and Expo SDK pinned; a public TestFlight beta.
  - **Submitting is an owner action.**
- [ ] **T14: Owner's walk and eye approval, one batch.**
  - **Walk:** the spec's Acceptance list on a real iPhone against `electron:dev`.
  - **Eye approval:** every UI from T5–T8 side by side with its mock.
  - **Findings:** go back into T4–T13 as fixes.
  - **Then:** the switch flip, the CHANGELOG entry and the App Store submission wait for the
    owner. No Playwright launch of the app unless asked.

## Owner actions, in the order they are needed

1. **Spikes, if you accept running them early:**
   - an Expo account;
   - an EAS dev build on your iPhone, with the device registered under Team `DJDD3T8LH7`.
2. **Before T6:** install Xcode, for the Simulator and the side-by-side screenshots.
3. **Before T3 deploys:** the Worker's secrets (the APNs key) and the route on
   `api.deck.spacevibe.dev/relay/*`.
4. **Before T9:** an App Store Connect record for bundle ID `dev.spacevibe.deck.mobile` and an
   APNs key (`.p8`).
5. **Before the T11 client release:** deploy the backend validation.
6. **T13:** the TestFlight external-beta submission (Beta App Review).

## Operating contract

Once the owner approves this plan, run T1 → T14 in order without asking again (S0 too, if
accepted).
- **Stop only for:**
  - a fork the table does not name;
  - a DL invariant;
  - a dependency outside F1;
  - a sibling repository;
  - a failed spike;
  - a spec requirement that turns out impossible as written;
  - an owner action from the list above.

  When stopping, post the question here and in chat.
- **In the unattended cloud run of 2026-11-05 nobody answers overnight.** So three of those
  stops do not halt the run:
  - **Not stopping for:** an unnamed fork, a dependency outside F1, or a spec requirement that
    proves impossible.
  - **What to do instead:** take the reversible option closest to the spec, write it under
    "Decisions taken" here and in the PR with the option turned down, and continue.
  - **Still never done:**
    - deploy, set secrets, or take any App Store, TestFlight or Expo account action;
    - push to `main`;
    - edit a sibling repository;
    - change a DL invariant;
    - bypass the pre-push hook.
- **Done for a desktop task:** its tests, lint, `scripts/check-changed.sh` and the `scripts/` +
  `src/styles/` suites pass. The `mobile/` check stands in for those in phone tasks.
  `npm test`, `npm run build` and `electron:build` stay CI's.
- **Merging and releasing:** merging each slice into local `main` is part of the task. Push,
  deploy, the switch flip and every App Store or TestFlight action need the owner.
- **Who implements:** Sonnet subagents (owner rule 2026-10-07).

## Verification

Evidence lands here, per task, with the command and the observed result.

**Baseline (clean clone of `origin/main` `f3d2aa3`, Linux cloud VM, 2026-11-05):** `npm test` →
`Test Files 4 failed | 626 passed | 1 skipped (631)`, `Tests 2 failed | 9692 passed | 22 skipped`.
All four are environmental and pre-existing:
- `scripts/electron-dev-watch.test.ts`, `electron/agent-hooks/codex-integration.test.ts`: "Electron
  failed to install correctly" (the VM has no Electron binary);
- `electron/dev-servers/protocol.test.ts` › rejects a certificate without an IP SAN for `::1` (no
  IPv6 in the sandbox);
- `electron/agent-shell/shell-bootstrap.test.ts` › bash startup keeps the user's PATH order.

`npx oxlint` → exit 0 (warnings only).

**T1:**
- A file with a type error and a failing test under `mobile/protocol/src/` is invisible to the root:
  `npx vitest run --exclude 'backend/**' --exclude 'mobile/**' mobile/` → "No test files found";
  `npx oxlint <file>` → exit 0, nothing reported; `npx prettier --check <file>` → ignored.
- The same file is caught by `npm run mobile:check`: unformatted → `mobile:check: prettier failed`;
  formatted → `protocol/src/broken.test.ts(3,7): error TS2322 … mobile:check: tsc protocol failed`.
- `npm run mobile:check` on the real tree → `mobile:check: all green`.
- `npx vitest run scripts/ src/styles/` → one failure, `electron-release-config.test.ts` pins two
  `ubuntu-24.04` jobs in `ci.yml`; updated to three for `mobile-check` in the same commit → green.
- Push from a clean `/tmp` worktree: the pre-push hook ran `mobile:check` and
  `npm test -- scripts/ src/styles/` → `Test Files 32 passed (32)`, `Tests 511 passed | 1 skipped`.

**T2 (`mobile/protocol/`):**
- `cd mobile && npx vitest run` → `Test Files 15 passed (15)`, `Tests 190 passed (190)`: encoding,
  the Node crypto against RFC 7748 §6.1, RFC 8439 §2.8.2 and RFC 5869 vectors, every Deck
  derivation in `test-vectors.json`, QR expiry/version/malformed, frames, the pairing exchange
  (one-time use, expiry on the desktop too, bad proof), the channel (in-order counters, a tampered
  frame dropped and counted while the next good one opens, close after 16 failures, version
  verdicts, no message before key confirmation), messages/results/tree parsers, chunking, sealed
  push, and a full in-memory phone ↔ desktop loopback.
- `npx tsc -p protocol/tsconfig.json` and `protocol/tsconfig.core.json` (`types: []`, no Node) pass;
  the core also compiles under the root's TS 5.6 with `--module commonjs --lib ES2022 --types node`.
- Prettier and `oxlint --deny-warnings` clean on `protocol/` and `scripts/`.
- The repro client (`npm run repro -- …`) typechecks and parses its arguments; its run against a
  real relay and `electron:dev` is **verify on the Mac**.

**T3 (`mobile/relay/`):**
- `cd mobile/relay && npm run check` (tsc + `node --test`, the Worker bundled by esbuild and run in
  Miniflare with SQLite Durable Objects, Node's `WebSocket` as the client) → `# tests 32 # pass 32
  # fail 0`: registration (201/409/bad bodies/expiry bounds), one-time claim, claim after expiry,
  the unclaimed-pairing alarm, auth for both roles, binary forwarding and drop when the peer is
  offline, `peer` notices, revoke from either side reaching the other and later connects reading
  `unknown`, 4413 frame size, 4429 rate, the third socket closing the oldest, APNs and Expo request
  shapes against a faked outbound service (generic alert only, `d: { p, c }`), push rate limit, the
  APNs-secrets-missing no-op, and **MOB7's canary**: a canary sent in binary frames and in a push is
  absent from every Durable Object storage value and every captured log line, raw, base64 (three
  alignments), base64url and hex.
- `npx wrangler deploy --dry-run --outdir dist` → 24.23 KiB, bindings `PAIRINGS`, `APNS_TOPIC`.
  `wrangler dev` answered `{"ok":true,"protocol":1}` on `/v1/health` and `/relay/v1/health`.
- **Verify after the owner deploys (S2):** whether a Worker's `fetch` reaches APNs over HTTP/2.

**T6 (`mobile/app/`):**
- `cd mobile && npm run check` → app check: `tsc --noEmit` without Node types, the test tsconfig with
  them, `oxlint --deny-warnings`, vitest `Test Files 10 passed (10)`, `Tests 64 passed (64)`, and
  `expo export --platform ios --no-minify` → `iOS Bundled 11378ms node_modules/expo-router/entry.js
  (1248 modules)`: Metro bundles the whole app for iOS without Xcode.
- Tested: the noble provider against `test-vectors.json`, the RFC vectors and the Node provider;
  pairing (happy path, reused code, desktop offline, relay unreachable, relay refusal, expired code);
  the connection through the real channel against a fake desktop (online, offline with last seen,
  version block, revoked, relay refusal, reconnect, handshake timeout); the ping watchdog; revoke on
  forget; the MOB4 lock rules; prefs defaults; status lines.
- **Verify on the Mac / iPhone (Expo Go):** camera QR scan, Face ID and the passcode, SF Symbols,
  Dynamic Type, the Keychain, pairing against `wrangler dev` and `electron:dev`, and the look next
  to the mock in both themes (T14's eye batch). No Simulator here, so no screenshots.

**T7 (`mobile/app/`):**
- `cd mobile && npm run check` → app vitest `Tests 115 passed (115)`, `iOS Bundled … (1280 modules)`.
  Tested: the numbered-choice parser on reconstructed Claude Code, Codex and opencode screens plus
  negatives (a list higher up the output, a list followed by a spinner or an idle input box); the
  Needs-you selection, order and See all; the tree store's replay after a reconnect; the terminal
  bridge's ready gating and snapshot-then-live order, held events and gap detection; zoom snapping
  and per-desktop persistence; the accessory key map; the 16 ms input batcher.
- **Verify on the iPhone (Expo Go):** xterm drawing inside the WebView and the Menlo cell ratio that
  sets fit-to-width; the keyboard opening in Live mode and keystrokes arriving; pinch and horizontal
  scroll; the header swipe; and whether a bare digit selects an option in each real agent (no real
  captures were available here; opencode's permission dialog has no numbers, so it gets Reply).

**T4 (desktop service):**
- `npx tsc --noEmit` and `npx tsc -p tsconfig.electron.json --noEmit` → clean.
- `npx vitest run src/terminal/ src/host/ src/lib/ src/ui/settings electron/control/ electron/ipc/
  electron/mobile/` → `Test Files 204 passed (204)`, `Tests 3145 passed (3145)`; the 24 files T4
  added or changed alone → 304 tests. Covered: pairing (the registration hash, the 5-minute expiry
  checked at start and at `pair-hello`, one-time use, a bad proof that does not burn the QR, the
  refusal when `safeStorage` cannot encrypt), the store (an unreadable file is never overwritten),
  the relay client (auth, ping, backoff, stopping on a terminal close code), a full phone session
  through the real channel with the version gate and the `desktop` event, every executor method
  with chunked bodies and error mapping, agent `send` with `expectedAgent` versus shell input,
  callerless `open` picking its window and holding the prompt until the first idle, the stream
  order (snapshot, buffered output, live output, with the snapshot holding exactly the output before
  the call), phone input reaching `paneIo.writePty`, push gated on focus and sealed per phone,
  keep-awake, revoke, the notifier's phone branch, and every new channel pinned in
  `scripts/electron-ipc-contract.test.ts` and `electron/wire-contract.test.ts`.
- **Verify on the Mac (`electron:dev`, isolated userData, repro client or phone):** Electron main's
  global `WebSocket` against `wrangler dev` (S5); a keystroke echo giving no `working` and no false
  `completed` push; a Claude Code TUI drawn from snapshot plus stream; callerless open across
  windows with the prompt after idle and focus unmoved; real `powerSaveBlocker` and `safeStorage`;
  no push while any Deck window is focused; revoke reaching the phone within 10 s.

**T11 (telemetry and privacy):**
- `npx vitest run electron/telemetry/ src/telemetry/ electron/mobile/ electron/ipc/ scripts/
  src/styles/` → `Test Files 61 passed (61)`, `Tests 803 passed | 1 skipped`: the four mobile
  counters reach the daily payload, reset on the next local day, carry no identifier, and are not
  reachable from the renderer's `telemetry_count` channel.
- `cd backend && npm test` → `# pass 57 # fail 0`: the optional `mobile` object validates, older
  payloads without it still validate, and the new notice is the current `/privacy`.
- `npm run build:landing` built. `tsc` (renderer and main) clean.
- **Owner:** apply `backend/migrations/0004-mobile-counters.sql` and deploy the backend **before**
  a client release that sends the counters (backend README rule); enter the App Store privacy
  answers from `mobile/app/store/privacy-answers.md`.

**T8 (`mobile/app/`, desktop handlers in T4):**
- `cd mobile && npm run check` → app vitest `Tests 148 passed (148)`, `iOS Bundled … (1302 modules)`.
  Tested: the new-agent flow and its error text; the guarded first prompt (idle → sent, a question
  on screen → held in the composer, timeout → held, agent exited → error, out-of-order events
  ignored); file navigation never leaving the checkout; the diff line classifier (with the
  desktop's synthetic untracked-file diff); usage formatting with the unpriced-tokens note; chunk
  assembly with the response before or after its chunks, gaps and timeouts.
- **Verify on the iPhone against `electron:dev`:** a fresh folder's trust question holds the prompt
  and a known folder gets it; the tab appears on the desktop without taking focus; sheet,
  segmented control, wide-diff scroll and large-file viewing on the device.

**T9 (push):**
- Desktop: the notifier's phone branch and main's focus gate and sealing landed in T4; the relay's
  APNs and Expo senders in T3.
- `cd mobile && npm run check` → app vitest `Tests 175 passed (175)` (including the
  `swift-contract.test.ts` that pins the AAD, nonce length, Keychain service and access group and
  the `d.p`/`d.c` keys between `NotificationService.swift` and `push.ts`), `iOS Bundled … (1374
  modules)`. Tested: environment → token kind and env, the registration message, re-registration
  on every relay `ready` and on rotation, the off switch sending nothing, the push key written,
  migrated and deleted under the extension's Keychain contract, the tap router, and the foreground
  decrypt of a `sealPush` payload (a tampered one keeps the generic line).
- **Verify with an EAS dev build on the iPhone (owner actions first: App Group and Keychain Sharing
  on both App IDs, an APNs key as Worker secrets, the relay deployed):** S1 — the extension
  rewrites "An agent needs you" into the real copy; the 9-of-10-within-5-s latency on cellular; no
  push while a Deck window is focused; tap opens the pane after unlock. In Expo Go only the
  generic line shows until the app is opened, and only with an EAS project id configured.

## Decisions taken (cloud run, 2026-11-05)

Each is the reversible option closest to the spec, taken without stopping (Operating contract).

1. **Branch.** The session was handed `mock/mobile-companion-2026-11-05` as its branch; the owner's
   prompt and this plan name `claude/mobile-companion`, so the build lives there and the mock branch
   is only read. Turned down: committing onto the mock branch, which is never merged.
2. **npm 10.9 crashes resolving vitest without a lockfile** (`Cannot read properties of null
   (reading 'edgesOut')`, also in an empty directory). Each `mobile/` lockfile was created once with
   `npx npm@11 install`; `npm ci` with npm 10 works from it. Turned down: `--legacy-peer-deps`,
   which changes what gets installed.
3. **CI runs `mobile/` in its own job** (`mobile-check`) instead of ignoring the path:
   `electron/mobile/` imports `mobile/protocol/`, so a protocol change must still run the root CI.
   `scripts/electron-release-config.test.ts` counted two Linux CI jobs and now counts three.
4. **The pre-push hook runs `mobile:check` when `mobile/` changed** and its packages are installed,
   and prints how to install them otherwise (CI runs it either way). Turned down: failing the push
   for a contributor who never installed the phone toolchain.
5. **`tsx` in `mobile/`'s dev dependencies** runs the protocol's no-phone repro client.
6. **Session keys are per connection**, from a fresh X25519 exchange on each transport mixed with
   the pairing key and the handshake transcript; frame counters restart per session. Turned down:
   one long-lived key with persisted counters, which a crash or a second transport can reuse.
7. **The relay never sees the QR secret**: it holds `sha256(claimToken)`, where `claimToken` is an
   HKDF of the secret, so it cannot forge the phone's pairing proof.
8. **Relay URL parsing is string-based** (`parseRelayUrl`): React Native's `URL` cannot set a
   protocol or a path.
9. **Expo's push service is the Expo Go path** (`kind: "expo"`), next to direct APNs. It carries
   the same generic line and ciphertext only; the privacy notice names it. Turned down: no push at
   all in Expo Go, which the owner's test tomorrow runs in.
10. **A socket for an unknown pairing is accepted as a plain socket and closed at once**, because
    closing a just-accepted hibernatable socket left the client waiting 10 s for the close.
11. **Expo SDK 58** (the latest; React Native 0.88, React 19.3, TypeScript 6.0). `npx expo install`
    cannot reach `api.expo.dev` through this VM's proxy, so the versions come from
    `expo/bundledNativeModules.json` by hand; `expo-crypto` (random bytes for the noble crypto) and
    `expo-font` (needed by `expo-symbols`) join the F1 list.
12. **T6 and T7 were committed before T4**: they were built at once by separate agents and finished
    first. Each task still has its own commit.
13. **A numbered choice sends the bare digit**, the same for every agent (MOB18: parsed buttons are
    agent-agnostic). Turned down: per-agent key recipes, which the spec rules out.
14. **Callerless `open` routes through a synthetic pane id** mapped to the chosen window, so
    `control-forward.ts` and the CLI stay untouched (F4). Turned down: a window field on the
    control command, which would change its twelve pinned keys.
15. **The renderer builds the tree** with the rail's own `buildRail` and main overlays the pane
    mirror. Turned down: grouping panes in main, a second copy of the rail's rules.
16. **Paths the phone may name are the ones a window reported** (projects and checkouts);
    `files.*`, `changes.*` and `open` refuse anything else with `outside-root`.
17. **Custom agents (`custom:` ids) are left out of `agents.list`** for now: the protocol's id
    pattern has no `:`. Opening a custom agent from the phone waits for a protocol bump.
18. **`DECK_RELAY_URL` is read only by unpackaged runs**, as `DECK_SUPABASE_URL` is: a packaged app
    cannot be redirected by its environment.
19. **The mobile counters are a separate `mobile` object** in the payload, optional on the backend,
    and main-side only. `pairedPhones` is a gauge read on every change, so the backend's aggregate
    reads as phone-days, not distinct phones (the migration and `telemetry.md` say so).
20. **App Store privacy answer:** "Device ID" (the push token and pairing id), not linked to the
    user, no tracking, for app functionality. "Data Not Collected" is the alternative, noted in the
    file; the owner picks when entering it.
21. **The phone runs the guarded first prompt itself** (MOB20): it opens the agent with no prompt,
    waits for its first idle, reads the screen, and sends only when no question shows; otherwise
    the prompt waits in the composer with a banner. Turned down: the desktop's prompt-on-first-idle
    path (the CLI's `--prompt`), which a first-run trust dialog would swallow. The protocol keeps
    the field; the phone always sends null.
22. **The push extension reads its key from a Keychain group the app shares**: the config plugin
    makes that group the app's only Keychain access group, so `expo-secure-store` writes there
    without the team id in JavaScript; the extension reads the resolved group from its Info.plist.
23. **No OS permission prompt at launch**: it appears when the first pairing completes or when the
    user turns Notifications on. Turning it off unregisters on the phone; the relay keeps the stale
    token until it is replaced, because its protocol has no "clear" message.
24. **T9 was committed before T5**, which was still running.

## Handoff

2026-11-05: plan written, approved for a full build (see Record) and committed for a cloud session,
together with the spec's link to it. The direction mock was pushed on its own branch,
`mock/mobile-companion-2026-11-05`. Nothing is built.
- **Next:** the cloud session builds T1–T13 on `claude/mobile-companion` and opens one draft
  PR.
- **The owner's test (T14):** happens the next day on the Mac.

/goal Mobile companion (docs/specs/2026-11-04-mobile-companion.md): behind `mobileCompanion`, an iPhone app built with Expo pairs with a running Deck by QR without an account, over an end-to-end encrypted Cloudflare relay at api.deck.spacevibe.dev/relay/* with a LAN fast path. Its home is every desktop's tree with up to three waiting panes pinned and answered in place. It renders any pane in xterm.js with Live mode, sends replies and keystrokes through the renderer's input path, opens a new agent with a prompt, and reads files, changes and usage. Push for requested/completed reaches the phone within 5 seconds in 9 of 10 tries on cellular, muted while a Deck window is focused. Deck keeps the machine awake while panes work. The relay's storage and logs hold no terminal text; revoke cuts a phone off within 10 seconds. Tests for the protocol, relay, desktop service, parser and IPC contracts pass. The user guide, its vi translation, the internals page, the privacy notice and the telemetry counters land. The app installs from TestFlight with EAS Update working, and the owner's walk on a real iPhone passes.
