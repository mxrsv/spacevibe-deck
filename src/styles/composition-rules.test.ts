/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditComposition,
  CSS_RULES,
  emptyExceptions,
  parseDebt,
  type CompositionHit,
} from "../../scripts/ui-composition-ledger";
import { countedCssRecipeHits, CSS_RECIPE_HOW } from "./css-recipe-hits";
import { parseRules, type Rule } from "./css-weight-sites";

/**
 * Keeps the legacy stylesheets on the UI composition rules (CMP-10, CMP-11, CMP-14, applied to
 * every surface by CMP-19): nothing under 12px, no outline on keyboard focus outside text
 * fields, and no horizontal divider line except the named ones. Read from stylesheet text, so a
 * regression fails here instead of surviving until someone looks at the screen.
 *
 * It also holds the recipe ratchet's CSS half (RCP-24 to RCP-27, read by `css-recipe-hits.ts`).
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** CMP-20: the old rail, dock column, Agent Board and Mission Control keep their look until deleted. */
const CMP_20 = /^src\/styles\/(04[a-f]-|14-dock\.css|19-agent-board\.css|20-mission-control\.css)/;
/** Never bundled (R7), and the preset is the vendored source of truth the rules are copied from. */
const SKIPPED = /^(src\/gallery\/|src\/ui\/preset\.css$)/;

function cssFiles(dir = join(ROOT, "src")): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const path = join(dir, entry);
      const name = relative(ROOT, path).split(sep).join("/");
      if (SKIPPED.test(name) || CMP_20.test(name)) return [];
      if (statSync(path).isDirectory()) return cssFiles(path);
      return name.endsWith(".css") ? [name] : [];
    });
}

interface Allowed {
  /** Exact normalised selector the rule carries. */
  readonly selector: string;
  /** Limits the entry to one stylesheet; omitted when the selector is unique to the tree. */
  readonly file?: string;
  readonly reason: string;
}

/**
 * CMP-14 keeps a line only where removing it would make the content unreadable. Every entry must
 * still match a rule that draws a visible `border-top` / `border-bottom`: delete the line, delete
 * the entry.
 */
const KEPT_LINES: readonly Allowed[] = [
  {
    selector: ".agent-launch-page__preview",
    reason: "sticky preview over scrolling tiles: the line is the only edge between them",
  },
  { selector: ".usage-overview th", reason: "numeric table row rule" },
  { selector: ".usage-overview td", reason: "numeric table row rule" },
  { selector: ".usage-timeline__stack", reason: "chart baseline" },
  { selector: ".md-doc hr", reason: "markdown thematic break is content, not a divider" },
];

/**
 * CMP-11 gives keyboard focus a ring on text fields only (the field's border plus a box-shadow
 * halo, never `outline`). Each token names a selector part; a focus selector containing it may
 * set an outline or a ring. Every token must still occur in some rule. Drop-target highlights
 * have no `:focus` selector, which this check never looks at.
 */
const TEXT_FIELD_FOCUS: readonly { token: string; reason: string }[] = [
  { token: ".text-input", reason: "shared text field" },
  { token: ".prompt-textarea", reason: "prompt text area" },
  { token: ".browser-panel__url", reason: "URL input" },
  { token: ".search-bar__input", reason: "search input" },
  { token: ".settings-nav__search-input", reason: "settings search input" },
  { token: ".nt-composer__textarea", reason: "new task composer text area" },
  { token: ".wtf__input", reason: "worktree field input" },
  { token: ".preset-editor__name", reason: "preset name input" },
  { token: "input", reason: "plain input element" },
  { token: ".command-bar__bar", reason: "the command bar's frame takes its input's ring (RCP-3)" },
];

const FOCUS = /:focus(-visible|-within)?(?![\w-])/;
const px = (n: number, unit: string): number =>
  unit === "rem" ? n * 16 : unit === "pt" ? (n * 4) / 3 : n;
const DIMENSION = /(?<!\/\s*)(?<![\d.])(\d*\.?\d+)(px|rem|pt)(?![\w-])/;
/** Keyword sizes that resolve under 12px. */
const SMALL_KEYWORD = /^(xx-small|x-small|xxx-small)$/;

const normalize = (selector: string): string => selector.replace(/\s+/g, " ").trim();
const where = (rule: Rule, selector?: string): string =>
  `${rule.file}:${rule.line} ${selector ?? rule.selectors.join(", ")}`;
const lastValue = (rule: Rule, ...props: string[]): string | undefined =>
  rule.declarations
    .findLast((d) => props.includes(d.prop))
    ?.value.replace(/\s*!important$/, "")
    .trim();

/**
 * The px size a `font-size` or `font` declaration states, or null when it states none that can be
 * read. `em`, `%`, `var()` and `inherit` depend on a parent that is itself checked. A bare `0` is
 * not a size: it hides the text.
 */
function declaredFontSize(prop: string, value: string): number | null {
  if (prop === "font-size") {
    if (SMALL_KEYWORD.test(value)) return 0;
    const match = DIMENSION.exec(value);
    return match ? px(Number(match[1]), match[2]) : null;
  }
  const match = prop === "font" ? DIMENSION.exec(value) : null;
  return match ? px(Number(match[1]), match[2]) : null;
}

/** True when an `outline` value draws something; `auto`, `solid ...` and `2px ...` all do. */
function outlineDraws(value: string): boolean {
  return !/^(none|0|0px|0 none)$/.test(value.trim());
}

/** True when a `border-top` / `border-bottom` value paints a line. `var(--x)` alone counts as visible. */
function borderLineVisible(value: string): boolean {
  const v = value.trim();
  if (/(^|\s)(none|hidden|transparent)(\s|$)/.test(v)) return false;
  const width = /^(\d*\.?\d+)(px|rem)?(\s|$)/.exec(v);
  return !(width && Number(width[1]) === 0);
}

interface Hit {
  readonly rule: Rule;
  readonly selector: string;
}

function fontSizeHits(rules: readonly Rule[]): string[] {
  return rules.flatMap((rule) =>
    rule.declarations.flatMap((d) => {
      const size = declaredFontSize(d.prop, d.value.replace(/\s*!important$/, "").trim());
      return size !== null && size < 12 ? [`${where(rule)} ${d.prop}: ${d.value}`] : [];
    }),
  );
}

function outlineHits(rules: readonly Rule[]): Hit[] {
  return rules.flatMap((rule) => {
    const outline = lastValue(rule, "outline");
    if (outline === undefined || !outlineDraws(outline)) return [];
    return rule.selectors
      .map(normalize)
      .filter((selector) => FOCUS.test(selector))
      .map((selector) => ({ rule, selector }));
  });
}

const hasToken = (selector: string, token: string): boolean =>
  new RegExp(`(^|[^\\w-])${token.replace(/[.[\]]/g, "\\$&")}(?![\\w-])`).test(selector);

function lineHits(rules: readonly Rule[]): Hit[] {
  return rules.flatMap((rule) => {
    const visible = ["border-top", "border-bottom", "border-block-start", "border-block-end"].some(
      (prop) => {
        const value = lastValue(rule, prop);
        return value !== undefined && borderLineVisible(value);
      },
    );
    return visible
      ? rule.selectors.map((selector) => ({ rule, selector: normalize(selector) }))
      : [];
  });
}

const sources = new Map(cssFiles().map((file) => [file, readFileSync(join(ROOT, file), "utf8")]));
const rules: Rule[] = [...sources].flatMap(([file, text]) => parseRules(file, text));

const DEBT = "scripts/ui-composition-debt.txt";
/** DL-4.6: the Windows ledger maps the authored weights for Segoe UI; they are not authored. */
const WEIGHT_LEDGER = "src/styles/21-windows-weights.css";
const isTextField = (s: string): boolean =>
  TEXT_FIELD_FOCUS.some(({ token }) => hasToken(s, token));

const recipeHits = new Map<string, CompositionHit[]>(
  [...sources].map(([file, text]) => {
    const own = rules.filter((rule) => rule.file === file);
    return [
      file,
      countedCssRecipeHits(text, own, { isTextField, weights: file !== WEIGHT_LEDGER }),
    ];
  }),
);

describe("composition rules in the legacy stylesheets", () => {
  it("reads the stylesheets it is meant to guard", () => {
    const files = new Set(rules.map((rule) => rule.file));
    for (const expected of ["src/styles/02-shell.css", "src/launcher/agent-launch-page.css"]) {
      expect(files.has(expected), `${expected} was not read`).toBe(true);
    }
    expect(
      [...files].filter((file) => CMP_20.test(file) || file.startsWith("src/gallery/")),
    ).toEqual([]);
  });

  it("states no font size under 12px (CMP-10)", () => {
    expect(
      fontSizeHits(rules),
      "CMP-10: nothing below 12px; use `var(--type-meta)` for metadata and `var(--type-body)` for text",
    ).toEqual([]);
  });

  it("paints no outline on keyboard focus outside text fields (CMP-11)", () => {
    const offenders = outlineHits(rules)
      .filter(({ selector }) => !TEXT_FIELD_FOCUS.some(({ token }) => hasToken(selector, token)))
      .map(({ rule, selector }) => where(rule, selector));
    expect(
      offenders,
      "CMP-11: only text fields have a focus ring; paint other controls' focus like their hover and set `outline: none`",
    ).toEqual([]);
  });

  it("keeps every text-field focus exemption attached to a selector that exists", () => {
    const selectors = rules.flatMap((rule) => rule.selectors.map(normalize));
    const stale = TEXT_FIELD_FOCUS.filter(
      ({ token }) => !selectors.some((selector) => hasToken(selector, token)),
    ).map(({ token }) => token);
    expect(stale, "delete the exemption: no rule carries this selector any more").toEqual([]);
  });

  it("draws horizontal lines only where the list keeps them (CMP-14)", () => {
    const offenders = lineHits(rules)
      .filter(
        ({ rule, selector }) =>
          !KEPT_LINES.some(
            (kept) => kept.selector === selector && (!kept.file || kept.file === rule.file),
          ),
      )
      .map(({ rule, selector }) => where(rule, selector));
    expect(
      offenders,
      "CMP-14: no `border-top` / `border-bottom` between rows, groups or headers; separate with spacing or a background step, or add a KEPT_LINES entry with a reason",
    ).toEqual([]);
  });

  it("lists no kept line that no rule draws any more", () => {
    const hits = lineHits(rules);
    const stale = KEPT_LINES.filter(
      (kept) =>
        !hits.some(
          ({ rule, selector }) =>
            kept.selector === selector && (!kept.file || kept.file === rule.file),
        ),
    ).map((kept) => kept.selector);
    expect(stale, "delete the KEPT_LINES entry: no rule draws this line any more").toEqual([]);
  });
});

describe("the recipe ratchet in the stylesheets (RCP-24, RCP-25)", () => {
  it("holds no off-recipe value beyond the debt file, and no reasonless `ui-scale:`", () => {
    const empty = [...sources].flatMap(([file, text]) =>
      emptyExceptions(text).map((line) => `${file}:${line}`),
    );
    expect(empty, "say why the value stays off its scale: `/* ui-scale: <reason> */`").toEqual([]);
    const { debt, problems } = parseDebt(readFileSync(join(ROOT, DEBT), "utf8"));
    expect(problems).toEqual([]);
    const scope = {
      rules: CSS_RULES,
      owns: (p: string) => p.endsWith(".css"),
      how: CSS_RECIPE_HOW,
    };
    expect(auditComposition(recipeHits, debt, scope)).toEqual([]);
  });
});

describe("composition readers", () => {
  it("reads sizes from font-size and the font shorthand", () => {
    expect(declaredFontSize("font-size", "11px")).toBe(11);
    expect(declaredFontSize("font-size", "0.625rem")).toBe(10);
    expect(declaredFontSize("font-size", "x-small")).toBe(0);
    expect(declaredFontSize("font", "600 11px/1.2 var(--ui-font)")).toBe(11);
    expect(declaredFontSize("font", "var(--type-meta) / 10px var(--ui-font)")).toBeNull();
    expect(declaredFontSize("font-size", "0.9em")).toBeNull();
    expect(declaredFontSize("font-size", "0")).toBeNull();
    expect(declaredFontSize("font-size", "var(--type-meta)")).toBeNull();
  });

  it("treats every outline except none and 0 as drawn", () => {
    for (const drawn of ["auto", "solid red", "2px solid red", "1px dashed"]) {
      expect(outlineDraws(drawn), drawn).toBe(true);
    }
    for (const hidden of ["none", "0", " none "]) expect(outlineDraws(hidden), hidden).toBe(false);
  });

  it("treats transparent, none and zero-width borders as no line", () => {
    for (const line of ["1px solid var(--hair)", "var(--divider)", "1px solid"]) {
      expect(borderLineVisible(line), line).toBe(true);
    }
    for (const none of ["none", "0", "1px solid transparent", "0 solid red"]) {
      expect(borderLineVisible(none), none).toBe(false);
    }
  });
});
