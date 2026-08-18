/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../settings/settings-schema';
import { DECK_THEME_ID, EDITOR_LANGUAGES, languageForPath, monacoThemeFor } from './editor-host';

describe('the enumerated language set', () => {
  it('imports exactly the languages it enumerates, and no language SERVICES', () => {
    // Spec §9 forbids "all of them". The `register.js` imports ARE the
    // enumeration, so they are checked against the table rather than trusted —
    // the two drifting apart is silent otherwise.
    const source = readFileSync('src/files/editor-host.ts', 'utf8');
    const imported = new Set(
      [...source.matchAll(/languages\/definitions\/([\w-]+)\/register\.js/g)].map(
        (match) => match[1],
      ),
    );
    const declared = new Set(EDITOR_LANGUAGES.map((language) => language.id));
    // `.json` rides the JavaScript tokenizer, so every declared id must be
    // imported, and nothing may be imported that is not declared.
    for (const id of declared) {
      expect(imported.has(id)).toBe(true);
    }
    for (const id of imported) {
      expect(declared.has(id)).toBe(true);
    }
    // Checked on the IMPORT specifiers, not the whole text: the header comment
    // names both of these as the things it exists to keep out.
    const specifiers = [...source.matchAll(/import\("([^"]+)"\)/g)].map((match) => match[1]);
    // The TypeScript language service alone is 12 MB of the package.
    expect(specifiers.filter((specifier) => specifier.includes('languages/features/'))).toEqual([]);
    // The catch-all contribution registers 80+ languages in one import.
    expect(specifiers.filter((specifier) => specifier.includes('monaco.contribution'))).toEqual([]);
  });

  it('keeps every Monaco import inside the lazy loader', () => {
    // Anything Monaco-shaped at module scope lands in the entry chunk, and
    // startup is unchanged only for a user who never opens a file (spec §9).
    const source = readFileSync('src/files/editor-host.ts', 'utf8');
    const staticImports = [...source.matchAll(/^import\s[^(]*from\s+"([^"]+)"/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier.startsWith('monaco-editor'));
    expect(staticImports).toEqual([]);
  });
});

describe('languageForPath', () => {
  it('resolves the common cases by extension', () => {
    expect(languageForPath('/r/src/index.ts')).toBe('typescript');
    expect(languageForPath('/r/src/app.tsx')).toBe('typescript');
    expect(languageForPath('/r/main.rs')).toBe('rust');
    expect(languageForPath('/r/readme.md')).toBe('markdown');
    expect(languageForPath('/r/deploy.yml')).toBe('yaml');
    expect(languageForPath('/r/Cargo.toml')).toBe('ini');
  });

  it('routes JSON through the JavaScript tokenizer', () => {
    expect(languageForPath('/r/package.json')).toBe('javascript');
  });

  it('prefers an exact filename over an extension', () => {
    expect(languageForPath('/r/Dockerfile')).toBe('dockerfile');
    expect(languageForPath('/r/Dockerfile.dev')).toBe('dockerfile');
    expect(languageForPath('/r/Gemfile')).toBe('ruby');
  });

  it('matches extensions case-insensitively', () => {
    expect(languageForPath('/r/READ.MD')).toBe('markdown');
    expect(languageForPath('/r/DATA.JSON')).toBe('javascript');
  });

  it('returns null for anything unlisted, which opens as plain text', () => {
    expect(languageForPath('/r/notes.wat')).toBeNull();
    expect(languageForPath('/r/LICENSE')).toBeNull();
  });

  it('reads the leaf, not the directory', () => {
    expect(languageForPath('/r/rust/notes.wat')).toBeNull();
    expect(languageForPath('C:\\r\\src\\index.ts')).toBe('typescript');
  });
});

describe('monacoThemeFor', () => {
  it('is built from the same palette as the terminals and the chrome', () => {
    const theme = monacoThemeFor(DEFAULT_SETTINGS);
    expect(theme.base).toBe('vs-dark');
    expect(theme.colors['editor.background']).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.colors['editor.foreground']).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('writes token colors WITHOUT a leading hash and colors WITH one', () => {
    // Monaco silently ignores a token rule whose foreground carries a `#`.
    const theme = monacoThemeFor(DEFAULT_SETTINGS);
    for (const rule of theme.rules) {
      if (rule.foreground !== undefined) {
        expect(rule.foreground).toMatch(/^[0-9a-f]{6}$/i);
      }
    }
    for (const [key, value] of Object.entries(theme.colors)) {
      expect(value, key).toMatch(/^#[0-9a-f]{6,8}$/i);
    }
  });

  it("follows a light theme's base", () => {
    const light = monacoThemeFor({
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: '#ffffff', foreground: '#1a1a1a' },
    });
    expect(light.base).toBe('vs');
  });

  it("follows a user's color overrides", () => {
    const custom = monacoThemeFor({
      ...DEFAULT_SETTINGS,
      colorOverrides: { background: '#101010' },
    });
    expect(custom.colors['editor.background']).toBe('#101010');
  });

  it("turns Monaco's scroll shadow off — DL-1.3 allows no shadows", () => {
    expect(monacoThemeFor(DEFAULT_SETTINGS).colors['scrollbar.shadow']).toBe('#00000000');
  });

  it('names one theme id, so re-defining it replaces rather than accumulates', () => {
    expect(DECK_THEME_ID).toBe('deck');
  });
});
