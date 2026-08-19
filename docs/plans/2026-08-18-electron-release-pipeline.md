# Electron Release Pipeline — Publish, Self-Update, Cutover

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

> **Superseded downstream of Task 8 — 2026-08-20.**
> [docs/specs/2026-08-20-electron-stable-release-design.md](../specs/2026-08-20-electron-stable-release-design.md)
> `decided` replaces this plan's macOS-only shape for everything after Task 8: the
> workflow is four jobs covering macOS AND Windows, `promote` gates on the whole
> six-asset set, and Task 10's "lift the freeze" became "retire the tag trigger",
> with `release.yml` reduced to `workflow_dispatch` and its `release-freeze` job
> kept. Tasks 6-8 stay as shipped and are the baseline that design builds on.
> Task 9's macOS self-update evidence was produced on 2026-08-19 and closed Gate A
> for macOS.

**Goal:** Take the signed, notarized local build that
[2026-08-18-gate-a-electron-signing.md](2026-08-18-gate-a-electron-signing.md) `building`
produces, publish it from CI, prove the published build updates itself, and only then lift
the release freeze.

**Architecture:** A second workflow file beside the frozen `release.yml`, on its own tag
namespace, reusing that workflow's keychain-import and verification steps verbatim. The
Tauri path is not modified until the final task, and that task runs only on Task 9's
evidence.

**Tech Stack:** electron-builder 26.15.3, electron-updater 6.8.9, Squirrel.Mac, GitHub
Actions, `gh`.

**Spec:** [docs/specs/2026-08-11-electron-migration-design.md](../specs/2026-08-11-electron-migration-design.md)
`decided`.

## Global Constraints

This plan inherits **every** constraint and **every** fork (F1–F5) from
[2026-08-18-gate-a-electron-signing.md](2026-08-18-gate-a-electron-signing.md) — the same
secret names, the same env-name mapping, the same mandatory `zip` target, the same
untouched local configs. Read that plan's `Global Constraints` and `Forks` sections before
starting; the fork answers must already be recorded there.

Two constraints bear repeating because this plan is where violating them ships:

- **The release freeze stays** until Task 9's self-update evidence exists. Task 10 is the
  only task allowed to touch `.github/workflows/release.yml`.
- **Tasks 1–5 must be complete.** This plan starts from a locally verified signed and
  notarized `.app`; publishing an unverified one moves the failure into CI where it is
  much harder to read.

## Execution state — 2026-08-18

Tasks 6 and 7 are done and committed. Task 8 onward is blocked on the signing plan's
Task 1: the owner has to create the Developer ID certificate, and `security find-identity`
still reports zero.

The workflow shipped with three guards the written plan did not ask for, each recorded in
its commit: the tag/version step also rejects a version that names no `electron` channel;
the artifact step requires the zip AND `electron-mac.yml`, not just the app and the dmg;
and the release is verified as a draft and only then promoted to a pre-release, so a bad
build never reaches an installed app.

One blocker outside both plans was cleared on the way: `npm test` had two failures on
`main`, and Task 7's own "Validate source" step runs `npm test`, so a tag push would have
refused to build. Root cause was `preact/compat` rewriting `onBlur` to `onfocusout`, which
made four commit-on-blur tests dispatch an event no handler was listening for. Fixed in
`0fe4b5f`; the suite is 3127 green.

## Prerequisites

- Tasks 1–5 of the signing plan are done, with their `codesign` / `spctl` / `stapler`
  output pasted.
- The six repository secrets are set (`gh secret list` shows them).
- Forks F1–F5 are answered and recorded (all five decided 2026-08-18; see the signing plan).

---

### Task 6: Teach the host to see its own channel — DONE 2026-08-18 (`6a171c2`)

**Files:**

- Modify: `electron/updater/updater.ts:30-40` (the `AutoUpdaterLike` interface) and
  `:160-165` (where the loaded updater is configured)
- Modify: `electron/updater/updater.test.ts`

**Interfaces:**

- Consumes: fork F4's version scheme.
- Produces: an updater that can see a pre-release at all. Without this task the whole
  pipeline builds, publishes and verifies correctly, and then Task 9 reports "up to date"
  forever — the single most expensive way to discover a one-line omission.

`allowPrerelease` defaults to **false**, and `GitHubProvider.getLatestVersion` branches on
it (`GitHubProvider.js:51`): false takes `releases/latest`, which on this repository is a
Tauri release carrying no `electron-mac.yml`. True walks the Atom feed and matches the
channel derived from the running version's own prerelease component — which is the whole
mechanism fork F4 rests on.

It is set beside `autoDownload` and `autoInstallOnAppQuit` rather than in
`register-updater.ts` so that a test can assert it: those two are already configured in
`createUpdateLifecycle`, where the updater is an injected fake.

- [x] **Step 1: Write the failing test**

Add to `electron/updater/updater.test.ts`, beside the existing case that asserts
`autoDownload` and `autoInstallOnAppQuit`. The fake at the top of that file needs the new
field: `allowPrerelease = false;`.

```ts
it("allows pre-releases, because the channel lives in the version", () => {
  // `X.Y.Z-electron.N` is the channel. With allowPrerelease false,
  // GitHubProvider takes `releases/latest` instead of walking the feed, and
  // `releases/latest` on this repository is a Tauri release with no
  // `electron-mac.yml` in it.
  const updater = new FakeUpdater();
  createLifecycleWith(updater);
  expect(updater.allowPrerelease).toBe(true);
});
```

Use whatever helper the neighbouring cases use to build the lifecycle; do not introduce a
second construction path.

- [x] **Step 2: Run it and watch it fail**

```bash
npx vitest run electron/updater/updater.test.ts -t "allows pre-releases"
```

Expected: fails — `allowPrerelease` is `false`, and it is not yet on the interface.

- [x] **Step 3: Widen the interface and set the flag**

In `electron/updater/updater.ts`, add to `AutoUpdaterLike`:

```ts
  /**
   * Off by default, which makes GitHubProvider read `releases/latest` — a Tauri
   * release on this repository, with no `electron-mac.yml` in it. On, it walks
   * the release feed for the channel named by this build's own version.
   */
  allowPrerelease: boolean;
```

and beside the two existing assignments:

```ts
    loaded.allowPrerelease = true;
```

- [x] **Step 4: Run the updater suite**

```bash
npx vitest run electron/updater/
npx tsc -p tsconfig.electron.json --noEmit
```

Expected: green, and no type error from the widened interface at
`electron/ipc/register-updater.ts` — `electron-updater`'s real `AppUpdater` already
declares `allowPrerelease`, so the cast there stays valid.

- [x] **Step 5: Commit**

```bash
git commit -- electron/updater/updater.ts electron/updater/updater.test.ts \
  -m "fix(electron): let the updater see its own pre-release channel"
```

---

### Task 7: The Electron release workflow — DONE 2026-08-18 (`1d28c1a`)

**Files:**

- Create: `.github/workflows/electron-release.yml`

**Interfaces:**

- Consumes: the six secrets from Task 1, and the config from Task 2.
- Produces: a draft GitHub release carrying `.dmg`, `.zip` and the channel `.yml`.

The keychain-import and verification steps are lifted verbatim from `release.yml`
(`Import Apple Developer ID certificate`, `Verify signed and notarized macOS bundle`). Copy
them rather than rewriting: they are already correct, including the
`set-key-partition-list` call that stops `codesign` prompting on a headless runner.

- [x] **Step 1: Write the workflow**

```yaml
name: Electron Release

# A separate tag namespace from the frozen Tauri path (fork F3). `release.yml`
# is untouched by this file and its freeze still holds — a `-electron.N` tag
# builds only what is here.
on:
  push:
    tags:
      - "v[0-9]+.[0-9]+.[0-9]+-electron.[0-9]+"

permissions:
  contents: read

jobs:
  build:
    runs-on: macos-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4

      - name: Setup Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Validate the tag against package.json
        env:
          TAG: ${{ github.ref_name }}
        run: |
          set -euo pipefail
          version="$(node -p "require('./package.json').version")"
          test "$TAG" = "v$version" || {
            echo "Tag $TAG does not match package version $version"; exit 1;
          }

      - name: Validate source
        run: |
          npm run generate:menu:check
          npm test
          npm run build

      - name: Import Apple Developer ID certificate
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          set -euo pipefail
          certificate="$RUNNER_TEMP/deck-developer-id.p12"
          printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$certificate"
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings -t 3600 -u build.keychain
          security import "$certificate" -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain
          identity="$(security find-identity -v -p codesigning build.keychain | sed -n 's/.*"\(Developer ID Application:.*\)".*/\1/p' | head -n 1)"
          if [[ -z "$identity" ]]; then
            echo "No Developer ID Application identity was imported"
            exit 1
          fi
          rm -f "$certificate"

      - name: Build, sign, notarize and publish the draft
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          # One secret, two names: app-builder-lib reads
          # APPLE_APP_SPECIFIC_PASSWORD, Tauri's workflow reads APPLE_PASSWORD.
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          set -euo pipefail
          node scripts/verify-electron-release-signing.mjs
          npm run build
          npm run electron:build
          npx electron-builder --config electron-builder.release.yml --mac --arm64 --publish always

      - name: Verify the published bundle is signed, notarized and stapled
        run: |
          set -euo pipefail
          shopt -s nullglob
          apps=(dist-electron-release/mac-*/*.app)
          images=(dist-electron-release/*.dmg)
          archives=(dist-electron-release/*.zip)
          manifests=(dist-electron-release/*.yml)
          if [[ ${#apps[@]} -ne 1 || ${#images[@]} -ne 1 || ${#archives[@]} -ne 1 || ${#manifests[@]} -ne 1 ]]; then
            echo "Expected exactly one app, dmg, zip and updater manifest"
            exit 1
          fi
          codesign --verify --deep --strict --verbose=2 "${apps[0]}"
          spctl --assess --type execute --verbose=2 "${apps[0]}"
          xcrun stapler validate "${apps[0]}"
          xcrun stapler validate "${images[0]}"
```

- [x] **Step 2: Prove the workflow parses before tagging anything**

```bash
npx --yes @action-validator/cli@latest .github/workflows/electron-release.yml
npx --yes @action-validator/cli@latest .github/workflows/release.yml
```

Observed: both exit 0. The second call is the control — a validator that accepts anything
would also "pass" the file it was given, so the known-good Tauri workflow is run through it
in the same breath. (The flag in the original plan text was wrong: the CLI takes the path
as a positional argument.)

A tag push is an expensive way to discover a YAML typo.

- [x] **Step 3: Confirm the Tauri path is untouched**

```bash
git diff --stat main -- .github/workflows/release.yml src-tauri/
```

Expected: empty. If this shows changes, the freeze has been touched and the task is wrong.

- [x] **Step 4: Commit**

```bash
git commit -- .github/workflows/electron-release.yml \
  -m "ci(electron): add the signed macOS release workflow"
```

---

### Task 8: Publish the first Electron release

**Files:**

- Modify: `package.json` (version)

**Interfaces:**

- Consumes: Task 7's workflow.
- Produces: release `v<N>-electron.1` on GitHub, and the installed build that Task 9 updates.

- [ ] **Step 1: Set the version**

The version **is** the channel (fork F4), so its shape is not cosmetic: it must be
`X.Y.Z-electron.N`. The current value is `0.12.4-electron-preview.2`, which would put the
build on an `electron-preview` channel — pick deliberately and keep the choice for every
later release, because changing the prerelease word changes the channel and orphans every
installed build on the old one.

```bash
npm version 0.13.0-electron.1 --no-git-tag-version
```

Verify what the two sides will derive from it before going further:

```bash
node -e 'const s=require("semver");const v=require("./package.json").version;console.log(v, s.valid("v"+v), s.prerelease(v))'
```

Expected: the version, a non-null semver, and `[ 'electron', 1 ]`. A `null` in either
position means no release built from this version can ever be found by the updater.

- [ ] **Step 2: Commit and tag**

```bash
git commit -- package.json -m "chore(release): cut v<N>"
git tag "v<N>"
git push origin main "v<N>"
```

- [ ] **Step 3: Watch the run**

```bash
gh run watch "$(gh run list --workflow=electron-release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: green. Notarization dominates the wall clock.

- [ ] **Step 4: Verify the release assets**

```bash
gh release view "v<N>" --json assets --jq '.assets[].name'
```

Expected: exactly three names — one `.dmg`, one `.zip`, one `electron-mac.yml`. A missing
`.yml` means Task 9 cannot pass; stop and fix the `publish` block.

- [ ] **Step 5: Install it on the owner's Mac**

Download the dmg from the release page (not the local build — the point is to exercise what
a user gets), install, launch. Expected: no Gatekeeper warning, panes spawn.

---

### Task 9: Prove the app updates itself — the Gate A evidence

This is the criterion `release.yml`'s freeze comment names: "the Electron host can update
itself". Nothing before this establishes it.

**Files:**

- Modify: `package.json` (version), `docs/CONTEXT.md`, `AGENTS.md`

**Interfaces:**

- Consumes: the installed `v<N>` from Task 8.
- Produces: the evidence that unlocks Task 10.

- [ ] **Step 1: Cut a second release**

Repeat Task 8's steps with `<N+1>`. A trivial visible change (a version string somewhere in
the UI) makes the update observable rather than inferred.

- [ ] **Step 2: With `v<N>` still installed and running, check for updates**

Use the app's own "Check for Updates" menu item. Expected: it reports version `<N+1>` as
available — **not** "SpaceVibe Deck is up to date", and **not** `unsupported`.
`unsupported` here means `app.isPackaged` is false or the feed is unreachable; `up to date`
means the feed resolved to a release with no matching manifest, which is fork F4 being
wrong.

- [ ] **Step 3: Download and install through the app**

Expected: download completes, the busy-pane confirmation appears, the app relaunches on
`<N+1>`. Squirrel.Mac refuses an unsigned or improperly signed app silently — if the
install does nothing, the signature is the first suspect.

- [ ] **Step 4: Confirm the running version**

Expected: the app reports `<N+1>`. **Paste the observed version and the sequence of states
the updater passed through.** This is the whole point of the gate.

- [ ] **Step 5: Record the evidence**

Update `docs/CONTEXT.md` with a dated section describing the run, and change the
`AGENTS.md` drift-table row for "Electron can replace Tauri on both supported platforms":
Gate A is closed for macOS; Gate C (Windows) remains open, so the row stays `partial`, not
`verified`. Do not overstate — this run says nothing about Windows.

- [ ] **Step 6: Ask before committing the docs**

Per D14, documentation is not committed until the owner has read it.

---

### Task 10: Lift the freeze and retire the Tauri path

Only start this task when Task 9's evidence exists. It is listed here so the plan is
complete, but it is a **separate owner decision** — the cutover, not the gate.

**Files:**

- Modify: `.github/workflows/release.yml` (delete the `release-freeze` job and the
  `needs:` line under `resolve-target`)
- Modify: `AGENTS.md`, `docs/CONTEXT.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Ship the final Tauri release**

Per `AGENTS.md`: the last Tauri release must explain the manual transition and where the old
data lives (`~/Library/Application Support/` — name the exact path for the Tauri bundle id).
Users cannot be updated across bundle identities; they have to be told.

- [ ] **Step 2: Remove the freeze — and the test that guards it**

`scripts/electron-release-config.test.ts` asserts that `release.yml` still contains the
`release-freeze` job ("leaves the Tauri release path frozen"). That assertion exists so
nothing lifts the freeze by accident; lifting it ON PURPOSE means deleting or rewriting
that case in the same commit. A red test here is the guard working, not a regression.

- [ ] **Step 2b: Remove the freeze job itself**

The freeze job's own comment names the removal procedure: delete the job and the `needs:`
line. Do this only after Step 1 has actually shipped.

- [ ] **Step 3: Update the living docs**

`AGENTS.md`'s "Deck ships the Electron host" row moves from `backlog` to a real state, and
the resolved forks (F1–F5) move from this plan's table into
`docs/ARCHITECTURE.md#resolved-forks` (D9).

- [ ] **Step 4: Ask before committing**

D14 again — the owner reads the docs before they are committed.

---

## Self-Review

**Spec coverage.** The migration spec's release half is: sign, notarize, publish, self-update,
retire Tauri. Signing and notarization are the signing plan's Tasks 2–5; here Tasks 6/7
publish, Task 9 self-updates, Task 10 retires. The spec's clean-install decision is carried by
fork F1's userData consequence and by Task 10 Step 1.

**Known gaps, stated rather than hidden.**

- **Windows (Gate C) is untouched.** The Electron host has no signed Windows path after this
  plan and the unsigned NSIS preview remains the only Windows artifact.
- **Universal binaries** are deferred by fork F2; Intel Macs are not served by the Electron
  build until that follow-up.
- **No provenance or trust-chain validation** on the Electron path. The Tauri workflow has
  `create-updater-provenance.mjs` and `verify-updater-manifest.mjs`; the Electron path relies
  on electron-updater's own signature verification instead. Reaching parity is a follow-up
  worth its own plan — name it as a gap when Task 10 lands rather than implying equivalence.
- **RC channels** have no Electron equivalent. The Tauri path isolates `rc.*` tags onto
  separate channels so a candidate cannot move production; fork F4's single channel does not
  reproduce that.

**Type consistency.** `electron-builder.release.yml` is read by three consumers under one
name each: the signing plan's Task 3 test, its Task 4 preflight, and Task 7's workflow here.
The channel is substituted nowhere — fork F4 derives it on both sides from the version
string, so `X.Y.Z-electron.N` is the one value that has to be right, and Task 8 Step 1
checks it explicitly. `arm64` (fork F2) appears in the config, the npm script and this plan's
workflow — all three must agree or the build produces an arch the publish step does not
upload.

**One gap this plan closes late, on purpose.** After the cutover the Electron build will
eventually want a *stable* channel, and a stable build resolves `releases/latest`, which is
where the Tauri releases still are. Task 10 Step 1's final Tauri release is what makes that
safe; until then every Electron release stays on the `electron` channel.
