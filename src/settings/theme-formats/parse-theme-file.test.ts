import { describe, expect, it } from 'vitest';
import { labelFromFileName, parseThemeFile, themeIdForFile } from './parse-theme-file';

/** A Windows Terminal scheme as windowsterminalthemes.dev exports one. */
const WINDOWS_TERMINAL = JSON.stringify({
  name: 'Orange Mechanic',
  background: '#101014',
  foreground: '#E8E3D8',
  cursorColor: '#FFB454',
  selectionBackground: '#3A3A24',
  black: '#101014',
  red: '#FF6666',
  green: '#A6CC70',
  yellow: '#FFB454',
  blue: '#5CCFE6',
  purple: '#D4BFFF',
  cyan: '#95E6CB',
  white: '#C7C7C7',
  brightBlack: '#686868',
  brightRed: '#FF7B7B',
  brightGreen: '#BAE67E',
  brightYellow: '#FFD173',
  brightBlue: '#73D0FF',
  brightPurple: '#DFBFFF',
  brightCyan: '#95E6CB',
  brightWhite: '#FFFFFF',
});

const ITERMCOLORS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Ansi 4 Color</key>
  <dict>
    <key>Alpha Component</key><real>1</real>
    <key>Blue Component</key><real>1</real>
    <key>Color Space</key><string>sRGB</string>
    <key>Green Component</key><real>0</real>
    <key>Red Component</key><real>0</real>
  </dict>
  <key>Background Color</key>
  <dict>
    <key>Blue Component</key><real>0</real>
    <key>Green Component</key><real>0</real>
    <key>Red Component</key><real>0</real>
  </dict>
  <key>Foreground Color</key>
  <dict>
    <key>Blue Component</key><real>1</real>
    <key>Green Component</key><real>1</real>
    <key>Red Component</key><real>1</real>
  </dict>
  <key>Badge Color</key>
  <dict>
    <key>Blue Component</key><real>0.5</real>
    <key>Green Component</key><real>0.5</real>
    <key>Red Component</key><real>0.5</real>
  </dict>
</dict>
</plist>`;

const GHOSTTY = `# Purple Disco
palette = 0=#100e17
palette = 5=#bb9af7
background = 100e17
foreground = #e0def4
cursor-color = #bb9af7
selection-background = #2a273f
`;

const ALACRITTY = `# Blue Powder
[colors.primary]
background = "#0d1117"  # the stage
foreground = "0xc9d1d9"

[colors.normal]
blue = "#58a6ff"

[colors.selection]
background = "#1f6feb"

[font]
size = 13
`;

describe('parseThemeFile — Windows Terminal', () => {
  const { id, result } = parseThemeFile('orange.json', WINDOWS_TERMINAL);

  it("takes the file's own name over the filename", () => {
    expect(id).toBe('file:orange.json');
    expect(result.ok && result.label).toBe('Orange Mechanic');
  });

  it('renames purple to the ANSI 5 slot xterm knows', () => {
    // `purple`/`brightPurple` is Microsoft's naming; leaving it unmapped
    // silently drops magenta from every imported scheme.
    expect(result.ok && result.colors.magenta).toBe('#d4bfff');
    expect(result.ok && result.colors.brightMagenta).toBe('#dfbfff');
  });

  it('normalizes every colour to lowercase #rrggbb', () => {
    expect(result.ok && result.colors.background).toBe('#101014');
    expect(result.ok && result.colors.foreground).toBe('#e8e3d8');
    expect(result.ok && result.colors.cursor).toBe('#ffb454');
  });

  it('unwraps a settings.json holding a schemes array', () => {
    const wrapped = JSON.stringify({
      profiles: { list: [] },
      schemes: [JSON.parse(WINDOWS_TERMINAL)],
    });
    const parsed = parseThemeFile('settings.json', wrapped);
    expect(parsed.result.ok && parsed.result.label).toBe('Orange Mechanic');
  });
});

describe('parseThemeFile — iTerm2', () => {
  const { result } = parseThemeFile('tokyo-night_storm.itermcolors', ITERMCOLORS);

  it('converts unit floats and maps Ansi N onto the palette', () => {
    expect(result.ok && result.colors.background).toBe('#000000');
    expect(result.ok && result.colors.foreground).toBe('#ffffff');
    expect(result.ok && result.colors.blue).toBe('#0000ff');
  });

  it('names the theme after the file, which carries no name', () => {
    expect(result.ok && result.label).toBe('Tokyo Night Storm');
  });

  it('ignores slots the app has no place for', () => {
    // `Badge Color` is a real iTerm2 slot with no terminal-theme equivalent.
    expect(result.ok && Object.values(result.colors)).not.toContain('#808080');
  });
});

describe('parseThemeFile — Ghostty', () => {
  const { result } = parseThemeFile('purple-disco', GHOSTTY);

  it('reads indexed palette entries and hash-less values', () => {
    expect(result.ok && result.colors.black).toBe('#100e17');
    expect(result.ok && result.colors.magenta).toBe('#bb9af7');
    expect(result.ok && result.colors.background).toBe('#100e17');
  });

  it('keeps values whose colour starts with the comment character', () => {
    // Treating any `#` as a comment marker drops every hashed colour in the
    // file and leaves a theme that parses to nothing.
    expect(result.ok && result.colors.foreground).toBe('#e0def4');
    expect(result.ok && result.colors.selectionBackground).toBe('#2a273f');
  });
});

describe('parseThemeFile — Alacritty', () => {
  const { result } = parseThemeFile('blue-powder.toml', ALACRITTY);

  it('reads the colours out of their tables', () => {
    expect(result.ok && result.colors.background).toBe('#0d1117');
    expect(result.ok && result.colors.foreground).toBe('#c9d1d9');
    expect(result.ok && result.colors.blue).toBe('#58a6ff');
  });

  it('distinguishes selection background from primary background', () => {
    expect(result.ok && result.colors.selectionBackground).toBe('#1f6feb');
  });

  it('ignores tables that are not colours', () => {
    expect(result.ok).toBe(true);
  });
});

describe('parseThemeFile — what it refuses and what it fills in', () => {
  it('rejects a valid theme whose chrome text cannot meet DL-3.5', () => {
    const { result } = parseThemeFile(
      'mid-gray.json',
      JSON.stringify({
        name: 'Mid Gray',
        background: '#777777',
        // 4.69:1 clears terminal text, while the derived chrome cannot reach
        // DL-3.5's stricter 8/6/4.5 ladder on this middle-luminance base.
        foreground: '#000000',
      }),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('DL-3.5');
  });

  it.each(['#000000', '#ffffff'])(
    'rejects an imported theme with invisible %s terminal text',
    (colour) => {
      const result = parseThemeFile(
        'invisible.json',
        JSON.stringify({ background: colour, foreground: colour }),
      ).result;

      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toContain('terminal foreground');
    },
  );

  it('rejects an explicitly invisible cursor', () => {
    const result = parseThemeFile(
      'cursor.json',
      JSON.stringify({
        background: '#000000',
        foreground: '#ffffff',
        cursorColor: '#000000',
      }),
    ).result;

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('terminal cursor');
  });

  it('rejects a file with no background and foreground', () => {
    const { result } = parseThemeFile(
      'half.json',
      JSON.stringify({ name: 'Half', background: '#000000' }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('background and foreground');
  });

  it('rejects an empty file', () => {
    expect(parseThemeFile('blank.json', '   ').result.ok).toBe(false);
  });

  it('rejects a file in no supported format', () => {
    const { result } = parseThemeFile('notes.txt', 'just some prose');
    expect(!result.ok && result.reason).toContain('Windows Terminal');
  });

  it('falls back for cursor and selection rather than refusing', () => {
    const { result } = parseThemeFile(
      'bare.json',
      JSON.stringify({ background: '#000000', foreground: '#ffffff' }),
    );
    expect(result.ok && result.colors.cursor).toBe('#ffffff');
    expect(result.ok && result.colors.selectionBackground).toBe('#ffffff');
  });

  it('parses a scheme saved with the wrong extension', () => {
    // Ghostty files are extensionless and half the schemes in circulation are
    // `.txt`, so the extension is a hint and never the decision.
    const { result } = parseThemeFile('orange.conf', WINDOWS_TERMINAL);
    expect(result.ok && result.colors.background).toBe('#101014');
  });
});

describe('identity helpers', () => {
  it('namespaces file ids so they cannot collide with a built-in', () => {
    expect(themeIdForFile('dracula.json')).toBe('file:dracula.json');
  });

  it.each([
    ['tokyo-night_storm.itermcolors', 'Tokyo Night Storm'],
    ['blue powder.toml', 'Blue Powder'],
    ['purple-disco', 'Purple Disco'],
  ])('titles %s as %s', (fileName, expected) => {
    expect(labelFromFileName(fileName)).toBe(expected);
  });
});
