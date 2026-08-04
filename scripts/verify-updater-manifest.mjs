import { createHash, createPublicKey, verify } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.[1-9]\d*)?$/;
const SHA = /^[0-9a-f]{40}$/;
const MANIFEST_ASSET = "latest.json";
const RELEASE_METADATA = "release.json";
const PREVIEW_SUFFIX = "-windows-preview";

// The complete asset set a platform's draft may carry. Everything a release
// publishes has to be named here: an asset nobody accounted for is either a
// leftover from a retried draft or something that was added after the build,
// and both are reasons to refuse the release rather than to ignore the file.
const PLATFORMS = {
  windows: {
    targets: ["windows-x86_64", "windows-x86_64-nsis"],
    // Tauri v2 signs the NSIS installer itself — the installer IS the payload.
    payloadSuffix: "-setup.exe",
    extraSuffixes: [],
  },
  macos: {
    targets: ["darwin-universal"],
    // The universal build emits one target and one payload for both arches.
    payloadSuffix: ".app.tar.gz",
    extraSuffixes: [".dmg"],
  },
};

// Minisign wire format, as produced by Tauri's signer and consumed by
// `minisign-verify` inside the shipped updater. Both the public key and the
// sidecar reach us as base64 of a whole Minisign file, so everything below
// re-derives what the app itself will check at install time.
const BASE64_TEXT = /^[A-Za-z0-9+/=\s]+$/;
const MAX_ENCODED_LENGTH = 4096;
const UNTRUSTED_COMMENT = "untrusted comment:";
const TRUSTED_COMMENT = "trusted comment: ";
const PUBLIC_KEY_BYTES = 42;
const SIGNATURE_BYTES = 74;
const GLOBAL_SIGNATURE_BYTES = 64;
const KEY_ID_BYTES = 8;
const LEGACY_ALGORITHM = "Ed";
const PREHASHED_ALGORITHM = "ED";
// DER prefix for an Ed25519 SubjectPublicKeyInfo — node:crypto has no raw
// Ed25519 key import, and Minisign carries the bare 32-byte key.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeMinisignFile(encoded, label) {
  invariant(
    typeof encoded === "string" &&
      encoded.trim() !== "" &&
      encoded.length <= MAX_ENCODED_LENGTH &&
      BASE64_TEXT.test(encoded),
    `${label} must be base64 text under ${MAX_ENCODED_LENGTH} characters`,
  );
  const text = Buffer.from(encoded, "base64").toString("utf8");
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith(UNTRUSTED_COMMENT));
  invariant(lines.length > 0, `${label} carries no Minisign content`);
  return lines;
}

function decodePacket(line, size, label) {
  invariant(BASE64_TEXT.test(line), `${label} is not base64`);
  const bytes = Buffer.from(line, "base64");
  invariant(bytes.length === size, `${label} must be exactly ${size} bytes`);
  return bytes;
}

export function decodeUpdaterPublicKey(encoded) {
  const lines = decodeMinisignFile(encoded, "Updater public key");
  invariant(lines.length === 1, "Updater public key must carry one key line");
  const bytes = decodePacket(lines[0], PUBLIC_KEY_BYTES, "Updater public key");
  const algorithm = bytes.subarray(0, 2).toString("latin1");
  invariant(
    algorithm === LEGACY_ALGORITHM,
    `Unsupported updater public key algorithm: ${algorithm}`,
  );
  const raw = bytes.subarray(2 + KEY_ID_BYTES);
  return {
    keyId: bytes.subarray(2, 2 + KEY_ID_BYTES),
    key: createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    }),
  };
}

export function decodeUpdaterSignature(encoded) {
  const lines = decodeMinisignFile(encoded, "Updater signature");
  invariant(
    lines.length === 3,
    "Updater signature must carry a signature, a trusted comment, and a global signature",
  );
  const [signatureLine, commentLine, globalLine] = lines;
  const bytes = decodePacket(
    signatureLine,
    SIGNATURE_BYTES,
    "Updater signature",
  );
  const algorithm = bytes.subarray(0, 2).toString("latin1");
  invariant(
    algorithm === PREHASHED_ALGORITHM || algorithm === LEGACY_ALGORITHM,
    `Unsupported updater signature algorithm: ${algorithm}`,
  );
  invariant(
    commentLine.startsWith(TRUSTED_COMMENT),
    "Updater signature is missing its trusted comment",
  );
  return {
    prehashed: algorithm === PREHASHED_ALGORITHM,
    keyId: bytes.subarray(2, 2 + KEY_ID_BYTES),
    signature: bytes.subarray(2 + KEY_ID_BYTES),
    trustedComment: commentLine.slice(TRUSTED_COMMENT.length),
    globalSignature: decodePacket(
      globalLine,
      GLOBAL_SIGNATURE_BYTES,
      "Updater global signature",
    ),
  };
}

/**
 * Reproduces `minisign-verify` over the bytes GitHub will actually serve:
 * key-id equality, the Ed25519 payload signature (BLAKE2b-512 prehashed for
 * `ED`), and the global signature covering the trusted comment.
 */
export function verifyUpdaterSignature(
  payload,
  encodedSignature,
  encodedPublicKey,
) {
  invariant(Buffer.isBuffer(payload), "Updater payload must be a byte buffer");
  const publicKey = decodeUpdaterPublicKey(encodedPublicKey);
  const signature = decodeUpdaterSignature(encodedSignature);
  invariant(
    publicKey.keyId.equals(signature.keyId),
    "Updater signature was made with a different public key",
  );
  const message = signature.prehashed
    ? createHash("blake2b512").update(payload).digest()
    : payload;
  invariant(
    verify(null, message, publicKey.key, signature.signature),
    "Updater payload signature is invalid",
  );
  invariant(
    verify(
      null,
      Buffer.concat([
        signature.signature,
        Buffer.from(signature.trustedComment, "utf8"),
      ]),
      publicKey.key,
      signature.globalSignature,
    ),
    "Updater trusted comment signature is invalid",
  );
}

function assertPlainObject(value, label) {
  invariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${label} must be an object`,
  );
}

function validateAssetMetadata(release) {
  invariant(Array.isArray(release.assets), "Release assets must be an array");
  for (const asset of release.assets) {
    invariant(
      typeof asset === "object" &&
        asset !== null &&
        typeof asset.name === "string" &&
        typeof asset.url === "string",
      "Release asset metadata is invalid",
    );
  }
  // A retried upload that lands twice, or two assets sharing one URL, makes
  // "the asset the manifest points at" ambiguous — refuse both shapes.
  for (const key of ["name", "url"]) {
    const seen = new Set();
    for (const asset of release.assets) {
      invariant(
        !seen.has(asset[key]),
        `Duplicate draft asset ${key}: ${asset[key]}`,
      );
      seen.add(asset[key]);
    }
  }
  return release.assets;
}

function rejectMsiArtifacts(names) {
  for (const name of names) {
    invariant(
      !name.toLowerCase().endsWith(".msi"),
      "MSI artifacts are forbidden",
    );
  }
}

function validateManifestPlatforms(manifest, expected, descriptor) {
  assertPlainObject(manifest.platforms, "manifest platforms");
  const targets = Object.keys(manifest.platforms);
  for (const target of targets) {
    invariant(
      descriptor.targets.includes(target),
      `Unexpected updater target: ${target}`,
    );
  }
  for (const target of descriptor.targets) {
    invariant(targets.includes(target), `Manifest is missing target ${target}`);
  }
  const assetPrefix = `https://api.github.com/repos/${expected.repository}/releases/assets/`;
  const urls = new Set();
  for (const target of descriptor.targets) {
    const platform = manifest.platforms[target];
    assertPlainObject(platform, `platform ${target}`);
    invariant(
      typeof platform.signature === "string" &&
        platform.signature.trim() !== "",
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
    urls.add(platform.url);
  }
  invariant(
    urls.size === 1,
    "Every updater target must point at the same payload asset",
  );
  return [...urls][0];
}

function closeAssetSet(assets, payloadName, sidecarName, descriptor) {
  const expectedAssets = [payloadName, sidecarName, MANIFEST_ASSET];
  const remaining = assets
    .map((asset) => asset.name)
    .filter((name) => !expectedAssets.includes(name));
  for (const suffix of descriptor.extraSuffixes) {
    const matches = remaining.filter((name) => name.endsWith(suffix));
    invariant(
      matches.length === 1,
      `Draft must carry exactly one ${suffix} asset`,
    );
    expectedAssets.push(matches[0]);
  }
  for (const name of expectedAssets) {
    invariant(
      assets.some((asset) => asset.name === name),
      `Draft is missing expected asset: ${name}`,
    );
  }
  for (const asset of assets) {
    invariant(
      expectedAssets.includes(asset.name),
      `Unexpected draft asset: ${asset.name}`,
    );
  }
  return expectedAssets.sort();
}

// The staged release response is captured mid-build and the draft is fetched
// again later, so incidental fields (timestamps, download counts) legitimately
// differ. Everything the release trust chain depends on does not.
function canonicalRelease(release) {
  return JSON.stringify({
    tag_name: release.tag_name,
    target_commitish: release.target_commitish,
    draft: release.draft,
    prerelease: release.prerelease,
    assets: release.assets
      .map(({ id, name, url }) => ({ id, name, url }))
      .sort((left, right) => (left.name < right.name ? -1 : 1)),
  });
}

function requireDownloadedAssets(releaseContents, expectedAssets) {
  for (const name of expectedAssets) {
    invariant(
      name in releaseContents,
      `Draft asset was not downloaded back: ${name}`,
    );
  }
  for (const name of Object.keys(releaseContents)) {
    invariant(
      expectedAssets.includes(name),
      `Downloaded file is not a draft asset: ${name}`,
    );
  }
  return releaseContents;
}

function validateStagedProvenance(stagedContents, provenance, expectedAssets) {
  assertPlainObject(provenance.files, "provenance files");
  const staged = Object.keys(stagedContents).sort();
  const carried = Object.keys(provenance.files).sort();
  const expectedStaged = [...expectedAssets, RELEASE_METADATA].sort();
  invariant(
    JSON.stringify(staged) === JSON.stringify(expectedStaged),
    "Staged files must be exactly the draft assets plus the release response",
  );
  invariant(
    JSON.stringify(carried) === JSON.stringify(staged),
    "Provenance and staged file sets differ",
  );
  for (const name of staged) {
    invariant(basename(name) === name, `Unsafe provenance filename: ${name}`);
    invariant(
      sha256(stagedContents[name]) === provenance.files[name],
      `Staged artifact digest mismatch: ${name}`,
    );
  }
}

/**
 * Validates one platform's draft release end to end.
 *
 * `stagedContents` are the local build outputs the provenance was computed
 * from. `releaseContents` are the bytes downloaded back from that exact draft,
 * and they are the only ones cryptographically trusted — provenance exists to
 * prove the draft still serves what the runner built.
 */
export function validateUpdaterRelease(input) {
  const {
    manifest,
    release,
    provenance,
    stagedContents,
    releaseContents,
    expected,
  } = input;
  assertPlainObject(manifest, "manifest");
  assertPlainObject(release, "release");
  assertPlainObject(provenance, "provenance");
  assertPlainObject(stagedContents, "stagedContents");
  assertPlainObject(releaseContents, "releaseContents");
  assertPlainObject(expected, "expected");

  const descriptor = PLATFORMS[expected.platform];
  invariant(
    descriptor !== undefined,
    `Unsupported updater platform: ${expected.platform}`,
  );
  invariant(
    SOURCE_VERSION.test(expected.version),
    "Expected version must be a stable or -rc.N SemVer",
  );
  invariant(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository),
    "Expected repository is invalid",
  );
  invariant(
    typeof expected.publicKey === "string" && expected.publicKey.trim() !== "",
    "Expected updater public key is required",
  );
  invariant(
    typeof expected.prerelease === "boolean",
    "Expected prerelease flag must be a boolean",
  );
  invariant(SHA.test(expected.sourceSha), "Expected source SHA is invalid");
  invariant(
    expected.tag === `v${expected.version}` ||
      expected.tag === `v${expected.version}${PREVIEW_SUFFIX}`,
    `Expected tag does not belong to version ${expected.version}`,
  );

  invariant(manifest.version === expected.version, "Manifest version mismatch");
  invariant(
    provenance.source_sha === expected.sourceSha,
    "Source SHA mismatch",
  );
  invariant(provenance.tag === expected.tag, "Provenance tag mismatch");
  invariant(release.tag_name === expected.tag, "Release tag mismatch");
  invariant(
    release.target_commitish === expected.sourceSha,
    "Release target commit mismatch",
  );
  invariant(release.draft === true, "Release must still be a draft");
  invariant(
    release.prerelease === expected.prerelease,
    `Release prerelease flag must be ${expected.prerelease}`,
  );

  const assets = validateAssetMetadata(release);
  rejectMsiArtifacts([
    ...assets.map((asset) => asset.name),
    ...Object.keys(stagedContents),
  ]);
  const payloadUrl = validateManifestPlatforms(manifest, expected, descriptor);
  const payloadAsset = assets.find((asset) => asset.url === payloadUrl);
  invariant(
    payloadAsset !== undefined,
    "Updater URL is not a release asset in this draft",
  );
  invariant(
    payloadAsset.name.endsWith(descriptor.payloadSuffix),
    `Updater asset must end with ${descriptor.payloadSuffix}`,
  );
  const sidecarName = `${payloadAsset.name}.sig`;
  const expectedAssets = closeAssetSet(
    assets,
    payloadAsset.name,
    sidecarName,
    descriptor,
  );

  // An inline signature that disagrees with the sidecar GitHub serves means the
  // manifest and the payload stopped describing the same build.
  const downloaded = requireDownloadedAssets(releaseContents, expectedAssets);
  const sidecar = downloaded[sidecarName].toString("utf8").trim();
  for (const [target, platform] of Object.entries(manifest.platforms)) {
    invariant(
      platform.signature.trim() === sidecar,
      `Manifest signature does not match the downloaded sidecar for ${target}`,
    );
  }

  validateStagedProvenance(stagedContents, provenance, expectedAssets);
  for (const name of expectedAssets) {
    invariant(
      sha256(downloaded[name]) === provenance.files[name],
      `Draft asset digest mismatch: ${name}`,
    );
  }

  invariant(
    JSON.stringify(JSON.parse(downloaded[MANIFEST_ASSET])) ===
      JSON.stringify(manifest),
    "latest.json content does not match the validated manifest",
  );
  invariant(
    canonicalRelease(JSON.parse(stagedContents[RELEASE_METADATA])) ===
      canonicalRelease(release),
    "release.json content does not match the validated release",
  );

  verifyUpdaterSignature(
    Buffer.from(downloaded[payloadAsset.name]),
    sidecar,
    expected.publicKey,
  );
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    invariant(
      key?.startsWith("--") && value !== undefined,
      "Invalid CLI arguments",
    );
    values[key.slice(2)] = value;
  }
  for (const key of [
    "manifest",
    "release",
    "provenance",
    "staged-dir",
    "release-dir",
    "version",
    "sha",
    "tag",
    "repository",
    "platform",
    "prerelease",
    "public-key",
  ]) {
    invariant(values[key], `Missing --${key}`);
  }
  invariant(
    values.prerelease === "true" || values.prerelease === "false",
    "--prerelease must be true or false",
  );
  return values;
}

async function readDirectoryContents(directory, skipped = []) {
  const contents = {};
  for (const name of (await readdir(directory)).sort()) {
    invariant(basename(name) === name, `Unsafe artifact filename: ${name}`);
    if (skipped.includes(name)) {
      continue;
    }
    contents[name] = await readFile(resolve(directory, name));
  }
  return contents;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(resolve(args.manifest), "utf8"));
  const release = JSON.parse(await readFile(resolve(args.release), "utf8"));
  const provenance = JSON.parse(
    await readFile(resolve(args.provenance), "utf8"),
  );
  const stagedContents = await readDirectoryContents(
    resolve(args["staged-dir"]),
    [basename(args.provenance)],
  );
  const releaseContents = await readDirectoryContents(
    resolve(args["release-dir"]),
  );
  validateUpdaterRelease({
    manifest,
    release,
    provenance,
    stagedContents,
    releaseContents,
    expected: {
      version: args.version,
      sourceSha: args.sha,
      tag: args.tag,
      repository: args.repository,
      platform: args.platform,
      prerelease: args.prerelease === "true",
      publicKey: args["public-key"],
    },
  });
  console.log(
    `Validated ${args.platform} updater release ${args.tag} at ${args.sha}`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
