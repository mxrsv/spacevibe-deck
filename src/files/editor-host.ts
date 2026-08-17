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
import { resolveTheme } from "../settings/themes";
import { deriveChromeColors } from "../lib/derive-colors";

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
  const cut = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const name = cut === -1 ? filePath : filePath.slice(cut + 1);
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

/**
 * Deck's palette as a Monaco theme.
 *
 * Built from the SAME `resolveTheme` / `deriveChromeColors` pair the terminals
 * and the chrome use (spec §4.4), so the editor is not a differently-themed
 * rectangle sitting in the middle of the app. The defaults mirror `app.tsx`'s,
 * which is where the same fallbacks are applied to the CSS custom properties.
 */
export function monacoThemeFor(settings: Settings): MonacoThemeData {
  const theme = resolveTheme(settings);
  const background = theme.background ?? "#16161e";
  const foreground = theme.foreground ?? "#cbcbcb";
  const chrome = deriveChromeColors(background, foreground);
  const red = theme.red ?? "#f7768e";
  const green = theme.green ?? "#9ece6a";
  const yellow = theme.yellow ?? "#e0af68";
  const magenta = theme.magenta ?? "#bb9af7";
  const cyan = theme.cyan ?? "#7dcfff";
  const accent = theme.blue ?? "#7aa2f7";
  return {
    // `--tone` is white on a dark theme and black on a light one — the same
    // question Monaco's base asks, already answered once.
    base: chrome.tone === "#ffffff" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: bare(chrome.textPrimary) },
      {
        token: "comment",
        foreground: bare(chrome.textFaint),
        fontStyle: "italic",
      },
      { token: "string", foreground: bare(green) },
      { token: "number", foreground: bare(yellow) },
      { token: "keyword", foreground: bare(magenta) },
      { token: "type", foreground: bare(cyan) },
      { token: "type.identifier", foreground: bare(cyan) },
      { token: "delimiter", foreground: bare(chrome.textMuted) },
      { token: "tag", foreground: bare(red) },
      { token: "attribute.name", foreground: bare(accent) },
      { token: "attribute.value", foreground: bare(green) },
      { token: "regexp", foreground: bare(red) },
      { token: "variable", foreground: bare(chrome.textPrimary) },
      { token: "variable.predefined", foreground: bare(accent) },
      { token: "invalid", foreground: bare(red) },
    ],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorCursor.foreground": theme.cursor ?? foreground,
      "editor.selectionBackground":
        theme.selectionBackground ?? chrome.tabActiveBg,
      "editor.lineHighlightBackground": chrome.chrome1,
      "editorLineNumber.foreground": chrome.textFaint,
      "editorLineNumber.activeForeground": chrome.textMuted,
      "editorIndentGuide.background1": chrome.chrome2,
      "editorWhitespace.foreground": chrome.chrome2,
      "editorGutter.background": background,
      "editorWidget.background": chrome.chrome1,
      "editorWidget.border": chrome.chrome2,
      "input.background": chrome.inputBg,
      "scrollbarSlider.background": chrome.chrome2,
      "scrollbarSlider.hoverBackground": chrome.tabActiveBg,
      "scrollbarSlider.activeBackground": chrome.tabActiveBg,
      // DL-1.3: no shadows anywhere. Monaco draws one under its scroll edge by
      // default, and a fully transparent value is how it is turned off.
      "scrollbar.shadow": "#00000000",
    },
  };
}

let loading: Promise<MonacoApi> | null = null;

/** Whether Monaco is already in memory — the panel uses it to decide whether
 * opening a file is instant or has a chunk to fetch first. */
export function isMonacoLoaded(): boolean {
  return loading !== null;
}

/**
 * Load Monaco once, with exactly the enumerated languages.
 *
 * The promise is cached, so a second file tab does not race a second import;
 * a FAILED load is not cached, so a transient chunk-fetch failure does not
 * poison every later attempt — the failure mode Gate M exists to catch is a
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
    // silent packaging failures in the MVP, which is why Gate M runs against a
    // packaged build and not `electron:dev`.
    const { default: EditorWorker } =
      await import("monaco-editor/editor/editor.worker?worker");
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

/** Reset the cached loader. Tests only. */
export function resetMonacoLoaderForTests(): void {
  loading = null;
}
