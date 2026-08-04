import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);
const macosConfig = readFileSync(
  new URL("../src-tauri/tauri.macos.conf.json", import.meta.url),
  "utf8",
);
const windowsConfig = readFileSync(
  new URL("../src-tauri/tauri.windows.conf.json", import.meta.url),
  "utf8",
);

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
      body.slice(
        header.index,
        index + 1 < headers.length ? headers[index + 1].index : body.length,
      ),
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
  const result = spawnSync(
    "bash",
    ["-c", '[[ "$1" =~ $SOURCE_TAG ]]', "bash", tag],
    {
      env: { ...process.env, SOURCE_TAG: pattern },
    },
  );
  // The Windows build job runs this suite too; a missing bash would otherwise
  // read as "every tag is refused" and send the reader hunting in the regex.
  if (result.error) {
    throw new Error(
      `Could not run the tag guard through bash: ${result.error}`,
    );
  }
  return result.status === 0;
}

describe("release tag resolution", () => {
  it("parses workflow jobs after a Windows CRLF checkout", () => {
    const windowsWorkflow = workflow
      .replaceAll("\r\n", "\n")
      .replaceAll("\n", "\r\n");

    expect(job("build-macos-stable-draft", windowsWorkflow)).toContain(
      "releaseDraft: true",
    );
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

  it("triggers on stable and release-candidate pushes only", () => {
    const triggers = workflow.slice(
      workflow.indexOf("tags:"),
      workflow.indexOf("workflow_dispatch:"),
    );

    expect(triggers).toContain('"v[0-9]+.[0-9]+.[0-9]+"');
    expect(triggers).toContain('"v[0-9]+.[0-9]+.[0-9]+-rc.[0-9]+"');
    expect(triggers).not.toContain("windows-preview");
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
    expect(windowsConfig).toContain(
      `releases/download/${WINDOWS_PRODUCTION_CHANNEL}/latest.json`,
    );
    expect(windowsConfig).not.toContain(WINDOWS_RC_CHANNEL);
  });

  it("overrides both platform endpoints for a release candidate", () => {
    for (const name of [
      "build-macos-stable-draft",
      "build-windows-preview-draft",
    ]) {
      const injections = steps(name).filter((step) =>
        step.includes("rc-channel"),
      );

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
    expect(job("promote-windows-channel")).toContain(
      WINDOWS_PRODUCTION_CHANNEL,
    );
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

describe("publication gates", () => {
  it("proves renamed macOS draft assets match the local build", () => {
    const collection = steps("build-macos-stable-draft").find((step) =>
      step.includes("Collect exact macOS updater artifacts"),
    );

    expect(collection).toContain("releases/assets/$id");
    expect(collection).toContain("cmp -s");
    expect(collection).not.toContain(
      'cp "${payloads[0]}" "${signatures[0]}" "${images[0]}"',
    );
  });

  it("lets validation jobs read draft releases", () => {
    for (const name of [
      "validate-macos-stable",
      "validate-windows-preview",
    ]) {
      expect(job(name), name).toContain("permissions:\n      contents: write");
    }
  });

  it("publishes nothing that cryptographic validation has not passed", () => {
    expect(job("publish-macos-stable")).toContain("validate-macos-stable");
    expect(job("publish-windows-preview")).toContain(
      "validate-windows-preview",
    );
    expect(job("promote-windows-channel")).toContain(
      "validate-windows-preview",
    );
  });
});
