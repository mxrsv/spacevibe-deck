# Development, Contribution, and Release Workflow

> **Status:** `draft` 2026-08-20. This document defines the repository workflow to
> review with the owner. It changes no GitHub setting, branch, CI job, release, or
> updater behaviour by itself.

**Goal:** keep `main` continuously releasable while allowing the owner and external
contributors to work quickly, and make one deliberate release publish the same Deck
version for macOS arm64 and Windows x64.

**Related authority:**

- [Electron stable release design](2026-08-20-electron-stable-release-design.md)
  `decided` owns artifact identities, signing, supported architectures, updater
  manifests, draft promotion, and the Tauri retirement path.
- [Cross-platform auto-update design](2026-08-03-cross-platform-auto-update-design.md)
  `decided` owns the user-controlled download/install/relaunch contract.
- [Current CI workflow](../../.github/workflows/ci.yml) `current` is the baseline this
  design changes.

This design supersedes only one part of the stable-release design: a public Electron
release uses reviewed, user-facing release notes assembled from PR metadata rather than
an unedited generated commit list. The fixed platform limitations remain prepended.

## Problem

Deck currently has three workflows that are related but not governed as one system:

1. code can enter `main`;
2. local and CI verification run on different platform surfaces;
3. a tag can publish an update to installed applications.

Without explicit boundaries, a green build can be mistaken for native acceptance, a
merged PR can be mistaken for a release, and a release can be cut from a commit whose
platform evidence is incomplete.

**Fact:** on 2026-08-20 the GitHub repository reported no branch protection and no
repository ruleset for `main`.

**Fact:** PR #21 merged on 2026-08-20 while both existing CI jobs, `check` and
`windows-check`, were failing. The post-merge `main` run failed in the same two jobs.

**Fact:** [CI](../../.github/workflows/ci.yml) `current` runs an Ubuntu job and a Windows
job for pull requests. It has no macOS pull-request job.

**Fact:** the four-job, two-platform Electron release workflow exists in the shared
working tree but is uncommitted and has never run. It is not evidence that the live
release path already ships both platforms.

## Decisions

| Area | Decision |
| --- | --- |
| Development model | Trunk-based development with short-lived branches or contributor forks |
| Integration branch | `main` is protected and continuously releasable |
| Publishing | A merge to `main` never publishes by itself |
| Merge path | Every ordinary change reaches `main` through a pull request |
| Merge method | Squash merge; one PR becomes one conventional commit on `main` |
| Owner approval count | Zero required approvals while there is only one maintainer |
| Contributor review | The owner must review and perform the merge; contributors have no merge authority |
| Release trigger | An explicit `build/vX.Y.Z` or `build/vX.Y.Z-electron.N` tag |
| Release source | The tag target must be an ancestor of `origin/main` and pass the release workflow's source gate |
| Platform publication | macOS and Windows become public together or neither becomes public |
| Update control | Deck may check automatically, but download, install, and relaunch remain user-controlled |

No `develop` or long-lived release branch is introduced. A second integration branch
would add drift without solving a current scaling problem.

## End-to-end flow

```text
short-lived branch / contributor fork
                  |
                  v
             pull request
                  |
       +----------+-----------+
       |          |           |
    Ubuntu      macOS       Windows
     checks     checks       checks
       +----------+-----------+
                  |
            owner review
                  |
            squash merge
                  |
                main
                  |
          explicit release PR
                  |
          build/vX.Y.Z tag
                  |
       draft -> mac + windows
                  |
       verify complete asset set
                  |
        atomic public promotion
                  |
       installed apps discover it
```

## Protected `main`

GitHub rules must be enabled only after the current required jobs have a green baseline.
Turning them on while the baseline is red would lock the owner behind failures unrelated
to the next PR.

The `main` ruleset requires:

- a pull request before merge, including for the repository owner;
- required checks with strict branch freshness;
- the stable contexts `check`, `macos-check`, and `windows-check`;
- conversation resolution before merge;
- linear history;
- no force-push and no deletion;
- rules applying to administrators.

The required approval count stays at zero while the owner is the only maintainer. GitHub
does not allow an author to approve their own PR, so requiring one approval would make an
owner-authored PR impossible to merge without a second maintainer. This is not permission
for contributors to self-merge: they do not receive write or merge authority.

### Break-glass path

There is no ordinary bypass. A repository-wide CI outage or an urgent security fix may
use an owner-only bypass if GitHub configuration makes one necessary, but all of these
conditions apply:

1. a PR still exists and names the failed or unavailable gate;
2. the owner records why waiting is riskier than bypassing;
3. the narrowest available verification runs before merge;
4. post-merge CI is watched to completion;
5. a follow-up restores the gate before normal feature work resumes.

Failing tests caused by the change, missing Windows runtime evidence, or release urgency
are not bypass reasons.

## Pull-request contract

### Contributor preparation

A contributor branches from the current `origin/main` or opens a PR from a fork. The PR
must stay scoped to one concern and must not include release tags, generated installers,
credentials, or unrelated cleanup.

Repository code, comments, docs, and commit messages remain English. The final squash
commit follows `type(scope): description`.

### Required PR body

Every PR states:

- **Summary:** what changed and why;
- **Main changes:** the owning files and behaviour;
- **Test evidence:** exact commands and their results;
- **Platform evidence:** macOS, Windows, both, or explicitly not run;
- **Screenshots:** required for rendered UI or interaction changes;
- **Release note:** `Release-Note: <user-facing sentence>` or
  `Release-Note: skip`;
- **Known gaps:** native, signing, updater, hardware, or owner-eye evidence still owed.

A `feat`, `fix`, or `perf` PR cannot merge without a valid release-note decision. Internal
refactors, tests, CI, and docs may use `Release-Note: skip` when they do not change user
behaviour.

### Review

The owner reviews behaviour and scope before merge. Additional specialist review is
required when a PR changes a trust boundary:

- IPC, filesystem, PTY, updater, signing, or release code receives security review;
- React/Preact renderer changes receive frontend correctness review;
- rendered UI changes require screenshot or recording evidence and owner eye approval;
- Windows-specific behaviour requires real Windows evidence before it is described as
  verified.

CI success proves only what its job runs. It does not prove an interactive installer,
auto-update cycle, native window behaviour, or subjective visual acceptance.

## CI contract

Pull-request workflows use `pull_request`, read-only repository permissions, and no
release secrets. They do not use `pull_request_target` to execute contributor code.

### `check` — Ubuntu

The shared source gate runs:

```text
npm ci
npm run generate:menu:check
npm run lint
npm test
npm run build
npm run electron:build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Tauri checks remain while the manual Tauri hotfix path exists. Retiring that path is a
separate decision.

### `macos-check`

The macOS job is required for every PR and runs on the shipping architecture:

- install dependencies;
- run tests that have macOS-specific behaviour;
- build the renderer and Electron main process;
- create an unsigned, unpublished arm64 directory package;
- verify the packaged app contains loadable `node-pty` native assets.

It uses no Apple certificate and performs no notarization. Signing/notarization remain a
release-only gate because fork PRs do not receive secrets.

### `windows-check`

The Windows job is required for every PR and runs:

- the full unit suite, including real ConPTY coverage;
- renderer and Electron main-process builds;
- the Windows bundle-validator tests;
- an unsigned, unpublished x64 directory or NSIS package smoke;
- Rust checks while the manual Tauri path remains.

The job proves Windows compilation, native module loading, and automated platform
behaviour. It does not prove interactive installation, SmartScreen, pointer capture,
window chrome, or update/relaunch behaviour.

### Path filters

Required job names remain stable. Jobs may skip expensive inner steps for a docs-only PR,
but the required context itself must report success. A path filter must not prevent the
entire required workflow from creating a status, because GitHub would leave the PR waiting
forever.

## Local development and verification

### macOS canonical loop

```bash
npm ci
npm run electron:dev:watch
```

`electron:dev:watch` gives renderer HMR and rebuilds/relaunches the Electron main process.
A main-process change may hard-kill the dev window, discard unsaved editor buffers, and
terminate live PTYs. Use the one-shot path when that cost is unacceptable:

```bash
npm run electron:dev
```

### Windows canonical loop

Until the watcher is verified on Windows, the canonical Windows command is:

```powershell
npm ci
npm run electron:dev
```

`electron:dev:watch` may become canonical only after a real Windows run proves its npm
spawn, file watching, rebuild, relaunch, and shutdown paths.

### Before opening a PR

The contributor runs the smallest relevant targeted tests while editing, then the full
local checks their platform supports:

```bash
npm run generate:menu:check
npm run lint
npm test
npm run build
npm run electron:build
```

Local verification is evidence attached to the PR; CI independently repeats the required
gate. A macOS developer does not claim Windows verification from a cross-build.

### Runtime evidence by risk

| Change | Minimum runtime evidence before merge |
| --- | --- |
| Docs or comments only | No host run; document checks and diff review |
| Pure renderer behaviour | Native Electron run on the contributor's platform |
| Rendered UI | Native run plus screenshot/recording and owner eye review |
| Electron main, IPC, filesystem, or PTY | Native run on each affected platform; CI alone is insufficient for platform-specific UX |
| Installer or updater | Packaged RC install and N -> N+1 update/relaunch cycle on each affected platform |
| Release workflow only | Static workflow tests plus one non-public RC run before the stable tag |

## Release contract

### Release preparation

A release is a dedicated PR, not an incidental version edit inside a feature PR. It:

1. chooses the stable or prerelease version;
2. updates every version source and lockfile required by the shipping host;
3. assembles reviewed user-facing notes from merged PR `Release-Note` trailers;
4. lists platform limitations and unresolved gates;
5. runs the same required checks as any other PR.

The release PR does not publish, create a release tag, or upload an installer.

### Trigger and source

After the release PR is merged, the owner pushes exactly one build tag:

- `build/vX.Y.Z` for stable;
- `build/vX.Y.Z-electron.N` for the migration prerelease channel.

The release workflow strips `build/`, validates the version, and rejects a tag whose
commit is not reachable from `origin/main`. It reruns source gates on the tagged SHA, so a
green check on a different commit cannot authorize publication.

The developer machine initiates the release but does not produce the public artifacts.
GitHub-hosted macOS and Windows runners build them independently from the exact tagged
commit.

### Atomic two-platform promotion

The artifact and promotion details remain owned by the
[stable-release design](2026-08-20-electron-stable-release-design.md) `decided`:

- create one draft before either platform publishes;
- build signed/notarized macOS arm64 and unsigned Windows x64;
- require the complete updater and installer asset set from both platforms;
- leave the release invisible as a draft if either platform fails;
- create the discoverable release tag only when promoting the complete draft.

No automatic release runs on a push or merge to `main`.

## Notification contract

There are two audiences and they receive different notifications.

### Maintainers and contributors

- PR checks and review state stay in GitHub.
- A failed required check blocks merge and names the failing job and step.
- A release run writes a GitHub Actions summary containing the source SHA, version,
  platform jobs, assets found, and whether promotion occurred.
- A failed release remains a draft and sends the normal GitHub Actions failure
  notification to maintainers. No Slack, Discord, or email integration beyond GitHub is
  introduced without a separate owner decision.

### Installed Deck users

Deck keeps automatic checks at startup and every six hours. Discovery is non-modal and
never interrupts terminal input.

| State | User-facing behaviour |
| --- | --- |
| Update available | Persistent action showing the version, with **What's New**, **Download**, and **Later** |
| Downloading | Persistent progress state; the app remains usable |
| Downloaded | Persistent **Install & Relaunch** action; no install on ordinary quit |
| Installing | Preserve sessions/settings, record the attempt, then hand over to the platform installer |
| Updated | On the first successful launch, show **Updated to X.Y.Z** once with the top changes and release-notes link |
| Background check failed | Log/report internally without a disruptive popup |
| Manual check failed | Show an explicit retryable error |
| Install incomplete | On next launch, explain that the target version did not finish installing and offer the release page |

Release notes are user language, not a commit dump. They contain:

- a one-sentence release summary;
- at most three to five important changes;
- fixes and breaking changes that affect workflows or stored data;
- fixed platform limitations, including unsigned Windows and unsupported architectures;
- a link to the complete GitHub release.

Stable installations follow stable releases. Prerelease participation must remain explicit;
the temporary `-electron.N` migration channel is not a permanent beta-channel design.

## Adoption sequence

1. Restore a green baseline for `check` and `windows-check` on `main`.
2. Add and stabilize `macos-check`; make package smoke native on both platforms.
3. Add the PR template and validate `Release-Note` metadata.
4. Enable the `main` ruleset with the three stable required contexts.
5. Finish and run a non-public RC of the two-platform release workflow.
6. Add any missing user notification states, especially post-update success.
7. Cut stable only after the tagged SHA is green and the owner accepts the stated gaps.

The order is load-bearing: branch protection cannot depend on checks that are currently red
or do not exist.

## Success criteria

- No ordinary commit can reach `main` without a PR and required green checks.
- A contributor cannot access release secrets, merge their own PR, or trigger a public
  release.
- The owner can merge an owner-authored PR without requiring a second maintainer.
- Every merged user-facing change has a release-note decision.
- macOS and Windows package on native GitHub runners before merge.
- A merge to `main` publishes nothing.
- A release publishes both platform asset sets atomically or stays invisible.
- Installed users choose when to download, install, and relaunch.
- A successful update and an incomplete install are both visible on the next launch.

## Gaps and open decisions

**Gap:** `main` is not protected and the current required CI baseline is red. No ruleset
can be safely activated until those failures are resolved or reclassified with evidence.

**Gap:** `macos-check` does not exist.

**Gap:** the Windows dev watcher is annotated as unverified on Windows.

**Gap:** the two-platform Electron release workflow is uncommitted and has never run.

**Gap:** Windows remains unsigned and runtime-unverified by the existing owner decision;
this workflow records that limitation but does not resolve it.

**Assumption:** the owner remains the only maintainer at adoption time. Adding a second
maintainer should reopen the approval count and make one independent approval required.

**Open decision:** whether package smoke runs on every PR or only when source, Electron,
dependency, or packaging files change. The required check context must exist and succeed in
either case.

## Chưa khớp thực tế

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| Every ordinary change reaches `main` through a PR | `decided` | draft only | No branch protection or ruleset on 2026-08-20 |
| Pull requests require Ubuntu, macOS, and Windows checks | `decided` | partial | Ubuntu and Windows jobs exist; macOS job does not |
| One release publishes both platforms atomically | `decided` | unverified | Shared-tree workflow is uncommitted and has never run |
| Users see a post-update success notice | `decided` | unspecified | Existing controller exposes available/download/install states; first-launch success UX needs an implementation audit |
