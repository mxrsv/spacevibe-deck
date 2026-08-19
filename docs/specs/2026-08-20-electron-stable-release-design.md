# Electron Stable Release — Two Platforms, One Tag

> **Status:** `decided` 2026-08-20. Supersedes the macOS-only shape of
> [2026-08-18-electron-release-pipeline.md](../plans/2026-08-18-electron-release-pipeline.md)
> `building` for everything downstream of its Task 8; that plan's Tasks 6–8 stay as
> shipped and are the baseline this design builds on.

**Goal:** one pushed tag produces a stable release carrying macOS **and** Windows, both
self-updating, with the Tauri release path retired from tag triggers.

**Owner decisions taken 2026-08-19/20, recorded so the spec does not relitigate them:**

| Decision | Value |
| --- | --- |
| Shipping host | Electron. Tauri is retired from the tag path. |
| Architectures | macOS **arm64** and Windows **x64**. Intel Mac and Windows ARM are not served. |
| Windows signing | **None.** Ship unsigned; do not print an "unsigned preview" banner in the notes. |
| Windows runtime verification | **Not performed.** Ship without it and say so in the docs. |
| `release.yml` | Trigger reduced to `workflow_dispatch`. File kept for manual hotfixes. |
| macOS auto-update | Verified working by the owner against `v0.12.5-electron.2`. Gate A is closed for macOS. |

## Baseline — what already exists

`.github/workflows/electron-release.yml` (on disk 2026-08-20 01:19, **uncommitted** at the
time of writing) already solves two failures that adding a second platform would otherwise
multiply. Both are load-bearing and are carried forward verbatim:

1. **The trigger tag is not the release tag.** It matches `build/vX.Y.Z-electron.N`, and
   the release tag is that string without the prefix. GitHub publishes a pushed tag to
   `releases.atom` immediately while the job needs ~10 minutes; pushing the release tag
   directly advertised a version whose manifest did not exist, and every running app that
   checked in that window reported "Couldn't check for updates". Measured twice on
   2026-08-19 against `v0.12.5-electron.2`. `build/v…` fails `semver.valid`, so
   `GitHubProvider` (GitHubProvider.js:71) skips the entry entirely.
2. **The draft is created before any publisher runs.** electron-builder runs one publisher
   per target, concurrently; with no release to upload into, the zip publisher and the dmg
   publisher each created one. Run `32232669706` produced **two drafts on the same tag** —
   dmg and manifest in one, zip in the other — a release that looked complete in the API
   and could never have updated anything. `gh release create "$TAG" --draft --target
   "$GITHUB_SHA"` removes the race; `--target` is required because the tag does not exist
   yet.

Also already true: `allowPrerelease: true` in `electron/updater/updater.ts`; the published
manifest is `latest-mac.yml`, not `electron-mac.yml`, because app-builder-lib copies the
channel into `publish.channel` only for the `generic` provider — the client asks for its
channel file first and falls back to the default, so the two halves meet.

## Architecture — four jobs, one file

A second workflow file cannot work here. Two files triggered by the same tag run with no
knowledge of each other: both would race to create the release (failure 2 above, one
platform apart instead of one target apart), and neither would have a point at which the
full artifact set is known to be complete. The verification that keeps a half-built release
invisible has to live downstream of both builds, which means one workflow.

```
prepare (ubuntu)              validate tag + version, strip build/, create the draft
   |
   +-- mac     (macos-latest)   sign, notarize, verify, publish into the draft
   +-- windows (windows-latest) build, publish into the draft
   |
promote (ubuntu)              verify the full asset set, then make it public
```

### `prepare`

- Validates that the trigger tag's stripped form equals `package.json`'s version.
- Accepts **two** tag shapes: `build/vX.Y.Z` (stable) and `build/vX.Y.Z-electron.N`
  (prerelease, the existing path). The current validator rejects a version that names no
  `electron` channel; that check is relaxed to "stable or `-electron.N`", not deleted.
- Runs the source gate once for both platforms: `generate:menu:check`, `npm test`,
  `npm run build`.
- Creates the draft and exports the stripped tag as a job output.

### `mac`

Unchanged from the shipped job: keychain import with `set-key-partition-list`, the signing
preflight before any build work, `--mac --arm64 --publish always`, then the notarization
proofs (`codesign --verify --deep --strict`, the `spawn-helper` check, `spctl --assess`,
`stapler validate`, and the offline `--test-requirement="=notarized"`). The dmg is
deliberately not asserted to carry a stapled ticket.

### `windows`

- `npm ci`, `npm run build`, `npm run electron:build`.
- `npx electron-builder --config electron-builder.release.yml --win --x64 --publish always`.
- **No signing step.** electron-builder warns and continues when no certificate is
  configured. The installer is unsigned by decision, and SmartScreen will warn on first
  install; nothing in the pipeline can change that.
- No runtime assertion is possible on a runner (no interactive install, no update cycle),
  so this job proves only that the installer and its manifest were produced.

### `promote`

Reads what the release actually serves — not what a runner produced — and requires **all
six** artifacts before it makes anything public:

| Asset | Consumer |
| --- | --- |
| `*.dmg` | macOS first install |
| `*-mac.zip` | macOS updater (Squirrel.Mac) |
| `latest-mac.yml` | macOS update feed |
| `*-setup.exe` | Windows first install **and** updater payload |
| `latest.yml` | Windows update feed |
| `*.blockmap` | differential download |

Then `gh release edit --draft=false` with `--latest` for a stable tag or `--prerelease`
for an `-electron.N` tag. A missing asset leaves the release a draft, which is the only
mechanism that stops a half-built release from reaching an installed app.

## Configuration changes

### `electron-builder.release.yml`

Gains a `win:` block (nsis, x64) and an `nsis:` block. It is **not** copied from
`electron-builder.yml`: that file's block is explicitly a preview artifact. Two settings
need a decision rather than a carry-over:

- `perMachine: false` (per-user install, no elevation prompt) is kept.
- `allowToChangeInstallationDirectory: true` is **re-examined**, because the one real
  Windows user report on record is an NSIS extract failure when installing to a secondary
  drive. The install-directory chooser is what lets a user reach that state. This design
  does not resolve the underlying bug; it records that the option is the trigger and that
  keeping it is a deliberate choice, not an inherited default.

`mac:` is unchanged. `publish.channel` stays absent (fork F4).

### `electron/updater/updater.ts`

`allowPrerelease` stays `true` for this release. The installed `0.12.5-electron.2` build
needs it to see anything, and `0.13.0 > 0.12.5-electron.2` under semver, so the stable
release reaches it. The cost is that a stable install will also follow future
`-electron.N` prereleases. Turning it off belongs to the version **after** the prerelease
channel is empty, not to this one.

### `.github/workflows/release.yml`

`on:` reduced to `workflow_dispatch`. The file, its Tauri jobs and its `release-freeze` job
stay, so a Tauri hotfix remains possible by hand.

`scripts/electron-release-config.test.ts` asserts that `release.yml` still contains the
`release-freeze` job. That assertion exists so nothing lifts the freeze by accident;
changing the trigger on purpose means rewriting that case **in the same commit**. A red
test there is the guard working.

### Release notes

`scripts/generate-release-notes.mjs` is reached only from `release.yml` and is therefore
unreferenced once that trigger goes. It is **not** deleted (the manual Tauri path still
calls it) and its `WINDOWS_PREVIEW_WARNING` is left alone, because the Electron workflow
never called it.

The Electron release currently ships the placeholder notes `prepare` writes. `promote`
instead sets the final notes with `gh release edit --notes-file`, composed of GitHub's
generated commit list plus a fixed header stating three things a user cannot discover
from the app:

- the Windows installer is unsigned, and SmartScreen will warn on first install;
- Windows behaviour is not runtime-verified;
- Intel Macs are not served by this build.

## Test surface

`scripts/electron-release-config.test.ts` is the existing guard and grows with the shape it
guards:

- the release config declares a Windows nsis x64 target;
- the workflow has a job on `windows-latest` that publishes;
- `promote` requires the Windows manifest (`latest.yml`) and the installer, not only the
  macOS set;
- both tag patterns are accepted and neither is a bare `v…` pattern a running app could
  see;
- the `release.yml` freeze assertion is rewritten to match the new trigger.

No renderer or main-process code is touched, so `npm test` and `npm run build` are the
gates; there is no new runtime surface to unit-test.

## What this design does not do

| Not done | Consequence |
| --- | --- |
| Windows code signing | SmartScreen warns on first install until reputation accrues |
| Windows runtime verification | Install and auto-update on Windows are unproven; Gate C stays open |
| macOS Intel / universal | Intel Mac users of the Tauri build have no upgrade path |
| Windows ARM | Not served |
| Settings/workspace migration from Tauri | Clean install by decision; the last Tauri release must say where the old data lives |

Each row goes into `AGENTS.md`'s drift table as `unverified` or `false` rather than being
left silent.

## Freeze prerequisites

These are not pipeline work, but the tag cannot be cut without them:

1. `package.json` version, currently `0.12.4-electron-preview.2` on `HEAD`, is behind the
   `v0.12.5-electron.2` tag. It must be set to the stable version being cut.
2. A clean tree. The checkout carries a large uncommitted state shared with other sessions;
   the release commit must be one whose `npm test`, `npm run build` and
   `generate:menu:check` are green **on that commit**.
3. Two known-unfinished states are shipped or fixed on purpose, not by omission:
   `GRAB_PASTE_DISABLED` (`src/browser/browser-store.ts:96`) is still `true`, and a preset
   can be created but neither renamed nor deleted anywhere in the app.
4. `docs/CONTEXT.md` still records Gate A as open; the owner's verified macOS auto-update
   contradicts it. Correct it before the release, not after.

## Chưa khớp thực tế

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| One tag ships macOS and Windows | `decided` | unbuilt | This design; no workflow job on `windows-latest` exists yet |
| The Windows build self-updates | `decided` | unverified | No Windows hardware; owner elected to ship without the check |
| macOS self-updates | `current` | verified | Owner-run check against `v0.12.5-electron.2`, 2026-08-19 |
