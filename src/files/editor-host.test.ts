/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { deriveChromeColors } from "../lib/derive-colors";
import { BUILT_IN_THEMES } from "../settings/built-in-themes";
import type { EditorKey, UiTokenKey } from "../settings/theme-schema";
import { getTheme } from "../settings/themes";
import { DECK_THEME_ID, EDITOR_LANGUAGES, languageForPath, monacoThemeFor } from "./editor-host";

describe("the enumerated language set", () => {
  it("imports exactly the languages it enumerates, and no language SERVICES", () => {
    // Spec §9 forbids "all of them". The `register.js` imports ARE the
    // enumeration, so they are checked against the table rather than trusted —
    // the two drifting apart is silent otherwise.
    const source = readFileSync("src/files/editor-host.ts", "utf8");
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
    expect(specifiers.filter((specifier) => specifier.includes("languages/features/"))).toEqual([]);
    // The catch-all contribution registers 80+ languages in one import.
    expect(specifiers.filter((specifier) => specifier.includes("monaco.contribution"))).toEqual([]);
  });

  it("keeps every Monaco import inside the lazy loader", () => {
    // Anything Monaco-shaped at module scope lands in the entry chunk, and
    // startup is unchanged only for a user who never opens a file (spec §9).
    const source = readFileSync("src/files/editor-host.ts", "utf8");
    const staticImports = [...source.matchAll(/^import\s[^(]*from\s+"([^"]+)"/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier.startsWith("monaco-editor"));
    expect(staticImports).toEqual([]);
  });
});

describe("the codicon font", () => {
  it("is loaded by the lazy loader, so the diff's signs and chevrons draw", () => {
    const source = readFileSync("src/files/editor-host.ts", "utf8");
    const specifiers = [...source.matchAll(/import\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(specifiers).toContain("monaco-editor/features/codicon/register.js");
  });
});

describe("loadMonaco's failures", () => {
  const CODICON = "monaco-editor/features/codicon/register.js";
  const LANGUAGE = "monaco-editor/languages/definitions/typescript/register.js";
  const specifiers = [
    ...readFileSync("src/files/editor-host.ts", "utf8").matchAll(/import\("([^"]+)"\)/g),
  ].map((match) => match[1]);

  /** A fresh `editor-host` whose every Monaco chunk is a stub, and whose
   * `failing` chunk throws on its first `failures` loads. */
  async function loaderWith(failing: string, failures: number) {
    vi.resetModules();
    let left = failures;
    for (const specifier of specifiers) {
      vi.doMock(specifier, () => {
        if (specifier === failing && left > 0) {
          left -= 1;
          throw new Error(`${specifier} did not load`);
        }
        if (specifier.endsWith("?worker")) return { default: class {} };
        return specifier.endsWith("editor.api") ? { stub: "editor.api" } : {};
      });
    }
    return import("./editor-host");
  }

  afterEach(() => {
    for (const specifier of specifiers) vi.doUnmock(specifier);
    vi.resetModules();
    vi.restoreAllMocks();
    delete (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment;
  });

  it("loads the editor without the codicon font, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadMonaco } = await loaderWith(CODICON, 1);
    await expect(loadMonaco()).resolves.toMatchObject({ stub: "editor.api" });
    expect(warn).toHaveBeenCalledWith(
      "Deck: Monaco's codicon font failed to load",
      expect.any(Error),
    );
  });

  it("still fails on any other chunk, and retries it on the next call", async () => {
    const { loadMonaco } = await loaderWith(LANGUAGE, 1);
    await expect(loadMonaco()).rejects.toBeInstanceOf(Error);
    await expect(loadMonaco()).resolves.toMatchObject({ stub: "editor.api" });
  });
});

describe("languageForPath", () => {
  it("resolves the common cases by extension", () => {
    expect(languageForPath("/r/src/index.ts")).toBe("typescript");
    expect(languageForPath("/r/src/app.tsx")).toBe("typescript");
    expect(languageForPath("/r/main.rs")).toBe("rust");
    expect(languageForPath("/r/readme.md")).toBe("markdown");
    expect(languageForPath("/r/deploy.yml")).toBe("yaml");
    expect(languageForPath("/r/Cargo.toml")).toBe("ini");
  });

  it("routes JSON through the JavaScript tokenizer", () => {
    expect(languageForPath("/r/package.json")).toBe("javascript");
  });

  it("prefers an exact filename over an extension", () => {
    expect(languageForPath("/r/Dockerfile")).toBe("dockerfile");
    expect(languageForPath("/r/Dockerfile.dev")).toBe("dockerfile");
    expect(languageForPath("/r/Gemfile")).toBe("ruby");
  });

  it("matches extensions case-insensitively", () => {
    expect(languageForPath("/r/READ.MD")).toBe("markdown");
    expect(languageForPath("/r/DATA.JSON")).toBe("javascript");
  });

  it("returns null for anything unlisted, which opens as plain text", () => {
    expect(languageForPath("/r/notes.wat")).toBeNull();
    expect(languageForPath("/r/LICENSE")).toBeNull();
  });

  it("reads the leaf, not the directory", () => {
    expect(languageForPath("/r/rust/notes.wat")).toBeNull();
    expect(languageForPath("C:\\r\\src\\index.ts")).toBe("typescript");
  });
});

describe("monacoThemeFor", () => {
  it("is built from the same palette as the terminals and the chrome", () => {
    const theme = monacoThemeFor(DEFAULT_SETTINGS);
    expect(theme.base).toBe("vs-dark");
    expect(theme.colors["editor.background"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(theme.colors["editor.foreground"]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("writes token colors WITHOUT a leading hash and colors WITH one", () => {
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
    const light = monacoThemeFor({ ...DEFAULT_SETTINGS, themeId: "deck-light" });
    expect(light.base).toBe("vs");
  });

  // Every Monaco token rule and editor colour, with the theme key it reads.
  const RULES: readonly (readonly [string, EditorKey])[] = [
    ["", "foreground"],
    ["comment", "comment"],
    ["string", "string"],
    ["number", "number"],
    ["keyword", "keyword"],
    ["type", "type"],
    ["type.identifier", "type"],
    ["delimiter", "delimiter"],
    ["tag", "tag"],
    ["attribute.name", "attributeName"],
    ["attribute.value", "attributeValue"],
    ["regexp", "regexp"],
    ["variable", "variable"],
    ["variable.predefined", "variablePredefined"],
    ["invalid", "invalid"],
  ];
  const EDITOR_COLORS: readonly (readonly [string, EditorKey])[] = [
    ["editor.background", "background"],
    ["editor.foreground", "foreground"],
    ["editorCursor.foreground", "cursor"],
    ["editor.selectionBackground", "selection"],
    ["editor.lineHighlightBackground", "lineHighlight"],
    ["editorLineNumber.foreground", "lineNumber"],
    ["editorLineNumber.activeForeground", "lineNumberActive"],
    ["editorIndentGuide.background1", "indentGuide"],
    ["editorWhitespace.foreground", "indentGuide"],
    ["editorGutter.background", "background"],
  ];
  const CHROME_COLORS: readonly (readonly [string, UiTokenKey])[] = [
    ["editorWidget.background", "chrome-1"],
    ["editorWidget.border", "chrome-2"],
    ["input.background", "input-bg"],
    ["scrollbarSlider.background", "chrome-2"],
    ["diffEditor.unchangedRegionBackground", "chrome-1"],
    ["diffEditor.unchangedRegionForeground", "text-muted"],
    ["diffEditor.diagonalFill", "chrome-2"],
    ["diffEditor.border", "chrome-2"],
  ];

  it.each(BUILT_IN_THEMES)("paints the editor from $id's own editor group", (theme) => {
    const monaco = monacoThemeFor({ ...DEFAULT_SETTINGS, themeId: theme.id });
    expect(monaco.base).toBe(theme.type === "dark" ? "vs-dark" : "vs");
    expect(monaco.rules.map((rule) => [rule.token, rule.foreground])).toEqual(
      RULES.map(([token, key]) => [token, theme.editor[key].slice(1)]),
    );
    for (const [name, key] of EDITOR_COLORS) {
      expect(monaco.colors[name], name).toBe(theme.editor[key]);
    }
    for (const [name, key] of CHROME_COLORS) {
      expect(monaco.colors[name], name).toBe(theme.ui[key]);
    }
    const { tabActiveBg } = deriveChromeColors(theme);
    expect(monaco.colors["scrollbarSlider.hoverBackground"]).toBe(tabActiveBg);
    expect(monaco.colors["scrollbarSlider.activeBackground"]).toBe(tabActiveBg);
  });

  it("turns Monaco's scroll shadow off — DL-1.3 allows no shadows", () => {
    expect(monacoThemeFor(DEFAULT_SETTINGS).colors["scrollbar.shadow"]).toBe("#00000000");
  });

  it("washes the diff from the live theme's own green and red, never fixed hex", () => {
    // 12% of 255 is 31 (0x1f), 25% is 64 (0x40).
    for (const themeId of ["deck-dark", "deck-light"]) {
      const settings = { ...DEFAULT_SETTINGS, themeId };
      const { green, red } = getTheme(themeId).ui;
      const colors = monacoThemeFor(settings).colors;
      expect(colors["diffEditor.insertedLineBackground"]).toBe(`${green}1f`.toLowerCase());
      expect(colors["diffEditor.removedLineBackground"]).toBe(`${red}1f`.toLowerCase());
      expect(colors["diffEditor.insertedTextBackground"]).toBe(`${green}40`.toLowerCase());
      expect(colors["diffEditor.removedTextBackground"]).toBe(`${red}40`.toLowerCase());
    }
    const dark = monacoThemeFor({ ...DEFAULT_SETTINGS, themeId: "deck-dark" });
    const light = monacoThemeFor({ ...DEFAULT_SETTINGS, themeId: "deck-light" });
    expect(dark.colors["diffEditor.insertedLineBackground"]).not.toBe(
      light.colors["diffEditor.insertedLineBackground"],
    );
  });

  it("paints each gutter in its own line's colour, at a low alpha", () => {
    const colors = monacoThemeFor(DEFAULT_SETTINGS).colors;
    const hue = (key: string) => colors[key].slice(0, 7);
    const alpha = (key: string) => colors[key].slice(7);
    expect(hue("diffEditorGutter.insertedLineBackground")).toBe(
      hue("diffEditor.insertedLineBackground"),
    );
    expect(hue("diffEditorGutter.removedLineBackground")).toBe(
      hue("diffEditor.removedLineBackground"),
    );
    // Never a solid stripe: well under half opacity.
    expect(parseInt(alpha("diffEditorGutter.insertedLineBackground"), 16)).toBeLessThan(128);
    expect(parseInt(alpha("diffEditorGutter.removedLineBackground"), 16)).toBeLessThan(128);
  });

  it("keeps the folded-run band shadowless — DL-1.3", () => {
    const colors = monacoThemeFor(DEFAULT_SETTINGS).colors;
    expect(colors["diffEditor.unchangedRegionShadow"]).toBe("#00000000");
    expect(colors["diffEditor.unchangedRegionShadow"]).toBe(colors["scrollbar.shadow"]);
  });

  it("names one theme id, so re-defining it replaces rather than accumulates", () => {
    expect(DECK_THEME_ID).toBe("deck");
  });
});
