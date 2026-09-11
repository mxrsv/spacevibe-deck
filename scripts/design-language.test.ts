/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
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
  const importPaths = [...index.matchAll(/@import\s+["']([^"']+)["'];/g)].map((match) => match[1]);
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
const SECTION_CITATION = /(?:DL|DESIGN-LANGUAGE(?:\.md)?)\s*§\s*(\d+)(?:\.(\d+))?/g;

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
 * DL-4.3's third exception (2026-09-03, the Agent Board): `.board-label` is
 * uppercase WITH positive tracking, and it is copy — two nav group headings
 * and the state word. Unlike the optical list above, which exempts negative
 * tracking only, this list exempts BOTH regexes the scan rejects on one
 * branch. A second selector here is an edit to DL-4.3 first.
 */
const LABEL_TREATMENT_SELECTORS = new Set([".board-label"]);
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
  "var(--radius-tab)",
  "var(--radius-tight)",
  "var(--radius-control)",
  "var(--radius-surface)",
  "50%",
  "999px",
  "0",
  // PROVISIONAL (rail-worktree-card plan, Task 7): the worktree card's two
  // pinned radius values, shipped ahead of a DL-20.1 edit rather than after
  // one. The owner has not yet picked between amending DL-20.1 to admit them,
  // adding a rung, or snapping the card to an existing role (Task 10's gate
  // row 3) — until that pick lands and Task 11 writes it into DL-20.1's own
  // text, these two entries are the exception to this comment's own rule.
  // `src/styles/04c-rail-worktree-card.css` pins both to exactly one variable
  // each for that reason: whichever way the pick goes, undoing this entry is
  // a one-line edit, not a hunt through the card's stylesheet.
  "var(--asr-card-radius)",
  "var(--asr-card-pill-radius)",
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
    if (LABEL_TREATMENT_SELECTORS.has(selector)) continue;
    for (const raw of body.split(";")) {
      const declaration = raw.trim().replace(/\s+/g, " ");
      if (!declaration) continue;
      if (OPTICAL_TRACKING_SELECTORS.has(selector) && NEGATIVE_TRACKING.test(declaration)) {
        continue;
      }
      if (STYLED_UPPERCASE.test(declaration) || TEXT_TRACKING.test(declaration)) {
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
  it("declares the DL-20.1 roles at 2/6/8/10/12", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    for (const [name, size] of Object.entries({
      // The dense-row role, added 2026-08-17 with the tab strip's turn text.
      "--radius-flat": "2px",
      "--radius-tab": "6px",
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

  it("keeps the rulebook synchronized with the 2/6/8/10/12 token contract", () => {
    const rulebook = readFileSync(RULEBOOK, "utf8");

    expect(rulebook).toContain("Five radius roles");
    expect(rulebook).toContain("`--radius-flat` (2px)");
    expect(rulebook).toContain("`--radius-tab` (6px)");
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
    for (const selector of [".preset-editor", ".save-preset", ".agent-quick-picker"]) {
      const declarations = [...css.matchAll(CSS_BLOCK)].find(
        ([, prelude]) => prelude.trim() === selector,
      )?.[2];

      expect(declarations, `${selector} should have a rule block`).toBeDefined();
      expect(declarations).toMatch(/border:\s*1px solid var\(--seam-raised\)\s*;/);
      expect(declarations).toMatch(/border-radius:\s*var\(--radius-surface\)\s*;/);
    }
  });

  it("keeps the gallery on the live radius scale", () => {
    const gallery = readFileSync(GALLERY_DIRECTION, "utf8").replace(CSS_COMMENT, "");

    expect(gallery).toMatch(/--gx-chat-radius-control:\s*var\(--radius-control\)\s*;/);
    expect(gallery).toMatch(/--gx-chat-radius-surface:\s*var\(--radius-surface\)\s*;/);
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

      const exactValue = new RegExp(`${name}\\s*:\\s*${size.replace(".", "\\.")}\\s*;`);
      expect(exactValue.test(css), `${name} should be declared as exactly ${size}`).toBe(true);
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
            if (!ok) unresolved.push(`${file.replace(ROOT, "")}: ${prefix}${id}`);
          }
        }
      }
    }
    expect(unresolved).toEqual([]);
  });

  /**
   * The rendered document's scroll thumb must stay visible at rest, and its
   * pointer step must stay declared BESIDE it.
   *
   * Both halves are load-bearing and both look redundant, which is why they
   * are pinned. `01-tokens.css` lights every other thumb through
   * `*:hover::-webkit-scrollbar-thumb`, and that rule never reaches the screen:
   * Chromium repaints a custom scrollbar only when the scrollbar's own state
   * changes, so flipping a pseudo-element declaration through the originating
   * element's `:hover` computes a new value and paints nothing (measured
   * 2026-08-23). And the 32% hover rule in that file carries the same
   * specificity while sitting earlier in the cascade, so deleting the local
   * `:hover` restatement silently removes the pointer step.
   */
  it("keeps the rendered document's scroll thumb visible at rest", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    const rest = css.match(/\.md-doc::-webkit-scrollbar-thumb\s*\{([^}]*)\}/)?.[1];
    const hover = css.match(/\.md-doc::-webkit-scrollbar-thumb:hover\s*\{([^}]*)\}/)?.[1];

    expect(rest, ".md-doc should declare a resting scrollbar thumb").toBeDefined();
    expect(rest).not.toMatch(/background:\s*transparent/);
    expect(hover, ".md-doc should restate its thumb hover step").toBeDefined();
  });

  it("keeps the stage-bound file editor square", () => {
    const styles = readStylesheet();
    const fileView = styles.match(/\.fileview\s*\{([^}]*)\}/)?.[1] ?? "";

    // DL-20.1 reserves surface radius for UI floating above chrome. The file
    // editor occupies the stage itself; rounding it clips Monaco's gutter.
    expect(fileView).not.toMatch(/border-radius\s*:/);
  });
});

describe("DL-32 task launcher", () => {
  it("declares the launcher rules and loads the production treatment", () => {
    const rulebook = readFileSync(RULEBOOK, "utf8");
    const index = readFileSync(STYLESHEET, "utf8");
    const css = readStylesheet().replace(CSS_COMMENT, "");

    expect(rulebook).toContain("## 32. The task launcher");
    for (const rule of ["32.1", "32.2", "32.3", "32.4", "32.5"]) {
      expect(rulebook).toContain(`**DL-${rule}**`);
    }
    expect(index).toContain('@import "./styles/18-new-task-launcher.css";');
    expect(css).toMatch(/\.nt-composer\s*\{/);
    expect(css).toMatch(/\.nt-quick-launch\s*\{[^}]*z-index:\s*110/s);
    expect(css).not.toMatch(/\.nt-quick-launch[^{}]*\{[^}]*backdrop-filter/s);

    // DL-32.1: choosing a recent "establishes context", so the chosen row has
    // to LOOK chosen — with the same wash every other selected surface wears
    // (DL-21.1 on a chip, DL-27.8 on a rail row). It shipped with the class and
    // `aria-pressed` set and no rule to paint either.
    expect(css).toMatch(/\.row\.is-selected\s*\{[^}]*background:\s*var\(--tab-active-bg\)/s);
  });
});

describe("DL-33 recent agent activity", () => {
  it("declares the compact re-entry rule and preserves its fixed row geometry", () => {
    const rulebook = readFileSync(RULEBOOK, "utf8");
    const css = readStylesheet().replace(CSS_COMMENT, "");

    expect(rulebook).toContain("## 33. Recent agent activity");
    for (const rule of ["33.1", "33.2", "33.3", "33.4", "33.5"]) {
      expect(rulebook).toContain(`**DL-${rule}**`);
    }

    const row = css.match(/\.recent-session-activity__row\s*\{([^}]*)\}/)?.[1] ?? "";
    // Amended 2026-09-09 (owner): the fixed age precedes the trailing status
    // slot; an unopened session leaves that slot empty without moving text.
    expect(row).toMatch(/grid-template-columns:\s*15px minmax\(0, 1fr\) 4em 14px\s*;/);
    expect(css).toMatch(
      /\.recent-session-activity__state > \.asr-row__mark\s*\{[^}]*justify-self:\s*center/s,
    );
    expect(row).toMatch(/min-height:\s*30px\s*;/);
    expect(row).toMatch(/border-radius:\s*var\(--radius-control\)\s*;/);
    expect(css).toMatch(
      /\[data-sidebar-collapsed="true"\] \.recent-session-activity\s*\{[^}]*display:\s*none/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.recent-session-activity \*,\s*\.sessions-screen,[^{]*\{[^}]*transition:\s*none\s*;/s,
    );
  });
});

describe("DL-27.23/27.24 the rail's worktree tier", () => {
  it("declares both rules and draws the sub-header as a label on the rows' edge", () => {
    const rulebook = readFileSync(RULEBOOK, "utf8");
    const css = readStylesheet().replace(CSS_COMMENT, "");

    for (const rule of ["27.23", "27.24"]) {
      expect(rulebook).toContain(`**DL-${rule}**`);
    }

    // DL-27.23's one left edge: 7px inset + a 17px leading slot + a 7px gap is
    // where the project name and every row's text start, and the sub-header
    // spends it as padding because it carries no leading glyph. An indent step
    // would come out of the row's turn line instead.
    const head = css.match(/\.asr-wt__head\s*\{([^}]*)\}/)?.[1];
    expect(head, ".asr-wt__head should have a rule block").toBeDefined();
    expect(head).toMatch(/padding:\s*[^;]*\s31px\s*;/);
    expect(head).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) 17px 17px\s*;/);

    // The row suffix's own treatment, one step quieter than the project.
    const name = css.match(/\.asr-wt__name\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(name).toMatch(/color:\s*var\(--text-faint\)\s*;/);
    expect(name).toMatch(/font:\s*450 var\(--type-meta\)/);

    // DL-27.24: one launcher, and nothing else — the `+` mirrors the project
    // header's own (DL-27.18), and no caret or close is drawn for a group.
    expect(css).toMatch(/\.asr-cluster:hover \.asr-wt__add,\s*\.asr-wt__add:focus-visible\s*\{/);
    expect(css).not.toMatch(/\.asr-wt__caret\s*\{/);
    expect(css).not.toMatch(/\.asr-wt__remove\s*\{/);

    // The suffix the group replaces is DELETED, not parked: leaving the rule
    // would keep a treatment nothing can reach and invite the word back onto
    // the row, where it prints once per agent.
    expect(css).not.toMatch(/\.asr-row__worktree\s*\{/);

    // A worktree group is prose; the 4px collapsed column drops it with every
    // other prose-width line (DL-18.9 for this rail).
    expect(css).toMatch(/\[data-sidebar-collapsed="true"\] \.asr-wt__head,/);
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
      const body = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(body).not.toContain("--accent");
    }
  });
});

describe("active pane focus current", () => {
  it("loops the yellow current while the focused agent is working", () => {
    const css = readStylesheet().replace(CSS_COMMENT, "");
    const base = css.match(/\.pane\.is-agent-working::before\s*\{([^}]*)\}/)?.[1] ?? "";
    const current = css.match(/\.pane\.is-agent-working::after\s*\{([^}]*)\}/)?.[1] ?? "";

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
    const locatorCurrents = [...css.matchAll(/\.pane-ping::after\s*\{([^}]*)\}/g)].map(
      (match) => match[1],
    );

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

describe("DL-34 agent board", () => {
  it("declares the board rules and the two treatment tokens", () => {
    const rulebook = readFileSync(RULEBOOK, "utf8");
    const css = readStylesheet().replace(CSS_COMMENT, "");
    expect(rulebook).toContain("## 34. The agent board");
    for (const rule of [
      "34.1",
      "34.2",
      "34.3",
      "34.4",
      "34.5",
      "34.6",
      "34.7",
      "34.8",
      "34.9",
      "34.10",
    ]) {
      expect(rulebook).toContain(`**DL-${rule}**`);
    }
    // DL-4.1 (amended): one face token, declared once, never read from the terminal setting.
    expect([...css.matchAll(/--board-font\s*:/g)].length).toBe(1);
    expect(css).toMatch(/--board-font\s*:\s*ui-monospace,/);
    // DL-4.3 (third exception): a treatment token, not a size rung.
    expect([...css.matchAll(/--label-tracking\s*:/g)].length).toBe(1);
    expect(css).toMatch(/--label-tracking\s*:\s*0\.06em\s*;/);

    const index = readFileSync(STYLESHEET, "utf8");
    expect(index).toContain('@import "./styles/19-agent-board.css";');
    // DL-34.5: one face over the subtree, from the token.
    expect(css).toMatch(/\.agent-board\s*\{[^}]*font-family:\s*var\(--board-font\)/s);
    // DL-4.3's third exception, on exactly this class.
    expect(css).toMatch(/\.board-label\s*\{[^}]*text-transform:\s*uppercase/s);
    expect(css).toMatch(/\.board-label\s*\{[^}]*letter-spacing:\s*var\(--label-tracking\)/s);
    // DL-34.4 (amended 2026-09-04) with DL-3.5: three second inks, declared
    // once each, read ONLY inside a selected card — a resting card keeps the
    // pure hue, so a rule that dropped `aria-current` would change every card.
    for (const ink of ["failed", "asked", "neutral"]) {
      expect([...css.matchAll(new RegExp(`--board-state-${ink}-ink\\s*:`, "g"))].length).toBe(1);
      expect(css).toMatch(new RegExp(`--board-state-${ink}-ink\\s*:\\s*color-mix\\(`));
    }
    for (const [selector, ink] of [
      ['\\.board-card\\[aria-current="true"\\]', "neutral"],
      ['\\.board-card\\[aria-current="true"\\]\\[data-state="asked"\\]', "asked"],
      ['\\.board-card\\[aria-current="true"\\]\\[data-state="failed"\\]', "failed"],
    ]) {
      expect(css).toMatch(
        new RegExp(
          `${selector} \\.board-card__state\\s*\\{[^}]*var\\(--board-state-${ink}-ink\\)`,
          "s",
        ),
      );
    }
    // DL-34.1 (amended 2026-09-04) / spec §5.7: the fold measures the BOARD
    // through a container query, and both thresholds are derived from the
    // three widths declared above them — never a viewport media query, which
    // would fold at one width in the app and another in the gallery.
    for (const token of ["--board-nav-w", "--board-panel-w", "--board-nav-folded-w"]) {
      expect([...css.matchAll(new RegExp(`${token}\\s*:`, "g"))].length).toBe(1);
    }
    expect(css).toMatch(/\.agent-board\s*\{[^}]*container-type:\s*inline-size/s);
    expect(css).toMatch(
      /@container \(max-width: 832px\)\s*\{\s*\.agent-board\[data-panel="open"\] \.agent-board__panel\s*\{[^}]*position:\s*absolute/s,
    );
    expect(css).toMatch(
      /@container \(max-width: 472px\)\s*\{\s*\.agent-board__nav\s*\{[^}]*width:\s*var\(--board-nav-folded-w\)/s,
    );
    // DL-34.2 (amended 2026-09-09): four GROUPS, not five even rows. The card
    // places by area and spends UNEQUAL margins between them, which is what
    // the amendment is about — a uniform `row-gap` would satisfy a shape
    // assertion and still read as the list the owner reported.
    expect(css).toMatch(
      /\.board-card\s*\{[^}]*grid-template-areas:\s*\n?\s*"status checkout num"/s,
    );
    expect(css).toMatch(/\.board-card\s*\{[^}]*row-gap:\s*0/s);
    expect(css).toMatch(/\.board-card__id\s*\{[^}]*margin-top:\s*8px/s);
    expect(css).toMatch(/\.board-card__where\s*\{[^}]*min-width:\s*0/s);
    // What the agent said is the subject: primary ink, two clamped lines, and
    // a floor so an `auto-fill` row is one height.
    expect(css).toMatch(/\.board-card__what\s*\{[^}]*color:\s*var\(--text-primary\)/s);
    expect(css).toMatch(/\.board-card__what\s*\{[^}]*line-clamp:\s*2/s);
    expect(css).toMatch(/\.board-card__what\s*\{[^}]*min-height:/s);
    // DL-27.5's column sits at the FOOT, so no row reserves space for it at
    // the top — the reserve is the footer's, over air.
    expect(css).toMatch(/\.board-card__actions\s*\{[^}]*bottom:/s);
    expect(css).not.toMatch(/\.board-card__actions\s*\{[^}]*\btop:/s);
    // DL-34.3: the frame carries state; the rail's ripple is off on the Board.
    expect(css).toMatch(/\.board-card\[data-state="asked"\]\s*\{[^}]*var\(--status-unread\)/s);
    expect(css).toMatch(
      /\.agent-board \.asr-row__mark\[data-state="asked"\]::after\s*\{[^}]*animation:\s*none/s,
    );
    // DL-1.3: no blurred shadow anywhere in the sheet. The whitespace sits
    // INSIDE the lookahead: outside it, `\s*` backtracks to zero width and
    // the lookahead trivially succeeds against the space before "inset",
    // matching every well-formed declaration and making this assertion
    // unsatisfiable against prettier-formatted CSS.
    const board = readFileSync(join(ROOT, "src/styles/19-agent-board.css"), "utf8").replace(
      CSS_COMMENT,
      "",
    );
    expect(board).not.toMatch(/box-shadow:(?!\s*inset 0 0 0 1px)/);
  });
});
