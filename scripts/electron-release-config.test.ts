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
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RELEASE_CONFIG_PATH = new URL(
  "../electron-builder.release.yml",
  import.meta.url,
);
const LOCAL_CONFIG_PATH = new URL("../electron-builder.yml", import.meta.url);
const ENTITLEMENTS_PATH = new URL(
  "../build/entitlements.mac.plist",
  import.meta.url,
);
const PACKAGE_PATH = new URL("../package.json", import.meta.url);

const releaseConfig = readFileSync(RELEASE_CONFIG_PATH, "utf8");
const localConfig = readFileSync(LOCAL_CONFIG_PATH, "utf8");
const entitlements = readFileSync(ENTITLEMENTS_PATH, "utf8");
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));

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
    const archLines = releaseDirectives.filter(
      (line) => line.trim() === "- arm64",
    );
    expect(archLines).toHaveLength(2);
    expect(releaseDirectives.some((line) => line.includes("universal"))).toBe(
      false,
    );
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
    expect(
      declares(releaseConfig, "entitlements: build/entitlements.mac.plist"),
    ).toBe(true);
    expect(
      declares(
        releaseConfig,
        "entitlementsInherit: build/entitlements.mac.plist",
      ),
    ).toBe(true);
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
    expect(
      releaseDirectives.some((line) => line.trim().startsWith("channel:")),
    ).toBe(false);
  });

  it("unpacks node-pty, which cannot load from inside the asar", () => {
    expect(declares(releaseConfig, '- "**/node_modules/node-pty/**"')).toBe(
      true,
    );
  });

  it("keeps the local config unsigned so it cannot be mistaken for a release", () => {
    expect(declares(localConfig, "identity: null")).toBe(true);
    expect(
      directives(localConfig).some((line) => line.includes("publish")),
    ).toBe(false);
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
