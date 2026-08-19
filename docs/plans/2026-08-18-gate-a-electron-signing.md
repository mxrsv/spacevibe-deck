# Gate A — Signed, Notarized, Self-Updating Electron macOS Build

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Developer ID signed, notarized, stapled Electron macOS build that a
user can install from a dmg with no Gatekeeper warning and that spawns panes normally —
the half of Gate A that has to exist before anything can be published.

**Architecture:** The Tauri release workflow already carries a complete macOS signing
scaffold — keychain import, notarization credentials and `codesign`/`spctl`/`stapler`
verification. This plan does **not** invent a second one: it reuses the same six secret
names and the same verification commands, and adds an Electron-only packaging config
beside the two existing local ones. The Tauri path is not touched at all. The updater
lifecycle (`electron/updater/`) already exists and already names a GitHub feed; what is
missing is a packaging config that produces the assets that feed needs — publishing and
the self-update proof are the continuation plan.

**Tech Stack:** electron-builder 26.15.3, @electron/notarize 2.5.0 (dynamic-imported by
app-builder-lib), electron-updater 6.8.9, Electron 43.3.0, `notarytool`, GitHub Actions.

**Spec:** [docs/specs/2026-08-11-electron-migration-design.md](../specs/2026-08-11-electron-migration-design.md)
`decided` — this plan implements the release half of it. The MVP plan
[docs/plans/2026-08-11-electron-mvp.md](2026-08-11-electron-mvp.md) `building` covers the
product half and is not touched here.

---

## Global Constraints

- **English only** in every file this plan creates or edits — strings, comments, docs and
  commit messages (R1).
- **Apple Team ID is `DJDD3T8LH7`**, enrolled 2026-08-18 as **Individual**. The signing
  identity therefore reads `Developer ID Application: <person name> (DJDD3T8LH7)` — there
  is no organization name in it.
- **Reuse the existing secret NAMES**, do not add parallel ones. `release.yml` consumes
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `KEYCHAIN_PASSWORD`, `APPLE_ID`,
  `APPLE_PASSWORD`, `APPLE_TEAM_ID` — but **none of the six are actually set**. Measured
  2026-08-19: `gh secret list -R mxrsv/spacevibe-deck` returns only
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. The Tauri workflow
  references six secrets it has never had, which is consistent with the release freeze —
  its `Verify macOS release signing` step would have refused the run. So Task 1 Step 6
  creates all six from nothing; it is not "filling in the last one".
- **electron-builder reads different env names than Tauri does.** Verified by reading
  `node_modules/app-builder-lib/out/mac/MacTargetHelper.js:219-244` in this checkout:
  notarization takes `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Tauri's
  variable is `APPLE_PASSWORD`. The Electron workflow therefore maps
  `APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_PASSWORD }}` — one secret, two names.
- **No `CSC_LINK` / `CSC_KEY_PASSWORD`.** The repo's established pattern imports the `.p12`
  into a build keychain with `security import`; electron-builder discovers the identity
  from the default keychain. Adding `CSC_*` would be a second, conflicting mechanism.
- **The `zip` target is mandatory.** `electron-updater` updates macOS from the zip, not
  from the dmg. A dmg-only config produces a release that can never self-update — exactly
  the failure this repo's "auto-update is a core requirement" rule exists to prevent.
- **Do not modify `electron-builder.yml` or `electron-builder.gate-m.yml`.** Both are
  deliberately unsigned, local-only configs and their header comments say so. The shipping
  config is a third file.
- **Nothing in this plan touches `.github/workflows/release.yml`.** The release freeze
  stays; lifting it needs self-update evidence that only the continuation plan produces.
- **Windows is out of scope.** Gate C (no real Windows hardware) is untouched; the
  unsigned NSIS preview continues exactly as it is. No Windows signing appears in this plan.
- **The Mac App Store is out of scope, permanently.** The iOS/macOS app records created on
  App Store Connect on 2026-08-18 are dead ends for Deck: the store requires sandboxing,
  which forbids spawning arbitrary binaries through a PTY, and it excludes Squirrel.Mac
  auto-update. Fork F5 took the app-specific password, so App Store Connect is not touched
  by this plan at all.
- **Every claim of success needs pasted command output** (W4). "The build is signed" is
  established by `codesign --verify` output, never by the build exiting 0.

---

## Forks — decided 2026-08-18

These are `AGENTS.md` **Forks** entries (bundle, signing, release channel, updater,
version configuration).

**All five were answered by the owner on 2026-08-18, each taking the recommendation.** They
are recorded here as decided; move them to `docs/ARCHITECTURE.md#resolved-forks` when the
continuation plan closes (D9).

| Fork   | Decision (2026-08-18)                                                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | The Electron build ships as `dev.spacevibe.deck` / `SpaceVibe Deck` — the Tauri bundle's own identity, so it replaces the installed app rather than standing beside it. |
| **F2** | `arm64` only. Intel Macs are not served by the Electron build; the final Tauri release must say so.                                                                     |
| **F3** | A separate `.github/workflows/electron-release.yml` on tag `v*.*.*-electron.N`.                                                                                         |
| **F4** | The channel lives in the version: `X.Y.Z-electron.N`, published as a pre-release, `allowPrerelease = true` in the host.                                                 |
| **F5** | App-specific password (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`), reusing the secret NAMES release.yml already wires (the values did not exist — see Task 1).                                      |

The reasoning behind each, and what it costs, is below.

| Fork   | Question                                                                                                                                                                                                                                                                                                                        | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | Shipping `appId` / `productName` for the Electron host. Tauri ships `SpaceVibe Deck`; the local Electron config is `Deck Electron` / `dev.spacevibe.deck.electron`.                                                                                                                                                             | Take the Tauri bundle's own identity (`SpaceVibe Deck`, its appId) so the Electron build _replaces_ the installed app in `/Applications` at cutover. This makes the clean-install decision visible (different userData path, no migration) while not littering a second Deck icon. Costs: the two hosts can never be installed side by side, and no updater bridges Tauri → Electron regardless.                                                                                                                                                                                                                                                                                                                     |
| **F2** | `universal` (what Tauri ships) vs `arm64`-only.                                                                                                                                                                                                                                                                                 | Start `arm64`-only. `node-pty` is a native module and `@electron/universal` merging two asar-unpacked native trees is a known-fiddly step that would put an unrelated failure mode in the middle of Gate A's evidence chain. Universal is a follow-up, not a prerequisite. Cost: Intel Macs lose the Electron build at cutover — state it in the final Tauri release notes.                                                                                                                                                                                                                                                                                                                                          |
| **F3** | A new `.github/workflows/electron-release.yml` with its own tag pattern, vs a job added to the frozen `release.yml`.                                                                                                                                                                                                            | New file, tag pattern `v[0-9]+.[0-9]+.[0-9]+-electron.[0-9]+`. `release.yml` is frozen at the job level and its every job assumes the Tauri artifact set (`latest.json`, `.sig`, provenance, trust-chain validator). The tag shape is **not** free: see F4 — a tag electron-updater cannot parse as semver is invisible to the updater.                                                                                                                                                                                                                                                                                                                                                                              |
| **F4** | Feed layout. `electron/ipc/register-updater.ts:76-83` already hard-codes `provider: github, owner: mxrsv, repo: spacevibe-deck`. Tauri releases in that repo carry no `latest-mac.yml`, so a plain GitHub provider pointed at "latest release" resolves to a Tauri release and fails with `ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`. | Carry the channel **in the version**: `X.Y.Z-electron.N`, tagged `vX.Y.Z-electron.N`, published as a pre-release, with `autoUpdater.allowPrerelease = true` in the host. Both sides then derive the channel from the same string with no extra configuration — `app-builder-lib` takes `publish.channel` from `appInfo.channel` (`PublishManager.js:416-429`) and `GitHubProvider` takes it from `semver.prerelease(tag)[0]` (`GitHubProvider.js:132-134`), so the manifest is `electron-mac.yml` on both. Verified in this checkout, and it is why F3's tag cannot be `electron-v1.0.0`: `semver.valid("electron-v1.0.0")` is `null`, and `GitHubProvider.js:71` skips every feed entry whose tag fails that check. |
| **F5** | Notarization credential: app-specific password (`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID`) vs App Store Connect API key (`APPLE_API_KEY` + `APPLE_API_KEY_ID` + `APPLE_API_ISSUER`).                                                                                                                         | App-specific password — two clicks on appleid.apple.com, and the names are already wired through `release.yml`. **Correction 2026-08-19: the original reason, "the three secrets already exist for Tauri", was wrong — none of the six were ever set.** The decision stands; the API key would add a downloadable `.p8` to store and rotate during a gate whose point is proving the pipeline. The API key is strictly better hygiene (revocable, not tied to the Apple ID) and is the right follow-up, but it adds a credential during a gate whose point is proving the pipeline.                                                                                                                                                                                                                                                                                                                                                                                                                                    |

---

## File Structure

| File                                                  | Responsibility                                                                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create: `build/entitlements.mac.plist`                | Hardened-runtime entitlements for the shipping build. `build/` does not exist yet in this repo — electron-builder's default lookup path.                                                                                   |
| Create: `electron-builder.release.yml`                | The **shipping** packaging config: signed, hardened, notarized, `dmg` + `zip`, `publish: github`. The one file that differs from the two local configs by being a release.                                                 |
| Create: `scripts/electron-release-config.test.ts`     | Guards the release config's invariants the way `scripts/electron-ipc-contract.test.ts` guards the IPC boundary: zip present, hardened runtime on, identity not null, notarize not disabled, entitlements path real.        |
| Create: `scripts/verify-electron-release-signing.mjs` | Preflight, modelled on `scripts/verify-macos-release-signing.mjs`: refuses to start a release build when the signing/notarization env is incomplete, so the failure lands in 5 seconds instead of after a 10-minute build. |
| Modify: `package.json`                                | Two scripts: `electron:package:release`, `test:electron-release-config`.                                                                                                                                                   |
| Modify: `electron/ipc/register-updater.ts:70-85`      | Feed channel, only if fork F4 selects a channel. The comment there explicitly anticipates this ("the production packaging config does not exist yet"). Editing it is deferred to the continuation plan, which can test it. |

`.github/workflows/electron-release.yml` and the `docs/CONTEXT.md` / `AGENTS.md` ledger
updates belong to
[2026-08-18-electron-release-pipeline.md](2026-08-18-electron-release-pipeline.md).

---

### Task 1: The owner creates the signing identity — DONE 2026-08-19

This task is **manual and runs on the owner's Mac**. It has no code and no commit. Nothing
downstream can be verified without it, and it can start immediately — it does not depend on
the forks.

**Files:** none.

**Interfaces:**

- Produces: a `Developer ID Application` identity in the login keychain; a `.p12` export and
  its password; an app-specific password; six populated GitHub secrets.

- [x] **Step 1: Confirm the starting state**

```bash
security find-identity -v -p codesigning
```

Expected: `0 valid identities found` (this is what the machine reported on 2026-08-18). If
an identity already exists, skip to Step 4.

- [x] **Step 2: Create the Developer ID Application certificate — done through the portal, CSR generated with `openssl`**

The written step said to use Xcode. What actually ran avoided both Xcode and Keychain
Access, because a CSR is two commands:

```bash
mkdir -p ~/Documents/deck-signing && cd ~/Documents/deck-signing && umask 077
openssl req -new -newkey rsa:2048 -nodes \
  -keyout deck-developer-id.key -out deck-developer-id.certSigningRequest \
  -subj "/emailAddress=<apple id>/CN=<name>/C=VN"
```

Upload that CSR at developer.apple.com → Certificates → `+` → **Developer ID Application**,
and take **G2 Sub-CA**, not the pre-selected *Previous Sub-CA* — certificates from the old
intermediary expire 2027-02-01 regardless of their own five-year validity.

Issued: `Developer ID Application: VAN BINH TRAN (DJDD3T8LH7)`, issuer
`Developer ID Certification Authority OU=G2`, valid to 2031-08-20.

- [x] **Step 3: Verify the identity exists**

```bash
security find-identity -v -p codesigning
```

Expected: one line containing `"Developer ID Application: <name> (DJDD3T8LH7)"`. Record the
exact string — Task 4 needs it.

- [x] **Step 4: Build the `.p12` and import it — `-certpbe PBE-SHA1-3DES` is mandatory**

The downloaded `.cer` is only the public half; it is bundled with the key from Step 2 and
with Apple's G2 intermediate, so the same file works in a CI keychain that has no Apple
intermediates installed.

```bash
openssl x509 -inform DER -in ~/Downloads/developerID_application.cer -out deck-developer-id.crt
curl -fsSL -o DeveloperIDG2CA.cer https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
openssl x509 -inform DER -in DeveloperIDG2CA.cer -out DeveloperIDG2CA.crt
openssl rand -base64 24 > deck-developer-id.p12.password
openssl pkcs12 -export -inkey deck-developer-id.key -in deck-developer-id.crt \
  -certfile DeveloperIDG2CA.crt -name "Developer ID Application: ... (DJDD3T8LH7)" \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 \
  -out deck-developer-id.p12 -passout "pass:$(cat deck-developer-id.p12.password)"
security import deck-developer-id.p12 -k ~/Library/Keychains/login.keychain-db \
  -P "$(cat deck-developer-id.p12.password)" -T /usr/bin/codesign -T /usr/bin/security
```

**The three `-*pbe`/`-macalg` flags are not optional.** OpenSSL 3 defaults to
AES-256-CBC + PBKDF2, which macOS's Security.framework cannot read — and it reports that as
`MAC verification failed during PKCS12 import (wrong password?)`, which sends you hunting a
password bug that does not exist. Measured on OpenSSL 3.6.3.

Everything lives in `~/Documents/deck-signing/` at mode 600, including the generated `.p12`
password, so a backup of that one folder is self-sufficient.

**Back this file up off the machine.** Developer ID Application certificates are capped per
account and the private key cannot be re-derived; losing it means losing the ability to sign
under this identity.

- [x] **Step 5: Create an app-specific password**

appleid.apple.com → Sign-In and Security → App-Specific Passwords → generate one named
`deck-notarization`. This is the value of the existing `APPLE_PASSWORD` secret.

- [x] **Step 6: Populate the six repository secrets**

```bash
gh secret set APPLE_CERTIFICATE < <(base64 -i /path/to/deck-developer-id.p12)
gh secret set APPLE_CERTIFICATE_PASSWORD   # the .p12 export password
gh secret set KEYCHAIN_PASSWORD            # any strong string; it names a throwaway CI keychain
gh secret set APPLE_ID                     # binh280912@gmail.com
gh secret set APPLE_PASSWORD               # the app-specific password from Step 5
gh secret set APPLE_TEAM_ID                # DJDD3T8LH7
```

- [x] **Step 7: Verify all six are set**

```bash
gh secret list
```

Expected: the six names above appear. Values are not readable — that is correct.

---

### Task 2: Entitlements and the shipping packaging config — DONE 2026-08-18 (`832a1b0`)

**Files:**

- Create: `build/entitlements.mac.plist`
- Create: `electron-builder.release.yml`
- Modify: `package.json` (scripts block, beside `electron:package` at line 28)

**Interfaces:**

- Consumes: the identity from Task 1; the fork answers F1, F2, F4.
- Produces: `npm run electron:package:release`, and a config whose mac block Task 3's test
  reads.

- [x] **Step 1: Write the entitlements file**

electron-builder ships a default template with exactly these three keys
(`node_modules/app-builder-lib/templates/entitlements.mac.plist`). It is copied into the
repo rather than inherited so the file is reviewable and cannot change under a dependency
bump.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <!-- V8 compiles at runtime; the hardened runtime forbids that without this. -->
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <!-- node-pty loads from asarUnpack, outside the signed main binary's own
         library set; without this the hardened runtime refuses to load it and
         every pane fails to spawn. -->
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <!-- Deck spawns agent CLIs through a PTY and must pass them an environment.
         Hardened runtime strips DYLD_* from child processes otherwise, which
         breaks agents installed through version managers. -->
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
  </dict>
</plist>
```

- [x] **Step 2: Write `electron-builder.release.yml`**

The fork answers are already substituted below (F1: the Tauri bundle identity; F2:
`arm64`). Copy it as written.

```yaml
# The SHIPPING Electron package: signed, hardened, notarized, published.
#
# This is the third electron-builder config in the repo and the only one that
# produces a release. `electron-builder.yml` (local, unsigned, `dir`) and
# `electron-builder.gate-m.yml` (the Gate M packaged run) stay exactly as they
# are — their comments say they are not a release path, and that stays true.
#
# Notarization credentials arrive as environment variables, not as config:
# app-builder-lib reads APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID
# (MacTargetHelper.getNotarizeOptions). Tauri's workflow calls the same secret
# APPLE_PASSWORD, so the CI job maps one to the other.
appId: dev.spacevibe.deck
productName: SpaceVibe Deck
directories:
  output: dist-electron-release
extraMetadata:
  main: dist-electron/electron/main.cjs
  productName: SpaceVibe Deck
files:
  - dist/**
  - dist-electron/electron/**/*.cjs
  - dist-electron/src/**/*.cjs
  - dist-electron/electron/vendor/**
  - package.json
asarUnpack:
  - "**/node_modules/node-pty/**"
mac:
  # BOTH targets are required. electron-updater updates macOS from the zip;
  # the dmg is the first-install download. A dmg-only release can never
  # self-update, which is the one failure this whole plan exists to prevent.
  target:
    - target: dmg
      arch: [arm64]
    - target: zip
      arch: [arm64]
  category: public.app-category.developer-tools
  icon: src-tauri/icons/icon.icns
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  notarize: true
publish:
  # `channel` is deliberately absent. app-builder-lib fills it from the app
  # version's prerelease component when it is unset (PublishManager.js:416-429),
  # so version `X.Y.Z-electron.N` produces `electron-mac.yml` — the same name
  # GitHubProvider derives from the tag on the client side. Setting it here
  # would let the two drift apart on the next version bump.
  - provider: github
    owner: mxrsv
    repo: spacevibe-deck
```

- [x] **Step 3: Add the packaging script**

In `package.json`, beside the existing `electron:package` script:

```json
"electron:package:release": "node scripts/verify-electron-release-signing.mjs && npm run build && npm run electron:build && electron-builder --config electron-builder.release.yml --mac --arm64 --publish never",
```

`--publish never` is deliberate: the workflow publishes, a local run must not. The
continuation plan's Task 7 introduces the publishing invocation as a separate flag in CI.

- [x] **Step 4: Verify the config parses and resolves**

```bash
npx electron-builder --config electron-builder.release.yml --mac --dir --publish never 2>&1 | head -30
```

Expected: it starts packaging (a signing failure at this point is fine and expected if the
`.p12` is not in the default keychain). A YAML or schema error is not fine — fix it here.

- [x] **Step 5: Commit**

```bash
git commit -- build/entitlements.mac.plist electron-builder.release.yml package.json \
  -m "build(electron): add the signed, notarized macOS release config"
```

Note the `--` and the explicit paths: other sessions share this checkout and leave files
staged, and `git add .` sweeps them into the commit.

---

### Task 3: A test that the release config cannot silently lose its invariants — DONE 2026-08-18 (`6f9db5b`)

**Files:**

- Create: `scripts/electron-release-config.test.ts`
- Modify: `package.json` (scripts block)

**Interfaces:**

- Consumes: `electron-builder.release.yml` from Task 2.
- Produces: `npm run test:electron-release-config`, and a case in `npm test`.

Four of this config's lines are load-bearing in a way that fails **silently and late**:
drop `zip` and updates stop working after release; drop `hardenedRuntime` and notarization
rejects the upload; set `identity: null` (as the local config does, correctly) and the
build ships unsigned; point `entitlements` at a missing file and the hardened runtime
strips the JIT permission. None of these fail the build. A test is the only thing that
catches a copy-paste from `electron-builder.yml`.

- [x] **Step 1: Write the failing test**

```ts
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const config = parse(readFileSync("electron-builder.release.yml", "utf8"));

describe("the shipping Electron release config", () => {
  it("builds both a dmg and a zip, because electron-updater reads the zip", () => {
    const targets = config.mac.target.map(
      (entry: { target: string }) => entry.target,
    );
    expect(targets).toContain("zip");
    expect(targets).toContain("dmg");
  });

  it("enables the hardened runtime, which notarization requires", () => {
    expect(config.mac.hardenedRuntime).toBe(true);
  });

  it("never disables signing the way the local configs do", () => {
    expect(config.mac.identity).not.toBeNull();
    expect(config.mac.notarize).not.toBe(false);
  });

  it("points at an entitlements file that exists", () => {
    expect(existsSync(config.mac.entitlements)).toBe(true);
    expect(existsSync(config.mac.entitlementsInherit)).toBe(true);
  });

  it("publishes to the GitHub repository the updater feed names", () => {
    const [target] = config.publish;
    expect(target.provider).toBe("github");
    expect(target.owner).toBe("mxrsv");
    expect(target.repo).toBe("spacevibe-deck");
  });

  it("keeps the local configs unsigned so they cannot be mistaken for releases", () => {
    const local = parse(readFileSync("electron-builder.yml", "utf8"));
    expect(local.mac.identity).toBeNull();
  });
});
```

- [x] **Step 2: Run it and watch it fail for the right reason**

```bash
npx vitest run scripts/electron-release-config.test.ts
```

Expected before Task 2 lands: fails at the `readFileSync` — the config does not exist.
Expected after Task 2 lands: passes.

- [x] **Step 3: Confirm `yaml` is already a dependency**

```bash
node -e "require.resolve('yaml'); console.log('present')"
```

Expected: `present` (electron-builder depends on it transitively). If it resolves only
through a nested path, add `yaml` to `devDependencies` rather than reaching into
`node_modules/**/node_modules`.

- [x] **Step 4: Wire it into the suite**

```json
"test:electron-release-config": "vitest run scripts/electron-release-config.test.ts",
```

Confirm the file is picked up by the default suite:

```bash
npm test -- --reporter=basic 2>&1 | grep electron-release-config
```

Expected: the file appears in the run. If the Vitest config's `include` does not cover
`scripts/`, check how `scripts/electron-ipc-contract.test.ts` is included and match it.

- [x] **Step 5: Commit**

```bash
git commit -- scripts/electron-release-config.test.ts package.json \
  -m "test(electron): guard the release config's signing and updater invariants"
```

---

### Task 4: The preflight that refuses an unsignable build — DONE 2026-08-18 (`36fc86c`)

**Files:**

- Create: `scripts/verify-electron-release-signing.mjs`

**Interfaces:**

- Consumes: nothing from earlier tasks at runtime; mirrors
  `scripts/verify-macos-release-signing.mjs`.
- Produces: a non-zero exit before any build work when the environment is incomplete.

- [x] **Step 1: Write the script**

```js
/**
 * Refuse to start a signed release build that cannot finish.
 *
 * Modelled on `verify-macos-release-signing.mjs`, which does the same job for
 * the Tauri path. The names differ on purpose: app-builder-lib reads
 * APPLE_APP_SPECIFIC_PASSWORD where Tauri reads APPLE_PASSWORD
 * (MacTargetHelper.getNotarizeOptions), so a CI job that forgets the mapping
 * would build for ten minutes and then fail at the notarization step.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";

const required = ["APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
const missing = required.filter((name) => !process.env[name]?.trim());

const config = parse(readFileSync("electron-builder.release.yml", "utf8"));
const problems = [];

if (missing.length > 0) {
  problems.push(`missing ${missing.join(", ")}`);
}
if (config?.mac?.identity === null) {
  problems.push("electron-builder.release.yml selects ad-hoc signing");
}
if (!existsSync(config?.mac?.entitlements ?? "")) {
  problems.push(`entitlements file is missing: ${config?.mac?.entitlements}`);
}

let identities = "";
try {
  identities = execFileSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    {
      encoding: "utf8",
    },
  );
} catch (error) {
  problems.push(`could not read the keychain: ${error.message}`);
}
if (identities && !identities.includes("Developer ID Application")) {
  problems.push("no Developer ID Application identity is in the keychain");
}

if (problems.length > 0) {
  console.error(
    `Electron release signing is not configured: ${problems.join("; ")}`,
  );
  process.exit(1);
}
console.log("Electron release signing is configured.");
```

- [x] **Step 2: Prove it fails closed**

```bash
env -u APPLE_ID -u APPLE_APP_SPECIFIC_PASSWORD -u APPLE_TEAM_ID \
  node scripts/verify-electron-release-signing.mjs; echo "exit=$?"
```

Expected: the message names all three missing variables and `exit=1`.

- [x] **Step 3: Prove it passes when the environment is complete**

```bash
APPLE_ID=x APPLE_APP_SPECIFIC_PASSWORD=y APPLE_TEAM_ID=DJDD3T8LH7 \
  node scripts/verify-electron-release-signing.mjs; echo "exit=$?"
```

Expected after Task 1: `Electron release signing is configured.` and `exit=0`. If the
keychain check still fails here, Task 1 Step 3 did not actually succeed — fix that first
rather than weakening this script.

- [x] **Step 4: Commit**

```bash
git commit -- scripts/verify-electron-release-signing.mjs \
  -m "build(electron): fail a release build before it starts when signing is unconfigured"
```

---

### Task 5: The first locally signed and notarized build — DONE 2026-08-19 (Step 4 owed)

This is the task that actually closes Gate A's technical question. It runs on the owner's
Mac, not in CI, because a local failure is diagnosable and a CI failure at this stage is not.

**Files:** none — this task produces evidence, not code.

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces: a stapled `.app` and `.dmg` in `dist-electron-release/`, and the pasted output
  that every later claim rests on.

- [x] **Step 1: Build, sign and notarize**

```bash
export APPLE_ID='binh280912@gmail.com'
export APPLE_APP_SPECIFIC_PASSWORD='<the app-specific password>'
export APPLE_TEAM_ID='DJDD3T8LH7'
npm run electron:package:release
```

Expected: the log ends with `notarization successful` (app-builder-lib logs exactly that
string on success). Notarization typically takes 2–15 minutes; the build appears to hang
during it, which is normal.

- [x] **Step 2: Verify the signature, the assessment and the staple**

These are `release.yml`'s own verification commands, pointed at the Electron output.

```bash
APP="dist-electron-release/mac-arm64/SpaceVibe Deck.app"
codesign --verify --deep --strict --verbose=2 "$APP"
codesign --verify --verbose=2 "$APP/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper"
spctl --assess --type execute --verbose=2 "$APP"
xcrun stapler validate "$APP"
codesign --test-requirement="=notarized" --verify --verbose=2 "$APP"
```

Observed 2026-08-19 on `0.12.4-electron-preview.2` arm64:

```
app           valid on disk / satisfies its Designated Requirement
spawn-helper  valid on disk / satisfies its Designated Requirement
spctl         accepted, source=Notarized Developer ID
stapler       The validate action worked!
=notarized    explicit requirement satisfied
```

**The dmg is deliberately not asserted.** The written plan checked it and was wrong:
electron-builder staples the `.app` and then packs it into an UNSIGNED disk image
(`dmg.sign` defaults false — "signing is not required and will lead to unwanted errors in
combination with notarization requirements", macOptions.d.ts:293). Measured on this build,
the dmg reports `does not have a ticket stapled to it` and `rejected: no usable signature`,
while the app inside passes everything. Gatekeeper assesses the app at launch, not the
image, so this changes nothing for a user — but an assertion on it would have failed every
CI release after the draft was already published (fixed in `915ea65`).

`=notarized` is the one that matters most: it is satisfied by the stapled ticket alone,
with no call to Apple, which is the offline case a real user hits.

- [x] **Step 3: Verify node-pty's binaries are signed too**

Notarization rejects any unsigned Mach-O in the bundle, and `node-pty`'s helper lives
outside the asar. If Step 1 succeeded this is already proven, but name it explicitly
because it is the single most likely thing to break on a dependency bump:

```bash
codesign --verify --verbose=2 \
  "$APP/Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper"
```

Expected: `valid on disk` and `satisfies its Designated Requirement`.

- [ ] **Step 4: Install it and prove a pane spawns — OWED, owner-manual**

Mount the dmg, drag to `/Applications`, launch it from Finder (not from the terminal — a
terminal launch inherits a shell environment that a Finder launch does not).

Expected: the app opens with no Gatekeeper warning at all, and a new pane spawns an agent
CLI. A pane that fails to spawn here is an entitlements problem, not a signing one — check
`disable-library-validation` first.

- [x] **Step 5: Confirm the zip exists and carries the updater metadata**

```bash
ls dist-electron-release/*.zip dist-electron-release/*.yml
```

Expected: one `.zip` and one channel manifest. Under fork F4 the name is
`electron-mac.yml`, derived from the version's prerelease component — if it reads
`latest-mac.yml`, the version is not `X.Y.Z-electron.N` and the client will never find it.
**If there is no `.yml` at all, stop**: the release cannot self-update and the continuation
plan's Task 9 will fail. Its absence means `publish` is misconfigured.

---

## Continues in

Publishing, the CI workflow, the self-update proof and the freeze lift are
[2026-08-18-electron-release-pipeline.md](2026-08-18-electron-release-pipeline.md)
`building`, which starts at Task 6 and inherits this plan's constraints and forks. Do not
start it until Task 5's verification output exists.

## Self-Review

**Spec coverage.** This plan covers the migration spec's _signing_ half: an identity exists
(Task 1), the packaging config that uses it exists and is guarded (Tasks 2–4), and a real
build carries a valid signature, a notarization ticket and a working PTY (Task 5). The
publishing half is the continuation plan.

**Known gaps, stated rather than hidden.**

- **Windows (Gate C) is untouched.** No signed Windows path exists after this plan; the
  unsigned NSIS preview remains the only Windows artifact.
- **Universal binaries** are deferred by fork F2 — Intel Macs are not served by the
  Electron build until that follow-up lands.
- **Notarization credentials are an app-specific password** (fork F5), not a revocable App
  Store Connect API key. That swap is a hygiene follow-up, not a blocker.
- **Nothing here proves the app can update.** A signed build that never self-updates still
  fails this repo's core auto-update requirement; that proof is Task 9 in the continuation
  plan, and no claim about the cutover may be made before it.

**Type consistency.** `electron-builder.release.yml` has three consumers, each naming it
once: this plan's Task 3 test, this plan's Task 4 preflight, and the continuation plan's
Task 7 workflow.
`arm64` (fork F2) appears in the config, the npm script and the continuation plan's
workflow — all three must agree or the build produces an arch the publish step does not
upload. The channel name is
not substituted anywhere: fork F4 derives it from the version on both sides, so
`X.Y.Z-electron.N` is the only string that has to be right.
