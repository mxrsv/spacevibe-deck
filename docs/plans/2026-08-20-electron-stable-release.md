# Electron Stable Release — Implementation Plan

> Executes [2026-08-20-electron-stable-release-design.md](../specs/2026-08-20-electron-stable-release-design.md)
> `decided`, amended by the parts of
> [2026-08-20-development-contribution-release-workflow-design.md](../specs/2026-08-20-development-contribution-release-workflow-design.md)
> `draft` the owner adopted on 2026-08-20: reviewed CHANGELOG notes for stable releases,
> the tag-ancestry gate, and the run summary. Baseline: the shipped single-job
> `electron-release.yml` (mac-only) and `electron-builder.release.yml` (mac-only). Two
> clarifications taken 2026-08-20 from the owner: **no macOS preview ever shipped
> publicly** — the landing page still says "coming soon" — so this stable is the first
> public macOS release and needs no "mac preview users must reinstall" note; and **the
> stable is `1.0.0`**, a V1, not a `0.12.x` increment.

## Tasks

1. **`package.json`** — version `0.12.5-electron.2` → `1.0.0`. Stable outranks the
   prerelease under semver, so installed `0.12.5-electron.2` and the Windows
   `0.12.4-electron-preview.2` both see it.
2. **`electron-builder.release.yml`** — add `win:` (nsis, x64, Tauri icon set) and
   `nsis:` (`oneClick: false`, `perMachine: false`,
   `allowToChangeInstallationDirectory: true` — kept deliberately per spec despite the
   secondary-drive extract report — and an explicit space-free `artifactName`).
   `mac:` and `publish:` untouched.
3. **`.github/workflows/electron-release.yml`** — restructure to the spec's four jobs:
   - `prepare` (ubuntu): refuse a tag whose commit is not reachable from
     `origin/main` (full-history checkout), validate both tag shapes
     (`build/vX.Y.Z` and `build/vX.Y.Z-electron.N`) against the package version, run
     the source gate (`generate:menu:check`, `npm test`, `npm run build`) once, create
     the draft with `--target`, output the stripped tag and the channel kind.
   - `mac` (macos-latest): the shipped job's steps verbatim — keychain import,
     signing preflight, build, `--mac --arm64 --publish always`, notarization proofs.
   - `windows` (windows-latest): `npm ci`, `npm run build`, `npm run electron:build`,
     `--win --x64 --publish always`, under `shell: bash` + `set -euo pipefail` so an
     intermediate build failure cannot publish a broken installer. No signing, no
     runtime assertion.
   - `promote` (ubuntu): require all six served assets (dmg, mac zip, latest-mac.yml,
     setup.exe, latest.yml, blockmap); final notes = the fixed three-line header plus,
     for a stable tag, the tagged commit's `## <version>` section of `CHANGELOG.md`
     (missing section → the release stays a draft) or, for `-electron.N`, the
     generated commit list; then `gh release edit --draft=false` with `--latest` for
     stable / `--prerelease` for `-electron.N`, and a `$GITHUB_STEP_SUMMARY` page
     naming source SHA, channel and served assets.
4. **`.github/workflows/release.yml`** — `on:` reduced to `workflow_dispatch`. Jobs,
   including `release-freeze`, stay.
5. **`scripts/electron-release-config.test.ts`** — grow with the shape it guards:
   win/nsis target declared, a publishing `windows-latest` job, promote requiring the
   Windows manifest and installer, both tag patterns and no bare `v…` pattern, the
   `release.yml` freeze assertion rewritten to "no tag-push trigger" in the same
   commit that removes the trigger.
6. **`CHANGELOG.md`** — new at the root (the workflow design's reviewed-notes
   carrier), opening with the `## 1.0.0` section the promote job will publish. The
   section text is a draft until the owner reviews it in the release PR.
7. **Docs** — `docs/CONTEXT.md`: correct Gate A (owner-verified macOS auto-update,
   2026-08-19) and record this pipeline build; `AGENTS.md`: drift rows for the spec's
   "not done" table (unsigned Windows, unverified Windows runtime, no Intel, no ARM,
   clean install).

## Out of scope

- Cutting the tag itself (freeze prerequisites 2–3: clean tree, the two accepted
  unfinished states are a release-time judgment).
- Landing page: swap "coming soon" for the real download links **after** the release
  is public, not before the URLs exist.
- Windows code signing, Windows runtime verification, Intel/ARM builds (spec's
  "not done" table).

## Verification

`npm test` (targeted: `scripts/electron-release-config.test.ts`,
`scripts/release-workflow.test.ts`), `npm run build` untouched by these files. Per the
owner's standing instruction the session reports changes as unverified and hands the
commands over instead of running them.
