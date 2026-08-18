import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** One temp dir stands in for `userData` for the whole file. */
const USER_DATA = mkdtempSync(join(tmpdir(), 'deck-themes-'));

/** What the next `showOpenDialog` answers with — set per test. */
let dialogResult: { canceled: boolean; filePaths: string[] } = {
  canceled: true,
  filePaths: [],
};

vi.mock('electron', () => ({
  app: { getPath: () => USER_DATA },
  BrowserWindow: {},
  dialog: { showOpenDialog: async () => dialogResult },
  shell: { openPath: async () => '' },
}));

import { importThemes, isThemeFileName, listThemes, themesDir, uniqueName } from './themes';

/** Sources the picker points at, outside the themes folder. */
const SOURCES = mkdtempSync(join(tmpdir(), 'deck-theme-src-'));

beforeEach(() => {
  dialogResult = { canceled: true, filePaths: [] };
});

afterEach(() => {
  rmSync(themesDir(), { recursive: true, force: true });
  rmSync(SOURCES, { recursive: true, force: true });
  mkdirSync(SOURCES, { recursive: true });
});

function writeTheme(fileName: string, body: string): void {
  mkdirSync(themesDir(), { recursive: true });
  writeFileSync(join(themesDir(), fileName), body);
}

/** Write a file the picker will point at, and return its absolute path. */
function writeSource(fileName: string, body: string): string {
  mkdirSync(SOURCES, { recursive: true });
  const path = join(SOURCES, fileName);
  writeFileSync(path, body);
  return path;
}

describe('listThemes', () => {
  it('creates the folder on first read and returns nothing', async () => {
    // "Reveal folder" is the documented way to remove a theme, so the folder
    // has to exist before anything has ever been imported.
    expect(await listThemes()).toEqual({ entries: [], rejected: [] });
  });

  it('returns file text, not parsed themes', async () => {
    writeTheme('dracula.json', '{"name":"Dracula"}');

    expect(await listThemes()).toEqual({
      entries: [{ fileName: 'dracula.json', content: '{"name":"Dracula"}' }],
      rejected: [],
    });
  });

  it('reads an extensionless Ghostty theme', async () => {
    // Ghostty's whole collection ships without extensions. A rule that demanded
    // one would make a supported format unreachable through the folder.
    writeTheme('purple-disco', 'background = #100e17');

    expect((await listThemes()).entries.map((entry) => entry.fileName)).toEqual(['purple-disco']);
  });

  it('skips dotfiles, subdirectories and unknown extensions', async () => {
    writeTheme('keep.toml', '[colors]');
    writeTheme('.DS_Store', 'junk');
    writeTheme('notes.md', 'junk');
    mkdirSync(join(themesDir(), 'nested'), { recursive: true });

    const scan = await listThemes();

    expect(scan.entries.map((entry) => entry.fileName)).toEqual(['keep.toml']);
    // `nested` has no extension, so it reaches the reader and is refused there
    // — with a reason, not in silence.
    expect(scan.rejected).toEqual([{ fileName: 'nested', reason: 'not a file' }]);
  });

  it('reports an oversized file in the folder instead of hiding it', async () => {
    // DL-24.6: a file the user believes is a theme cannot disappear. Silence
    // here reads as "the import never happened".
    writeTheme('huge.json', 'x'.repeat(512 * 1024 + 1));

    const scan = await listThemes();

    expect(scan.entries).toEqual([]);
    expect(scan.rejected).toEqual([
      {
        fileName: 'huge.json',
        reason: 'too large to be a theme (over 512 KB)',
      },
    ]);
  });

  it('sorts by name so the gallery order is stable across scans', async () => {
    writeTheme('beta.json', '{}');
    writeTheme('alpha.json', '{}');

    expect((await listThemes()).entries.map((entry) => entry.fileName)).toEqual([
      'alpha.json',
      'beta.json',
    ]);
  });
});

describe('importThemes', () => {
  it('copies the picked files in and returns the folder', async () => {
    const source = writeSource('orange.json', '{"name":"Orange"}');
    dialogResult = { canceled: false, filePaths: [source] };

    const scan = await importThemes(null);

    expect(scan.entries).toEqual([{ fileName: 'orange.json', content: '{"name":"Orange"}' }]);
    expect(scan.rejected).toEqual([]);
  });

  it('leaves the folder alone when the picker is cancelled', async () => {
    writeTheme('existing.json', '{}');

    const scan = await importThemes(null);

    expect(scan.entries.map((entry) => entry.fileName)).toEqual(['existing.json']);
  });

  it('refuses a wrong file type before copying, and says so', async () => {
    // The picker offers "All files" (Ghostty themes have no extension), so a
    // `.png` is one misclick away. Copying it in and letting the folder scan
    // filter it out afterwards is the silent drop DL-24.6 forbids: the file
    // would sit in userData forever with no card and no row.
    const source = writeSource('screenshot.png', 'not a theme');
    dialogResult = { canceled: false, filePaths: [source] };

    const scan = await importThemes(null);

    expect(scan.entries).toEqual([]);
    expect(scan.rejected).toEqual([
      { fileName: 'screenshot.png', reason: '.png is not a theme file' },
    ]);
    expect(readdirSync(themesDir())).toEqual([]);
  });

  it('refuses an oversized file before copying it into userData', async () => {
    const source = writeSource('huge.json', 'x'.repeat(512 * 1024 + 1));
    dialogResult = { canceled: false, filePaths: [source] };

    const scan = await importThemes(null);

    expect(scan.rejected).toEqual([
      {
        fileName: 'huge.json',
        reason: 'too large to be a theme (over 512 KB)',
      },
    ]);
    expect(readdirSync(themesDir())).toEqual([]);
  });

  it('refuses a source that vanished between the pick and the copy', async () => {
    dialogResult = {
      canceled: false,
      filePaths: [join(SOURCES, 'gone.json')],
    };

    const scan = await importThemes(null);

    expect(scan.rejected).toEqual([
      { fileName: 'gone.json', reason: 'the file could not be read' },
    ]);
  });

  it('costs one bad file its own import, never the good ones beside it', async () => {
    const good = writeSource('orange.json', '{"name":"Orange"}');
    const bad = writeSource('screenshot.png', 'not a theme');
    dialogResult = { canceled: false, filePaths: [bad, good] };

    const scan = await importThemes(null);

    expect(scan.entries.map((entry) => entry.fileName)).toEqual(['orange.json']);
    expect(scan.rejected.map((entry) => entry.fileName)).toEqual(['screenshot.png']);
  });

  it('suffixes rather than overwriting a theme already in the folder', async () => {
    writeTheme('orange.json', '{"name":"Mine"}');
    const source = writeSource('orange.json', '{"name":"Theirs"}');
    dialogResult = { canceled: false, filePaths: [source] };

    const scan = await importThemes(null);

    expect(scan.entries.map((entry) => entry.fileName)).toEqual(['orange-2.json', 'orange.json']);
    // The hand-edited original is untouched — there is no undo anywhere here.
    expect(readFileSync(join(themesDir(), 'orange.json'), 'utf8')).toBe('{"name":"Mine"}');
  });
});

describe('uniqueName', () => {
  it('keeps a free name', () => {
    expect(uniqueName('dracula.json', new Set())).toBe('dracula.json');
  });

  it('suffixes past a run of taken names', () => {
    const taken = new Set(['dracula.json', 'dracula-2.json']);
    expect(uniqueName('dracula.json', taken)).toBe('dracula-3.json');
  });

  it('suffixes an extensionless Ghostty file', () => {
    expect(uniqueName('purple-disco', new Set(['purple-disco']))).toBe('purple-disco-2');
  });
});

describe('isThemeFileName', () => {
  it.each([
    ['dracula.json', true],
    ['purple-disco', true],
    ['preset.itermcolors', true],
    ['screenshot.png', false],
    ['notes.md', false],
    ['.DS_Store', false],
  ])('reads %s as %s', (fileName, expected) => {
    expect(isThemeFileName(fileName)).toBe(expected);
  });
});

describe('the extension allowlist', () => {
  it("matches the renderer's, which parses what this module reads", () => {
    // The two lists are separate because sharing one would drag the renderer's
    // parser chain (and `@xterm/xterm` types) into the main-process tsconfig.
    // This is the guard that makes the duplication safe.
    const main = extract(readFileSync('electron/themes.ts', 'utf8'), 'THEME_EXTENSIONS');
    const renderer = extract(
      readFileSync('src/settings/theme-formats/parse-theme-file.ts', 'utf8'),
      'THEME_FILE_EXTENSIONS',
    );

    expect(main.length).toBeGreaterThan(0);
    expect(main).toEqual(renderer);
  });
});

/** Read the string literals out of a `const NAME = [...] as const` array. */
function extract(source: string, name: string): string[] {
  const start = source.indexOf(`${name} = [`);
  const end = source.indexOf(']', start);
  if (start === -1 || end === -1) {
    return [];
  }
  return [...source.slice(start, end).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}
