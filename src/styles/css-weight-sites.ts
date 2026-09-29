/**
 * Reads the font weight every chrome rule states, straight from stylesheet
 * text, for `windows-weights.test.ts`. A flat tokenizer rather than a CSS
 * dependency: the stylesheets use plain rules and at-rule wrappers only (no
 * nesting), the same reading `scripts/design-language.test.ts` relies on.
 */

/** The three weights static Segoe UI ships. */
export const STATIC_WEIGHTS: readonly number[] = [400, 600, 700];

/** `font-weight: bold` / `normal` are the only keywords with an absolute value. */
const KEYWORD_WEIGHTS: Readonly<Record<string, number>> = { normal: 400, bold: 700 };

/** A number, or why a number cannot be had: `bolder`, `lighter` and `var()` depend on context. */
export type Weight = number | "unsupported" | "inherit";

interface Declaration {
  readonly prop: string;
  readonly value: string;
}

export interface Rule {
  readonly file: string;
  readonly line: number;
  /** At-rule wrappers, outermost first: `@media (max-width: 720px)`. Empty at top level. */
  readonly wrap: string;
  readonly selectors: readonly string[];
  readonly declarations: readonly Declaration[];
  /** What the rule sets the weight to, or null when it says nothing about weight. */
  readonly weight: Weight | null;
}

/** One comma-separated selector of a rule that states a weight. */
export interface Site {
  readonly file: string;
  readonly line: number;
  readonly wrap: string;
  readonly selector: string;
  readonly weight: Weight;
}

// ── text ───────────────────────────────────────────────────────────────────

/** Blanks comments but keeps every newline, so offsets still map to lines. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

/** Splits at `separator` characters that sit outside parentheses and brackets. */
function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(" || text[i] === "[") depth++;
    else if (text[i] === ")" || text[i] === "]") depth--;
    else if (depth === 0 && separator.test(text[i])) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, text.slice(start)];
}

function normalizeSelector(selector: string): string {
  return selector
    .replace(/\s*([>+~])\s*/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── weights ────────────────────────────────────────────────────────────────

function parseWeightToken(token: string): Weight {
  const value = token.trim().toLowerCase();
  if (/^\d{1,4}$/.test(value)) return Number(value);
  if (value in KEYWORD_WEIGHTS) return KEYWORD_WEIGHTS[value];
  return value === "inherit" || value === "initial" || value === "unset"
    ? "inherit"
    : "unsupported";
}

/**
 * The weight a `font:` shorthand sets. A weight token sits before the size; a
 * shorthand without one resets the weight to `normal`, which is why
 * `font: var(--type-body) var(--ui-font)` is a 400 site.
 */
function shorthandWeight(value: string): Weight {
  const trimmed = value.trim();
  if (/^(inherit|initial|unset)$/i.test(trimmed)) return "inherit";
  const lead = trimmed.match(
    /^(?:(?:italic|oblique|small-caps)\s+)*(\d{1,4}|normal|bold|bolder|lighter)\s+(?=[\d.]|var\()/i,
  );
  return lead ? parseWeightToken(lead[1]) : KEYWORD_WEIGHTS.normal;
}

/** The last `font` / `font-weight` declaration wins, exactly as the cascade reads it. */
function ruleWeight(declarations: readonly Declaration[]): Weight | null {
  let weight: Weight | null = null;
  for (const { prop, value } of declarations) {
    if (prop === "font-weight") weight = parseWeightToken(value);
    else if (prop === "font") weight = shorthandWeight(value);
  }
  return weight;
}

// ── rules ──────────────────────────────────────────────────────────────────

interface Frame {
  readonly kind: "at" | "rule";
  readonly prelude: string;
  readonly line: number;
  readonly declarations: Declaration[];
}

function toDeclaration(text: string): Declaration | null {
  const colon = text.indexOf(":");
  if (colon < 1) return null;
  return { prop: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim() };
}

function closeRule(file: string, stack: readonly Frame[], frame: Frame): Rule | null {
  const wraps = stack.filter((f) => f.kind === "at").map((f) => f.prelude.replace(/\s+/g, " "));
  if (wraps.some((wrap) => /^@(keyframes|font-face)/.test(wrap))) return null;
  return {
    file,
    line: frame.line,
    wrap: wraps.join(" > "),
    selectors: splitTopLevel(frame.prelude, /,/).map(normalizeSelector),
    declarations: frame.declarations,
    weight: ruleWeight(frame.declarations),
  };
}

/** Flat and at-rule-nested rules; parentheses and strings hide their `;`. */
export function parseRules(file: string, source: string): Rule[] {
  const css = stripComments(source);
  const rules: Rule[] = [];
  const stack: Frame[] = [];
  let buffer = "";
  let bufferLine = 1;
  let line = 1;
  let parens = 0;
  let quote = "";
  const takeDeclaration = (): void => {
    const top = stack[stack.length - 1];
    if (top?.kind === "rule") {
      const declaration = toDeclaration(buffer);
      if (declaration) top.declarations.push(declaration);
    }
    buffer = "";
  };
  for (const ch of css) {
    if (ch === "\n") line++;
    if (quote) {
      buffer += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    if (ch === "(") parens++;
    if (ch === ")") parens--;
    if (parens > 0 || !"{};".includes(ch)) {
      if (buffer.trim() === "" && ch.trim() !== "") bufferLine = line;
      buffer += ch;
      continue;
    }
    if (ch === "{") {
      const prelude = buffer.trim();
      const kind = prelude.startsWith("@") ? "at" : "rule";
      stack.push({ kind, prelude, line: bufferLine, declarations: [] });
      buffer = "";
    } else if (ch === ";") {
      takeDeclaration();
    } else {
      takeDeclaration();
      const frame = stack.pop();
      const rule = frame?.kind === "rule" ? closeRule(file, stack, frame) : null;
      if (rule) rules.push(rule);
    }
  }
  return rules;
}

/** One site per comma-separated selector of every rule that states a weight. */
export function toSites(rules: readonly Rule[]): Site[] {
  return rules.flatMap((rule) => {
    const { weight } = rule;
    if (weight === null) return [];
    return rule.selectors.map((selector) => ({
      file: rule.file,
      line: rule.line,
      wrap: rule.wrap,
      selector,
      weight,
    }));
  });
}

export function siteKey(wrap: string, selector: string): string {
  return `${wrap}|${selector}`;
}

export function describeSite(site: Site): string {
  const wrap = site.wrap === "" ? "" : `${site.wrap} { `;
  return `${site.file}:${site.line}  ${wrap}${site.selector}  (${site.weight})`;
}

// ── selectors ──────────────────────────────────────────────────────────────

function compounds(selector: string): string[][] {
  return splitTopLevel(selector, /[\s>+~]/)
    .filter((compound) => compound !== "")
    .map(
      (compound) => compound.match(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+|^[a-z][\w-]*/gi) ?? [],
    );
}

/** Specificity as one comparable number: ids, then classes / attributes / pseudo-classes, then elements. */
export function specificity(selector: string): number {
  let total = 0;
  for (const part of compounds(selector).flat()) {
    if (part.startsWith("#")) total += 10_000;
    else if (part.startsWith("::") || /^[a-z]/i.test(part)) total += 1;
    else total += 100;
  }
  return total;
}

/** `more` targets a subset of what `base` targets: base's compounds all appear in the tail of more's. */
export function refines(more: string, base: string): boolean {
  if (more === base) return false;
  const moreParts = compounds(more);
  const baseParts = compounds(base);
  if (baseParts.length > moreParts.length) return false;
  const tail = moreParts.slice(moreParts.length - baseParts.length);
  return baseParts.every((parts, i) => parts.every((part) => tail[i].includes(part)));
}

/** `.btn--primary` is the modifier a `.btn` element carries beside its base class. */
export function modifiesBase(modifier: string, base: string): boolean {
  const baseClasses = compounds(base)
    .flat()
    .filter((part) => part.startsWith("."));
  const all = compounds(modifier);
  const last = all[all.length - 1] ?? [];
  return baseClasses.some((cls) => last.some((part) => part.startsWith(`${cls}--`)));
}
