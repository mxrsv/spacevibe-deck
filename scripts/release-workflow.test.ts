/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const macosConfig = readFileSync(
  new URL("../src-tauri/tauri.macos.conf.json", import.meta.url),
  "utf8",
);
const windowsConfig = readFileSync(
  new URL("../src-tauri/tauri.windows.conf.json", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

const MACOS_RC_CHANNEL = "macos-rc-channel";
const WINDOWS_RC_CHANNEL = "windows-rc-channel";
const WINDOWS_PRODUCTION_CHANNEL = "windows-preview-channel";
const IS_RELEASE_CANDIDATE = "needs.resolve-target.outputs.rc == 'true'";

/**
 * Slices the workflow into its jobs. The routing rules this file locks live in
 * `if:`/`needs:` expressions, and a whole-file substring match cannot tell a
 * guard on the RC promotion apart from one on the production promotion.
 */
function jobs(source = workflow): Map<string, string> {
  const normalized = source.replaceAll("\r\n", "\n");
  const body = normalized.slice(normalized.indexOf("\njobs:\n"));
  const headers = [...body.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)];
  return new Map(
    headers.map((header, index) => [
      header[1],
      body.slice(header.index, index + 1 < headers.length ? headers[index + 1].index : body.length),
    ]),
  );
}

function job(name: string, source = workflow): string {
  const found = jobs(source).get(name);
  if (found === undefined) {
    throw new Error(`Workflow has no job named ${name}`);
  }
  return found;
}

/** Slices one job into its steps, so a guard can be read against its own step. */
function steps(name: string): string[] {
  const definition = job(name);
  const headers = [...definition.matchAll(/^ {6}- name: /gm)];
  return headers.map((header, index) =>
    definition.slice(
      header.index,
      index + 1 < headers.length ? headers[index + 1].index : definition.length,
    ),
  );
}

/** Runs the tag guard the workflow actually ships, not a copy of it. */
function acceptsTag(tag: string): boolean {
  const pattern = workflow.match(/SOURCE_TAG='([^']+)'/)?.[1];
  if (pattern === undefined) {
    throw new Error("resolve-target does not define a SOURCE_TAG pattern");
  }
  const result = spawnSync("bash", ["-c", '[[ "$1" =~ $SOURCE_TAG ]]', "bash", tag], {
    env: { ...process.env, SOURCE_TAG: pattern },
  });
  // The Windows build job runs this suite too; a missing bash would otherwise
  // read as "every tag is refused" and send the reader hunting in the regex.
  if (result.error) {
    throw new Error(`Could not run the tag guard through bash: ${result.error}`);
  }
  return result.status === 0;
}

describe("release tag resolution", () => {
  it("parses workflow jobs after a Windows CRLF checkout", () => {
    const windowsWorkflow = workflow.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");

    expect(job("build-macos-stable-draft", windowsWorkflow)).toContain("releaseDraft: true");
  });

  it("accepts exact stable and release-candidate source tags", () => {
    for (const tag of ["v0.11.0", "v0.11.0-rc.1", "v1.0.0-rc.12"]) {
      expect(acceptsTag(tag), tag).toBe(true);
    }
  });

  it("refuses derived preview, channel and malformed tags", () => {
    // The workflow creates `-windows-preview` tags and channel releases itself.
    // Accepting them here would let a release start another release.
    for (const tag of [
      "v0.11.0-windows-preview",
      "v0.11.0-rc.1-windows-preview",
      WINDOWS_PRODUCTION_CHANNEL,
      WINDOWS_RC_CHANNEL,
      MACOS_RC_CHANNEL,
      "v0.11.0-rc.0",
      "v0.11.0-beta.1",
      "0.11.0",
      "latest",
    ]) {
      expect(acceptsTag(tag), tag).toBe(false);
    }
  });

  it("never triggers on a tag push — tags ship Electron now", () => {
    // Reduced to `workflow_dispatch` on 2026-08-20 (Electron stable release
    // spec): a pushed tag ships the Electron host via electron-release.yml,
    // and nothing may build Tauri automatically. The manual path stays for
    // hotfixes.
    const trigger = workflow.slice(workflow.indexOf("\non:"), workflow.indexOf("permissions:"));

    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toContain("push:");
    expect(trigger).not.toContain("tags:");
  });

  it("builds every job from the resolved tag and commit", () => {
    // On a manual retry GITHUB_REF_NAME is a branch and GITHUB_SHA is its head,
    // so either one silently validates or stamps the wrong source.
    expect(workflow).not.toContain("GITHUB_REF_NAME");
    expect(workflow).not.toContain("GITHUB_SHA");
  });
});

describe("release channel isolation", () => {
  it("keeps production endpoints in the committed configs", () => {
    expect(macosConfig).toContain("releases/latest/download/latest.json");
    expect(macosConfig).not.toContain(MACOS_RC_CHANNEL);
    expect(windowsConfig).toContain(`releases/download/${WINDOWS_PRODUCTION_CHANNEL}/latest.json`);
    expect(windowsConfig).not.toContain(WINDOWS_RC_CHANNEL);
  });

  it("overrides both platform endpoints for a release candidate", () => {
    for (const name of ["build-macos-stable-draft", "build-windows-preview-draft"]) {
      const injections = steps(name).filter((step) => step.includes("rc-channel"));

      expect(injections, name).toHaveLength(1);
      expect(injections[0]).toContain(MACOS_RC_CHANNEL);
      expect(injections[0]).toContain(WINDOWS_RC_CHANNEL);
      expect(injections[0]).toContain(`if: ${IS_RELEASE_CANDIDATE}`);
    }
  });

  it("marks release candidates as prereleases", () => {
    expect(job("build-macos-stable-draft")).toContain(
      `prerelease: \${{ ${IS_RELEASE_CANDIDATE} }}`,
    );
    expect(job("build-windows-preview-draft")).toContain("prerelease: true");
  });

  it("moves the production Windows channel only on a final release", () => {
    expect(job("promote-windows-channel")).toContain(
      "if: needs.resolve-target.outputs.rc != 'true'",
    );
    expect(job("promote-windows-channel")).toContain(WINDOWS_PRODUCTION_CHANNEL);
  });

  it("promotes release candidates into their own channels", () => {
    const macos = job("promote-macos-rc-channel");
    const windows = job("promote-windows-rc-channel");

    expect(macos).toContain(`if: ${IS_RELEASE_CANDIDATE}`);
    expect(macos).toContain(MACOS_RC_CHANNEL);
    expect(windows).toContain(`if: ${IS_RELEASE_CANDIDATE}`);
    expect(windows).toContain(WINDOWS_RC_CHANNEL);
    expect(windows).not.toContain(WINDOWS_PRODUCTION_CHANNEL);
  });
});

describe("release notes gate", () => {
  it("generates user-facing notes before either draft build", () => {
    const preparation = job("prepare-release-notes");

    expect(preparation).toContain("fetch-depth: 0");
    expect(preparation).toContain("scripts/generate-release-notes.mjs");
    expect(preparation).toContain("--channel stable");
    expect(preparation).toContain("--channel windows-preview");

    for (const name of ["build-macos-stable-draft", "build-windows-preview-draft"]) {
      expect(job(name), name).toMatch(/^\s*needs:\s*\[[^\]]*\bprepare-release-notes\b[^\]]*\]$/m);
    }
  });

  it("uses generated notes instead of static platform boilerplate", () => {
    expect(job("build-macos-stable-draft")).toContain(
      "needs.prepare-release-notes.outputs.stable_body",
    );
    expect(job("build-windows-preview-draft")).toContain(
      "needs.prepare-release-notes.outputs.windows_body",
    );
    expect(job("build-macos-stable-draft")).not.toContain("Users on 0.10.0 or earlier");
  });

  it("uses an unpredictable delimiter for multiline GitHub outputs", () => {
    const preparation = job("prepare-release-notes");

    expect(preparation).toMatch(
      /local random_suffix[\s\S]*random_suffix="\$\(openssl rand -hex 16\)"/,
    );
    expect(preparation).toContain('delimiter="deck_release_notes_${random_suffix}"');
    expect(preparation).toContain('[[ "$random_suffix" =~ ^[0-9a-f]{32}$ ]]');
    expect(preparation).toContain('grep -Fxq "$delimiter" "$path"');
    expect(preparation).toContain('printf \'%s<<%s\\n\' "$name" "$delimiter"');
    expect(preparation).toContain("printf '\\n%s\\n' \"$delimiter\"");
    expect(preparation).not.toContain("${RANDOM}");
  });

  it("fails closed when delimiter entropy generation fails", () => {
    const preparation = job("prepare-release-notes");
    const helper = preparation.match(/^ {10}append_output\(\) \{[\s\S]*?^ {10}\}/m)?.[0];
    if (helper === undefined) {
      throw new Error("prepare-release-notes has no append_output helper");
    }
    const runnableHelper = helper.replace(/^ {10}/gm, "");
    const result = spawnSync(
      "bash",
      [
        "-c",
        [
          "set -euo pipefail",
          "openssl() { return 1; }",
          runnableHelper,
          "append_output notes package.json",
        ].join("\n"),
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, GITHUB_OUTPUT: "/dev/null" },
        encoding: "utf8",
      },
    );

    expect(result.status).not.toBe(0);
  });

  it("reuses the reviewed stable release body for a manual Windows retry", () => {
    const preparation = job("prepare-release-notes");

    expect(preparation).toContain('if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]');
    expect(preparation).toContain('gh release view "$TARGET_TAG" --json body --jq .body');
    expect(preparation).toContain("--body-file stable-release-notes.md --channel windows-preview");
  });
});

describe("publication gates", () => {
  it("pins every third-party action to an immutable commit", () => {
    for (const source of [workflow, ciWorkflow]) {
      const actionRefs = [...source.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1]);
      expect(actionRefs.length).toBeGreaterThan(0);
      for (const ref of actionRefs) {
        expect(ref, ref).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("blocks the macOS build before tauri-action without release signing", () => {
    const build = job("build-macos-stable-draft");
    const gate = steps("build-macos-stable-draft").find((step) =>
      step.includes("Verify macOS release signing"),
    );

    expect(gate).toContain("scripts/verify-macos-release-signing.mjs");
    expect(build.indexOf("Verify macOS release signing")).toBeLessThan(
      build.indexOf("Build stable macOS updater draft"),
    );

    const result = spawnSync(process.execPath, ["scripts/verify-macos-release-signing.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {},
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("macOS release signing is not configured");

    const configured = spawnSync(process.execPath, ["scripts/verify-macos-release-signing.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: {
        APPLE_CERTIFICATE: "certificate",
        APPLE_CERTIFICATE_PASSWORD: "certificate-password",
        KEYCHAIN_PASSWORD: "keychain-password",
        APPLE_ID: "release@example.com",
        APPLE_PASSWORD: "app-password",
        APPLE_TEAM_ID: "TEAMID",
      },
      encoding: "utf8",
    });
    expect(configured.status).toBe(0);
  });

  it("verifies the signed and notarized app and DMG before collection", () => {
    const build = job("build-macos-stable-draft");
    const verification = steps("build-macos-stable-draft").find((step) =>
      step.includes("Verify signed and notarized macOS bundle"),
    );

    expect(verification).toContain("codesign --verify --deep --strict");
    expect(verification).toContain("spctl --assess --type execute");
    expect(verification).toContain("spctl --assess --type open");
    expect(verification?.match(/xcrun stapler validate/g)).toHaveLength(2);
    expect(build.indexOf("Verify signed and notarized macOS bundle")).toBeLessThan(
      build.indexOf("Collect exact macOS updater artifacts"),
    );
  });

  it("proves renamed macOS draft assets match the local build", () => {
    const collection = steps("build-macos-stable-draft").find((step) =>
      step.includes("Collect exact macOS updater artifacts"),
    );

    expect(collection).toContain("releases/assets/$id");
    expect(collection).toContain("cmp -s");
    expect(collection).not.toContain('cp "${payloads[0]}" "${signatures[0]}" "${images[0]}"');
  });

  it("proves renamed Windows draft assets match the local build", () => {
    const collection = steps("build-windows-preview-draft").find((step) =>
      step.includes("Collect exact Windows updater artifact"),
    );

    expect(collection).toContain("releases/assets/$($asset.id)");
    expect(collection).toContain("Get-FileHash");
    expect(collection).not.toContain("Copy-Item $installers[0].FullName");
  });

  it("lets validation jobs read draft releases", () => {
    for (const name of ["validate-macos-stable", "validate-windows-preview"]) {
      expect(job(name), name).toContain("permissions:\n      contents: write");
    }
  });

  it("publishes nothing that cryptographic validation has not passed", () => {
    expect(job("publish-macos-stable")).toContain("validate-macos-stable");
    expect(job("publish-windows-preview")).toContain("validate-windows-preview");
    expect(job("promote-windows-channel")).toContain("validate-windows-preview");
  });
});
