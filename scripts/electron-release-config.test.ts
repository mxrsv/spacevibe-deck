/**
 * Locks the invariants of the shipping Electron packaging config.
 *
 * Four lines in `electron-builder.release.yml` are load-bearing in a way that
 * fails SILENTLY and LATE:
 *
 *  - drop the `zip` target and the release builds, publishes and installs
 *    perfectly, then can never self-update — electron-updater reads the zip on
 *    macOS, never the dmg;
 *  - drop `hardenedRuntime` and notarization rejects the upload, minutes into
 *    a release run;
 *  - set `identity: null` — which the two LOCAL configs do, correctly — and the
 *    build ships unsigned with only a warning in the log;
 *  - point `entitlements` at a missing file and the hardened runtime strips
 *    JIT, so every pane dies at runtime in a build that verified clean.
 *
 * None of these fail the build. The realistic way each one arrives is a
 * copy-paste from `electron-builder.yml`, so the local config is asserted here
 * too: it must STAY unsigned, or the distinction this file guards is gone.
 *
 * The config is matched as text rather than parsed. `yaml` is not a declared
 * dependency of this repo — it only exists under `node_modules` as a
 * transitive of electron-builder — and adding one is a Forks decision in
 * AGENTS.md. `scripts/release-workflow.test.ts` locks `release.yml` the same
 * way, so this follows the pattern already in the tree.
 *
 * The package these lines produce is described in docs/operations/release.md.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RELEASE_CONFIG_PATH = new URL("../electron-builder.release.yml", import.meta.url);
const LOCAL_CONFIG_PATH = new URL("../electron-builder.yml", import.meta.url);
const ENTITLEMENTS_PATH = new URL("../build/entitlements.mac.plist", import.meta.url);
const PACKAGE_PATH = new URL("../package.json", import.meta.url);
const WORKFLOW_PATH = new URL("../.github/workflows/electron-release.yml", import.meta.url);
const TAURI_WORKFLOW_PATH = new URL("../.github/workflows/release.yml", import.meta.url);

const releaseConfig = readFileSync(RELEASE_CONFIG_PATH, "utf8");
const localConfig = readFileSync(LOCAL_CONFIG_PATH, "utf8");
const entitlements = readFileSync(ENTITLEMENTS_PATH, "utf8");
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
const workflow = readFileSync(WORKFLOW_PATH, "utf8");
const tauriWorkflow = readFileSync(TAURI_WORKFLOW_PATH, "utf8");

/**
 * The config's own lines, with comments and blanks removed.
 *
 * Every rule below explains itself in a comment that names the very key it
 * guards, so a substring search over the raw file would match the prose that
 * says a key must NOT be there and pass a config that has it.
 */
function directives(source: string): string[] {
  return source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
}

const releaseDirectives = directives(releaseConfig);

/** True when any non-comment line is exactly this, at any indentation. */
function declares(source: string, directive: string): boolean {
  return directives(source).some((line) => line.trim() === directive);
}

describe("the shipping Electron release config", () => {
  it("builds both a dmg and a zip, because electron-updater reads the zip", () => {
    // A dmg-only release is installable and permanently un-updatable, which is
    // the one outcome this repo's core auto-update requirement forbids.
    expect(declares(releaseConfig, "- target: dmg")).toBe(true);
    expect(declares(releaseConfig, "- target: zip")).toBe(true);
  });

  it("ships the arch the packaging script builds", () => {
    // Fork F2 is arm64. If the config and the npm script disagree, the build
    // produces one arch and the publish step uploads another.
    const archLines = releaseDirectives.filter((line) => line.trim() === "- arm64");
    expect(archLines).toHaveLength(2);
    expect(releaseDirectives.some((line) => line.includes("universal"))).toBe(false);
  });

  it("enables the hardened runtime, which notarization requires", () => {
    expect(declares(releaseConfig, "hardenedRuntime: true")).toBe(true);
  });

  it("never disables signing or notarization the way the local configs do", () => {
    expect(declares(releaseConfig, "identity: null")).toBe(false);
    expect(declares(releaseConfig, "notarize: false")).toBe(false);
    expect(declares(releaseConfig, "notarize: true")).toBe(true);
  });

  it("points at an entitlements file that exists, for the app and its helpers", () => {
    expect(declares(releaseConfig, "entitlements: build/entitlements.mac.plist")).toBe(true);
    expect(declares(releaseConfig, "entitlementsInherit: build/entitlements.mac.plist")).toBe(true);
    // readFileSync at module scope already proves the file is there; this
    // states the dependency so a rename of the plist fails HERE, naming the
    // reason, rather than as an unexplained ENOENT.
    expect(entitlements).toContain("<plist");
  });

  it("keeps the entitlements a hardened Electron terminal actually needs", () => {
    // Each of these buys back something the hardened runtime removes; see the
    // plist's own header for what breaks without it.
    for (const key of [
      "com.apple.security.cs.allow-jit",
      "com.apple.security.cs.allow-unsigned-executable-memory",
      "com.apple.security.cs.disable-library-validation",
      "com.apple.security.cs.allow-dyld-environment-variables",
    ]) {
      expect(entitlements).toContain(`<key>${key}</key>`);
    }
    // Sandboxing and a PTY that spawns arbitrary agent CLIs are mutually
    // exclusive. This is also why Deck cannot ship through the Mac App Store.
    expect(entitlements).not.toContain("com.apple.security.app-sandbox");
  });

  it("declares the Windows nsis x64 target the stable release ships", () => {
    // One tag carries both platforms. Dropping this block quietly produces a
    // macOS-only release whose promote job then blocks on the missing
    // installer — better to fail here, naming the reason.
    expect(declares(releaseConfig, "- target: nsis")).toBe(true);
    expect(declares(releaseConfig, "- x64")).toBe(true);
  });

  it("keeps the Windows install per-user and names its artifact without spaces", () => {
    // `perMachine: false` is the no-elevation decision carried from the
    // preview; the explicit artifactName is what the promote job's
    // `*-setup.exe` assertion holds onto — the default starts with
    // `productName`, whose space normalizes unpredictably as an asset name.
    expect(declares(releaseConfig, "perMachine: false")).toBe(true);
    expect(
      declares(releaseConfig, "artifactName: SpaceVibe-Deck-${version}-win-x64-setup.${ext}"),
    ).toBe(true);
    // Kept deliberately (spec §Configuration): the chooser is the trigger of
    // the one real Windows bug report on record, and removing it is the
    // mitigation this release chose NOT to take. If this line changes, the
    // spec's record of the trade changes with it.
    expect(declares(releaseConfig, "allowToChangeInstallationDirectory: true")).toBe(true);
  });

  it("publishes to the GitHub repository the updater feed names", () => {
    expect(declares(releaseConfig, "- provider: github")).toBe(true);
    expect(declares(releaseConfig, "owner: mxrsv")).toBe(true);
    expect(declares(releaseConfig, "repo: spacevibe-deck")).toBe(true);
  });

  it("leaves the channel to the version, so both sides derive the same name", () => {
    // app-builder-lib fills `publish.channel` from the app version's prerelease
    // component when it is unset, and GitHubProvider derives the client-side
    // channel from the tag's. Naming it here lets the two drift apart on the
    // next version bump and orphans every installed build.
    expect(releaseDirectives.some((line) => line.trim().startsWith("channel:"))).toBe(false);
  });

  it("unpacks node-pty, which cannot load from inside the asar", () => {
    expect(declares(releaseConfig, '- "**/node_modules/node-pty/**"')).toBe(true);
  });

  it("keeps the local config unsigned so it cannot be mistaken for a release", () => {
    expect(declares(localConfig, "identity: null")).toBe(true);
    expect(directives(localConfig).some((line) => line.includes("publish"))).toBe(false);
  });
});

describe("the release packaging script", () => {
  const script: string = packageJson.scripts["electron:package:release"];

  it("exists and runs the release config", () => {
    expect(script).toBeDefined();
    expect(script).toContain("--config electron-builder.release.yml");
  });

  it("runs the signing preflight before doing any build work", () => {
    // The preflight costs seconds; discovering the same gap after notarization
    // has already been attempted costs the whole run.
    expect(script.indexOf("verify-electron-release-signing.mjs")).toBeLessThan(
      script.indexOf("electron-builder"),
    );
  });

  it("never publishes from a local run", () => {
    // Publishing is the release workflow's job. A local `--publish always`
    // would upload an unreviewed build to the real feed.
    expect(script).toContain("--publish never");
    expect(script).not.toContain("--publish always");
  });

  it("builds the arch the config declares", () => {
    expect(script).toContain("--arm64");
  });
});

describe("the Electron release workflow", () => {
  it("builds from a tag no running app can see, stable and prerelease alike", () => {
    // GitHub publishes a pushed tag to `releases.atom` immediately, while this
    // workflow takes ten minutes. A pushed RELEASE tag therefore advertised a
    // version whose manifest did not exist yet, and every running app that
    // checked in that window showed "Couldn't check for updates".
    // `build/v…` fails `semver.valid`, so GitHubProvider skips it entirely.
    // Both shapes wear the prefix: a bare `v…` pattern on either one would
    // reintroduce the advertised-but-absent window for that channel.
    expect(workflow).toContain('- "build/v[0-9]+.[0-9]+.[0-9]+"');
    expect(workflow).toContain('- "build/v[0-9]+.[0-9]+.[0-9]+-electron.[0-9]+"');
    expect(workflow).not.toContain('- "v[0-9]+.[0-9]+.[0-9]+');
    expect(workflow).not.toContain('- "electron-v');
  });

  it("builds Windows on a windows runner and publishes into the same draft", () => {
    // Two workflow files triggered by the same tag would race to create the
    // release (run 32232669706, one platform apart instead of one target
    // apart); the second platform therefore lives in THIS file, downstream of
    // the one `prepare` job that created the draft.
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("--win --x64 --publish always");
  });

  it("creates the release tag only at promotion, never before", () => {
    // A draft release holds a `tag_name` without creating the git ref, so the
    // version stays invisible until the artifacts are verified. `--target` is
    // what makes that possible: the tag does not exist to create it from.
    expect(workflow).toContain("--draft --target");
    // The steps that name the release must read the STRIPPED tag, not the
    // pushed ref — the pushed ref still carries `build/`. Anchored to the line,
    // because `BUILD_TAG: ${{ github.ref_name }}` is correct and contains the
    // same substring.
    expect(workflow).not.toMatch(/^\s+TAG: \$\{\{ github\.ref_name \}\}/m);
    expect(workflow).toContain("BUILD_TAG: ${{ github.ref_name }}");
    expect(workflow).toContain("TAG: ${{ steps.target.outputs.tag }}");
  });

  it("maps the one notarization secret onto the name app-builder-lib reads", () => {
    // `release.yml` stores it as APPLE_PASSWORD; app-builder-lib reads
    // APPLE_APP_SPECIFIC_PASSWORD. Dropping the mapping fails the run at
    // notarization, minutes after the build started.
    expect(workflow).toContain("APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_PASSWORD }}");
  });

  it("unlocks the imported key for codesign on a headless runner", () => {
    // Without `set-key-partition-list`, `codesign` blocks on a GUI prompt that
    // a runner can never answer, and the job hangs until it times out.
    expect(workflow).toContain("security set-key-partition-list");
  });

  it("runs the signing preflight before it builds anything", () => {
    expect(workflow.indexOf("verify-electron-release-signing.mjs")).toBeLessThan(
      workflow.indexOf("npx electron-builder"),
    );
  });

  it("publishes, unlike the local packaging script", () => {
    expect(workflow).toContain("--publish always");
  });

  it("proves the artifacts are notarized, not merely signed", () => {
    // A signed but un-notarized app installs with a Gatekeeper warning and
    // Squirrel.Mac refuses to update into it.
    expect(workflow).toContain("spctl --assess --type execute");
    expect(workflow).toContain("xcrun stapler validate");
    // The offline proof: the stapled ticket satisfies `=notarized` with no
    // call to Apple, which is what a user without a network gets.
    expect(workflow).toContain('--test-requirement="=notarized"');
    // node-pty's helper is outside the asar and is the first thing a
    // dependency bump leaves unsigned.
    expect(workflow).toContain("node-pty/build/Release/spawn-helper");
  });

  it("does not assert a stapled ticket on the dmg, which never has one", () => {
    // electron-builder staples the .app and then packs it into an UNSIGNED
    // disk image (`dmg.sign` defaults false, macOptions.d.ts:293). Measured
    // 2026-08-19 on a real notarized build: the app passes every check and the
    // dmg reports "no usable signature". An assertion here fails by design,
    // after the draft has already been published.
    const verifyStep = workflow.slice(
      workflow.indexOf("Verify the artifacts are signed"),
      workflow.indexOf("Confirm the draft carries"),
    );
    expect(verifyStep).toContain('xcrun stapler validate "${apps[0]}"');
    expect(verifyStep).not.toContain('xcrun stapler validate "${images[0]}"');
  });

  it("hands prepare's outputs to promote by naming it a direct need", () => {
    // `needs.<job>.outputs` resolves only for DIRECTLY listed jobs. With
    // `[mac, windows]` alone, TAG/CHANNEL arrived empty and `gh release view`
    // quietly audited the LATEST release instead of the draft (run
    // 32382369994). The empty-output guard is the runtime half of this test.
    expect(workflow).toContain("needs: [prepare, mac, windows]");
    expect(workflow).toContain("prepare's outputs did not arrive");
  });

  it("requires the full two-platform asset set before promoting anything", () => {
    // The promote job reads what the release actually SERVES, and a missing
    // asset leaves it a draft — the only mechanism that stops a half-built
    // release from reaching an installed app. Six assets, both platforms.
    expect(workflow).toContain("electron-mac.yml");
    expect(workflow).toContain("grep -q '\\.dmg$' published.txt");
    expect(workflow).toContain("grep -q -- '-mac\\.zip$' published.txt");
    expect(workflow).toContain("grep -qx 'latest-mac.yml' published.txt");
    expect(workflow).toContain("grep -q -- '-setup\\.exe$' published.txt");
    expect(workflow).toContain("grep -qx 'latest.yml' published.txt");
    expect(workflow).toContain("grep -q '\\.blockmap$' published.txt");
  });

  it("refuses a tag whose commit is not on main", () => {
    // A green check on some other branch must not authorize publication
    // (workflow design, Release contract). The check needs history, so the
    // prepare checkout must not be shallow.
    expect(workflow).toContain("git merge-base --is-ancestor HEAD origin/main");
    expect(workflow).toContain("fetch-depth: 0");
  });

  it("publishes reviewed CHANGELOG notes for a stable tag, never a commit dump", () => {
    // The workflow design supersedes the generated commit list for public
    // stable releases: the notes are the release PR's reviewed `## <version>`
    // section, read from the TAGGED commit, and a stable tag without its
    // section stays a draft. The generated list remains only for the
    // `-electron.N` migration channel.
    expect(workflow).toContain("CHANGELOG.md > section.md");
    expect(workflow).toContain("the release stays a draft");
    expect(workflow).toContain("releases/generate-notes");
    // A stable release is an announcement: it wears the product name, not the
    // bare tag.
    expect(workflow).toContain('--title "SpaceVibe Deck $VERSION"');
  });

  it("writes a run summary naming source, channel and assets", () => {
    expect(workflow).toContain('>> "$GITHUB_STEP_SUMMARY"');
  });

  it("promotes a stable tag to latest and an electron tag to a pre-release", () => {
    // A stable release becoming `latest` is the cutover: `releases/latest`
    // stops serving Tauri. An `-electron.N` tag stays a pre-release that only
    // the `electron` channel walks.
    expect(workflow).toContain('gh release edit "$TAG" --draft=false --latest');
    expect(workflow).toContain('gh release edit "$TAG" --draft=false --prerelease');
  });

  it("keeps Tauri off every automatic trigger", () => {
    // `release.yml` stays for manual hotfixes but must never ship from a tag
    // push again — tags ship Electron now. The freeze job remains as
    // defense-in-depth should a push trigger ever be reintroduced.
    const trigger = tauriWorkflow.slice(
      tauriWorkflow.indexOf("\non:"),
      tauriWorkflow.indexOf("permissions:"),
    );
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toContain("push:");
    expect(trigger).not.toContain("tags:");
    expect(tauriWorkflow).toContain("release-freeze:");
    expect(tauriWorkflow).toContain("Refuse to ship from a tag push");
  });
});
