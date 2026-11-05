import { excepted, type CompositionHit, type CssRule } from "../../scripts/ui-composition-ledger";
import type { Declaration, Rule } from "./css-weight-sites";

/**
 * The CSS half of the recipe ratchet (spec 2026-11-05-ui-recipes-ratchet, RCP-25): reads each
 * declaration of a parsed stylesheet and names the ones off a recipe. Pure; the suite in
 * `composition-rules.test.ts` reads the files and counts the hits against the ledger. It reads
 * values, not intent (RCP-29): a height that comes from padding, a class built at run time and a
 * token that sits on the wrong state all pass.
 */

/** RCP-6: the spacing scale, in px. Negatives are read by their size. */
const SPACING_SCALE: ReadonlySet<number> = new Set([0, 2, 4, 6, 8, 10, 12, 16, 24]);
/** RCP-3, RCP-4 and RCP-7: every height a control, chip, badge, icon box, row or bar may take. */
const HEIGHT_SCALE: ReadonlySet<number> = new Set([20, 24, 28, 32, 36, 40, 44]);
/** RCP-25: heights outside this band are layout, not a recipe. */
const HEIGHT_BAND = { min: 12, max: 48 } as const;
/** RCP-8: a control 36 or 40 high takes the literal 6px. */
const TALL_CONTROL = { min: 36, max: 40 } as const;
/** RCP-5: the two weights. */
const WEIGHTS: ReadonlySet<string> = new Set([
  "400",
  "600",
  "normal",
  "inherit",
  "initial",
  "unset",
  "var(--weight-regular)",
  "var(--weight-strong)",
]);
/**
 * RCP-9's state tokens, a filled control's own steps, and `--ring` for the resize gutter (RCP-20).
 * A state background reads one of these or clears to `transparent` / `none`.
 */
const STATE_TOKENS: ReadonlySet<string> = new Set([
  "--state-hover-bg",
  "--tab-rest-bg",
  "--tab-active-bg",
  "--tab-active-focus-bg",
  "--state-pressed-bg",
  "--state-dragover-bg",
  "--state-needs-you-bg",
  // A filled control's own fill and steps: a `.is-primary` variant is not a state.
  "--primary",
  "--primary-hover",
  "--primary-pressed",
  "--danger-bg",
  "--danger-bg-hover",
  // RCP-16: the scrollbar thumb's two steps.
  "--scrollbar-thumb",
  "--scrollbar-thumb-hover",
]);
/** Selectors that name a state: RCP-25's list. */
const STATE_SELECTOR =
  /:hover|:active|:focus-visible|\[aria-(?:selected|current|pressed)\b|\.is-[a-z][\w-]*/;
/** The pane split gutter may paint `--ring` (RCP-20); nothing else may. */
const RESIZE_GUTTER = /divider|resize|gutter|splitter|grip/;
const FOCUS = /:focus(-visible|-within)?(?![\w-])/;

const LENGTH = /(-?\d*\.?\d+)(px|rem)(?![\w-])/g;
const SINGLE_LENGTH = /^(-?\d*\.?\d+)(px|rem)$/;
const toPx = (n: number, unit: string): number => (unit === "rem" ? n * 16 : n);
const clean = (value: string): string => value.replace(/\s*!important$/, "").trim();

/** Splits at commas or spaces outside parentheses. */
function splitTop(text: string, separator: "," | " "): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (depth === 0 && (separator === "," ? text[i] === "," : /\s/.test(text[i]))) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, text.slice(start)].map((part) => part.trim()).filter((part) => part !== "");
}

const varNames = (value: string): string[] =>
  [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);

/** The px a value states when it is one length literal and nothing else, else null. */
function singlePx(value: string): number | null {
  const match = SINGLE_LENGTH.exec(clean(value));
  return match ? toPx(Number(match[1]), match[2]) : null;
}

/** The block size a rule declares, in px, when it states one plainly. */
function blockSize(rule: Rule): number | null {
  for (const { prop, value } of rule.declarations) {
    if (!["height", "min-height", "block-size"].includes(prop)) continue;
    const px = singlePx(value);
    if (px !== null) return px;
    const token = /^var\(--control-h-(\d+)\)$/.exec(clean(value));
    if (token) return Number(token[1]);
  }
  return null;
}

const RADIUS_PROPS = /^border(-(top|bottom|start|end)-(left|right|start|end))?-radius$/;
const RADIUS_PART = /^(0|0px|50%|999px|9999px|inherit|var\(--radius-[\w-]+\))$/;

function radiusHit(rule: Rule, { prop, value }: Declaration): string | null {
  if (!RADIUS_PROPS.test(prop)) return null;
  const parts = clean(value).replace("/", " ").split(/\s+/);
  const tall = blockSize(rule);
  const tallControl = tall !== null && tall >= TALL_CONTROL.min && tall <= TALL_CONTROL.max;
  const off = parts.filter((part) => !RADIUS_PART.test(part) && !(part === "6px" && tallControl));
  return off.length > 0 ? `${prop}: ${value}` : null;
}

function heightHit({ prop, value }: Declaration): string | null {
  if (!["height", "min-height", "block-size", "min-block-size"].includes(prop)) return null;
  const px = singlePx(value);
  if (px === null || px < HEIGHT_BAND.min || px > HEIGHT_BAND.max) return null;
  return HEIGHT_SCALE.has(px) ? null : `${prop}: ${value}`;
}

function spacingHit({ prop, value }: Declaration): string | null {
  if (!/^(padding|margin)(-|$)|^(row-|column-)?gap$/.test(prop)) return null;
  const off = [...clean(value).matchAll(LENGTH)].filter(
    (match) => !SPACING_SCALE.has(Math.abs(toPx(Number(match[1]), match[2]))),
  );
  return off.length > 0 ? `${prop}: ${value}` : null;
}

function stateBackgroundHit(rule: Rule, { prop, value }: Declaration): string | null {
  if (!["background", "background-color", "background-image"].includes(prop)) return null;
  if (!rule.selectors.some((selector) => STATE_SELECTOR.test(selector))) return null;
  const v = clean(value);
  if (/^(transparent|none|inherit|initial|unset)$/.test(v)) return null;
  const gutter = rule.selectors.every((selector) => RESIZE_GUTTER.test(selector));
  const names = varNames(v);
  // What is left once every `var()` and the gradient that layers it are gone is a literal colour.
  const literal = v
    .replace(/var\([^()]*(\([^()]*\))*[^()]*\)/g, "")
    .replace(/linear-gradient|[(),\s]/g, "");
  const allowed = names.every((name) => STATE_TOKENS.has(name) || (gutter && name === "--ring"));
  return names.length > 0 && allowed && literal === "" ? null : `${prop}: ${value}`;
}

/** True when a `box-shadow` layer has a blur radius: a third length that is not zero. */
function blurred(layer: string): boolean {
  const lengths = layer
    .split(/\s+/)
    .filter((part) => /^-?\d*\.?\d+(px|rem)?$/.test(part) || part.startsWith("var("));
  const blur = lengths[2];
  if (blur === undefined) return false;
  return blur.startsWith("var(")
    ? !/^var\(--(seam|ring|diff-bar|flash)-w\)$/.test(blur)
    : Number.parseFloat(blur) !== 0;
}

function shadowHit(rule: Rule, { prop, value }: Declaration): string | null {
  if (prop !== "box-shadow") return null;
  const v = clean(value);
  if (/^(none|inherit|initial|unset)$/.test(v)) return null;
  if (/^var\(--elev-[123]\)$/.test(v)) {
    // An entrance `animation` moves opacity or transform; what its keyframes touch is not read
    // here (RCP-29), so only a transition on the shadow, or on `all`, counts.
    const moves = rule.declarations.some(
      (d) => /^transition(-property)?$/.test(d.prop) && /box-shadow|\ball\b/.test(d.value),
    );
    return moves ? `${prop}: ${value} transitions` : null;
  }
  const layers = splitTop(v, ",");
  const off = layers.filter(
    (layer) => blurred(layer) || /var\(--elev/.test(layer) || /^var\([^)]*\)$/.test(layer),
  );
  return off.length > 0 ? `${prop}: ${value}` : null;
}

function weightHit({ prop, value }: Declaration): string | null {
  const v = clean(value);
  if (prop === "font-weight") return WEIGHTS.has(v) ? null : `${prop}: ${value}`;
  if (prop !== "font") return null;
  const first = splitTop(v, " ").find((token) => /^(\d{3}|bold|bolder|lighter)$/.test(token));
  return first === undefined || WEIGHTS.has(first) ? null : `${prop}: ${value}`;
}

function focusShadowHit(
  rule: Rule,
  { prop, value }: Declaration,
  isTextField: (selector: string) => boolean,
): string | null {
  if (prop !== "box-shadow" || /^(none|0)$/.test(clean(value))) return null;
  const off = rule.selectors.filter((selector) => FOCUS.test(selector) && !isTextField(selector));
  return off.length > 0 ? `${off.join(", ")} { ${prop}: ${value} }` : null;
}

/** Every RCP-25 hit in the parsed rules of one stylesheet, before `ui-scale:` exceptions. */
export function findCssRecipeHits(
  rules: readonly Rule[],
  options: { readonly isTextField: (selector: string) => boolean; readonly weights: boolean },
): CompositionHit[] {
  return rules.flatMap((rule) =>
    rule.declarations.flatMap((declaration) => {
      const checks: [CssRule, string | null][] = [
        ["radius", radiusHit(rule, declaration)],
        ["height", heightHit(declaration)],
        ["spacing", spacingHit(declaration)],
        ["focus", focusShadowHit(rule, declaration, options.isTextField)],
        ["state-bg", stateBackgroundHit(rule, declaration)],
        ["shadow", shadowHit(rule, declaration)],
        ["weight", options.weights ? weightHit(declaration) : null],
      ];
      return checks.flatMap(([kind, detail]) =>
        detail === null ? [] : [{ rule: kind, line: declaration.line, detail }],
      );
    }),
  );
}

/** The hits of one stylesheet that count: those without `ui-scale: <reason>` on the line above. */
export function countedCssRecipeHits(
  source: string,
  rules: readonly Rule[],
  options: Parameters<typeof findCssRecipeHits>[1],
): CompositionHit[] {
  const lines = source.split(/\r?\n/);
  return findCssRecipeHits(rules, options).filter((hit) => !excepted(lines, hit.line));
}

/** How to fix each rule, for the failure message. */
export const CSS_RECIPE_HOW: Readonly<Record<CssRule, string>> = {
  radius:
    "read a radius role (`var(--radius-control)` …), 0, 50% or the pill; 6px only on a block 36 to 40 high (RCP-8)",
  height: "use 20, 24, 28, 32, 36, 40 or 44, or a token: `--row-*`, `--control-h-*` (RCP-7)",
  spacing: "use 0/2/4/6/8/10/12/16/24 or a `--space-*` token (RCP-6)",
  focus: "only a text field paints a focus ring; paint focus like hover (RCP-9, CMP-11)",
  "state-bg":
    "a state background reads `--state-hover-bg`, `--tab-active-bg`, `--tab-active-focus-bg`, `--state-pressed-bg`, `--state-dragover-bg` or `--state-needs-you-bg` (RCP-9)",
  shadow: "a blurred shadow is one static `var(--elev-1|2|3)`, on a floating element (RCP-11)",
  weight:
    "use 400 or 600 as a number: the Windows weight ledger reads numbers, not `var()` (RCP-5, DL-4.6)",
};
