/* oxlint-disable eslint/no-console -- CLI tooling: stdout is the interface */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A source tag is `vX.Y.Z` or `vX.Y.Z-rc.N`; the Windows preview draft derives
// its tag from that one. Channel tags (`windows-preview-channel`,
// `macos-rc-channel`) name a moving pointer, never a build, so provenance must
// refuse them — otherwise a rerun could stamp a channel as a source of truth.
const RELEASE_TAG =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-rc\.[1-9]\d*)?(-windows-preview)?$/;

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function buildUpdaterProvenance(fileContents, sourceSha, tag) {
  invariant(/^[0-9a-f]{40}$/.test(sourceSha), 'Source SHA must be 40 lowercase hex characters');
  invariant(RELEASE_TAG.test(tag), `Release tag is invalid: ${tag}`);
  const names = Object.keys(fileContents).sort();
  invariant(names.length > 0, 'No updater files were provided');
  const files = Object.fromEntries(
    names.map((name) => {
      invariant(basename(name) === name, `Unsafe updater filename: ${name}`);
      return [name, createHash('sha256').update(fileContents[name]).digest('hex')];
    }),
  );
  return Object.freeze({ source_sha: sourceSha, tag, files });
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    invariant(key?.startsWith('--') && value !== undefined, 'Invalid CLI arguments');
    values[key.slice(2)] = value;
  }
  for (const key of ['artifact-dir', 'sha', 'tag']) {
    invariant(values[key], `Missing --${key}`);
  }
  return values;
}

async function runCli() {
  const args = parseArgs(process.argv.slice(2));
  const directory = resolve(args['artifact-dir']);
  const entries = await readdir(directory, { withFileTypes: true });
  invariant(
    entries.every((entry) => entry.isFile()),
    'Updater artifact directory may contain files only',
  );
  invariant(
    entries.every((entry) => entry.name !== 'provenance.json'),
    'Refusing to overwrite existing provenance.json',
  );
  const fileContents = Object.fromEntries(
    await Promise.all(
      entries.map(async (entry) => [entry.name, await readFile(resolve(directory, entry.name))]),
    ),
  );
  const provenance = buildUpdaterProvenance(fileContents, args.sha, args.tag);
  await writeFile(
    resolve(directory, 'provenance.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
    { flag: 'wx' },
  );
  console.log(`Created provenance for ${Object.keys(fileContents).length} files`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
