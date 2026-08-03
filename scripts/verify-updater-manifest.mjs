import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA = /^[0-9a-f]{40}$/;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPlainObject(value, label) {
  invariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} must be an object`,
  );
}

export function validateUpdaterRelease(input) {
  const { manifest, release, provenance, fileContents, expected } = input;
  assertPlainObject(manifest, "manifest");
  assertPlainObject(release, "release");
  assertPlainObject(provenance, "provenance");
  assertPlainObject(fileContents, "fileContents");
  assertPlainObject(expected, "expected");

  invariant(SEMVER.test(expected.version), "Expected version must be SemVer");
  invariant(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository),
    "Expected repository is invalid",
  );
  invariant(manifest.version === expected.version, "Manifest version mismatch");
  invariant(SHA.test(expected.sourceSha), "Expected source SHA is invalid");
  invariant(provenance.source_sha === expected.sourceSha, "Source SHA mismatch");
  invariant(provenance.tag === expected.tag, "Provenance tag mismatch");
  invariant(release.tag_name === expected.tag, "Release tag mismatch");
  invariant(
    release.target_commitish === expected.sourceSha,
    "Release target commit mismatch",
  );
  invariant(release.draft === true, "Release must still be a draft");
  invariant(release.prerelease === true, "Release must be a prerelease");

  assertPlainObject(manifest.platforms, "manifest platforms");
  const platformEntries = Object.entries(manifest.platforms);
  const allowedTargets = new Set([expected.target, `${expected.target}-nsis`]);
  invariant(
    platformEntries.some(([target]) => target === expected.target),
    `Manifest is missing target ${expected.target}`,
  );
  invariant(Array.isArray(release.assets), "Release assets must be an array");
  invariant(
    release.assets.every(
      (asset) =>
        typeof asset === "object" &&
        asset !== null &&
        typeof asset.name === "string" &&
        typeof asset.url === "string",
    ),
    "Release asset metadata is invalid",
  );
  const assetPrefix = `https://api.github.com/repos/${expected.repository}/releases/assets/`;
  for (const [target, platform] of platformEntries) {
    invariant(allowedTargets.has(target), `Unexpected updater target: ${target}`);
    assertPlainObject(platform, `platform ${target}`);
    invariant(
      typeof platform.signature === "string" && platform.signature.trim() !== "",
      `Updater signature is empty for ${target}`,
    );
    invariant(
      typeof platform.url === "string" && platform.url.startsWith("https://"),
      `Updater URL must use HTTPS for ${target}`,
    );
    invariant(
      platform.url.startsWith(assetPrefix),
      `Updater URL is outside repository ${expected.repository}`,
    );
    const asset = release.assets.find((candidate) => candidate.url === platform.url);
    invariant(asset !== undefined, `Updater URL is not a release asset for ${target}`);
    invariant(
      typeof asset.name === "string" && asset.name.endsWith(".nsis.zip"),
      `Updater asset must be an NSIS zip for ${target}`,
    );
  }

  assertPlainObject(provenance.files, "provenance files");
  const carriedFiles = Object.keys(provenance.files);
  invariant(carriedFiles.includes("latest.json"), "Provenance lacks latest.json");
  invariant(carriedFiles.includes("release.json"), "Provenance lacks release.json");
  invariant(
    carriedFiles.filter((name) => name.endsWith(".nsis.zip")).length === 1,
    "Provenance must carry exactly one NSIS updater bundle",
  );
  invariant(
    carriedFiles.filter((name) => name.endsWith(".nsis.zip.sig")).length === 1,
    "Provenance must carry exactly one updater signature",
  );
  invariant(
    carriedFiles.filter((name) => name.endsWith(".exe")).length === 1,
    "Provenance must carry exactly one NSIS installer",
  );
  invariant(
    carriedFiles.every((name) => !name.toLowerCase().endsWith(".msi")),
    "MSI artifacts are forbidden",
  );
  invariant(
    carriedFiles.length === Object.keys(fileContents).length,
    "Provenance and carried file sets differ",
  );
  for (const name of carriedFiles) {
    invariant(basename(name) === name, `Unsafe provenance filename: ${name}`);
    invariant(name in fileContents, `Missing carried file: ${name}`);
    invariant(
      sha256(fileContents[name]) === provenance.files[name],
      `Artifact digest mismatch: ${name}`,
    );
  }
  invariant(
    JSON.stringify(JSON.parse(fileContents["latest.json"])) ===
      JSON.stringify(manifest),
    "latest.json content does not match the validated manifest",
  );
  invariant(
    JSON.stringify(JSON.parse(fileContents["release.json"])) ===
      JSON.stringify(release),
    "release.json content does not match the validated release",
  );
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    invariant(key?.startsWith("--") && value !== undefined, "Invalid CLI arguments");
    values[key.slice(2)] = value;
  }
  for (const key of [
    "manifest",
    "release",
    "provenance",
    "artifact-dir",
    "version",
    "sha",
    "tag",
    "repository",
    "target",
  ]) {
    invariant(values[key], `Missing --${key}`);
  }
  return values;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const artifactDir = resolve(args["artifact-dir"]);
  const manifest = JSON.parse(await readFile(resolve(args.manifest), "utf8"));
  const release = JSON.parse(await readFile(resolve(args.release), "utf8"));
  const provenance = JSON.parse(await readFile(resolve(args.provenance), "utf8"));
  const directoryFiles = (await readdir(artifactDir)).sort();
  const expectedFiles = [
    ...Object.keys(provenance.files),
    basename(args.provenance),
  ].sort();
  invariant(
    JSON.stringify(directoryFiles) === JSON.stringify(expectedFiles),
    "Artifact directory contains untracked files",
  );
  const fileContents = {};
  for (const name of Object.keys(provenance.files)) {
    invariant(basename(name) === name, `Unsafe provenance filename: ${name}`);
    fileContents[name] = await readFile(resolve(artifactDir, name));
  }
  validateUpdaterRelease({
    manifest,
    release,
    provenance,
    fileContents,
    expected: {
      version: args.version,
      sourceSha: args.sha,
      tag: args.tag,
      repository: args.repository,
      target: args.target,
    },
  });
  console.log(`Validated updater manifest for ${args.tag} at ${args.sha}`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
