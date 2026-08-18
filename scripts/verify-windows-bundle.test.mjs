import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { verifyWindowsBundle } from './verify-windows-bundle.mjs';

async function withFixture(files, run) {
  const root = await mkdtemp(join(tmpdir(), 'deck-windows-bundle-'));
  try {
    await Promise.all(
      files.map(async (relativePath) => {
        const path = join(root, relativePath);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, '');
      }),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('rejects a bundle with no setup executable', async () => {
  await withFixture(['notes.txt'], async (root) => {
    await assert.rejects(verifyWindowsBundle(root), /expected exactly one \*-setup\.exe, found 0/);
  });
});

test('accepts exactly one nested NSIS setup executable', async () => {
  await withFixture(['nsis/SpaceVibe-Deck_0.9.0_x64-setup.exe'], async (root) => {
    const result = await verifyWindowsBundle(root);
    assert.equal(result, join(root, 'nsis/SpaceVibe-Deck_0.9.0_x64-setup.exe'));
  });
});

test('rejects more than one setup executable and lists both', async () => {
  await withFixture(['a/first-setup.exe', 'b/second-setup.exe'], async (root) => {
    await assert.rejects(verifyWindowsBundle(root), (error) => {
      assert.match(error.message, /found 2/);
      assert.match(error.message, /first-setup\.exe/);
      assert.match(error.message, /second-setup\.exe/);
      return true;
    });
  });
});

test('rejects any MSI even when one NSIS setup exists', async () => {
  await withFixture(['app-setup.exe', 'msi/app.msi'], async (root) => {
    await assert.rejects(verifyWindowsBundle(root), (error) => {
      assert.match(error.message, /expected zero \.msi files, found 1/);
      assert.match(error.message, /app\.msi/);
      return true;
    });
  });
});

test('rejects a missing or non-directory bundle root', async () => {
  await withFixture(['not-a-directory'], async (root) => {
    await assert.rejects(verifyWindowsBundle(join(root, 'missing')), /does not exist/);
    await assert.rejects(verifyWindowsBundle(join(root, 'not-a-directory')), /is not a directory/);
  });
});
