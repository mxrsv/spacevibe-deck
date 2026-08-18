import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildUpdaterProvenance } from './create-updater-provenance.mjs';
import { validateUpdaterRelease } from './verify-updater-manifest.mjs';

const REPOSITORY = 'mxrsv/spacevibe-deck';
const SHA = 'a'.repeat(40);
const VERSION = '0.11.0-rc.1';
const SOURCE_TAG = `v${VERSION}`;
const PREVIEW_TAG = `${SOURCE_TAG}-windows-preview`;
const ASSET_BASE = `https://api.github.com/repos/${REPOSITORY}/releases/assets`;
const KEY_ID = Buffer.from('0123456789abcdef', 'hex');

// The exact asset set each platform's draft is allowed to carry. Anything the
// descriptor does not name — a stale installer from a retried draft, a second
// bundle, an MSI — is a reason to refuse the release, not to ignore the file.
const WINDOWS = {
  platform: 'windows',
  tag: PREVIEW_TAG,
  prerelease: true,
  targets: ['windows-x86_64', 'windows-x86_64-nsis'],
  payload: `Deck_${VERSION}_x64-setup.exe`,
  extras: [],
  stagedNames: {},
};
const MACOS = {
  platform: 'macos',
  tag: SOURCE_TAG,
  prerelease: true,
  targets: [
    'darwin-aarch64',
    'darwin-x86_64',
    'darwin-universal',
    'darwin-aarch64-app',
    'darwin-x86_64-app',
    'darwin-universal-app',
  ],
  payload: `SpaceVibe.Deck_${VERSION}_universal.app.tar.gz`,
  extras: [`SpaceVibe.Deck_${VERSION}_universal.dmg`],
  // Two renames stack between the runner and the draft: tauri-action adds
  // `_<version>_universal` to the bundle on upload, and GitHub replaces spaces
  // with dots. The staged names therefore never equal the asset names.
  stagedNames: {
    [`SpaceVibe.Deck_${VERSION}_universal.app.tar.gz`]: 'SpaceVibe Deck.app.tar.gz',
    [`SpaceVibe.Deck_${VERSION}_universal.app.tar.gz.sig`]: 'SpaceVibe Deck.app.tar.gz.sig',
    [`SpaceVibe.Deck_${VERSION}_universal.dmg`]: `SpaceVibe Deck_${VERSION}_universal.dmg`,
  },
};

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

// Tauri stores both the public key and the sidecar as base64 of a whole
// Minisign file, so the fixtures have to build those files byte for byte —
// a hand-written "signed" string proves nothing about the trust chain.
function minisignKeypair(keyId = KEY_ID) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const file = [
    `untrusted comment: minisign public key ${keyId.toString('hex').toUpperCase()}`,
    Buffer.concat([Buffer.from('Ed'), keyId, raw]).toString('base64'),
    '',
  ].join('\n');
  return { privateKey, encodedPublicKey: Buffer.from(file).toString('base64') };
}

const KEYPAIR = minisignKeypair();
// A genuinely different signing key also carries a different key id, which is
// what a released build compares first.
const OTHER_KEYPAIR = minisignKeypair(Buffer.from('fedcba9876543210', 'hex'));

function signUpdaterPayload(payload, options = {}) {
  const {
    privateKey = KEYPAIR.privateKey,
    algorithm = 'ED',
    trustedComment = 'timestamp:1754265600\tfile:updater-payload',
    keyId = KEY_ID,
  } = options;
  const message =
    algorithm === 'ED' ? createHash('blake2b512').update(payload).digest() : Buffer.from(payload);
  const signature = sign(null, message, privateKey);
  const globalSignature = sign(
    null,
    Buffer.concat([signature, Buffer.from(trustedComment, 'utf8')]),
    privateKey,
  );
  const file = [
    'untrusted comment: signature from tauri secret key',
    Buffer.concat([Buffer.from(algorithm), keyId, signature]).toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64'),
    '',
  ].join('\n');
  return Buffer.from(file).toString('base64');
}

function editSignatureFile(encoded, edit) {
  const lines = Buffer.from(encoded, 'base64').toString('utf8').split('\n');
  return Buffer.from(edit([...lines]).join('\n'), 'utf8').toString('base64');
}

function flipLastByte(base64Line) {
  const bytes = Buffer.from(base64Line, 'base64');
  bytes[bytes.length - 1] ^= 0xff;
  return bytes.toString('base64');
}

/**
 * Rebuilds every derived artifact from the mutated manifest/release, so a case
 * that targets one invariant cannot pass or fail on a stale digest.
 */
function sync(value) {
  value.releaseContents['latest.json'] = Buffer.from(JSON.stringify(value.manifest));
  value.stagedContents = {
    ...Object.fromEntries(
      Object.entries(value.releaseContents).map(([name, content]) => [
        value.stagedNames[name] ?? name,
        content,
      ]),
    ),
    'release.json': Buffer.from(JSON.stringify(value.release)),
  };
  return reprovenance(value);
}

function reprovenance(value) {
  value.provenance = {
    ...value.provenance,
    files: Object.fromEntries(
      Object.entries(value.stagedContents).map(([name, content]) => [name, digest(content)]),
    ),
  };
  return value;
}

function fixture(descriptor = WINDOWS, options = {}) {
  const {
    payloadBytes = Buffer.from(`${descriptor.payload} bytes`),
    signature = signUpdaterPayload(payloadBytes),
    publicKey = KEYPAIR.encodedPublicKey,
  } = options;
  const sidecarName = `${descriptor.payload}.sig`;
  const payloadUrl = `${ASSET_BASE}/41`;
  const manifest = {
    version: VERSION,
    notes: 'Release candidate',
    pub_date: '2026-08-04T00:00:00.000Z',
    platforms: Object.fromEntries(
      descriptor.targets.map((target) => [target, { signature, url: payloadUrl }]),
    ),
  };
  const assets = [
    { id: 41, name: descriptor.payload, url: payloadUrl },
    { id: 42, name: sidecarName, url: `${ASSET_BASE}/42` },
    ...descriptor.extras.map((name, index) => ({
      id: 43 + index,
      name,
      url: `${ASSET_BASE}/${43 + index}`,
    })),
    { id: 50, name: 'latest.json', url: `${ASSET_BASE}/50` },
  ];
  const release = {
    tag_name: descriptor.tag,
    target_commitish: SHA,
    draft: true,
    prerelease: descriptor.prerelease,
    assets,
  };
  const value = {
    manifest,
    release,
    provenance: { source_sha: SHA, tag: descriptor.tag, files: {} },
    stagedNames: descriptor.stagedNames,
    // Under Tauri v2 the installer IS the updater payload — one file, not a
    // separate .nsis.zip alongside it.
    releaseContents: {
      [descriptor.payload]: payloadBytes,
      [sidecarName]: Buffer.from(signature, 'utf8'),
      ...Object.fromEntries(descriptor.extras.map((name) => [name, Buffer.from(`${name} bytes`)])),
      'latest.json': Buffer.from('{}'),
    },
    stagedContents: {},
    expected: {
      version: VERSION,
      sourceSha: SHA,
      tag: descriptor.tag,
      repository: REPOSITORY,
      platform: descriptor.platform,
      prerelease: descriptor.prerelease,
      publicKey,
    },
  };
  return sync(value);
}

function withSignature(value, descriptor, signature) {
  for (const platform of Object.values(value.manifest.platforms)) {
    platform.signature = signature;
  }
  value.releaseContents[`${descriptor.payload}.sig`] = Buffer.from(signature, 'utf8');
  return sync(value);
}

test('accepts a signed NSIS draft tied to the exact source SHA', () => {
  assert.doesNotThrow(() => validateUpdaterRelease(fixture(WINDOWS)));
});

test('accepts a signed universal macOS draft', () => {
  assert.doesNotThrow(() => validateUpdaterRelease(fixture(MACOS)));
});

test('builds deterministic provenance without mutating input', () => {
  const files = { 'b.sig': 'signature', 'a.zip': 'bundle' };
  const provenance = buildUpdaterProvenance(files, SHA, PREVIEW_TAG);

  assert.deepEqual(Object.keys(provenance.files), ['a.zip', 'b.sig']);
  assert.equal(provenance.files['a.zip'], digest('bundle'));
  assert.deepEqual(files, { 'b.sig': 'signature', 'a.zip': 'bundle' });
});

test('carries provenance for stable, release-candidate and preview tags', () => {
  const files = { 'latest.json': 'manifest' };

  for (const tag of [
    'v0.11.0',
    'v0.11.0-rc.1',
    'v0.11.0-windows-preview',
    'v0.11.0-rc.2-windows-preview',
  ]) {
    assert.equal(buildUpdaterProvenance(files, SHA, tag).tag, tag);
  }
});

test('refuses provenance for channel or malformed tags', () => {
  const files = { 'latest.json': 'manifest' };

  for (const tag of [
    'windows-preview-channel',
    'windows-rc-channel',
    'macos-rc-channel',
    '0.11.0',
    'v0.11.0-rc.0',
    'v0.11.0-beta.1',
    'latest',
  ]) {
    assert.throws(() => buildUpdaterProvenance(files, SHA, tag), /tag/i);
  }
});

test('rejects a different version, commit, tag, or repository', () => {
  for (const key of ['version', 'sourceSha', 'tag', 'repository']) {
    const value = fixture();
    value.expected = { ...value.expected, [key]: 'wrong' };
    assert.throws(() => validateUpdaterRelease(value));
  }
});

test('rejects a release whose prerelease flag does not match the channel', () => {
  const value = fixture();
  value.expected = { ...value.expected, prerelease: false };
  assert.throws(() => validateUpdaterRelease(sync(value)), /prerelease/i);
});

test('rejects empty signatures and non-HTTPS URLs', () => {
  const unsigned = fixture();
  unsigned.manifest.platforms['windows-x86_64'].signature = '';
  assert.throws(() => validateUpdaterRelease(sync(unsigned)), /signature/i);

  const insecure = fixture();
  insecure.manifest.platforms['windows-x86_64'].url = 'http://example.test/app.zip';
  assert.throws(() => validateUpdaterRelease(sync(insecure)), /HTTPS/i);
});

test('rejects assets outside the exact GitHub draft', () => {
  const value = fixture();
  value.release.assets = [];
  assert.throws(() => validateUpdaterRelease(sync(value)), /asset/i);
});

test('rejects MSI or unexpected updater targets', () => {
  const msi = fixture();
  msi.stagedContents[`Deck_${VERSION}_x64.msi`] = Buffer.from('msi');
  assert.throws(() => validateUpdaterRelease(reprovenance(msi)), /MSI/i);

  const target = fixture();
  target.manifest.platforms['linux-x86_64'] = {
    signature: target.manifest.platforms['windows-x86_64'].signature,
    url: `${ASSET_BASE}/41`,
  };
  assert.throws(() => validateUpdaterRelease(sync(target)), /target/i);
});

test('rejects a manifest that omits a platform target', () => {
  const value = fixture(MACOS);
  delete value.manifest.platforms['darwin-universal-app'];
  assert.throws(() => validateUpdaterRelease(sync(value)), /target/i);
});

test('rejects a modified artifact digest', () => {
  const value = fixture();
  value.stagedContents[WINDOWS.payload] = Buffer.from('tampered');
  assert.throws(() => validateUpdaterRelease(value), /digest/i);
});

test('rejects staged bytes that differ from the draft asset', () => {
  // Provenance still describes the local build; the draft now serves something
  // else. Only the re-downloaded bytes are trusted, so this must fail.
  const value = fixture();
  value.releaseContents[WINDOWS.payload] = Buffer.from('swapped after upload');
  assert.throws(() => validateUpdaterRelease(value), /draft asset digest/i);
});

test('rejects a manifest and sidecar signature mismatch', () => {
  const value = fixture();
  value.releaseContents[`${WINDOWS.payload}.sig`] = Buffer.from(
    signUpdaterPayload(Buffer.from('some other payload')),
    'utf8',
  );
  assert.throws(() => validateUpdaterRelease(sync(value)), /sidecar/i);
});

test('rejects a staged release response that no longer describes the draft', () => {
  // Incidental fields may drift between the build and the validation job; the
  // asset set, tag, commit and draft flags may not.
  const value = fixture();
  const staged = JSON.parse(value.stagedContents['release.json']);
  value.stagedContents['release.json'] = Buffer.from(
    JSON.stringify({
      ...staged,
      assets: staged.assets.slice(1),
      updated_at: '2026-08-04T12:00:00Z',
    }),
  );
  assert.throws(() => validateUpdaterRelease(reprovenance(value)), /release\.json content/i);
});

test('rejects a staged file that never reached the draft', () => {
  // Binding by content must stay symmetric: an artifact the runner built and
  // nobody uploaded is as much a broken release as an asset nobody built.
  const value = fixture(MACOS);
  value.stagedContents['SpaceVibe Deck_0.11.0-rc.1_aarch64.dmg'] = Buffer.from('second image');
  assert.throws(() => validateUpdaterRelease(reprovenance(value)), /never reached the draft/i);
});

test('rejects a stale draft asset left by an earlier run', () => {
  const value = fixture();
  const stale = 'Deck_0.10.0_x64-setup.exe';
  value.release.assets = [
    ...value.release.assets,
    { id: 99, name: stale, url: `${ASSET_BASE}/99` },
  ];
  value.releaseContents[stale] = Buffer.from('stale installer');
  assert.throws(() => validateUpdaterRelease(sync(value)), /unexpected draft asset/i);
});

test('rejects duplicate draft assets', () => {
  const duplicateName = fixture();
  duplicateName.release.assets = [
    ...duplicateName.release.assets,
    { id: 98, name: WINDOWS.payload, url: `${ASSET_BASE}/98` },
  ];
  assert.throws(() => validateUpdaterRelease(sync(duplicateName)), /duplicate/i);

  const duplicateUrl = fixture();
  duplicateUrl.release.assets = [
    ...duplicateUrl.release.assets,
    { id: 97, name: 'extra.txt', url: `${ASSET_BASE}/41` },
  ];
  assert.throws(() => validateUpdaterRelease(sync(duplicateUrl)), /duplicate/i);
});

test('rejects a draft without the updater sidecar', () => {
  const value = fixture();
  const sidecar = `${WINDOWS.payload}.sig`;
  value.release.assets = value.release.assets.filter((asset) => asset.name !== sidecar);
  delete value.releaseContents[sidecar];
  assert.throws(() => validateUpdaterRelease(sync(value)), /missing/i);
});

test('rejects a draft asset that was never downloaded back', () => {
  const value = fixture();
  delete value.releaseContents[WINDOWS.payload];
  assert.throws(() => validateUpdaterRelease(value), /download/i);
});

test('rejects a wrong updater public key', () => {
  const value = fixture(WINDOWS, { publicKey: OTHER_KEYPAIR.encodedPublicKey });
  assert.throws(() => validateUpdaterRelease(value), /key/i);
});

test('rejects tampered installer bytes', () => {
  // Digests and provenance are recomputed, so only the Minisign signature
  // stands between a swapped installer and a published update.
  const value = fixture();
  value.releaseContents[WINDOWS.payload] = Buffer.from('malicious installer');
  assert.throws(() => validateUpdaterRelease(sync(value)), /signature is invalid/i);
});

test('rejects a tampered sidecar signature', () => {
  const value = fixture();
  const tampered = editSignatureFile(
    value.manifest.platforms['windows-x86_64'].signature,
    (lines) => {
      lines[1] = flipLastByte(lines[1]);
      return lines;
    },
  );
  assert.throws(
    () => validateUpdaterRelease(withSignature(value, WINDOWS, tampered)),
    /signature is invalid/i,
  );
});

test('rejects a tampered trusted comment', () => {
  const value = fixture();
  const tampered = editSignatureFile(
    value.manifest.platforms['windows-x86_64'].signature,
    (lines) => {
      lines[2] = 'trusted comment: timestamp:0\tfile:evil.exe';
      return lines;
    },
  );
  assert.throws(
    () => validateUpdaterRelease(withSignature(value, WINDOWS, tampered)),
    /trusted comment/i,
  );
});

test('keeps generated keys and payloads out of the filesystem', () => {
  // Split so the check never matches its own source text.
  const writeApis = [
    ['write', 'File'],
    ['append', 'File'],
    ['create', 'WriteStream'],
    ['mkd', 'temp'],
    ['write', 'FileSync'],
  ].map((parts) => parts.join(''));
  const source = readFileSync(new URL(import.meta.url), 'utf8');

  for (const api of writeApis) {
    assert.equal(source.includes(api), false, `Fixtures must not call ${api}`);
  }
});
