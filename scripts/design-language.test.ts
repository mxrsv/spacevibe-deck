import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `URL.pathname` yields `/C:/…` on Windows, which `readFileSync` cannot open;
// `scripts/gallery-entry.test.ts` learned this first.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RULEBOOK = join(ROOT, "docs/DESIGN-LANGUAGE.md");
const GALLERY_DIRECTION = join(ROOT, "src/gallery/chatgpt-direction.css");
// `src/styles.css` is an `@import` index over `src/styles/*.css` partials
// (2026-08-16 split) — see `readStylesheet()` below.
const STYLESHEET = join(ROOT, "src/styles.css");

/**
 * `src/styles.css` no longer carries any rule blocks itself — it is an
 * `@import` index over contiguous partials in `src/styles/`. Every gate below
 * used to read `STYLESHEET` directly and scan the whole cascade; reading only
 * the index today would scan zero rules and pass every gate vacuously. This
 * reads the index, pulls the `@import` paths out IN ORDER and concatenates
 * the partials — derived from the index rather than a hardcoded partial
 * list, so a new partial cannot silently drop out of the gate.
 */
function readStylesheet(): string {
  const index = readFileSync(STYLESHEET, "utf8");
  const importPaths = [...index.matchAll(/@import\s+["']([^"']+)["'];/g)].map(
    (match) => match[1],
  );
  return importPaths
    .map((path) => readFileSync(resolve(dirname(STYLESHEET), path), "utf8"))
    .join("\n");
}
const SCANNED_DIRS = ["src", "electron", "scripts"];
const SCANNED_EXT = /\.(ts|tsx|css)$/;
const SECTION = /^## (\d+)\. (.+)$/gm;
const RULE = /\*\*DL-(\d+)\.(\d+)\*\*/g;
const CITATION = /DL-(\d+)(?:\.(\d+))?/g;
/**
 * The other spelling this repo uses — `DL §17`, `DESIGN-LANGUAGE §19`. The
 * rulebook prefix is required: a bare `§7` cites a spec, a plan or a review far
 * more often than it cites this document, and there is no way to tell which
 * from the digits. Citing DL by section therefore means naming DL.
 */
const SECTION_CITATION =
  /(?:DL|DESIGN-LANGUAGE(?:\.md)?)\s*§\s*(\d+)(?:\.(\d+))?/g;

/**
 * DL-4.3 bans styled uppercase and artificial tracking on readable copy, with
 * exactly one exception: the pane anchor grip, whose negative tracking pulls
 * two `⋮⋮` glyphs into one grip pattern. That is glyph geometry drawing an
 * icon-like control — there is no word in it to read. Any second entry here is
 * an edit to DL-4.3 first.
 */
const GLYPH_GEOMETRY_SELECTORS = new Set([".pane__anchor-grip"]);
/**
 * DL-4.3's second exception (2026-08-19), kept apart from the grip because it
 * is a different argument: this one IS readable copy, and what excuses it is
 * display SIZE. A 24px 650-weight heading carries the face's 12.5px fitting as
 * visible looseness, so a small negative track is optical correction rather
 * than texture. Bounded to this selector and to negative values; a third entry
 * anywhere is an edit to DL-4.3 first.
 */
const OPTICAL_TRACKING_SELECTORS = new Set([".settings-screen__title"]);
/**
 * DL-20.1's closed radius scale, plus the two shapes it names as shapes rather
 * than scale values (the circle and the capsule) and the square corner. A
 * number picked by feel at a use site is what this list exists to reject: the
 * rule names its roles, and that count is only true if nothing else can be
 * written. Adding an entry here is an edit to DL-20.1 first — which is exactly
 * how `--radius-flat` arrived on 2026-08-17 (owner), for controls packed into
 * a dense row.
 */
const RADIUS_VALUES = new Set([
  "var(--radius-flat)",
  "var(--radius-tight)",
  "var(--radius-control)",
  "var(--radius-surface)",
  "50%",
  "999px",
  "0",
]);
const RADIUS_DECLARATION = /^border-radius\s*:\s*(.+)$/;

/** One rule block: everything before its `{`, and its declarations. */
const CSS_BLOCK = /([^{}]+)\{([^{}]*)\}/g;
const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const STYLED_UPPERCASE = /^text-transform\s*:\s*uppercase$/;
const TEXT_TRACKING = /^letter-spacing\s*:/;
const NEGATIVE_TRACKING = /^letter-spacing\s*:\s*-/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") return [];
    // The gate's own regex literals are not citations.
    if (entry === "design-language.test.ts") return [];
    if (statSync(path).isDirectory()) return walk(path);
    return SCANNED_EXT.test(entry) ? [path] : [];
  });
}

function declared(): { sections: Set<string>; rules: Set<string> } {
  const text = readFileSync(RULEBOOK, "utf8");
  const sections = new Set<string>();
  for (const match of text.matchAll(SECTION)) sections.add(match[1]);
  const rules = new Set<string>();
  for (const match of text.matchAll(RULE)) rules.add(`${match[1]}.${match[2]}`);
  return { sections, rules };
}

/**
 * Every `selector: declaration;` in the shipping stylesheet that styles casing
 * or tracking outside the glyph-geometry allowlist. Comments are stripped
 * first: the file quotes `text-transform: uppercase` as prose while explaining
 * why a rule no longer carries it, and prose is not a declaration.
 *
 * The block regex reads flat rules only, which is what this stylesheet has (no
 * CSS nesting). An at-rule's own prelude never matches — its body contains
 * `{`, so the scan resumes inside it and reports the nested selector instead,
 * which is the one that owns the declaration.
 */
function styledCasingViolations(): string[] {
  const css = readStylesheet().replace(CSS_COMMENT, "");
  const violations: string[] = [];
  for (const [, prelude, body] of css.matchAll(CSS_BLOCK)) {
    const selector = prelude.trim().replace(/\s+/g, " ");
    if (GLYPH_GEOMETRY_SELECTORS.has(selector)) continue;
    for (const raw of body.split(";")) {
      const declaration = raw.trim().replace(/\s+/g, " ");
      if (!declaration) continue;
      if (
        OPTICAL_TRACKING_SELECTORS.has(selector) &&
        NEGATIVE_TRACKING.test(declaration)
      ) {
        continue;
      }
      if (
        STYLED_UPPERCASE.test(declaration) ||
        TEXT_TRACKING.test(declaration)
      ) {
        violations.push(`${selector}: ${declaration};`);
      }
    }
  }
  return violations;
}

describe("design-language typography policy", () => {
  it("rejects styled uppercase and text tracking", () => {
    expect(styledCasingViolations()).toEqual([]);
  });
});

/**
 * Every `border-radius` in the shipping stylesheet whose value is outside
 * DL-20.1's scale. Reads the same stripped-comment blocks as the casing scan
 * above, for the same reason: the file explains the scale in prose that quotes
 * its own numbers.
 */
function offScaleRadii(): string[] {
  const css = readStylesheet().replace(CSS_COMMENT, "");
  const violations: string[] = [];
  for (const [, prelude, body] of css.matchAll(CSS_BLOCK)) {
    const selector = prelude.trim().replace(/\s+/g, " ");
    for (const raw of body.split(";")) {
      const declaration = raw.trim().replace(/\s+/g, " ");
      const value = declaration.match(RADIUS_DECLARATION)?.[1];
      if (value && !RADIUS_VALUES.has(value)) {
        violations.push(`${selector}: border-radius: ${value};`);
      }
    }
  }
  return violations;
}

describe("design-language radius scale", () => {
  it("declares the DL-20.1 roles at 2/8/10/12", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    for (const [name, size] of Object.entries({
      // The dense-row role, added 2026-08-17 with the tab strip's turn text.
      "--radius-flat": "2px",
      "--radius-tight": "8px",
      "--radius-control": "10px",
      "--radius-surface": "12px",
    })) {
      const declarations = [...css.matchAll(new RegExp(`${name}\\s*:`, "g"))];
      expect(
        declarations.length,
        `${name} should be declared exactly once across src/styles/*.css`,
      ).toBe(1);
      expect(
        new RegExp(`${name}\\s*:\\s*${size}\\s*;`).test(css),
        `${name} should be declared as exactly ${size}`,
      ).toBe(true);
    }
  });

  it("rejects a radius picked by feel at a use site", () => {
    expect(offScaleRadii()).toEqual([]);
  });

  it("keeps the rulebook synchronized with the 2/8/10/12 token contract", () => {
    const rulebook = readFileSync(RULEBOOK, "utf8");

    expect(rulebook).toContain("Four radius roles");
    expect(rulebook).toContain("`--radius-flat` (2px)");
    expect(rulebook).toContain("`--radius-tight` (8px)");
    expect(rulebook).toContain("`--radius-control` (10px)");
    expect(rulebook).toContain("`--radius-surface` (12px)");
    expect(rulebook).not.toContain("the two radius roles");
    expect(rulebook).not.toContain("Two radius roles");
    // The count in the rule's own first sentence moved with the role; a
    // rulebook still saying "three" would leave the gate asserting one number
    // and the prose teaching another.
    expect(rulebook).not.toContain("Three radius roles");
  });

  it("uses the surface radius and raised seam for every modal shell", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    for (const selector of [
      ".preset-editor",
      ".save-preset",
      ".agent-quick-picker",
    ]) {
      const declarations = [...css.matchAll(CSS_BLOCK)].find(
        ([, prelude]) => prelude.trim() === selector,
      )?.[2];

      expect(
        declarations,
        `${selector} should have a rule block`,
      ).toBeDefined();
      expect(declarations).toMatch(
        /border:\s*1px solid var\(--seam-raised\)\s*;/,
      );
      expect(declarations).toMatch(
        /border-radius:\s*var\(--radius-surface\)\s*;/,
      );
    }
  });

  it("keeps the gallery on the live radius scale", () => {
    const gallery = readFileSync(GALLERY_DIRECTION, "utf8").replace(
      CSS_COMMENT,
      "",
    );

    expect(gallery).toMatch(
      /--gx-chat-radius-control:\s*var\(--radius-control\)\s*;/,
    );
    expect(gallery).toMatch(
      /--gx-chat-radius-surface:\s*var\(--radius-surface\)\s*;/,
    );
  });
});

/**
 * DL-4.4's Native balanced ladder, keyed by variable name to its exact size.
 * DL-4.5 requires each declared once in `:root`, never a second standard
 * ladder declared beside it.
 */
const TYPE_LADDER: Record<string, string> = {
  "--type-title": "14px",
  "--type-body": "12.5px",
  "--type-meta": "11px",
  "--type-micro": "10.5px",
};

describe("design-language typography tokens", () => {
  it("declares the DL-4.4 type ladder exactly once each, at its named size", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    for (const [name, size] of Object.entries(TYPE_LADDER)) {
      const nameOnly = new RegExp(`${name}\\s*:`, "g");
      const declarations = [...css.matchAll(nameOnly)];
      expect(
        declarations.length,
        `${name} should be declared exactly once across src/styles/*.css`,
      ).toBe(1);

      const exactValue = new RegExp(
        `${name}\\s*:\\s*${size.replace(".", "\\.")}\\s*;`,
      );
      expect(
        exactValue.test(css),
        `${name} should be declared as exactly ${size}`,
      ).toBe(true);
    }
  });
});

describe("design-language citations", () => {
  it("declares every section number exactly once", () => {
    const text = readFileSync(RULEBOOK, "utf8");
    const numbers = [...text.matchAll(SECTION)].map((m) => m[1]);
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  });

  it("scans a non-empty set of files", () => {
    const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(100);
  });

  it("resolves every cited rule to a declared rule or section", () => {
    const { sections, rules } = declared();
    const spellings = [
      { pattern: CITATION, prefix: "DL-" },
      { pattern: SECTION_CITATION, prefix: "DL §" },
    ] as const;
    const unresolved: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const { pattern, prefix } of spellings) {
          for (const match of text.matchAll(pattern)) {
            const id = match[2] ? `${match[1]}.${match[2]}` : match[1];
            const ok = match[2] ? rules.has(id) : sections.has(id);
            if (!ok)
              unresolved.push(`${file.replace(ROOT, "")}: ${prefix}${id}`);
          }
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("keeps the stage-bound file editor square", () => {
    const styles = readStylesheet();
    const fileView = styles.match(/\.fileview\s*\{([^}]*)\}/)?.[1] ?? "";

    // DL-20.1 reserves surface radius for UI floating above chrome. The file
    // editor occupies the stage itself; rounding it clips Monaco's gutter.
    expect(fileView).not.toMatch(/border-radius\s*:/);
  });
});

describe("design-language feature glyph treatment", () => {
  it("keeps feature glyphs prominent and interaction surfaces neutral", () => {
    const css = readStylesheet();
    expect(css).toMatch(/\.feature-glyph\s*\{[^}]*color:\s*var\(--tone\)/s);
    expect(css).toMatch(/\.wsitem__spinner\s*\{[^}]*color:\s*var\(--tone\)/s);
    expect(css).not.toContain("--accent-icon");

    for (const selector of [
      ".dock-tabs__chip:hover",
      ".dock-tabs__chip.is-active",
      ".sidebar-actions__row:hover",
      ".sidebar-actions__row.is-active",
    ]) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const body =
        css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(body).not.toContain("--accent");
    }
  });
});

describe("active pane focus current", () => {
  it("loops the yellow current while the focused agent is working", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    const base =
      css.match(
        /\.pane\.is-agent-working::before\s*\{([^}]*)\}/,
      )?.[1] ?? "";
    const current =
      css.match(
        /\.pane\.is-agent-working::after\s*\{([^}]*)\}/,
      )?.[1] ?? "";

    expect(css).toMatch(/--pane-focus-current-duration:\s*1500ms\s*;/);
    expect(css).not.toMatch(/\.is-active \.pane\.is-agent-working::before/);
    expect(base).not.toMatch(/animation\s*:/);
    expect(current).toMatch(
      /animation:\s*pane-focus-current var\(--pane-focus-current-duration\) linear infinite\s*;/,
    );
  });

  it("runs a sidebar-click locator once for 1.5s", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    const paneSlot = css.match(/\.pane-slot\s*\{([^}]*)\}/)?.[1] ?? "";
    const locator = css.match(/\.pane-ping\s*\{([^}]*)\}/)?.[1] ?? "";
    const locatorCurrents = [
      ...css.matchAll(/\.pane-ping::after\s*\{([^}]*)\}/g),
    ].map((match) => match[1]);

    expect(paneSlot).toMatch(/position:\s*relative\s*;/);
    expect(locator).toMatch(
      /animation:\s*pane-ping-line var\(--pane-focus-current-duration\) linear 1 both\s*;/,
    );
    expect(
      locatorCurrents.some((body) =>
        /animation:\s*pane-focus-current var\(--pane-focus-current-duration\) linear 1 both\s*;/.test(
          body,
        ),
      ),
    ).toBe(true);
  });

  it("freezes working to a static line and removes the locator for reduced motion", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");

    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.pane\.is-agent-working::after,[\s\S]*?\.pane-ping\s*\{[^}]*animation:\s*none\s*;[^}]*opacity:\s*0\s*;/,
    );
  });
});
