/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Rollup } from "vite";
import { beforeAll, describe, expect, it } from "vitest";
import { parseRules, type Rule } from "../src/styles/css-weight-sites";

/**
 * The Base UI preset's migration boundary (spec UI-3, migration plan gates G2 and the
 * wave 1 "enforced migration boundary"). The preset is a second styling system next to
 * Deck's chrome: it may be imported by a migrated surface and must change nothing about a
 * surface that does not import it. Nothing shipping imports it yet, so this test builds the
 * way a first importer would (production mode, the repository's own Vite config, one
 * entry that pulls in the stylesheet and every control) and reads what comes out.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = join(ROOT, "src");
const SCRATCH = join(ROOT, "node_modules/.cache/deck-tests");

const posix = (path: string): string => path.split(sep).join("/");

function files(dir: string, test: (name: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path, test);
    return test(entry) ? [path] : [];
  });
}

interface Output {
  readonly js: string;
  readonly css: string;
  readonly moduleIds: readonly string[];
  readonly bytes: { readonly js: number; readonly css: number; readonly fonts: number };
}

async function buildFirstImporter(): Promise<Output> {
  mkdirSync(SCRATCH, { recursive: true });
  const entry = join(SCRATCH, "first-importer.ts");
  writeFileSync(
    entry,
    [
      `import ${JSON.stringify(join(SRC, "ui/preset.css"))};`,
      `import * as controls from ${JSON.stringify(join(SRC, "ui/controls/preset-controls.ts"))};`,
      "(globalThis as Record<string, unknown>).presetControls = controls;",
      "",
    ].join("\n"),
  );
  const result = await build({
    root: ROOT,
    configFile: join(ROOT, "vite.config.ts"),
    logLevel: "silent",
    build: { write: false, rollupOptions: { input: entry } },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (item) => (item as Rollup.RollupOutput).output,
  );
  const chunks = output.filter((file): file is Rollup.OutputChunk => file.type === "chunk");
  const assets = output.filter((file): file is Rollup.OutputAsset => file.type === "asset");
  const size = (file: Rollup.OutputAsset): number => file.source.length;
  const css = assets.find((file) => file.fileName.endsWith(".css"));
  return {
    js: chunks.map((chunk) => chunk.code).join("\n"),
    css: String(css?.source ?? ""),
    moduleIds: chunks.flatMap((chunk) => Object.keys(chunk.modules)),
    bytes: {
      js: chunks.reduce((total, chunk) => total + chunk.code.length, 0),
      css: css === undefined ? 0 : size(css),
      fonts: assets
        .filter((file) => file.fileName.endsWith(".woff2"))
        .reduce((n, a) => n + size(a), 0),
    },
  };
}

let built: Output;
let rules: Rule[];

beforeAll(async () => {
  built = await buildFirstImporter();
  rules = parseRules("preset.css (built)", built.css);
}, 120_000);

describe("G2: the production bundle holds one renderer", () => {
  it("contains no module of real React or react-dom", () => {
    const real = built.moduleIds.filter((id) =>
      /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id),
    );
    expect(real, "Base UI must resolve react to preact/compat in the production build").toEqual([]);
    expect(built.moduleIds.some((id) => id.includes("node_modules/preact/compat/"))).toBe(true);
  });

  it("carries none of React's runtime markers", () => {
    for (const marker of [
      "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
      "react.transitional.element",
    ]) {
      expect(built.js.includes(marker), marker).toBe(false);
    }
  });

  it("emits the font files and a stylesheet next to the script (sizes are recorded in the plan)", () => {
    expect(built.bytes.js).toBeGreaterThan(0);
    expect(built.bytes.css).toBeGreaterThan(0);
    expect(built.bytes.fonts).toBeGreaterThan(0);
  });
});

/** Every stylesheet the app can load: `src/styles/` and the ones that sit beside their component. */
function chromeCssFiles(): string[] {
  return files(SRC, (name) => name.endsWith(".css")).filter((file) => {
    const path = posix(relative(SRC, file));
    return path !== "ui/preset.css" && !path.startsWith("gallery/");
  });
}

/** The controls the barrel exports, as paths under `src/`; the rest of `ui/controls/` is chrome. */
function presetControlFiles(): Set<string> {
  const barrel = readFileSync(join(SRC, "ui/controls/preset-controls.ts"), "utf8");
  return new Set(
    [...barrel.matchAll(/from "\.\/([\w-]+)"/g)].map((m) => `ui/controls/${m[1]}.tsx`),
  );
}

/** Directories under `src/ui/` that preset.css scans whole (`@source "./blocks";`), as `ui/<dir>/`. */
function scannedDirectories(): string[] {
  const css = readFileSync(join(SRC, "ui/preset.css"), "utf8");
  return [...css.matchAll(/^@source "\.\/([\w-]+)";/gm)].map((m) => `ui/${m[1]}/`);
}

/** Custom properties the chrome declares: its stylesheets, and the theme the renderer sets inline. */
function deckCustomProperties(): Set<string> {
  const names = new Set<string>();
  const declared = /(?:^|[;{\s])(--[a-z0-9-]+)\s*:/g;
  for (const file of chromeCssFiles()) {
    for (const match of readFileSync(file, "utf8").matchAll(declared)) names.add(match[1]);
  }
  for (const file of ["lib/theme-vars.ts", "lib/derive-colors.ts"]) {
    for (const match of readFileSync(join(SRC, file), "utf8").matchAll(/"(--[a-z0-9-]+)"/g)) {
      names.add(match[1]);
    }
  }
  return names;
}

/** Plain class names a rule list defines (an escaped utility such as `.md\:flex` is skipped). */
function plainClasses(selectors: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const selector of selectors) {
    for (const match of selector.matchAll(/\.((?:\\.|[\w-])+)/g)) {
      if (!match[1].includes("\\")) names.add(match[1]);
    }
  }
  return names;
}

const insideProperties = (rule: Rule): boolean => rule.wrap.startsWith("@layer properties");

describe("the preset leaks nothing into a surface that does not carry it", () => {
  it("restyles no page root, bare element or universal selector", () => {
    // `:root, :host` carries Tailwind's theme custom properties and nothing else.
    const onlyCustomProperties = (rule: Rule): boolean =>
      rule.declarations.every((d) => d.prop.startsWith("--"));
    const offenders = rules
      .filter((rule) => !insideProperties(rule) && !onlyCustomProperties(rule))
      .flatMap((rule) => rule.selectors)
      .filter((selector) => /^(html|body|#root|\*|:host|[a-z][a-z0-9-]*)(?![\w-])/i.test(selector));
    expect(offenders, "preset rules must hang off .ui-preset or [data-slot]").toEqual([]);
  });

  it("scopes the reset to .ui-preset and the controls' data-slot", () => {
    const reset = rules.filter((rule) =>
      rule.selectors.some((s) => s.startsWith(":is(.ui-preset")),
    );
    expect(reset.length).toBeGreaterThan(0);
    const boxSizing = reset.filter((rule) =>
      rule.declarations.some((d) => d.prop === "box-sizing"),
    );
    expect(boxSizing.length).toBeGreaterThan(0);
    // The only global-looking `*` rule is Tailwind's @property fallback, which declares
    // `--tw-*` custom properties for browsers without @property and nothing else.
    const universal = rules.filter((rule) => rule.selectors.some((s) => /^\*(,|$)/.test(s)));
    for (const rule of universal) {
      expect(insideProperties(rule)).toBe(true);
      expect(rule.declarations.filter((d) => !d.prop.startsWith("--")).map((d) => d.prop)).toEqual(
        [],
      );
    }
  });

  it("keeps :root and .dark to custom properties that Deck does not also declare", () => {
    const deck = deckCustomProperties();
    const tokenRules = rules.filter(
      (rule) => !insideProperties(rule) && rule.selectors.some((s) => /^(:root|\.dark)$/.test(s)),
    );
    expect(tokenRules.length).toBeGreaterThan(0);
    for (const rule of tokenRules) {
      for (const { prop } of rule.declarations) {
        expect(prop.startsWith("--"), `${rule.selectors.join(",")} sets ${prop}`).toBe(true);
      }
    }
    // Every custom property the output declares anywhere, theme layer and fallbacks included.
    const everything = rules.flatMap((rule) => rule.declarations.map((d) => d.prop));
    const clashes = [...new Set(everything.filter((prop) => deck.has(prop)))];
    expect(clashes, "the preset redeclares a custom property the chrome owns").toEqual([]);
    const declared = tokenRules.flatMap((rule) => rule.declarations.map((d) => d.prop));
    expect(declared).toContain("--ui-accent");
    expect(declared).not.toContain("--accent");
  });

  it("emits no utility class that a chrome stylesheet or chrome markup also uses", () => {
    const utilities = plainClasses(rules.flatMap((rule) => rule.selectors));
    const chromeCss = chromeCssFiles().flatMap((file) =>
      parseRules(file, readFileSync(file, "utf8")).flatMap((rule) => rule.selectors),
    );
    const definedByChrome = plainClasses(chromeCss);
    const sharedWithCss = [...utilities].filter((name) => definedByChrome.has(name));
    expect(sharedWithCss, "a chrome rule and a preset utility share a class name").toEqual([]);

    const chromeMarkup = new Set<string>();
    const scanned = scannedDirectories();
    const sources = files(SRC, (name) => /\.tsx$/.test(name) && !name.endsWith(".test.tsx"));
    for (const file of sources) {
      const path = posix(relative(SRC, file));
      // Blocks and migrated regions are composed from the preset controls and scanned by
      // preset.css, like them; the `@source` lines are the list.
      if (path.startsWith("gallery/") || scanned.some((dir) => path.startsWith(dir))) continue;
      if (presetControlFiles().has(path)) continue;
      const text = readFileSync(file, "utf8");
      // A template literal is read up to its first `${`: what follows is code, not class names.
      for (const match of text.matchAll(/\bclass(?:Name)?=(?:\{\s*)?(["'`])([^"'`]*)\1/g)) {
        const literal = match[2].split("${")[0];
        for (const token of literal.split(/\s+/)) chromeMarkup.add(token);
      }
    }
    const sharedWithMarkup = [...utilities].filter((name) => chromeMarkup.has(name));
    expect(sharedWithMarkup, "chrome markup uses a name the preset turns into a utility").toEqual(
      [],
    );
  });

  it("scans exactly the controls the barrel exports, so a chrome control's classes never become utilities", () => {
    const css = readFileSync(join(SRC, "ui/preset.css"), "utf8");
    const listed = css
      .match(/@source "\.\/controls\/\{([^}]*)\}\.tsx"/)?.[1]
      .split(",")
      .sort();
    const barrel = readFileSync(join(SRC, "ui/controls/preset-controls.ts"), "utf8");
    const exported = [...barrel.matchAll(/from "\.\/([\w-]+)"/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(exported);
  });

  it("hands out the font from the local package, never a URL", () => {
    expect(built.css).not.toMatch(/url\(\s*["']?https?:/);
    expect(built.css).toContain("Inter Variable");
  });

  it("keeps the chrome's stylesheets free of the preset's tokens", () => {
    const presetTokens = new Set(
      [
        ...built.css.matchAll(
          /(?:^|[;{\s])(--(?:background|foreground|primary|secondary|muted|card|popover|destructive|border|input|ring|ui-accent))\s*[:)]/g,
        ),
      ].map((m) => m[1]),
    );
    expect(presetTokens.size).toBeGreaterThan(0);
    const usage: string[] = [];
    for (const file of chromeCssFiles()) {
      const text = readFileSync(file, "utf8");
      for (const token of presetTokens) {
        if (new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(text))
          usage.push(`${posix(relative(ROOT, file))} reads ${token}`);
      }
    }
    expect(usage, "chrome CSS must not depend on the preset's tokens (UI-2)").toEqual([]);
  });
});
