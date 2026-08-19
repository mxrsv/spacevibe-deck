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
 * Plan: docs/plans/2026-08-18-gate-a-electron-signing.md (Task 3)
 */
import { spawnSync } from "node:child_process";
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

/**
 * Slices the workflow into its jobs.
 *
 * The four-job shape is the whole design: the source gate runs once in
 * `prepare`, the two builds are per-OS, and `promote` is downstream of both so
 * that a half-built release cannot be made public. A whole-file substring match
 * cannot tell "the Windows job publishes" apart from "some job publishes", and
 * every rule below belongs to exactly one job.
 */
function workflowJobs(): Map<string, string> {
  const normalized = workflow.replaceAll("\r\n", "\n");
  const body = normalized.slice(normalized.indexOf("\njobs:\n"));
  const headers = [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)];
  return new Map(
    headers.map((header, index) => [
      header[1],
      body.slice(header.index, index + 1 < headers.length ? headers[index + 1].index : body.length),
    ]),
  );
}

function workflowJob(name: string): string {
  const found = workflowJobs().get(name);
  if (found === undefined) {
    throw new Error(`The Electron release workflow has no job named ${name}`);
  }
  return found;
}

/**
 * The two version shapes `prepare` accepts, as the SHIPPED bash regexes.
 *
 * Extracted rather than restated: a copy in this file would keep passing after
 * the workflow's own pattern changed, and the version is the update channel —
 * getting it wrong orphans every installed build rather than failing a build.
 */
function versionPatterns(): string[] {
  const found = [...workflowJob("prepare").matchAll(/"\$version" =~ (\S+) \]\]/g)].map(
    (match) => match[1],
  );
  if (found.length !== 2) {
    throw new Error(`prepare declares ${found.length} version patterns, expected 2`);
  }
  return found;
}

/** Runs one shipped pattern through bash's own `=~`, not a JS approximation. */
function bashMatches(pattern: string, value: string): boolean {
  const result = spawnSync("bash", ["-c", '[[ "$1" =~ $PATTERN ]]', "bash", value], {
    env: { ...process.env, PATTERN: pattern },
  });
  // The Windows build job runs this suite too; a missing bash would otherwise
  // read as "every version is refused" and send the reader hunting in the regex.
  if (result.error) {
    throw new Error(`Could not run the version guard through bash: ${result.error}`);
  }
  return result.status === 0;
}

/** `stable`, `electron`, or null when `prepare` would refuse the version. */
function channelOf(version: string): "stable" | "electron" | null {
  const [stable, electron] = versionPatterns();
  if (bashMatches(stable, version)) {
    return "stable";
  }
  return bashMatches(electron, version) ? "electron" : null;
}

/** The asset patterns `promote` requires before it makes a release public. */
function promoteRequires(): string[] {
  return [...workflowJob("promote").matchAll(/^\s*require '([^']+)'/gm)].map((match) => match[1]);
}

/**
 * The macOS asset names the release path actually produced, read off
 * `v0.12.5-electron.2` on 2026-08-19 — not names derived from the config.
 *
 * The dot in the blockmap is real and is the reason the Windows installer is
 * given an explicit space-free `artifactName`: app-builder-lib hyphenates the
 * primary artifacts on the way up, GitHub rewrites spaces to dots on anything
 * that does not go through that path, and electron-updater asks for the name
 * written in the manifest.
 */
const PUBLISHED_MACOS_ASSETS = [
  "latest-mac.yml",
  "SpaceVibe-Deck-0.12.5-electron.2-arm64-mac.zip",
  "SpaceVibe-Deck-0.12.5-electron.2-arm64.dmg",
  "SpaceVibe-Deck-0.12.5-electron.2-arm64.dmg.blockmap",
  "SpaceVibe.Deck-0.12.5-electron.2-arm64-mac.zip.blockmap",
];

/** The Windows half, named by the config's own `artifactName` template. */
function windowsAssetsFromConfig(version: string): string[] {
  const template = releaseDirectives
    .map((line) => /^\s*artifactName:\s*(\S+)\s*$/.exec(line)?.[1])
    .find(Boolean);
  if (template === undefined) {
    throw new Error("The release config declares no nsis artifactName");
  }
  const installer = template.replace("${version}", version).replace("${ext}", "exe");
  return [installer, `${installer}.blockmap`, "latest.yml"];
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

  it("declares a Windows nsis x64 target beside the macOS ones", () => {
    // One tag ships both platforms (2026-08-20). Without this block the run's
    // Windows job builds nothing, `promote` refuses the asset set, and the
    // release stays a draft — a loud failure, but the point is that the config
    // and the workflow have to agree about which platforms exist.
    expect(declares(releaseConfig, "- target: nsis")).toBe(true);
    expect(declares(releaseConfig, "- x64")).toBe(true);
  });

  it("serves arm64 on macOS and x64 on Windows, and neither the other way", () => {
    // Intel Mac and Windows ARM are out of scope by decision. An arch added
    // here builds and publishes silently; it is the asset SET that gets audited
    // downstream, never the arch list.
    const archLines = releaseDirectives
      .map((line) => line.trim())
      .filter(
        (line) => line.startsWith("- ") && /^- (arm64|x64|universal|ia32|armv7l)$/.test(line),
      );
    expect(archLines).toEqual(["- arm64", "- arm64", "- x64"]);
  });

  it("keeps the Windows install per-user, with the directory chooser it warns about", () => {
    // `perMachine: false` is what lets the updater replace the install without
    // an elevation prompt every time. The chooser stays deliberately: the one
    // Windows report on record is an NSIS extract failure on a secondary drive
    // and this is how a user reaches that state, but removing it hides the bug
    // rather than fixing it and strands a user whose system drive is full.
    expect(declares(releaseConfig, "perMachine: false")).toBe(true);
    expect(declares(releaseConfig, "allowToChangeInstallationDirectory: true")).toBe(true);
    // One-click would install without asking and without a directory at all.
    expect(declares(releaseConfig, "oneClick: false")).toBe(true);
  });

  it("names the Windows installer with no space either side can rewrite", () => {
    const [installer] = windowsAssetsFromConfig("0.13.0");
    // `productName` is "SpaceVibe Deck", and the default nsis artifactName
    // carries it verbatim. GitHub rewrites spaces on upload — the real mac zip
    // blockmap on v0.12.5-electron.2 is proof — while electron-updater asks
    // for the name written in `latest.yml`, so a rewritten name is a 404 on
    // the update, not on the build.
    expect(installer).not.toContain(" ");
    expect(installer).toBe("SpaceVibe-Deck-0.13.0-win-x64-setup.exe");
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
  it("runs four jobs: one gate, two builds, one promotion", () => {
    // Two workflow files triggered by the same tag would race to create the
    // release and neither would have a point at which the full artifact set is
    // known to be complete. The verification that keeps a half-built release
    // invisible has to live DOWNSTREAM of both builds, which is only possible
    // inside one workflow.
    expect([...workflowJobs().keys()]).toEqual(["prepare", "mac", "windows", "promote"]);
    expect(workflowJob("mac")).toContain("runs-on: macos-latest");
    expect(workflowJob("windows")).toContain("runs-on: windows-latest");
    expect(workflowJob("promote")).toContain("needs: [prepare, mac, windows]");
  });

  it("builds from a tag no running app can see, in both shapes", () => {
    // GitHub publishes a pushed tag to `releases.atom` immediately, while this
    // run takes ten minutes. A pushed RELEASE tag therefore advertised a
    // version whose manifest did not exist yet, and every running app that
    // checked in that window showed "Couldn't check for updates".
    // `build/v…` fails `semver.valid`, so GitHubProvider skips it entirely.
    expect(workflow).toContain('- "build/v[0-9]+.[0-9]+.[0-9]+"');
    expect(workflow).toContain('- "build/v[0-9]+.[0-9]+.[0-9]+-electron.[0-9]+"');
    // Neither shape may lose the prefix. A bare `v…` pattern is exactly the
    // tag an installed app CAN see.
    expect(workflow).not.toMatch(/^\s+- "v\[0-9]/m);
    expect(workflow).not.toContain('- "electron-v');
  });

  it("accepts a stable version and an -electron.N one, and nothing else", () => {
    // The version IS the update channel: app-builder-lib derives the manifest
    // name from its prerelease component and electron-updater derives the
    // channel it asks for from the tag's. A version naming any other word
    // publishes onto a channel no installed build ever requests, and nothing
    // in the run fails.
    expect(channelOf("0.13.0")).toBe("stable");
    expect(channelOf("0.12.5-electron.2")).toBe("electron");
    for (const version of [
      // The value this repo actually carried before the first release — it
      // would have shipped an `electron-preview` channel.
      "0.12.4-electron-preview.2",
      "1.0.0-rc.1",
      "0.13.0-electron",
      "0.13",
      "v0.13.0",
    ]) {
      expect({ version, channel: channelOf(version) }).toEqual({ version, channel: null });
    }
  });

  it("creates the release tag only at promotion, never before", () => {
    // A draft release holds a `tag_name` without creating the git ref, so the
    // version stays invisible until the artifacts are verified. `--target` is
    // what makes that possible: the tag does not exist to create it from.
    expect(workflowJob("prepare")).toContain("--draft --target");
    // The steps that name the release must read the STRIPPED tag, not the
    // pushed ref — the pushed ref still carries `build/`. Anchored to the line,
    // because `BUILD_TAG: ${{ github.ref_name }}` is correct and contains the
    // same substring.
    expect(workflow).not.toMatch(/^\s+TAG: \$\{\{ github\.ref_name \}\}/m);
    expect(workflowJob("prepare")).toContain("BUILD_TAG: ${{ github.ref_name }}");
    expect(workflowJob("prepare")).toContain("TAG: ${{ steps.target.outputs.tag }}");
    // Downstream jobs cannot reach `steps.target`; they read the job output.
    expect(workflowJob("promote")).toContain("TAG: ${{ needs.prepare.outputs.tag }}");
  });

  it("runs the source gate once, before either platform builds", () => {
    // The build jobs are per-OS and cost tens of minutes each. A source failure
    // has to stop the run before either starts, and running the suite twice
    // proves nothing twice.
    const prepare = workflowJob("prepare");
    expect(prepare).toContain("npm run generate:menu:check");
    expect(prepare).toContain("npm test");
    expect(prepare).toContain("npm run build");
    for (const name of ["mac", "windows"]) {
      expect({ job: name, repeatsTheSuite: workflowJob(name).includes("npm test") }).toEqual({
        job: name,
        repeatsTheSuite: false,
      });
    }
  });

  it("maps the one notarization secret onto the name app-builder-lib reads", () => {
    // `release.yml` stores it as APPLE_PASSWORD; app-builder-lib reads
    // APPLE_APP_SPECIFIC_PASSWORD. Dropping the mapping fails the run at
    // notarization, minutes after the build started.
    expect(workflowJob("mac")).toContain(
      "APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_PASSWORD }}",
    );
  });

  it("unlocks the imported key for codesign on a headless runner", () => {
    // Without `set-key-partition-list`, `codesign` blocks on a GUI prompt that
    // a runner can never answer, and the job hangs until it times out.
    expect(workflowJob("mac")).toContain("security set-key-partition-list");
  });

  it("runs the signing preflight before it builds anything", () => {
    const mac = workflowJob("mac");
    expect(mac.indexOf("verify-electron-release-signing.mjs")).toBeLessThan(
      mac.indexOf("npx electron-builder"),
    );
  });

  it("publishes from both build jobs, unlike the local packaging script", () => {
    expect(workflowJob("mac")).toContain("--mac --arm64 --publish always");
    expect(workflowJob("windows")).toContain("--win --x64 --publish always");
  });

  it("ships Windows unsigned, with nothing pretending otherwise", () => {
    // Unsigned by decision (2026-08-19). electron-builder WARNS and continues
    // without a certificate, so a signing step that silently did nothing would
    // be indistinguishable from one that worked. There is no such step, and
    // the preflight cannot run here anyway — it reads the macOS keychain.
    const windows = workflowJob("windows");
    expect(windows).not.toContain("verify-electron-release-signing.mjs");
    expect(windows).not.toContain("CSC_LINK");
    expect(windows).not.toContain("signtool");
    expect(windows).not.toContain("WINDOWS_CERTIFICATE");
  });

  it("claims nothing about Windows that a runner could not observe", () => {
    // A runner cannot run an interactive install and cannot exercise an update
    // cycle. The Windows job proves the installer and its manifest were
    // PRODUCED; Gate C stays open, and the release notes say so.
    const windows = workflowJob("windows");
    expect(windows).toContain("dist-electron-release/*-setup.exe");
    expect(windows).toContain("dist-electron-release/latest.yml");
  });

  it("proves the artifacts are notarized, not merely signed", () => {
    // A signed but un-notarized app installs with a Gatekeeper warning and
    // Squirrel.Mac refuses to update into it.
    const mac = workflowJob("mac");
    expect(mac).toContain("spctl --assess --type execute");
    expect(mac).toContain("xcrun stapler validate");
    // The offline proof: the stapled ticket satisfies `=notarized` with no
    // call to Apple, which is what a user without a network gets.
    expect(mac).toContain('--test-requirement="=notarized"');
    // node-pty's helper is outside the asar and is the first thing a
    // dependency bump leaves unsigned.
    expect(mac).toContain("node-pty/build/Release/spawn-helper");
  });

  it("does not assert a stapled ticket on the dmg, which never has one", () => {
    // electron-builder staples the .app and then packs it into an UNSIGNED
    // disk image (`dmg.sign` defaults false, macOptions.d.ts:293). Measured
    // 2026-08-19 on a real notarized build: the app passes every check and the
    // dmg reports "no usable signature". An assertion here fails by design,
    // after the draft has already been published.
    const mac = workflowJob("mac");
    expect(mac).toContain('xcrun stapler validate "${apps[0]}"');
    expect(mac).not.toContain('xcrun stapler validate "${images[0]}"');
  });

  it("requires every asset both platforms need before anything is public", () => {
    // A missing asset leaves the release a DRAFT. That is the only mechanism
    // that stops a half-built release from reaching an installed app, so the
    // set is asserted exactly: a dropped line here is a silent hole.
    expect(promoteRequires()).toEqual([
      "\\.dmg$",
      "-mac\\.zip$",
      "^latest-mac\\.yml$",
      "-setup\\.exe$",
      "^latest\\.yml$",
      "\\.blockmap$",
    ]);
  });

  it("matches the names the two builds actually publish", () => {
    // Patterns and artifacts are written in different files by different
    // tools. These are the real macOS names off `v0.12.5-electron.2` and the
    // Windows names the config's own template produces.
    const published = [...PUBLISHED_MACOS_ASSETS, ...windowsAssetsFromConfig("0.12.5-electron.2")];
    for (const pattern of promoteRequires()) {
      expect({
        pattern,
        matched: published.some((name) => new RegExp(pattern).test(name)),
      }).toEqual({ pattern, matched: true });
    }
  });

  it("refuses the macOS-only set the previous pipeline produced", () => {
    // `v0.12.5-electron.2` is a complete, working macOS release. Under the
    // two-platform gate it is now an incomplete one, and must stay a draft —
    // this is the case that would otherwise ship "Windows support" as a
    // release page with no installer on it.
    const unmatched = promoteRequires().filter(
      (pattern) => !PUBLISHED_MACOS_ASSETS.some((name) => new RegExp(pattern).test(name)),
    );
    expect(unmatched).toEqual(["-setup\\.exe$", "^latest\\.yml$"]);
  });

  it("replaces the placeholder notes before the release is visible", () => {
    // The draft is created with "Build in progress." — the body every shipped
    // Electron release has carried so far. The real notes state three things a
    // user cannot discover from the app.
    expect(workflowJob("prepare")).toContain('--notes "Build in progress."');
    const promote = workflowJob("promote");
    expect(promote).toContain("--notes-file release-notes.md");
    expect(promote).toContain("not code-signed");
    expect(promote).toContain("SmartScreen");
    expect(promote).toContain("not runtime-verified");
    expect(promote).toContain("Intel Macs are not served");
    // Notes first, then the promotion: the other order publishes the
    // placeholder for as long as the two API calls are apart.
    expect(promote.indexOf("--notes-file")).toBeLessThan(promote.indexOf("--draft=false"));
  });

  it("promotes a stable tag to latest and an -electron.N tag to a pre-release", () => {
    // `releases/latest` served the Tauri release until the cutover; the stable
    // Electron release is what replaces it. A prerelease must NOT take it —
    // that is how an `-electron.N` build would become the download every new
    // user gets.
    const promote = workflowJob("promote");
    expect(promote).toContain("--draft=false --prerelease=true");
    expect(promote).toContain("--draft=false --prerelease=false --latest=true");
    expect(promote).not.toContain("--prerelease=true --latest");
  });

  it("leaves the Tauri release path reachable only by hand", () => {
    // This workflow exists so that shipping Electron does not require touching
    // `release.yml`. Its tag trigger is gone (2026-08-20) — a `vX.Y.Z` push
    // would otherwise ship Tauri alongside the Electron release built from the
    // same commit: two releases, two update feeds, one version. The freeze job
    // stays as the second lock, and states the rule where a reader of the jobs
    // list meets it.
    const trigger = tauriWorkflow.slice(
      tauriWorkflow.indexOf("\non:\n"),
      tauriWorkflow.indexOf("\npermissions:"),
    );
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toContain("push:");
    expect(trigger).not.toContain("tags:");
    expect(tauriWorkflow).toContain("release-freeze:");
    expect(tauriWorkflow).toContain("Refuse to ship from a tag push");
  });
});
