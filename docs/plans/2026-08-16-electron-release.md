# Electron Release Plan — macOS, signed, self-updating

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans or
> superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.
> Several tasks here are **listed forks** in [`AGENTS.md`](../../AGENTS.md) (bundle,
> dependency, signing, release channel, updater, version configuration). Each fork task
> below carries the decision it needs; do not widen one on your own.

**Goal:** ship a packaged, Developer ID signed, notarized macOS Electron build of Deck that
completes a real discover → download → install → relaunch update cycle, published from CI on
a tag, **alongside** the existing Tauri release rather than replacing it.

**Not the goal:** the cutover. Retiring the Tauri channels, the final Tauri release that tells
users to download by hand, the doc page naming the old store path, and the README/landing copy
edits all belong to a separate cutover plan that does not exist yet
([migration design §5](../specs/2026-08-11-electron-migration-design.md)).

**Owner decisions taken 2026-08-16 (before this plan was written):**

- Scope stops at "Electron build that auto-updates", shipped in parallel with Tauri.
- The Apple Developer Program is **not bought yet**; buying it is task P0.2 and it blocks the
  whole signing branch.
- Windows: the owner wants a signing certificate but **has no ≥3-year business entity**, which
  is the eligibility bar Azure Trusted Signing has historically applied. Windows is therefore a
  research track (P0.3) that does **not** block anything in this plan, and no Windows Electron
  artifact is released here — Gate C (real Windows hardware) is still unmet.

## 0. Standing conditions

- **Electron only.** Tauri stays feature-frozen and keeps its own channels, key and workflow
  jobs untouched. Nothing in this plan may change `src-tauri/tauri*.conf.json`, the Minisign
  secrets, or the existing `build-macos-stable-draft` job's behaviour.
- **R1:** English only — strings, comments, docs, commits.
- **R4:** the updater, quit/busy guard and packaging paths are load-bearing. Changes land with
  tests in the same task.
- **R6:** new IPC payloads use flat keys; `scripts/electron-ipc-contract.test.ts` stays green.
- **Trust material is not shared.** `electron-updater` gets its own feed, its own manifest
  filenames and Apple's signature as its only trust root. The Tauri Minisign key is never
  reused (migration design §6).
- Per-task gate: `npm test`. Repo finish gate:
  `npm test && npm run build && npm run electron:build && npm run generate:menu:check`.
- Commits: conventional, scoped, one concern each (`build(electron): …`, `feat(updater): …`,
  `ci(release): …`). Stage by explicit path — the tree carries unrelated uncommitted work.
- Do **not** commit this plan until the owner has reviewed it (D14).

## 1. Where this starts from

Verified 2026-08-16 by reading the tree, not assumed:

| Thing                             | State                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `electron-updater` dependency     | **absent** from `package.json`                                                                                   |
| Production electron-builder cfg   | **absent** — `electron-builder.gate-m.yml` explicitly disclaims being a release path (`--dir`, `identity: null`) |
| Main-process update handlers      | `electron/ipc/register-updater.ts` — single-flight kept, the check itself is a **stub**                          |
| Renderer update controller        | intact: `src/updater/update-controller.ts` (267 LOC), pill, About section, attempt store, preview                |
| Renderer updater adapter          | `src/updater/tauri-updater-adapter.ts` returns `null` — "no update available" on purpose                         |
| Release CI                        | `.github/workflows/release.yml` builds **Tauri** on every `v*` push; secrets are Minisign only                   |
| Gate B (node-pty universal in CI) | everything done except one GitHub Actions run                                                                    |
| Gate A (updater end to end)       | blocked on the Apple identity                                                                                    |
| T18 (packaged manual pass)        | **never run**                                                                                                    |

The renderer half of the updater is therefore already built and tested; this plan supplies the
host half, the package it runs inside, and the pipe that feeds it.

## 2. File structure (new / modified)

```text
electron-builder.yml                       NEW  production packaging config (mac dmg + zip, universal)
build/entitlements.mac.plist               NEW  hardened-runtime entitlements (JIT, unsigned exec memory)
build/entitlements.mac.inherit.plist       NEW  inherited entitlements for node-pty's spawn-helper
electron/updater/updater.ts                NEW  electron-updater lifecycle owned by main
electron/updater/updater.test.ts           NEW  unit tests over the lifecycle state machine
electron/ipc/register-updater.ts           MOD  stub → real check/download/install behind the single-flight
electron/ipc/channels.ts                   MOD  new flat-key channels + renderer events
electron/preload.ts                        MOD  expose the new channels
src/updater/electron-updater-adapter.ts    NEW  replaces tauri-updater-adapter.ts (same exports)
src/updater/tauri-updater-adapter.ts       DEL  after the swap; nothing else imports the name
src/updater/update-controller.ts           MOD  only if the adapter contract needs widening — prefer not
scripts/verify-electron-package.mjs        NEW  production sibling of verify-electron-gate-m-package.mjs
scripts/verify-electron-package.test.ts    NEW  unit tests for the verifier's parsing halves
scripts/verify-electron-updater-feed.mjs   NEW  latest-mac.yml shape/version/checksum assertions
.github/workflows/release.yml              MOD  new Electron draft-build + validate + publish jobs
scripts/release-workflow.test.ts           MOD  cover the new jobs, their gating and channel isolation
package.json                               MOD  version bump, electron-updater dep, new scripts
docs/CONTEXT.md, AGENTS.md                 MOD  ledger + drift table at the end (Task 14)
```

## 3. Task list

### Phase 0 — Preconditions (no code)

- [ ] **P0.1 Clean the tree.** The checkout carries a large uncommitted checkpoint across
      `src/`, `electron/` and `docs/`. Land or park it before anything here is tagged; a
      release cannot be cut from this state. Verify: `git status --short` shows only this
      plan's own files.
- [ ] **P0.2 Buy the Apple Developer Program** and create a `Developer ID Application`
      certificate. Export the identity as `.p12`, base64 it, and add the five secrets the
      migration design §6 names, none of which exist today: `CSC_LINK`, `CSC_KEY_PASSWORD`,
      `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Verify: `security find-identity
-v -p codesigning` lists the identity locally; the repo's secret list shows five new names.
      **This is the longest-lead item and it blocks Phases 2, 5 and Gate A entirely.**
- [ ] **P0.3 Windows signing research (parallel track, blocks nothing here).** Establish, with
      current vendor documentation rather than memory, what is actually purchasable without a
      ≥3-year business entity: Azure Trusted Signing eligibility today, OV certificates with
      individual/sole-proprietor validation, and what each does and does not do about SmartScreen
      (an OV certificate does **not** clear SmartScreen immediately; reputation accrues).
      Record the finding and the owner's decision in this file. Windows Electron artifacts stay
      out of the release until Gate C has real hardware regardless of the certificate.
- [ ] **P0.4 Decide the version and tag scheme** — a listed fork (version configuration).
      Recommendation to approve or reject: bump `package.json` to **0.13.0**, keep the single
      `v*` tag trigger, and let one tag build **both** hosts into the same GitHub release —
      Tauri assets and `latest.json` exactly as today, Electron assets plus `latest-mac.yml`
      beside them. One tag, one release page, two asset sets, two independent update channels.
      The alternative (a separate `electron-v*` tag namespace) doubles the release ritual for
      the duration of the parallel period. Record the choice here before Phase 4 starts.
- [ ] **P0.5 Confirm the feed provider.** `electron-updater`'s GitHub provider needs the
      releases to be readable by the installed app. Check the repository's visibility and, if
      it is private, choose the generic provider over an HTTPS endpoint instead. This is a
      release-channel fork; record the answer here.

### Phase 1 — Packaging (independent of signing, start immediately)

- [ ] **T1. Production `electron-builder.yml`.** `appId: dev.spacevibe.deck`,
      `productName: Deck`, mac targets `dmg` + `zip` (Squirrel.Mac updates from the zip),
      `universal`. Carry over every lesson the Gate M config already encodes, because each was
      a real failure: `extraMetadata.main`, `asarUnpack` for `node-pty`, `x64ArchFiles` for its
      prebuilds, and a `files` list that includes **`dist-electron/electron/vendor/**`** — the
      vendored react-grab bundle is read from disk at runtime, and a glob that only matches
      `.cjs` drops it, killing Inspect silently in the packaged app while every gate stays
      green (MVP plan T19). Add the `spawn-helper` executable-mode step; the npm tarball ships
      it `0644` and node-pty's own postinstall never chmods `prebuilds/`, whose only symptom is
      `posix_spawnp failed`. Verify: `npm run electron:package` produces `dist-release/`.
- [ ] **T2. `scripts/verify-electron-package.mjs`.** The production sibling of the Gate M
      verifier, same two halves. **Structure:** both architecture slices present (`file` on the
      binary), `node-pty` unpacked with executable helpers, `vendor/` present, packaged
      `package.json` `main` exact, version equal to `package.json`'s. **Runtime:** launch the
      packaged app against a disposable fixture outside the repo, assert a pane paints and a
      real PTY echoes back — the `electron:smoke` assertions, but against the packaged binary.
      Verify: it fails when `vendor/` is deleted from the built app (prove the check by
      breaking it).
- [ ] **T3. Local packaged run + T18.** Run the never-executed manual pass on the packaged
      build, not on `electron:dev`: open pane, split, new tab, switch preset, open a workspace,
      settings round-trip, prompt board paste, agent chip appears, attention state changes,
      find, links, ⌘⇧M detach, quit with a busy pane. Paste the result into this file. Add the
      surfaces the drift table lists as suite/build-only that a user meets on first launch —
      the tab strip, the agent rail, the open board's one-click path, the modals, the dock's
      three tabs. **A release cannot be tagged with T18 outstanding.**

### Phase 2 — Signing and notarization (needs P0.2)

- [ ] **T4. Hardened runtime + entitlements.** `hardenedRuntime: true`, `gatekeeperAssess:
false`, entitlements granting JIT and unsigned executable memory (V8), plus inherited
      entitlements so `spawn-helper` and the node-pty prebuilds keep working under the hardened
      runtime. Verify: `codesign --verify --deep --strict` and `spctl -a -vvv` on the local
      build.
- [ ] **T5. Notarize and staple.** `mac.notarize` with the Apple ID/team/app-specific password,
      then staple the ticket. Verify: `xcrun stapler validate` passes, and a build downloaded
      through a browser on a second Mac opens with no Gatekeeper prompt.

### Phase 3 — Updater (code; testable before signing, provable only after)

- [ ] **T6. Add `electron-updater`** and `electron/updater/updater.ts`: check → download →
      install → relaunch, with the failure states the renderer controller already models. Keep
      the existing single-flight in `register-updater.ts` — the renderer's behaviour must not
      change — and keep the busy-pane guard: an install that restarts the app while an agent is
      working is the failure the quit census exists to prevent. Verify: unit tests over the
      state machine with the network layer faked; `npm test` green.
- [ ] **T7. Channels and manifests.** Configure the publish target chosen in P0.5. Deck's
      Electron feed reads `latest-mac.yml`; Tauri's reads `latest.json`. They must not collide
      in name, path or trust material. Decide and record how a release candidate is separated
      from stable (`electron-updater` channel files: `beta-mac.yml` / `alpha-mac.yml`), mirroring
      what `release.yml` already does for the Tauri RC channels.
- [ ] **T8. Renderer adapter swap.** `src/updater/electron-updater-adapter.ts` exporting exactly
      `checkForUpdate` and `relaunchDeck`, backed by the new IPC. Delete
      `tauri-updater-adapter.ts` — its docblock says outright that it is renamed when this lands.
      Do not reshape `update-controller.ts` unless the real lifecycle genuinely needs a wider
      contract; if it does, that is a separate commit with its tests. **The renderer is shared,
      so this file also runs under `npm run tauri dev` and browser `npm run dev`, where the
      Electron bridge does not exist.** Today's stub is host-agnostic by accident of being a
      stub; the replacement must be so on purpose — absent bridge resolves to `null`, the same
      fail-soft the other `src/host/` facades use. Without it, the next Tauri hotfix built from
      `main` ships a broken update UI instead of a quiet "no update available". Verify:
      `npm test` (`update-controller.test.ts`, `update-action.test.tsx`,
      `update-menu-actions.test.ts`) plus one case asserting the no-bridge path returns `null`.
- [ ] **T9. IPC contract.** New channels use flat keys and appear in
      `scripts/electron-ipc-contract.test.ts`'s scan. Verify: that test green.

### Phase 4 — Release CI (needs P0.4; produces the Gate B evidence)

- [ ] **T10. `build-macos-electron-draft` job.** macOS runner, Node 22, `npm ci`,
      `npm run build && npm run electron:build`, `electron-builder --mac --universal` with the
      signing/notarization env, then `scripts/verify-electron-package.mjs` **inside CI** before
      any asset is uploaded to the draft. Reuse the existing `prepare-release-notes` output
      rather than writing new boilerplate. **This run is what clears Gate B** — "builds on the
      maintainer's Mac" and "builds on a CI runner" are not the same claim.
- [ ] **T11. `validate-macos-electron` job.** Prove the draft's renamed assets match the local
      build's checksums (the existing macOS/Windows validation jobs are the template), and run
      `scripts/verify-electron-updater-feed.mjs` over `latest-mac.yml`: version equals the tag,
      the referenced file exists, its sha512 matches. Publication stays gated on this job, like
      every other asset in this workflow.
- [ ] **T12. `scripts/release-workflow.test.ts`.** Extend it to assert: the Electron jobs
      trigger on the same tags, publish nothing validation has not passed, and **do not touch
      the Tauri channel files or the Minisign secrets**. Verify: `npm test`.

### Phase 5 — Gate A and the evidence that makes this a release

- [ ] **T13. Gate A, by hand, on a real signed build.** Install version N from the published
      artifact (downloaded, not copied out of `dist-release/`), publish N+1, then watch the
      installed app discover → verify → download → install → relaunch into N+1. Record the
      version strings, timestamps and any dialog text here. **This cannot be replaced by a unit
      test, by design** — and remember the trap: the updater that performs an upgrade lives in
      the **old** build, so the first Electron release is the one whose updater has never
      upgraded anything.
      **Gate A has a second half this plan does not do.** The frozen spec (§11) also asks what
      `electron-updater` does with an **unsigned Windows NSIS build**. Windows is out of scope
      here, so that half is deferred with Gate C rather than answered — say it in the ledger,
      do not quietly drop it.
- [ ] **T14. Ledger.** Update `docs/CONTEXT.md` with the run and its evidence, and
      `AGENTS.md`'s "Current direction" plus the drift table. Gate B: resolved. Gate A:
      **"resolved for macOS; the unsigned-NSIS recording is deferred with Gate C"** — not a flat
      "resolved", which would contradict the frozen spec. The Windows and cutover rows stay open
      and unchanged. Record every fork this plan resolved with its one-line reason.

## 4. Risks

- **Gate A is the only proof that matters and it is last.** Everything before it can be green
  while the shipped app still cannot update itself. Do not describe the release as ready before
  T13 has output.
- **The tree is dirty and shared.** Other sessions leave files staged in this checkout. Stage by
  explicit path; never `git add -A`.
- **Notarization fails late and slowly.** It runs at the end of a long build and its errors
  arrive by ticket. Budget for repeat runs, and test the entitlements locally (T4) before
  putting them through CI.
- **`node-pty` under the hardened runtime is unproven here.** Gate M packaged it unsigned;
  signing plus hardened runtime is a different environment for a helper binary that spawns
  processes. T4's verification is not a formality.
- **Windows is untouched and stays untouched.** Neither a certificate (P0.3) nor a green macOS
  release changes Gate C. Do not let a passing macOS run turn into a cross-platform claim.
- **Parallel channels invite a mistake.** A Tauri user must never be offered an Electron
  artifact, and vice versa. T12 is what keeps that from being a matter of care.

## 5. Open decisions (fill in as they are taken)

| Decision                                     | Task | Answer |
| -------------------------------------------- | ---- | ------ |
| Version + tag scheme for the parallel period | P0.4 | _open_ |
| Feed provider (GitHub vs generic HTTPS)      | P0.5 | _open_ |
| Windows certificate route                    | P0.3 | _open_ |
| RC channel naming for the Electron feed      | T7   | _open_ |

## 6. Verification log

_(Paste command output here as tasks complete — T3's manual pass, T10's CI run, T13's update
cycle. This section is the plan's evidence, not a summary of it.)_
