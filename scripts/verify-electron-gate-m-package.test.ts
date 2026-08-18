import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EXPECTED_MAIN,
  asarHasDir,
  machOArchCount,
  readAsarFile,
  structureFailures,
} from './verify-electron-gate-m-package.mjs';

/**
 * The verifier's pure half, proven against synthetic layouts so a regression
 * in the asar reader or a structure check shows up here — not as a false
 * PASS on the verification Mac. The runtime half needs the packaged app and
 * stays owned by `npm run electron:verify:gate-m`.
 */

/** Minimal asar writer — the mirror of the verifier's reader. */
function writeAsar(target: string, files: Record<string, string>): void {
  interface DirNode {
    files: Record<string, DirNode | { size: number; offset: string }>;
  }
  const index: DirNode = { files: {} };
  const contents: Buffer[] = [];
  let offset = 0;
  for (const [innerPath, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const parts = innerPath.split('/');
    let node = index;
    for (const part of parts.slice(0, -1)) {
      const next = (node.files[part] ??= { files: {} }) as DirNode;
      node = next;
    }
    node.files[parts[parts.length - 1]] = {
      size: data.length,
      offset: String(offset),
    };
    contents.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(index));
  const padded = Math.ceil(json.length / 4) * 4;
  const header = Buffer.alloc(16 + padded);
  header.writeUInt32LE(4, 0);
  header.writeUInt32LE(8 + padded, 4);
  header.writeUInt32LE(4 + padded, 8);
  header.writeUInt32LE(json.length, 12);
  json.copy(header, 16);
  writeFileSync(target, Buffer.concat([header, ...contents]));
}

/** A two-slice fat header — enough for the arch check, no real slices. */
function writeFatBinary(target: string, arches: number): void {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(0xcafebabe, 0);
  head.writeUInt32BE(arches, 4);
  writeFileSync(target, head);
}

const temps: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-m-test-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const COMPLETE_ASAR = {
  'package.json': JSON.stringify({ main: EXPECTED_MAIN }),
  'dist/index.html': '<!doctype html>',
  'dist-gate-m-renderer/gate-m.html': '<!doctype html>',
  'dist-electron/electron/main.cjs': 'module.exports = {};',
  'dist-electron/src/shared.cjs': 'module.exports = {};',
  'dist-electron/electron/vendor/react-grab/index.global.js': ';',
};

function completeLayout(dir: string) {
  const asar = path.join(dir, 'app.asar');
  writeAsar(asar, COMPLETE_ASAR);
  const unpacked = path.join(dir, 'app.asar.unpacked');
  const helperDir = path.join(unpacked, 'node_modules', 'node-pty', 'build', 'Release');
  mkdirSync(helperDir, { recursive: true });
  writeFileSync(path.join(helperDir, 'spawn-helper'), '#!/bin/sh\n', {
    mode: 0o755,
  });
  const executable = path.join(dir, 'Deck Gate M');
  writeFatBinary(executable, 2);
  return { asar, unpacked, executable };
}

describe('asar reader', () => {
  it('round-trips files and directories through a written archive', () => {
    const dir = tempDir();
    const asar = path.join(dir, 'app.asar');
    writeAsar(asar, {
      'package.json': '{"main":"x.cjs"}',
      'dist/index.html': 'hello',
    });
    expect(readAsarFile(asar, 'dist/index.html').toString()).toBe('hello');
    expect(asarHasDir(asar, 'dist')).toBe(true);
    expect(asarHasDir(asar, 'missing')).toBe(false);
    expect(() => readAsarFile(asar, 'missing.txt')).toThrow('is not a file inside');
  });
});

describe('machOArchCount', () => {
  it('reads the slice count from a fat header and 1 from anything else', () => {
    const dir = tempDir();
    const fat = path.join(dir, 'fat');
    writeFatBinary(fat, 2);
    expect(machOArchCount(fat)).toBe(2);
    const thin = path.join(dir, 'thin');
    writeFileSync(thin, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
    expect(machOArchCount(thin)).toBe(1);
  });
});

describe('structureFailures', () => {
  it('passes a complete layout', () => {
    expect(structureFailures(completeLayout(tempDir()))).toEqual([]);
  });

  it('reports a missing asar and stops there', () => {
    const dir = tempDir();
    const failures = structureFailures({
      asar: path.join(dir, 'app.asar'),
      unpacked: path.join(dir, 'app.asar.unpacked'),
      executable: path.join(dir, 'Deck Gate M'),
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('missing app.asar');
  });

  it('rejects a wrong packaged main', () => {
    const dir = tempDir();
    const layout = completeLayout(dir);
    writeAsar(layout.asar, {
      ...COMPLETE_ASAR,
      'package.json': JSON.stringify({ main: 'electron/main.js' }),
    });
    expect(
      structureFailures(layout).some((failure) => failure.includes(`expected ${EXPECTED_MAIN}`)),
    ).toBe(true);
  });

  it('rejects a single-architecture executable', () => {
    const dir = tempDir();
    const layout = completeLayout(dir);
    writeFatBinary(layout.executable, 1);
    expect(structureFailures(layout).some((failure) => failure.includes('universal'))).toBe(true);
  });

  it('rejects a non-executable spawn-helper', () => {
    const dir = tempDir();
    const layout = completeLayout(dir);
    const helper = path.join(
      layout.unpacked,
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'spawn-helper',
    );
    // `writeFileSync`'s mode applies only on creation — the helper already
    // exists, so the executable bit has to be stripped explicitly.
    chmodSync(helper, 0o644);
    expect(structureFailures(layout).some((failure) => failure.includes('not executable'))).toBe(
      true,
    );
  });
});
