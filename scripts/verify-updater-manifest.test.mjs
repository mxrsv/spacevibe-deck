import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { buildUpdaterProvenance } from "./create-updater-provenance.mjs";
import { validateUpdaterRelease } from "./verify-updater-manifest.mjs";

const REPOSITORY = "mxrsv/spacevibe-deck";
const SHA = "a".repeat(40);
const TAG = "v0.10.0-windows-preview";
const ASSET_URL = `https://api.github.com/repos/${REPOSITORY}/releases/assets/42`;

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture() {
  const manifest = {
    version: "0.10.0",
    notes: "Preview",
    pub_date: "2026-08-03T00:00:00.000Z",
    platforms: {
      "windows-x86_64": { signature: "signed", url: ASSET_URL },
      "windows-x86_64-nsis": { signature: "signed", url: ASSET_URL },
    },
  };
  const release = {
    tag_name: TAG,
    target_commitish: SHA,
    draft: true,
    prerelease: true,
    assets: [{ id: 42, name: "Deck_0.10.0_x64-setup.exe", url: ASSET_URL }],
  };
  const fileContents = {
    "latest.json": JSON.stringify(manifest),
    "release.json": JSON.stringify(release),
    // Under Tauri v2 the installer IS the updater payload — one file, not a
    // separate .nsis.zip alongside it.
    "Deck_0.10.0_x64-setup.exe": "installer",
    "Deck_0.10.0_x64-setup.exe.sig": "signature",
  };
  const provenance = {
    source_sha: SHA,
    tag: TAG,
    files: Object.fromEntries(
      Object.entries(fileContents).map(([name, value]) => [name, digest(value)]),
    ),
  };
  const expected = {
    version: "0.10.0",
    sourceSha: SHA,
    tag: TAG,
    repository: REPOSITORY,
    target: "windows-x86_64",
  };
  return { manifest, release, provenance, fileContents, expected };
}

test("accepts a signed NSIS draft tied to the exact source SHA", () => {
  assert.doesNotThrow(() => validateUpdaterRelease(fixture()));
});

test("builds deterministic provenance without mutating input", () => {
  const files = { "b.sig": "signature", "a.zip": "bundle" };
  const provenance = buildUpdaterProvenance(files, SHA, TAG);

  assert.deepEqual(Object.keys(provenance.files), ["a.zip", "b.sig"]);
  assert.equal(provenance.files["a.zip"], digest("bundle"));
  assert.deepEqual(files, { "b.sig": "signature", "a.zip": "bundle" });
});

test("rejects a different version, commit, tag, or repository", () => {
  for (const key of ["version", "sourceSha", "tag", "repository"]) {
    const value = fixture();
    value.expected = { ...value.expected, [key]: "wrong" };
    assert.throws(() => validateUpdaterRelease(value));
  }
});

test("rejects empty signatures and non-HTTPS URLs", () => {
  const unsigned = fixture();
  unsigned.manifest.platforms["windows-x86_64"].signature = "";
  assert.throws(() => validateUpdaterRelease(unsigned), /signature/i);

  const insecure = fixture();
  insecure.manifest.platforms["windows-x86_64"].url = "http://example.test/app.zip";
  assert.throws(() => validateUpdaterRelease(insecure), /HTTPS/i);
});

test("rejects assets outside the exact GitHub draft", () => {
  const value = fixture();
  value.release.assets = [];
  assert.throws(() => validateUpdaterRelease(value), /release asset/i);
});

test("rejects MSI or unexpected updater targets", () => {
  const msi = fixture();
  msi.provenance.files["Deck_0.10.0_x64.msi"] = digest("msi");
  msi.fileContents["Deck_0.10.0_x64.msi"] = "msi";
  assert.throws(() => validateUpdaterRelease(msi), /MSI/i);

  const target = fixture();
  target.manifest.platforms["linux-x86_64"] = {
    signature: "signed",
    url: ASSET_URL,
  };
  assert.throws(() => validateUpdaterRelease(target), /target/i);
});

test("rejects a modified artifact digest", () => {
  const value = fixture();
  value.fileContents["Deck_0.10.0_x64-setup.exe"] = "tampered";
  assert.throws(() => validateUpdaterRelease(value), /digest/i);
});
