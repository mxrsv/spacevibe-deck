# Hardened updater 0.11.0 release plan

**Source design**: [Cross-platform auto-update](../specs/2026-08-03-cross-platform-auto-update-design.md)
**Goal**: Make the updater trust chain, platform installer handoff, rollback behavior, and release-candidate channels trustworthy before publishing 0.11.0.
**Architecture**: The release validator will treat the exact draft GitHub Release as the source of artifact bytes, compare its signatures with `latest.json`, and reproduce Tauri's Minisign verification with `node:crypto`. Deck will pin one reviewed fork revision containing the upstream Windows `ShellExecuteW` check and the macOS rollback/permission patch. Stable and release-candidate tags will share one workflow, but RC manifests will use isolated fixed channels and production channels will remain untouched until the final release gate passes.

## 1. Expected outcomes

- A wrong updater public key, modified installer, modified sidecar signature, mismatched manifest signature, or extra/stale draft asset fails validation — verified by `npm run test:updater-manifest`.
- The validator verifies bytes fetched back from the exact draft release, and their digests match the build provenance — verified by the negative release-byte and provenance cases in `scripts/verify-updater-manifest.test.mjs`.
- Windows returns an updater error when `ShellExecuteW` fails instead of exiting successfully — verified by the fork's updater tests and Deck's existing `install-failed` controller test.
- macOS restores the prior `.app` when the final bundle move fails and preserves the prior bundle's directory mode on success — verified by focused updater tests in the fork.
- Stable and `-rc.N` source tags resolve to exact source commits, while `-windows-preview` and channel tags remain rejected — verified by `npm test` and `scripts/release-workflow.test.ts`.
- `0.11.0-rc.1` discovers and installs `0.11.0-rc.2` on macOS and Windows without moving either production update channel — verified by the signed real-device checklist.
- Public 0.11.0 and `windows-preview-channel` are published only after both platform E2E runs, tampered-signature refusal, and failure injection pass — verified by the release evidence recorded in `docs/CONTEXT.md`.

## 2. Canonical data

**Canonical data**: The exact tag commit, live draft Release API response, assets re-downloaded by asset ID from that draft, `latest.json`, sidecar `.sig` files, and `DECK_UPDATER_PUBLIC_KEY` are the release trust roots. The pinned fork commit is the sole source for updater platform-install behavior.

**Taken from**: `resolve-target` outputs, GitHub's REST Release/asset APIs under `github.repository`, the workflow's protected repository variable, and an immutable fork revision reviewed against upstream `v2`.

**Never taken from**: `GITHUB_SHA` or `GITHUB_REF_NAME` during `workflow_dispatch`, a staged installer without a draft re-download, a mutable fork branch, `releases/latest` for prereleases, or an unpublished local public key.

## 3. Business rules and invariants

- **Old-build authority**: 0.11.0 hardening cannot protect the 0.10.0 → 0.11.0 transition because 0.10.0 runs that install — verified by release notes and E2E starting from `0.11.0-rc.1`, not 0.10.0.
- **Exact signature binding**: Each manifest signature equals its downloaded sidecar content before cryptographic verification — verified by `rejects a manifest and sidecar signature mismatch`.
- **Tauri-compatible verification**: Decode the outer Tauri base64, validate Minisign algorithm/key-id packets, hash `ED` signatures with BLAKE2b-512, verify the Ed25519 payload signature, and verify the trusted-comment global signature — verified by generated valid, wrong-key, tampered-payload, tampered-signature, and tampered-comment fixtures.
- **Release-byte authority**: Cryptographic verification reads only re-downloaded draft assets; provenance proves they equal the local build outputs — verified by `rejects staged bytes that differ from the draft asset`.
- **Closed asset set**: Platform-specific expected assets form the complete draft asset set; an unknown, duplicate, missing, or stale asset fails — verified by asset-set tests for macOS and Windows.
- **Immutable dependency**: `[patch.crates-io]` uses a full 40-character fork commit, never a branch or tag — verified by `Cargo.lock` source inspection.
- **RC isolation**: RC builds use `macos-rc-channel` and `windows-rc-channel`; stable macOS uses `releases/latest`, and `windows-preview-channel` is moved only by final 0.11.0 — verified by workflow routing tests and config inspection.
- **Version monotonicity**: RC source versions are `0.11.0-rc.1` then `0.11.0-rc.2`; final source version is `0.11.0`, with `package.json`, `Cargo.toml`, and `tauri.conf.json` equal to the source tag — verified by `validate-source`.
- **No credential expansion**: No private updater key enters source, logs, PR jobs, workflow artifacts, or local `.env` files — verified by workflow inspection.

## 4. Scope

**Included**:

- Cryptographic manifest, signature, provenance, and exact draft-asset verification for macOS and Windows.
- Stable/RC tag resolution, RC release metadata, isolated RC channels, and final-only production channel promotion.
- A forked updater revision containing upstream PR #3516 plus macOS rollback and permission fixes for issues #3505 and #3506.
- Exact revision pinning, lockfile updates, version transitions, automated gates, release-candidate operator commands, and real-device evidence.
- Living documentation updates after automated and runtime claims become true.

**Excluded**:

- Feature work, UI changes, design-language changes, Authenticode, Apple Developer signing, notarization, or silent updates.
- Publishing `windows-preview-channel` from `c2b3a14` or any pre-hardening build.
- Treating CI, a VM without a desktop session, or a macOS-local run as Windows install/relaunch evidence.
- Agent-created releases, tags, channel mutations, production keys, or upstream merges without separate operator authorization.
- Fixes unrelated to the 0.11.0 updater scope, including the dirty landing prototype and untracked landing assets.

## 5. Risks and decisions

**Resolved with risk**:

- RC builds use dedicated macOS and Windows RC channels. This is the conservative reading of the final-only production-channel rule and avoids exposing either production endpoint during E2E.
- Node reproduces the verification behavior of `minisign-verify` without a new dependency. Packet parsing and both Ed25519 signatures therefore need explicit format tests rather than relying on a CLI smoke test.
- The upstream patch lives in the user's fork until Tauri publishes a release containing all three platform fixes. Deck remains tied to that immutable revision until a separately reviewed unpin.
- The macOS patch preserves the old bundle until the new bundle is installed, restores it on every unprivileged swap failure, and reapplies the old root directory mode. The privileged path must avoid deleting the old bundle before replacement succeeds.

**Approval/fork input required before implementation**:

- Approving this plan confirms the dedicated `windows-rc-channel` interpretation.
- The user must create `mxrsv/plugins-workspace` and provide its URL before the upstream worktree, patch commit, or Deck pin can exist.
- The user must run the macOS replacement E2E and provide access to a real Windows desktop for the Windows E2E.

## 6. Tasks

### Task 1: Lock Tauri-compatible Minisign parsing with red tests

**Files**:

- [verify-updater-manifest.test.mjs](../../scripts/verify-updater-manifest.test.mjs)

**Decision**: Test fixtures generate an Ed25519 keypair in memory and encode Tauri's outer base64 plus Minisign `Ed`/`ED`, key-id, signature, trusted-comment, and global-signature packets.

**Build**:

- Replace the fake `"signed"`/`"signature"` fixture with a valid signed installer and matching sidecar.
- Add failing cases named `rejects a wrong updater public key`, `rejects tampered installer bytes`, `rejects a tampered sidecar signature`, and `rejects a tampered trusted comment`.
- Assert fixture construction never writes a private key or generated asset to disk.

**Verify**:

- `npm run test:updater-manifest` → the four new cryptographic cases fail before Task 2.

---

### Task 2: Implement Minisign verification with Node crypto

**Files**:

- [verify-updater-manifest.mjs](../../scripts/verify-updater-manifest.mjs)
- [verify-updater-manifest.test.mjs](../../scripts/verify-updater-manifest.test.mjs)

**Depends on**: Task 1

**Decision**: `verifyUpdaterSignature(bytes, encodedSignature, encodedPublicKey)` validates packet lengths, algorithms, key-id equality, payload signature, and global signature; it uses `blake2b512` for `ED` and raw bytes for legacy `Ed`.

**Build**:

- Parse the public key and signature as bounded base64/UTF-8 inputs with exact packet lengths.
- Convert the raw 32-byte Ed25519 key into an SPKI key accepted by `node:crypto`.
- Verify the artifact signature and the global signature over signature bytes plus the trusted comment without its prefix.
- Return explicit non-secret errors for malformed encoding, wrong key id, payload failure, and global-signature failure.

**Verify**:

- `npm run test:updater-manifest` → all Task 1 cryptographic cases pass.

---

### Task 3: Lock manifest, sidecar, provenance, and draft-asset binding

**Files**:

- [verify-updater-manifest.test.mjs](../../scripts/verify-updater-manifest.test.mjs)
- [create-updater-provenance.mjs](../../scripts/create-updater-provenance.mjs)

**Decision**: Validation receives separate staged provenance and release-downloaded bytes; only the latter are cryptographically trusted, while equal digests bind the two sets.

**Build**:

- Add failing tests for inline/sidecar mismatch, staged/draft byte mismatch, stale draft asset, duplicate asset URL/name, missing sidecar, and an unexpected platform target.
- Add valid macOS fixtures for the universal `.app.tar.gz`, `.sig`, `.dmg`, and `latest.json` asset set.
- Generalize provenance tag validation to stable and `-rc.N` source tags plus their derived Windows preview tags without accepting channel tags.

**Verify**:

- `npm run test:updater-manifest` → the new binding and asset-set cases fail before Task 4.

---

### Task 4: Make the validator trust only exact draft-release bytes

**Files**:

- [verify-updater-manifest.mjs](../../scripts/verify-updater-manifest.mjs)
- [verify-updater-manifest.test.mjs](../../scripts/verify-updater-manifest.test.mjs)
- [create-updater-provenance.mjs](../../scripts/create-updater-provenance.mjs)

**Depends on**: Tasks 2 and 3

**Decision**: Platform descriptors define the exact expected asset names/targets. Manifest URLs must identify assets in the same draft, sidecars must match inline signatures, and downloaded bytes must match provenance before signature verification.

**Build**:

- Replace Windows-only installer assumptions with explicit macOS and Windows descriptors.
- Reject any release asset not accounted for by the descriptor, including stale assets left on an existing draft.
- Compare downloaded asset SHA-256 values with staged provenance and verify each updater payload using `DECK_UPDATER_PUBLIC_KEY`.
- Keep `latest.json` and release metadata canonical comparisons; do not read payload bytes from the staging directory for cryptographic verification.

**Verify**:

- `npm run test:updater-manifest` → every positive and negative manifest case passes.

---

### Task 5: Re-download and validate the Windows draft assets

**Files**:

- [release.yml](../../.github/workflows/release.yml)

**Depends on**: Task 4

**Decision**: `validate-windows-preview` fetches fresh release metadata by release ID and downloads every asset by API asset ID into a clean directory before invoking the validator.

**Build**:

- Pass the resolved tag/SHA outputs instead of `GITHUB_REF_NAME`/`GITHUB_SHA` through collection, provenance, and validation.
- Capture local provenance before upload, then fetch the draft response and release assets again in the validation job using `GITHUB_TOKEN`.
- Pass `DECK_UPDATER_PUBLIC_KEY` and the separate staging/re-download directories to the validator.
- Fail before publication when the fresh asset set differs in name, count, digest, signature, or payload bytes.

**Verify**:

- `npm run test:updater-manifest` → all validator cases pass.
- Workflow inspection shows the validator's payload directory is populated only by GitHub asset API downloads.

---

### Task 6: Apply the same trust chain to the macOS draft

**Files**:

- [release.yml](../../.github/workflows/release.yml)

**Depends on**: Tasks 4 and 5

**Decision**: macOS no longer uses an inline non-empty signature check; it has a collect/validate/preserve gate equivalent to Windows before any publish or channel step.

**Build**:

- Collect the universal updater payload, sidecar, DMG, manifest, release response, and provenance from the exact source SHA.
- Add a separate macOS validation job that re-fetches draft assets and runs the same cryptographic validator for both Darwin manifest targets.
- Make macOS publication depend on this validation job.

**Verify**:

- `npm run test:updater-manifest` → macOS asset and signature fixtures pass.
- Workflow dependency inspection shows no macOS draft can publish without cryptographic validation.

---

### Task 7: Lock release tag and channel routing

**Files**:

- [release-workflow.test.ts](../../scripts/release-workflow.test.ts)
- [release.yml](../../.github/workflows/release.yml)

**Decision**: Structural tests require stable plus `-rc.N` triggers, reject preview/channel recursion, use resolved tag/SHA outputs, and keep RC endpoints separate from production endpoints.

**Build**:

- Add red tests for accepted `v0.11.0`/`v0.11.0-rc.1`, rejected `v0.11.0-windows-preview`, and final-only production-channel promotion.
- Assert RC builds override both platform endpoints to their dedicated RC channels while committed configs retain production endpoints.
- Assert RC releases are prereleases and stable releases are not.

**Verify**:

- `npm test -- --run scripts/release-workflow.test.ts` → fails before Task 8.

---

### Task 8: Implement stable and release-candidate workflow routing

**Files**:

- [release.yml](../../.github/workflows/release.yml)
- [release-workflow.test.ts](../../scripts/release-workflow.test.ts)

**Depends on**: Tasks 6 and 7

**Decision**: `resolve-target` accepts only exact stable or `-rc.N` tags. RC builds are prereleases, inject RC endpoints before bundling, and promote only RC channels; final 0.11.0 promotes the production Windows preview channel.

**Build**:

- Widen the push trigger and exact resolver without matching `-windows-preview` or channel tags.
- Validate source versions against `needs.resolve-target.outputs.tag` and SHA for both push and manual retry paths.
- Route macOS RC release metadata and updater config to `macos-rc-channel`; route Windows RC metadata/config to `windows-rc-channel`.
- Keep `releases/latest` and `windows-preview-channel` untouched on RC runs, and prevent recursively generated preview/channel tags from starting a new run.

**Verify**:

- `npm test -- --run scripts/release-workflow.test.ts` → all routing tests pass.
- `npm test` → the full frontend/script suite stays green.

---

### Task 9: Create the upstream fork branch and worktree

**Files**:

- [upstream updater source](https://github.com/tauri-apps/plugins-workspace/blob/622f02bf21858f0cff95419fc042ce02b8c6b18b/plugins/updater/src/updater.rs)

**Depends on**: User-created `mxrsv/plugins-workspace`

**Decision**: Fork from upstream `v2`, branch once for the macOS issues, and use an isolated worktree because the work will become an upstream PR.

**Build**:

- Add upstream as a read-only remote and verify merge commit `622f02bf21858f0cff95419fc042ce02b8c6b18b` is an ancestor.
- Create one conventional branch plus paired worktree for issues #3505/#3506; do not edit any SpaceVibe sibling repository.
- Record the fork URL and chosen base revision in [AGENTS.md](../../AGENTS.md) before patching.

**Verify**:

- `git remote -v` → fork is `origin` and `tauri-apps/plugins-workspace` is the upstream remote.
- `git merge-base --is-ancestor 622f02bf21858f0cff95419fc042ce02b8c6b18b HEAD` → exit 0.

---

### Task 10: Add failing upstream macOS rollback and permission tests

**Files**:

- [upstream updater source](https://github.com/tauri-apps/plugins-workspace/blob/622f02bf21858f0cff95419fc042ce02b8c6b18b/plugins/updater/src/updater.rs)

**Depends on**: Task 9

**Decision**: Extract a filesystem swap helper with an injected rename operation under tests so final-move failure is deterministic without cross-volume or root assumptions.

**Build**:

- Add a test that fails the final new-bundle move after the old bundle is backed up and asserts the old bundle returns to the original path.
- Add a test that installs a replacement bundle and asserts its root mode equals the prior bundle's mode rather than the temp directory's `0700`.
- Add a privileged-path command construction test that proves the old bundle is moved aside before replacement and is restored if replacement fails.

**Verify**:

- `cargo test -p tauri-plugin-updater` in the fork worktree → the focused new cases fail before Task 11.

---

### Task 11: Implement the upstream macOS transactional swap

**Files**:

- [upstream updater source](https://github.com/tauri-apps/plugins-workspace/blob/622f02bf21858f0cff95419fc042ce02b8c6b18b/plugins/updater/src/updater.rs)

**Depends on**: Task 10

**Decision**: Preserve the old bundle and its mode until replacement succeeds; on any replacement failure, restore the old path before returning the original error with rollback context.

**Build**:

- Keep the backup directory alive across the swap and remove it only after the replacement and permission application succeed.
- Restore the backup on final rename or permission-application failure; if rollback also fails, return an error containing both failures without deleting the backup.
- Replace the privileged `rm -rf && mv` sequence with old-aside, new-into-place, rollback-on-error ordering and safely quote path arguments.
- Apply the saved prior bundle mode to the installed `.app` root.

**Verify**:

- `cargo fmt --all -- --check` → exit 0.
- `cargo test -p tauri-plugin-updater` → all updater tests pass.

---

### Task 12: Prepare the upstream PR and immutable fork revision

**Files**:

- [upstream issue #3505](https://github.com/tauri-apps/plugins-workspace/issues/3505)
- [upstream issue #3506](https://github.com/tauri-apps/plugins-workspace/issues/3506)

**Depends on**: Task 11

**Decision**: One English conventional commit and one upstream PR cover the coupled macOS transaction and permission behavior; Deck pins the pushed commit before upstream merge.

**Build**:

- Commit only the updater patch/tests in the fork worktree and push the branch after user authorization.
- Prepare an upstream PR body with reproduction, rollback invariant, permission invariant, and exact test commands.
- Capture the immutable 40-character fork commit for Deck.

**Verify**:

- `git status --short` in the fork worktree → empty after the scoped commit.
- `git rev-parse HEAD` → a 40-character commit reachable from the pushed fork branch.

---

### Task 13: Pin Deck to the reviewed updater fork revision

**Files**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [AGENTS.md](../../AGENTS.md)

**Depends on**: Task 12

**Decision**: `[patch.crates-io]` points `tauri-plugin-updater` at the immutable fork commit that contains upstream PR #3516 and Tasks 10–11.

**Build**:

- Add the git/revision patch and update only the affected Cargo lock entries.
- Confirm the existing rejected-install controller test retains the downloaded update and exposes `install-failed`; add only a narrowly missing assertion if required.
- Record the resolved fork/revision and one-line reason in the 0.11.0 `In flight` entry.

**Verify**:

- `cargo tree --manifest-path src-tauri/Cargo.toml -i tauri-plugin-updater` → source resolves to the exact fork revision.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` → all Deck Rust tests pass.
- `npm test -- --run src/updater/update-controller.test.ts` → install rejection remains retryable.

---

### Task 14: Run the full pre-RC automated gate

**Files**:

- [package.json](../../package.json)
- [Cargo.toml](../../src-tauri/Cargo.toml)

**Depends on**: Tasks 4, 8, and 13

**Decision**: No release version change, tag, or external mutation occurs until all local gates are fresh and green.

**Build**:

- Inspect `git diff --check`, the complete scoped diff, new-file references, and unrelated dirty files.
- Run frontend, manifest, build, Rust format, and Rust test gates from the current tree.

**Verify**:

- `npm test` → exit 0.
- `npm run test:updater-manifest` → exit 0.
- `npm run build` → exit 0.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → exit 0.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` → exit 0.
- `git diff --check` → exit 0.

---

### Task 15: Set the JavaScript package version to 0.11.0-rc.1

**Files**:

- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)

**Depends on**: Task 14

**Decision**: The npm package and root lock entry become `0.11.0-rc.1` without changing dependency versions.

**Build**:

- Update the root package version and only the matching root/package lock entries.
- Inspect the lockfile diff for dependency churn and reject any unrelated change.

**Verify**:

- `node -p "require('./package.json').version"` → `0.11.0-rc.1`.
- Root `package-lock.json` package entries both report `0.11.0-rc.1`.

---

### Task 16: Set the Rust and Tauri versions to 0.11.0-rc.1

**Files**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [tauri.conf.json](../../src-tauri/tauri.conf.json)

**Depends on**: Task 15

**Decision**: Cargo package and Tauri application versions become `0.11.0-rc.1`; dependency versions and sources remain unchanged.

**Build**:

- Update the Cargo package version, its root lock entry, and the Tauri config version.
- Inspect `Cargo.lock` and reject any change outside the root package version.

**Verify**:

- Version equality command prints `0.11.0-rc.1` for package, Cargo, and Tauri.
- `cargo metadata --locked --manifest-path src-tauri/Cargo.toml --no-deps` reports Deck `0.11.0-rc.1`.

---

### Task 17: Build and publish 0.11.0-rc.1 under operator control

**Files**:

- [release.yml](../../.github/workflows/release.yml)

**Depends on**: Task 16 and user authorization

**Decision**: The operator creates/pushes the RC.1 tag; the workflow may publish only prerelease assets and isolated RC channels.

**Build**:

- Re-run the full Task 14 gate and prepare exact tag/release commands for the user.
- Review the workflow diff and draft release metadata before the operator publishes RC.1.
- Install RC.1 manually on macOS and the real Windows desktop before publishing RC.2.

**Verify**:

- GitHub workflow run shows both RC drafts cryptographically validated before RC channel promotion.
- Production `releases/latest` and `windows-preview-channel` asset SHAs remain unchanged.

---

### Task 18: Set the JavaScript package version to 0.11.0-rc.2

**Files**:

- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)

**Depends on**: Task 17

**Decision**: The npm package and root lock entry become the strictly newer `0.11.0-rc.2`.

**Build**:

- Update the root package version and matching lock entries only.
- Reject any dependency or integrity change in `package-lock.json`.

**Verify**:

- `node -p "require('./package.json').version"` → `0.11.0-rc.2`.
- Root `package-lock.json` package entries both report `0.11.0-rc.2`.

---

### Task 19: Set the Rust and Tauri versions to 0.11.0-rc.2

**Files**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [tauri.conf.json](../../src-tauri/tauri.conf.json)

**Depends on**: Task 18

**Decision**: Cargo package and Tauri application versions become `0.11.0-rc.2` without dependency changes.

**Build**:

- Update the Cargo package version, its root lock entry, and Tauri config version.
- Re-run Task 14 before any RC.2 tag command is prepared.

**Verify**:

- Version equality command prints `0.11.0-rc.2` for package, Cargo, and Tauri.
- `cargo metadata --locked --manifest-path src-tauri/Cargo.toml --no-deps` reports Deck `0.11.0-rc.2`.

---

### Task 20: Upgrade real devices from rc.1 to rc.2 and exercise failures

**Files**:

- [release.yml](../../.github/workflows/release.yml)

**Depends on**: Task 19 and user authorization

**Decision**: Both installed RC.1 builds discover, verify, download, install, and relaunch RC.2 through isolated RC channels.

**Build**:

- Let the user create/push the RC.2 tag after reviewing the fresh automated gate.
- On macOS and Windows, record old/new version, manifest URL, signature acceptance, download, install, process exit, and relaunched version.
- Serve a manifest with a modified signature and confirm both apps refuse it without installation.
- Inject an install interruption after backup/start and confirm the old app survives and the next launch reports the incomplete attempt accurately.

**Verify**:

- macOS and Windows evidence each covers discover → verify → download → install → relaunch.
- Tampered-signature evidence shows no installer launch or app replacement.
- Failure-injection evidence shows a launchable app remains and the breadcrumb reports the correct outcome.

---

### Task 21: Set the JavaScript package version to final 0.11.0

**Files**:

- [package.json](../../package.json)
- [package-lock.json](../../package-lock.json)

**Depends on**: Task 20

**Decision**: The npm package and root lock entry become final `0.11.0`.

**Build**:

- Remove the prerelease suffix from the root package and matching lock entries.
- Reject any dependency or integrity change in `package-lock.json`.

**Verify**:

- `node -p "require('./package.json').version"` → `0.11.0`.
- Root `package-lock.json` package entries both report `0.11.0`.

---

### Task 22: Set the Rust and Tauri versions to final 0.11.0

**Files**:

- [Cargo.toml](../../src-tauri/Cargo.toml)
- [Cargo.lock](../../src-tauri/Cargo.lock)
- [tauri.conf.json](../../src-tauri/tauri.conf.json)

**Depends on**: Task 21

**Decision**: Cargo package and Tauri application versions become final `0.11.0` without dependency changes.

**Build**:

- Remove the prerelease suffix from the Cargo package, root lock entry, and Tauri config.
- Run the complete Task 14 gate on the final source.

**Verify**:

- Version equality command prints `0.11.0` for package, Cargo, and Tauri.
- `npm test`, `npm run test:updater-manifest`, `npm run build`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`, and `cargo test --locked --manifest-path src-tauri/Cargo.toml` all exit 0.

---

### Task 23: Publish final 0.11.0 and enable production channels

**Files**:

- [release.yml](../../.github/workflows/release.yml)
- [README.md](../../README.md)

**Depends on**: Task 22 and explicit release authorization

**Decision**: Only the final stable workflow run may publish stable macOS and move `windows-preview-channel`.

**Build**:

- Prepare the final tag/release commands and release notes for operator review.
- State accurately that 0.10.0 users have one final unhardened/manual bootstrap transition and the hardened guarantee starts from 0.11.0 onward.
- After operator publication, verify stable macOS, unsigned Windows preview, manifests, signatures, download links, and channel asset SHAs.

**Verify**:

- Stable and Windows channel `latest.json` responses return 200 and cryptographically validate against the published bytes and embedded public key.
- GitHub release metadata points both releases at the final exact source SHA.

---

### Task 24: Close the living architecture and delivery records

**Files**:

- [CONTEXT.md](../CONTEXT.md)
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [AGENTS.md](../../AGENTS.md)

**Depends on**: Task 23

**Decision**: Only verified automated/runtime claims become `current`; the closed 0.11.0 decision leaves the `In flight` queue.

**Build**:

- Add current source anchors and runtime evidence to context and architecture.
- Move the closed 0.11.0 decision from `In flight` into architecture and retain any unverified gate as backlog/drift.
- Recheck all touched living-doc anchors after workflow line movement.

**Verify**:

- Relative-link check confirms every new living-doc anchor resolves.
- `git diff --check` → exit 0.
- `git status --short` shows only scoped changes plus explicitly retained unrelated user files.
