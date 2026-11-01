/**
 * Loading Monaco, and making it look like Deck (plan T1).
 *
 * Two binding requirements from spec §9, both visible in this file:
 *
 *  - **Lazily imported on the first file tab.** Nothing Monaco-shaped may sit
 *    in the entry chunk, so app startup and time-to-first-pane are unchanged
 *    for a user who never opens a file. Every `import("monaco-editor/…")` below
 *    is therefore inside `loadMonaco()`, and this module's own static imports
 *    are pure helpers.
 *  - **The language set is explicitly enumerated, not "all of them."** Monaco's
 *    own `basic-languages/monaco.contribution` registers 80+ languages;
 *    importing each `register.js` by name is the enumeration, and it is
 *    deliberately written out rather than looped, because a loop over a list of
 *    strings is not statically analyzable and Vite would then bundle all of
 *    them or none.
 *
 * The language SERVICES (`languages/features/*` — the TypeScript, JSON, CSS and
 * HTML workers) are deliberately NOT imported. They are the megabytes in
 * Monaco, and they buy IntelliSense; the loop this feature serves is "read what
 * the agent changed", which needs tokenization and nothing more.
 */
import type { Settings } from "../settings/settings-schema";
import { activeTheme } from "../settings/themes";
import { deriveChromeColors } from "../lib/derive-colors";
import { baseName } from "../lib/path-name";

/** The subset of Monaco this feature uses. Structural, so nothing here has to
 * import Monaco's types at module scope. */
export type MonacoApi = typeof import("monaco-editor/editor/editor.api");

/** One enumerated language: its Monaco id and what filenames select it. */
export interface EditorLanguage {
  readonly id: string;
  readonly extensions: readonly string[];
  /** Exact filenames, for the ones that carry no extension. */
  readonly filenames?: readonly string[];
}

/**
 * The enumerated set (spec §9).
 *
 * Chosen for what agent CLIs are pointed at, not for completeness. Anything not
 * listed opens as plain text, which is a legible outcome — unlike a bundle that
 * grew by a megabyte to tokenize a language nobody here writes.
 */
export const EDITOR_LANGUAGES: readonly EditorLanguage[] = [
  { id: "typescript", extensions: [".ts", ".tsx", ".mts", ".cts"] },
  // `.json` deliberately rides the JavaScript tokenizer. Monaco 0.56 ships no
  // basic-language definition for JSON — its JSON support is a full language
  // SERVICE with its own worker, which is the class of thing this file exists
  // to keep out. JSON is a subset of JavaScript's object syntax, so strings,
  // numbers, punctuation and structure all tokenize correctly; the only
  // difference is that `//` reads as a comment, which is right for `.jsonc`
  // and harmless for `.json`.
  {
    id: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs", ".json", ".jsonc"],
  },
  { id: "css", extensions: [".css"] },
  { id: "scss", extensions: [".scss"] },
  { id: "less", extensions: [".less"] },
  { id: "html", extensions: [".html", ".htm"] },
  { id: "markdown", extensions: [".md", ".markdown", ".mdx"] },
  { id: "yaml", extensions: [".yaml", ".yml"] },
  { id: "python", extensions: [".py", ".pyi"] },
  { id: "rust", extensions: [".rs"] },
  { id: "go", extensions: [".go"] },
  { id: "java", extensions: [".java"] },
  { id: "kotlin", extensions: [".kt", ".kts"] },
  { id: "swift", extensions: [".swift"] },
  { id: "ruby", extensions: [".rb"], filenames: ["Gemfile", "Rakefile"] },
  { id: "php", extensions: [".php"] },
  { id: "shell", extensions: [".sh", ".bash", ".zsh", ".fish"] },
  { id: "sql", extensions: [".sql"] },
  { id: "xml", extensions: [".xml", ".svg", ".plist"] },
  { id: "ini", extensions: [".ini", ".toml", ".cfg", ".conf", ".properties"] },
  {
    id: "dockerfile",
    extensions: [],
    filenames: ["Dockerfile", "Containerfile"],
  },
  { id: "cpp", extensions: [".c", ".h", ".cc", ".cpp", ".hpp", ".hh"] },
  { id: "csharp", extensions: [".cs"] },
  { id: "lua", extensions: [".lua"] },
  { id: "graphql", extensions: [".graphql", ".gql"] },
  { id: "protobuf", extensions: [".proto"] },
  { id: "hcl", extensions: [".tf", ".tfvars", ".hcl"] },
];

/**
 * The Monaco language id for a path, or null for plain text.
 *
 * Filenames beat extensions: `Dockerfile.dev` is a Dockerfile, and `Gemfile`
 * has no extension at all. The extension match is case-insensitive because
 * `.JSON` and `.MD` both turn up in real repositories.
 */
export function languageForPath(filePath: string): string | null {
  const name = baseName(filePath);
  for (const language of EDITOR_LANGUAGES) {
    if (language.filenames?.some((candidate) => name.startsWith(candidate))) {
      return language.id;
    }
  }
  const lower = name.toLowerCase();
  for (const language of EDITOR_LANGUAGES) {
    if (language.extensions.some((extension) => lower.endsWith(extension))) {
      return language.id;
    }
  }
  return null;
}

/** Monaco's theme id for Deck's derived palette. */
export const DECK_THEME_ID = "deck";

/** Structural shape of Monaco's `IStandaloneThemeData` — declared here so the
 * mapping is unit-testable without loading Monaco. */
export interface MonacoThemeData {
  readonly base: "vs" | "vs-dark";
  readonly inherit: boolean;
  readonly rules: readonly {
    readonly token: string;
    readonly foreground?: string;
    readonly fontStyle?: string;
  }[];
  readonly colors: Readonly<Record<string, string>>;
}

/** Monaco token rules take a hex WITHOUT the leading `#`; its `colors` map
 * takes one WITH it. Getting that backwards is a silently ignored rule. */
function bare(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

/** `#rrggbb` plus an alpha, as the 8-digit hex Monaco's `colors` map parses. */
function withAlpha(color: string, alpha: number): string {
  const digits = color.replace("#", "");
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return `#${full.slice(0, 6)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
}

/** The diff's washes: a line, the changed words inside it, and the gutter beside
 * it. A gutter keeps a low alpha so a hunk's margin reads as its line's colour,
 * never a solid stripe. */
const DIFF_LINE_ALPHA = 0.12;
const DIFF_WORD_ALPHA = 0.25;
const DIFF_GUTTER_ALPHA = 0.25;

/**
 * Deck's palette as a Monaco theme.
 *
 * Read from the active theme's own `editor` group, with the widget frames on
 * its `ui` surfaces and the scroll thumb on the same selection wash the chrome
 * uses, so the editor is not a differently-themed rectangle sitting in the
 * middle of the app.
 */
export function monacoThemeFor(settings: Settings): MonacoThemeData {
  const theme = activeTheme(settings);
  const { editor, ui } = theme;
  const { tabActiveBg } = deriveChromeColors(theme);
  return {
    base: theme.type === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: bare(editor.foreground) },
      {
        token: "comment",
        foreground: bare(editor.comment),
        fontStyle: "italic",
      },
      { token: "string", foreground: bare(editor.string) },
      { token: "number", foreground: bare(editor.number) },
      { token: "keyword", foreground: bare(editor.keyword) },
      { token: "type", foreground: bare(editor.type) },
      { token: "type.identifier", foreground: bare(editor.type) },
      { token: "delimiter", foreground: bare(editor.delimiter) },
      { token: "tag", foreground: bare(editor.tag) },
      { token: "attribute.name", foreground: bare(editor.attributeName) },
      { token: "attribute.value", foreground: bare(editor.attributeValue) },
      { token: "regexp", foreground: bare(editor.regexp) },
      { token: "variable", foreground: bare(editor.variable) },
      { token: "variable.predefined", foreground: bare(editor.variablePredefined) },
      { token: "invalid", foreground: bare(editor.invalid) },
    ],
    colors: {
      "editor.background": editor.background,
      "editor.foreground": editor.foreground,
      "editorCursor.foreground": editor.cursor,
      "editor.selectionBackground": editor.selection,
      "editor.lineHighlightBackground": editor.lineHighlight,
      "editorLineNumber.foreground": editor.lineNumber,
      "editorLineNumber.activeForeground": editor.lineNumberActive,
      "editorIndentGuide.background1": editor.indentGuide,
      "editorWhitespace.foreground": editor.indentGuide,
      "editorGutter.background": editor.background,
      "editorWidget.background": ui["chrome-1"],
      "editorWidget.border": ui["chrome-2"],
      "input.background": ui["input-bg"],
      "scrollbarSlider.background": ui["chrome-2"],
      "scrollbarSlider.hoverBackground": tabActiveBg,
      "scrollbarSlider.activeBackground": tabActiveBg,
      // DL-1.3: no shadows anywhere. Monaco draws one under its scroll edge by
      // default, and a fully transparent value is how it is turned off.
      "scrollbar.shadow": "#00000000",
      // The diff column (DL-3.2): an added line or word on a low green wash and
      // a removed one on a low red wash, from the live theme. Monaco's own
      // defaults are fixed hex that ignores the theme (DL-2.1).
      "diffEditor.insertedLineBackground": withAlpha(ui.green, DIFF_LINE_ALPHA),
      "diffEditor.removedLineBackground": withAlpha(ui.red, DIFF_LINE_ALPHA),
      "diffEditor.insertedTextBackground": withAlpha(ui.green, DIFF_WORD_ALPHA),
      "diffEditor.removedTextBackground": withAlpha(ui.red, DIFF_WORD_ALPHA),
      "diffEditorGutter.insertedLineBackground": withAlpha(ui.green, DIFF_GUTTER_ALPHA),
      "diffEditorGutter.removedLineBackground": withAlpha(ui.red, DIFF_GUTTER_ALPHA),
      // DL-1.3 again: the band over a folded run of unchanged lines blurs a shadow.
      "diffEditor.unchangedRegionShadow": "#00000000",
      "diffEditor.unchangedRegionBackground": ui["chrome-1"],
      "diffEditor.unchangedRegionForeground": ui["text-muted"],
      "diffEditor.diagonalFill": ui["chrome-2"],
      "diffEditor.border": ui["chrome-2"],
    },
  };
}

let loading: Promise<MonacoApi> | null = null;

/**
 * Load Monaco once, with exactly the enumerated languages.
 *
 * The promise is cached, so a second file tab does not race a second import;
 * a FAILED load is not cached, so a transient chunk-fetch failure does not
 * poison every later attempt — the failure mode the packaged Monaco smoke catches is a
 * chunk that 404s under `file://`, and retrying it is the only recovery a
 * running app has.
 */
export function loadMonaco(): Promise<MonacoApi> {
  if (loading !== null) {
    return loading;
  }
  const attempt = (async (): Promise<MonacoApi> => {
    const monaco = await import("monaco-editor/editor/editor.api");
    // Workers resolve through the same `base: "./"` path that produced two
    // silent packaging failures in the MVP, which is why the Monaco smoke runs against a
    // packaged build and not `electron:dev`.
    const { default: EditorWorker } = await import("monaco-editor/editor/editor.worker?worker");
    (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
      getWorker: () => new EditorWorker(),
    };
    // The enumeration, written out. Each `register.js` registers a lazy loader,
    // so a language's tokenizer is only fetched when a file of that kind opens.
    await Promise.all([
      import("monaco-editor/languages/definitions/typescript/register.js"),
      import("monaco-editor/languages/definitions/javascript/register.js"),
      import("monaco-editor/languages/definitions/css/register.js"),
      import("monaco-editor/languages/definitions/scss/register.js"),
      import("monaco-editor/languages/definitions/less/register.js"),
      import("monaco-editor/languages/definitions/html/register.js"),
      import("monaco-editor/languages/definitions/markdown/register.js"),
      import("monaco-editor/languages/definitions/yaml/register.js"),
      import("monaco-editor/languages/definitions/python/register.js"),
      import("monaco-editor/languages/definitions/rust/register.js"),
      import("monaco-editor/languages/definitions/go/register.js"),
      import("monaco-editor/languages/definitions/java/register.js"),
      import("monaco-editor/languages/definitions/kotlin/register.js"),
      import("monaco-editor/languages/definitions/swift/register.js"),
      import("monaco-editor/languages/definitions/ruby/register.js"),
      import("monaco-editor/languages/definitions/php/register.js"),
      import("monaco-editor/languages/definitions/shell/register.js"),
      import("monaco-editor/languages/definitions/sql/register.js"),
      import("monaco-editor/languages/definitions/xml/register.js"),
      import("monaco-editor/languages/definitions/ini/register.js"),
      import("monaco-editor/languages/definitions/dockerfile/register.js"),
      import("monaco-editor/languages/definitions/cpp/register.js"),
      import("monaco-editor/languages/definitions/csharp/register.js"),
      import("monaco-editor/languages/definitions/lua/register.js"),
      import("monaco-editor/languages/definitions/graphql/register.js"),
      import("monaco-editor/languages/definitions/protobuf/register.js"),
      import("monaco-editor/languages/definitions/hcl/register.js"),
      // The codicon font and its `.codicon` rules. Without them the diff's `+` /
      // `−` signs and its unfold chevrons draw no glyph, and the fold and find
      // icons of the file editor stay blank. Blank icons are all a failed load
      // costs, so it warns rather than failing the editor with it.
      import("monaco-editor/features/codicon/register.js").catch((error: unknown) => {
        console.warn("Deck: Monaco's codicon font failed to load", error);
      }),
    ]);
    return monaco;
  })();
  loading = attempt.catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Register (or update) Deck's theme and make it current. */
export function applyMonacoTheme(monaco: MonacoApi, settings: Settings): void {
  monaco.editor.defineTheme(
    DECK_THEME_ID,
    monacoThemeFor(settings) as Parameters<typeof monaco.editor.defineTheme>[1],
  );
  monaco.editor.setTheme(DECK_THEME_ID);
}
