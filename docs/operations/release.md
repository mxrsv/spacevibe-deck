# Cutting a release

One pushed tag ships SpaceVibe Deck for macOS and Windows, both self-updating, through
[`electron-release.yml`](../../.github/workflows/electron-release.yml). Nothing ships the
Tauri host automatically any more; [`release.yml`](../../.github/workflows/release.yml) is a
hand-run hotfix path for a build that already shipped. This page is the runbook for both.

## What a release is

- **The trigger tag is `build/<release tag>`.** Two shapes are accepted:
  `build/vX.Y.Z` (stable, the updater's default `latest` channel) and
  `build/vX.Y.Z-electron.N` (prerelease, the `electron` channel).
- **The release tag is the trigger tag without the `build/` prefix**, and it does not exist
  until the run has finished. GitHub creates it when the draft is promoted. Pushing a bare
  `vX.Y.Z` tag would advertise the version through `releases.atom` ten minutes before its
  manifests existed, and every running app that checked in that window would report a
  failed update check. `build/v…` is not valid semver, so the updater client skips it.
- **The tagged commit must be reachable from `origin/main`**, and the tag must equal
  `v<version>` for the `version` in [`package.json`](../../package.json). Either mismatch
  fails the run before anything is built.
- **The version is the channel.** A bare `X.Y.Z` is stable; `X.Y.Z-electron.N` is a
  prerelease. Both halves of the update path derive the channel from that one string:
  electron-builder from the version's prerelease component (`publish.channel` is deliberately
  unset in [`electron-builder.release.yml`](../../electron-builder.release.yml)), and
  electron-updater from the release tag on the client.
- **The design is fail-closed.** Every artifact lands in a draft release, and the draft goes
  public only after a downstream job has counted the full two-platform asset set on the
  release itself. A failure anywhere leaves a draft that no installed app can see. A run that
  dies in `promote` and publishes nothing is the design working, not a bug.

## The four jobs

`prepare` → `mac` + `windows` (parallel) → `promote`. All four run on Node 22 with `npm ci`.

### `prepare` (ubuntu)

1. Full-history checkout, then refuse a tag whose commit is not an ancestor of `origin/main`.
2. Validate the tag against `package.json`'s version and derive the channel.
3. Validate source: `npm run generate:menu:check`, `npm test`, `npm run build`.
4. Create the draft release with `gh release create "$TAG" --draft --target "$GITHUB_SHA"`.
   Creating it upstream of both platform jobs is what stops the two electron-builder
   publishers from each creating their own release. `--target` is required because the
   release tag does not exist yet.

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

`needs: [prepare, mac, windows]` names `prepare` directly on purpose: `needs.<job>.outputs`
resolves only for jobs in that list, and an empty `TAG` makes `gh release view ""` answer
with the latest release, so every assertion would run against whatever shipped last.

1. Refuse empty `TAG` or `CHANNEL`.
2. Read the asset names the release actually serves and require all six:

   | Asset            | Role                                                             |
   | ---------------- | ---------------------------------------------------------------- |
   | `*.dmg`          | macOS first install                                              |
   | `*-mac.zip`      | macOS update payload (electron-updater reads the zip, never the dmg) |
   | `latest-mac.yml` | macOS update feed                                                |
   | `*-setup.exe`    | Windows first install and update payload (NSIS reruns the installer) |
   | `latest.yml`     | Windows update feed                                              |
   | `*.blockmap`     | Differential download                                            |

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

## `CHANGELOG.md` is machine-read

The `promote` job extracts the section between `## <version>` and the next `## ` heading
from [`CHANGELOG.md`](../../CHANGELOG.md) at the tagged commit and **fails the run if that
section is empty**. Consequences:

- A stable tag without its section stays a draft. Write the section in the release PR before
  tagging.
- Do not rename, move or restructure the file, and keep the `## <version>` heading exact.
- Each section is written for users and frozen at its tag. It is never an auto-generated
  commit list.

## Secrets

Stored on the repository; `GITHUB_TOKEN` is supplied by Actions.

| Secret                       | Used by                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64 `.p12` Developer ID Application certificate                   |
| `APPLE_CERTIFICATE_PASSWORD` | Password of that `.p12`                                              |
| `KEYCHAIN_PASSWORD`          | The throwaway build keychain                                         |
| `APPLE_ID`                   | Notarization account                                                 |
| `APPLE_PASSWORD`             | App-specific password; exported to the build as `APPLE_APP_SPECIFIC_PASSWORD`, the name app-builder-lib reads |
| `APPLE_TEAM_ID`              | Notarization team                                                    |

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
- Both hosts share the icon set in `src-tauri/icons/`.
- Publish provider is GitHub (`mxrsv/spacevibe-deck`) with no explicit `channel`.

A Windows `Deck Electron` preview that auto-updates into this build gets a **new** side-by-side
`SpaceVibe Deck` install with fresh userData; the preview stays in Add/Remove Programs until
removed by hand.

## Platform limits

- macOS: Apple Silicon (`arm64`) only. Intel Macs are not served.
- Windows: `x64` only, unsigned, SmartScreen warns on first install, and no real-hardware
  runtime verification pass has been run. Windows ARM is not served.
- Both platforms update from the moving `releases/latest`, never from a pinned asset.

## The updater client

[`electron/updater/updater.ts`](../../electron/updater/updater.ts) wraps electron-updater with
four rules that are correctness, not preference:

- `allowPrerelease` is on, so a prerelease build walks the release feed for its own channel
  instead of resolving `releases/latest`.
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

## Tauri hotfix

The Tauri host is feature-frozen and its last shipped version is `0.12.3`
([`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json)). Its updater endpoint,
`releases/latest/download/latest.json`, now answers 404 because `releases/latest` is an
Electron release, so a deployed Tauri client's update check fails, and Tauri builds carry an
in-app migration notice ([`migration-notice.ts`](../../src/updater/migration-notice.ts),
`MIGRATION_NOTICE_ENABLED`) telling the user to reinstall by hand.

To rebuild a Tauri hotfix:

1. Run `release.yml` by `workflow_dispatch` with the `tag` input set to an **existing**
   `vX.Y.Z` or `vX.Y.Z-rc.N` source tag. The `release-freeze` job refuses any tag push, and
   `resolve-target` refuses a tag that does not match that exact shape or does not exist. It
   rebuilds from the tag's commit, never from `main`.
2. The DAG is `resolve-target` → `prepare-release-notes` + `validate-source` → the macOS
   stable draft and the unsigned Windows preview draft → per-platform validation
   ([`scripts/verify-updater-manifest.mjs`](../../scripts/verify-updater-manifest.mjs)
   re-downloads every draft asset and verifies the Minisign-signed manifest against
   `DECK_UPDATER_PUBLIC_KEY`) → publish → channel promotion.
3. Beyond the Apple secrets above it needs `TAURI_SIGNING_PRIVATE_KEY` and
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

A hotfix built from a commit on `main` carries the migration notice unless
`MIGRATION_NOTICE_ENABLED` is set to false for that build; the notice is what tells its users
the build no longer updates itself.

## Preview and local builds

- `npm run electron:package` — local unsigned `Deck Electron.app` (`arm64`, `dir` target) in
  `dist-electron-app/`.
- `npm run electron:package:release` — the shipping config, signed and notarized, published
  nowhere.
- `npm run electron:package:monaco-smoke` then `npm run electron:verify:monaco-smoke` — the
  packaged Monaco regression smoke (universal, unsigned). Rerun it after adding a CSP.
- [`ci.yml`](../../.github/workflows/ci.yml)'s `windows-electron-package` job
  (`workflow_dispatch`) builds the unsigned Electron Windows preview on a Windows runner and
  keeps it as a 7-day artifact. It is deliberately not gated on `windows-check`.
