# Cutting a release

> For maintainers. Using Deck? See [docs/user/](../user/).

One pushed tag ships SpaceVibe Deck for macOS and Windows, both self-updating, through
[`electron-release.yml`](../../.github/workflows/electron-release.yml). This page is its
runbook.

Manual native acceptance, real-device upgrade checks, and Windows install/update checks run
only when explicitly requested. They do not block release completion or issue closure.
Report the checks actually performed; omitted checks are not successful test results.

## What a release is

- **The trigger tag is `build/<release tag>`**, and only the stable shape `build/vX.Y.Z` is
  accepted for now. Every build through 1.2.0 checks with `allowPrerelease` on and installs
  the feed's newest entry, so a promoted `vX.Y.Z-electron.N` would move every stable install
  onto the `electron` channel for good. The
  [workflow](../../.github/workflows/electron-release.yml) refuses prerelease tags until the
  installed base runs a build that resolves `releases/latest`.
- **The release tag is the trigger tag without the `build/` prefix**, and it does not exist
  until the run has finished. GitHub creates it when the draft is promoted. Pushing a bare
  `vX.Y.Z` tag would advertise the version through `releases.atom` ten minutes before its
  manifests existed, and every running app that checked in that window would report a
  failed update check. `build/v…` is not valid semver, so a prerelease client skips it, and
  a stable build after 1.2.0 never reads the feed's tag list — it resolves
  [`releases/latest`](../../electron/updater/updater.ts). Builds through 1.2.0 still read it
  and take its first entry, so while a run is in flight they ask the trigger tag for
  manifests, get a 404, and hide the failed check. Keep that window short.
- **The tagged commit must be reachable from `origin/main`**, and the tag must equal
  `v<version>` for the `version` in [`package.json`](../../package.json). Either mismatch
  fails the run before anything is built.
- **The version is the channel.** A bare `X.Y.Z` is stable; `X.Y.Z-electron.N` is a
  prerelease. Only the client derives the channel from that string: electron-updater reads
  it off the release tag. electron-builder does not (for the GitHub provider app-builder-lib
  derives a channel from the version only for `generic`), so with `publish.channel` unset in
  [`electron-builder.release.yml`](../../electron-builder.release.yml) it always writes the
  default manifest names, which step 2 below relies on.
- **The design is fail-closed.** Every artifact lands in a draft release, and the draft goes
  public only after a downstream job has counted the full two-platform asset set on the
  release itself. A failure anywhere leaves a draft that no installed app can see. A run that
  dies in `promote` and publishes nothing is the design working, not a bug.

## The five jobs

`prepare` → `source-check` + `mac` + `windows` (parallel) → `promote` in
[the release workflow](../../.github/workflows/electron-release.yml). Ubuntu jobs are pinned
at `ubuntu-24.04`; Node stays at 22. Source/platform jobs install with `npm ci`.
The shortened critical path still includes signing and notarization; a ~7-minute release
workflow is a target, not a time guarantee, and the cut also waits for main CI beforehand.

### `prepare` (ubuntu)

1. Full-history checkout, then refuse a tag whose commit is not an ancestor of `origin/main`.
2. Validate the tag against `package.json`'s version and derive the channel.
3. Require the tagged commit's nonempty exact `## <version>` CHANGELOG section.
4. Create the draft with `gh release create "$TAG" --draft --target "$(git rev-parse HEAD)"`.
   Use the peeled checkout commit, including for annotated trigger tags.
   Creating it upstream of both platform jobs is what stops the two electron-builder
   publishers from each creating their own release. `--target` is required because the
   release tag does not exist yet.

### `source-check` (ubuntu-24.04)

After `prepare` creates the draft, independently check out the exact tag, install dependencies
and run `npm run lint`, `npm test`, `npm run build` with a fail-fast shell. This
[read-only job](../../.github/workflows/electron-release.yml) runs alongside both platform
builds. If it fails, platform uploads can remain in the draft, but promotion cannot run.

### `mac` (macos-latest)

1. Import the Developer ID certificate into a throwaway keychain, including
   `set-key-partition-list` so `codesign` cannot block on a GUI prompt.
2. Run [`scripts/verify-electron-release-signing.mjs`](../../scripts/verify-electron-release-signing.mjs).
   A missing identity does not fail electron-builder; it silently produces an unsigned app,
   which this preflight refuses in seconds instead of at notarization ten minutes later.
3. `npm run build`, `npm run electron:build`, then
   `npx electron-builder --config electron-builder.release.yml --mac --arm64 --publish always`.
4. Verify the outputs: exactly one `.app`, one `.dmg`, one `.zip` and one `latest-mac.yml`;
   `codesign --verify --deep --strict` on the bundle and on node-pty's `spawn-helper` (it
   lives outside the asar and is the first thing a dependency bump breaks); `spctl --assess`;
   `xcrun stapler validate`; and `codesign --test-requirement="=notarized"`, the one offline
   proof. The DMG is not asserted: electron-builder staples the `.app` and packs it into an
   unsigned image on purpose, and Gatekeeper assesses the app at launch, not the image.

### `windows` (windows-latest)

`npm run build`, `npm run electron:build`, then
`npx electron-builder --config electron-builder.release.yml --win --x64 --publish always`,
under Git Bash with `set -euo pipefail` because pwsh only fails a step on the last command's
exit code. **There is no signing step**: no certificate is configured, electron-builder warns
and continues, and SmartScreen warns on first install. No runtime assertion is possible on a
runner, so this job proves only that the installer and its manifest were produced.

### `promote` (ubuntu)

`needs: [prepare, source-check, mac, windows]` names `prepare` directly on purpose: `needs.<job>.outputs`
resolves only for jobs in that list, and an empty `TAG` makes `gh release view ""` answer
with the latest release, so every assertion would run against whatever shipped last.

1. Refuse empty `TAG` or `CHANNEL`.
2. Read the asset names the release actually serves and require all six:

   | Asset                | Role                                                                 |
   | -------------------- | -------------------------------------------------------------------- |
   | `*.dmg`              | macOS first install                                                  |
   | `*-mac.zip`          | macOS update payload (electron-updater reads the zip, never the dmg) |
   | `latest-mac.yml`     | macOS update feed                                                    |
   | `*-setup.exe`        | Windows first install and update payload (NSIS reruns the installer) |
   | `latest.yml`         | Windows update feed                                                  |
   | `<payload>.blockmap` | Differential download, by the exact `path` each manifest names       |

   The manifests are `latest-mac.yml` / `latest.yml`, not `electron-mac.yml`: for the GitHub
   provider app-builder-lib always writes the default name. The client asks for its channel
   file first and falls back to the default one, so the two halves meet.

3. Write the final notes. A fixed header states the platform limitations (unsigned Windows
   installer, Windows not runtime-verified, no Intel Macs). Under it, a **stable** release
   carries the `## <version>` section of the **tagged commit's** `CHANGELOG.md`; a
   prerelease keeps GitHub's generated commit list. A stable release is titled
   `SpaceVibe Deck X.Y.Z`; a prerelease keeps the bare tag.
4. Promote: stable becomes `--latest`, prerelease becomes `--prerelease`. Promotion is what
   creates the release tag, so the version becomes discoverable only now.
5. Write the run summary (source SHA, channel, promoted, published assets).
6. Announce a **stable** release on Discord (version, release link, CHANGELOG section) through
   the webhook in the `DISCORD_WEBHOOK_URL` repository secret (Discord channel settings →
   Integrations → Webhooks). A missing secret or a failed post only warns.

## `CHANGELOG.md` is machine-read

The `promote` job extracts the section between `## <version>` and the next level-2 heading
from [`CHANGELOG.md`](../../CHANGELOG.md) at the tagged commit and **fails the run if that
section is empty**. Consequences:

- A stable tag without its section stays a draft. Write the section in the release PR before
  tagging.
- Do not rename, move or restructure the file, and keep the `## <version>` heading exact.
- Each section is written for users and frozen at its tag. It is never an auto-generated
  commit list.

## Cut from clean main

[`npm run release:cut`](../../scripts/release-cut.mjs) bumps the version, freezes pending
notes, commits only `package.json`, `package-lock.json` and `CHANGELOG.md`, pushes main,
waits for successful push CI on that exact SHA, pushes `build/vX.Y.Z`, and observes public
promotion and updater assets. Invoking it authorizes those remote actions. Run on clean
local `main` after the primary checkout's writer hands it off; it refuses dirty, behind,
diverged, wrong-repository and incomplete-release states. Never run it as a release probe.

### Verify the commit before cutting it

To ship only what was looked at, build a preview of the commit the cut will use, verify it,
then cut that SHA:

1. Dispatch [`electron-preview.yml`](../../.github/workflows/electron-preview.yml) from `main`
   with `ref` set to the commit (`gh workflow run electron-preview.yml --ref main -f ref=<sha>`).
   It builds the signed, notarized macOS app and the unsigned Windows installer from the
   shipping config, keeps them as 7-day artifacts and publishes nothing: no draft, release,
   tag or manifest.
2. Verify the artifacts. A release switch stays at its file value in a packaged build, so a
   branch shows a gated feature only if it carries the activation commit.
3. Run `npm run release:cut -- --expect-sha <sha>`. It refuses before any edit when local
   `main` HEAD is not that commit. When `main` moved, either build a preview of the new HEAD,
   or leave the newer commits unshipped: a feature merged behind a switch is harmless, one
   without a switch is not.

The preview accepts a branch of this repository or a commit already on one, and runs only when
dispatched from `main`, because the signing secrets run beside the code at `ref`. A fork's
commit is refused. The workflow mirrors the `mac` and `windows` jobs, so change them together.

Maintain reviewed user-facing notes under exactly `## Unreleased` at the top of CHANGELOG
on main at integration time. The command renames that heading to exactly `## X.Y.Z`; it
refuses missing/empty/duplicate sections and preserves older release sections. It does not
invent notes. Switch activation and its pending notes share one main commit; see
[release switches](../internals/traps.md#release-switch-convention).

The [version policy](../../scripts/release-cut-model.mjs) inspects commits since the latest
promoted stable baseline: fix-only means patch, any `feat` means minor, including a hidden
feature. Breaking metadata stops for a separate major-release decision. Maintenance-only
or ambiguous history needs `npm run release:cut -- --bump patch` (or `minor`) and reviewed
notes; a bump override cannot bypass safety checks. Beta/prerelease tags remain blocked.

`npm run release:cut -- --dry-run` reads eligibility and prints the proposed version/notes;
it does not fetch, lock, edit, commit, push, tag or dispatch. Missing local baseline history
must be fetched deliberately. Once a cut commit exists, resume using
`npm run release:cut -- --resume <full-cut-SHA>` on main containing that commit (exact HEAD before a missing tag push); it verifies versions,
notes, immutable tags and run identity and never bumps again or reruns successful prepare.
Existing pushed attempts can be monitored even if remote main has since advanced.

[Failures](../../scripts/release-cut.mjs) stop downstream actions and print the failed stage,
version/SHA when captured and inspection commands. Completed changes remain visible;
there is no automatic reset, draft/tag deletion or workflow rerun. CI cancellation (including
main's superseding-run policy), skipped required jobs, a wrong SHA, API errors or bounded
30-minute CI / 45-minute release waits do not authorize tagging or a success claim. A tag
push timeout may have succeeded remotely: inspect refs, then resume, never force a ref.

Cuts that change the client telemetry payload stop for the backend compatibility prerequisite
below; after owner confirmation pass `--backend-compatible` to acknowledge it. This flag
only acknowledges that prerequisite; the command never runs a migration/deploy. Release once daily when releasable changes
exist, and resolve a concrete stop before the gap reaches two days rather than collecting
another batch. No empty release or scheduled automatic publication is required.

## Before tagging and recovering a failed run

Require an ordinary [CI run](../../.github/workflows/ci.yml) on the exact integrated
`main` commit to reach and pass Ubuntu **Test** and **Build frontend** before tagging.
`source-check` runs lint, tests and build alongside the platform builds; it must not be the first
evidence that the source works on Ubuntu. A local macOS pass is not that evidence. If CI is still
red, stop for an explicit owner decision rather than treating a tag as a test run.

Run the `landing-sync` skill
([`.claude/skills/landing-sync/SKILL.md`](../../.claude/skills/landing-sync/SKILL.md)) in
report mode against the commit being tagged, and decide on every item it reports: fix the
landing in its own worktree, or record on the release PR why that surface ships stale.
Nothing else catches this: [`landing.yml`](../../.github/workflows/landing.yml) runs only
when `marketing/**` changes, so an app change that retires a surface the landing still sells
passes every other gate.

If [`src/telemetry/payload.ts`](../../src/telemetry/payload.ts) changed since the last
release, the analytics Worker must already accept the new shape: run `npm run migrate` and
`npm run deploy` in `backend/` first. A client whose snapshot the live Worker rejects gets a
terminal 400 and loses that day's whole snapshot, not just the new field — see
[telemetry](../internals/telemetry.md#receiving-service).

A retry depends on both the failed step and whether the source must change:

- **Same commit, failure before draft creation:** fix the runner/service problem and rerun
  the failed jobs. No release exists to delete; a missing release must be confirmed as a
  404, not inferred from an authentication or network error.
- **Same commit, draft exists and `prepare` succeeded:** rerun the failed `source-check`,
  platform or `promote` jobs. Keep the draft so successful platform assets remain available. Do not
  rerun successful `prepare`: its create-draft step would collide with the existing draft.
  While the draft waits, the trigger tag stays the feed's newest entry and every build
  through 1.2.0 fails its update check against it, so do not leave it waiting: finish the
  rerun promptly, or remove the attempt with the guarded procedure below and tag again later.
- **Source must change:** failed-job reruns still use the original SHA. Complete the
  corrected source and CI first, then remove the failed attempt and recreate the trigger
  tag using the guarded procedure below.
- **Already public:** do not delete the release or move either tag. Fix forward with a new
  version, changelog section and release approval; installed clients may already have it.

For example, recovery of an **unpublished** `build/v1.1.0` attempt after `prepare`:

1. Inspect `gh run view <run-id>` and `gh release view v1.1.0 --json isDraft,tagName,url`.
   Cancel any active run for this trigger with `gh run cancel <run-id>` and wait until every
   such run reports `completed`. Never change a tag while a job can still upload or promote.
   Record the failed SHA and preserve any logs/assets needed for diagnosis.
2. Confirm owner approval for deleting this draft and recreating the trigger tag. The
   following Bash commands abort unless the release still exists and is a draft. They
   deliberately name only this version, and never use `--cleanup-tag`:

   ```bash
   set -euo pipefail
   RELEASE_REPO=mxrsv/spacevibe-deck
   test "$(gh release view v1.1.0 --repo "$RELEASE_REPO" --json isDraft --jq .isDraft)" = true
   gh release delete v1.1.0 --repo "$RELEASE_REPO" --yes
   git push origin --delete refs/tags/build/v1.1.0
   git tag -d build/v1.1.0
   ```

   If a trigger tag is absent locally or remotely, omit only that deletion after checking
   `git show-ref --verify refs/tags/build/v1.1.0` or
   `git ls-remote --tags origin refs/tags/build/v1.1.0`. A failed `prepare` that never created
   a draft needs only the trigger-tag cleanup. If a bare `v1.1.0` ref also exists, stop and
   inspect its origin and SHA; do not remove or reuse it blindly.

3. Confirm the corrected commit is on `origin/main`, its `package.json` and lock root are
   `1.1.0`, and its `CHANGELOG.md` has a non-empty exact `## 1.1.0` section. Capture the green
   Ubuntu Test + Build run for that commit. With release approval, tag **that exact SHA**
   (`git tag build/v1.1.0 <verified-sha>`) and push only
   `refs/tags/build/v1.1.0`. This push starts a new release, including signing and publishing.
4. Inspect the new run and draft, then verify promotion and the full updater asset set.
   Neither deleting the draft nor a green `prepare` means recovery is complete.

## Secrets

Stored on the repository; `GITHUB_TOKEN` is supplied by Actions.

| Secret                       | Used by                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64 `.p12` Developer ID Application certificate                                                            |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12`                                                                                       |
| `KEYCHAIN_PASSWORD`          | The throwaway build keychain                                                                                  |
| `APPLE_ID`                   | Notarization account                                                                                          |
| `APPLE_PASSWORD`             | App-specific password; exported to the build as `APPLE_APP_SPECIFIC_PASSWORD`, the name app-builder-lib reads |
| `APPLE_TEAM_ID`              | Notarization team                                                                                             |
| `DISCORD_WEBHOOK_URL`        | The release announcement; optional, the `promote` job warns and skips the post when it is unset              |

Run [`verify-signing-credentials.yml`](../../.github/workflows/verify-signing-credentials.yml)
(`workflow_dispatch`) before the first release and after rotating any credential. It imports
the certificate into a throwaway keychain and reads `notarytool history`, submitting and
publishing nothing, so a mistyped secret surfaces in a minute instead of at notarization.

Locally, `npm run electron:package:release` runs the same signing preflight and the same
config with `--publish never`. The preflight accepts one of three credential sets: Apple ID
(`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`), API key
(`APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`), or `APPLE_KEYCHAIN_PROFILE`, and
requires a `Developer ID Application` identity in the keychain.

## The shipping package

[`electron-builder.release.yml`](../../electron-builder.release.yml) is the only config that
produces a release. The other two are not release paths:
[`electron-builder.yml`](../../electron-builder.yml) is the local unsigned `Deck Electron`
preview (`appId: dev.spacevibe.deck.electron`, `dir` target) and
[`electron-builder.monaco-smoke.yml`](../../electron-builder.monaco-smoke.yml) is the packaged
Monaco regression smoke.

- `appId: dev.spacevibe.deck`, `productName: SpaceVibe Deck`. This is the Tauri bundle's own
  identity, so the build replaces an installed Tauri `SpaceVibe Deck` rather than standing
  beside it. userData still differs (`SpaceVibe Deck` vs `dev.spacevibe.deck` under
  Application Support), so nothing migrates and no updater bridges the two hosts.
- macOS: `dmg` **and** `zip`, both `arm64`, hardened runtime,
  [`build/entitlements.mac.plist`](../../build/entitlements.mac.plist), `notarize: true`.
  A dmg-only release could never self-update. node-pty is `asarUnpack`ed and signed in place.
- Windows: `nsis` `x64`, artifact `SpaceVibe-Deck-<version>-win-x64-setup.exe`, per-user,
  not one-click, and the install-directory chooser is kept on purpose.
- The icons are [`build/icon.icns`](../../build/icon.icns) and [`build/icon.ico`](../../build/icon.ico).
- Publish provider is GitHub (`mxrsv/spacevibe-deck`) with no explicit `channel`.

A Windows `Deck Electron` preview that auto-updates into this build gets a **new** side-by-side
`SpaceVibe Deck` install with fresh userData; the preview stays in Add/Remove Programs until
removed by hand.

## Platform limits

- macOS: Apple Silicon (`arm64`) only. Intel Macs are not served.
- Windows: `x64` only, unsigned, SmartScreen warns on first install, and no real-hardware
  runtime verification pass has been run. Windows ARM is not served.
- Stable builds on both platforms update from the moving `releases/latest`, never from a
  pinned asset; `-electron.N` builds walk the release feed for their own channel.

## The updater client

[`electron/updater/updater.ts`](../../electron/updater/updater.ts) wraps electron-updater with
four rules that are correctness, not preference:

- `allowPrerelease` is on only for an `X.Y.Z-<prerelease>` build, which walks the release feed
  for its own channel. A stable build must resolve `releases/latest`: with the flag on,
  electron-updater 6.x takes the first `releases.atom` entry unfiltered, and that feed lists
  every pushed `build/v…` tag.
- `autoDownload` and `autoInstallOnAppQuit` are off. The user chooses when to download and
  when to install; nothing installs behind an ordinary quit.
- `install()` never resolves on success: `quitAndInstall` hands the app to Squirrel or NSIS,
  which relaunch Deck themselves.
- `isInstalling()` is read by main's quit and window-close census, because `quitAndInstall`
  closes every window before `before-quit` fires and the renderer has already confirmed.

A dev run (`app.isPackaged === false`) never constructs the updater. One update check runs at a
time across windows ([`update-flight.ts`](../../electron/updater/update-flight.ts)); a window
that dies releases the flight. The renderer side is host-agnostic
([`src/updater/update-controller.ts`](../../src/updater/update-controller.ts)).

## Old Tauri installs

The Tauri host was removed from `main` on 2026-10-12; its last release is `v0.12.3`, and that
tag keeps its source. Its updater endpoint, `releases/latest/download/latest.json`, answers 404
because `releases/latest` is an Electron release, so a deployed Tauri client's update check
fails. No migration notice ever shipped in a Tauri release: the move to Electron is a manual
download and clean install. No hotfix path remains; one would mean restoring `release.yml`
and `src-tauri/` from git history first.

On macOS, old Tauri data remains in `~/Library/Application Support/dev.spacevibe.deck`;
on Windows, `%APPDATA%\dev.spacevibe.deck`. Electron uses `SpaceVibe Deck` instead: Tauri
keyed its app data by bundle identifier, while Electron uses `app.getPath("userData")` in
[`main.ts`](../../electron/main.ts). Neither settings nor workspaces are migrated between hosts.

## Preview and local builds

- `npm run electron:package` — local unsigned `Deck Electron.app` (`arm64`, `dir` target) in
  `dist-electron-app/`.
- `npm run electron:package:release` — the shipping config, signed and notarized, published
  nowhere.
- `npm run electron:package:monaco-smoke` then `npm run electron:verify:monaco-smoke` — the
  packaged Monaco regression smoke (universal, unsigned). Rerun it after adding a CSP.
- [`electron-preview.yml`](../../.github/workflows/electron-preview.yml) — the shipping config
  built from any commit of this repository on CI, signed on macOS, kept as artifacts, published
  nowhere; see [Verify the commit before cutting it](#verify-the-commit-before-cutting-it).
- [`ci.yml`](../../.github/workflows/ci.yml)'s `windows-electron-package` job
  (`workflow_dispatch`) builds the unsigned Electron Windows preview on a Windows runner and
  keeps it as a 7-day artifact. It is deliberately not gated on `windows-check`.
