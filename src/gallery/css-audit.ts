/**
 * Live audit of the app stylesheet.
 *
 * The numbers this produces are the argument for a token scale: the colour
 * layer routes through `:root` almost perfectly, while every dimension —
 * radius, font size, spacing, duration, stacking order — is typed by hand at
 * the point of use. A count in a chat message rots the moment someone edits
 * the file; a count read from the live stylesheet cannot.
 *
 * It reads `src/styles.css` only, found through the `data-vite-dev-id`
 * attribute Vite puts on the style element it injects. `gallery.css` is
 * excluded on purpose — auditing the gallery's own frame would inflate every
 * number with values that never ship.
 */

const APP_STYLESHEET_SUFFIX = "src/styles.css";

export interface AuditEntry {
  /** The literal as written in CSS. */
  readonly value: string;
  /** How many declarations use it. */
  readonly count: number;
  /** One selector that uses it, so it can be found in the file. */
  readonly sample: string;
}

export interface AuditGroup {
  readonly label: string;
  /** What a token would have to replace, in one line. */
  readonly note: string;
  readonly entries: readonly AuditEntry[];
}

interface Tally {
  count: number;
  sample: string;
}

/**
 * The top-level rules of every readable `src/styles.css` the document loaded.
 *
 * Exported because the forced-state builder needs the same sheet, and finding
 * it is the fiddly part — a second copy of this lookup is a second thing to
 * get wrong when Vite changes how it injects styles.
 *
 * It hands back the rule lists rather than the sheets on purpose: reading
 * `cssRules` is the access that throws on a cross-origin sheet, so the guard
 * has to wrap that read and keep what it returns. A probe that reads and
 * discards guards nothing — the real read would still be outside the handler,
 * and a minifier is free to drop a discarded property access altogether.
 */
export function appRuleLists(): readonly CSSRuleList[] {
  const lists: CSSRuleList[] = [];
  for (const sheet of document.styleSheets) {
    const node = sheet.ownerNode;
    const devId =
      node instanceof HTMLElement ? node.dataset.viteDevId : undefined;
    const source = devId ?? sheet.href ?? "";
    if (!source.endsWith(APP_STYLESHEET_SUFFIX)) {
      continue;
    }
    try {
      lists.push(sheet.cssRules);
    } catch {
      // The app sheet is same-origin in dev, so this only skips something
      // neither reader was ever going to see.
      continue;
    }
  }
  return lists;
}

function styleRules(): readonly CSSStyleRule[] {
  const rules: CSSStyleRule[] = [];
  const collect = (list: CSSRuleList): void => {
    for (const rule of list) {
      if (rule instanceof CSSStyleRule) {
        rules.push(rule);
      } else if (
        rule instanceof CSSMediaRule ||
        rule instanceof CSSSupportsRule
      ) {
        collect(rule.cssRules);
      }
    }
  };
  for (const list of appRuleLists()) {
    collect(list);
  }
  return rules;
}

function toEntries(tallies: ReadonlyMap<string, Tally>): readonly AuditEntry[] {
  return [...tallies]
    .map(([value, tally]) => ({
      value,
      count: tally.count,
      sample: tally.sample,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function tally(
  rules: readonly CSSStyleRule[],
  read: (rule: CSSStyleRule) => readonly string[],
): readonly AuditEntry[] {
  const tallies = new Map<string, Tally>();
  for (const rule of rules) {
    for (const value of read(rule)) {
      const existing = tallies.get(value);
      if (existing === undefined) {
        tallies.set(value, { count: 1, sample: rule.selectorText });
      } else {
        existing.count += 1;
      }
    }
  }
  return toEntries(tallies);
}

/** Values of one declared property, ignoring rules that do not set it. */
function declared(property: string) {
  return (rule: CSSStyleRule): readonly string[] => {
    const value = rule.style.getPropertyValue(property).trim();
    return value === "" ? [] : [value];
  };
}

/** Values of any of several properties (shorthand + longhands together). */
function declaredAny(properties: readonly string[]) {
  return (rule: CSSStyleRule): readonly string[] =>
    properties.flatMap((property) => declared(property)(rule));
}

function matches(pattern: RegExp) {
  return (rule: CSSStyleRule): readonly string[] =>
    [...rule.cssText.matchAll(pattern)].map((match) => match[0]);
}

/**
 * Splits a shorthand into the individual lengths it is made of.
 *
 * A spacing scale is a set of steps, and `padding: 6px 14px` chooses two of
 * them. Counting the declaration whole reports it as one value and inflates the
 * total with duplicates that differ only in arrangement — the first version of
 * this audit said 67 where the number of distinct steps is far smaller. An
 * external review (Codex, 2026-08-12) caught it.
 */
function lengthSteps(properties: readonly string[]) {
  return (rule: CSSStyleRule): readonly string[] =>
    declaredAny(properties)(rule)
      .flatMap((value) => value.split(/\s+/))
      .filter((token) => /^-?\d+(?:\.\d+)?px$/.test(token));
}

/**
 * Colour literals written by hand.
 *
 * Read from `cssText`, not from `rule.style`: a value containing `var()` on a
 * shorthand like `border-color` is a pending substitution the CSSOM will not
 * hand back as text, which is exactly where the missed `white` lives
 * (`.drop-overlay.is-swap`).
 *
 * Every name is fenced by `(?<![-\w])…(?![-\w])`, which is what makes scanning
 * raw rule text safe: it rejects `white-space` (a `-` follows) and `var(--red)`
 * (a `-` precedes), the two false positives that would otherwise swamp the
 * real findings.
 */
function hardcodedColours(rule: CSSStyleRule): readonly string[] {
  return matches(
    /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|(?<![-\w])(?:white|black|red|green|blue|yellow|orange|purple|gray|grey|silver)(?![-\w])/g,
  )(rule);
}

export interface RootToken {
  readonly name: string;
  /** As written in `:root` — usually a `color-mix` or a literal. */
  readonly declared: string;
  /** What the element actually resolves to right now, theme applied. */
  readonly computed: string;
}

/**
 * Every custom property `:root` declares, read from the rule itself rather
 * than from a list kept here — a list would silently omit the next token
 * someone adds, which is precisely the failure the gallery is meant to catch.
 */
export function rootTokens(): readonly RootToken[] {
  const root = styleRules().find((rule) => rule.selectorText === ":root");
  if (root === undefined) {
    return [];
  }
  const computedStyle = getComputedStyle(document.documentElement);
  const tokens: RootToken[] = [];
  for (const property of root.style) {
    if (!property.startsWith("--")) {
      continue;
    }
    tokens.push({
      name: property,
      declared: root.style.getPropertyValue(property).trim(),
      computed: computedStyle.getPropertyValue(property).trim(),
    });
  }
  return tokens;
}

export function auditAppStyles(): readonly AuditGroup[] {
  const rules = styleRules();
  /**
   * `:root` is where the token layer legitimately lives: its `color-mix`
   * fallbacks and its hex literals ARE the system, not ad-hoc values. Counting
   * them would overstate every colour number — `--fg 12/20/34/52%` are the
   * definitions of `--hair`, `--hair-strong`, `--text-muted` and
   * `--text-faint`, which is exactly what a token is supposed to look like.
   */
  const authored = rules.filter((rule) => rule.selectorText !== ":root");
  return [
    {
      label: "font-size",
      note: "DL-4.4 names five sizes in prose; the file declares this many literals.",
      entries: tally(rules, declared("font-size")),
    },
    {
      label: "border-radius",
      note: "DL-20.1 names two roles — `--radius-control` and `--radius-surface`. Every literal still counted here is a third radius picked at a use site, so this number is phase 2's burn-down list.",
      entries: tally(rules, declared("border-radius")),
    },
    {
      label: "spacing steps (padding · gap · margin)",
      note: "Shorthands are split, so this counts distinct STEPS, not distinct declarations. No spacing scale exists, so any step is reachable.",
      entries: tally(
        rules,
        lengthSteps([
          "padding",
          "padding-top",
          "padding-right",
          "padding-bottom",
          "padding-left",
          "gap",
          "row-gap",
          "column-gap",
          "margin",
          "margin-top",
          "margin-right",
          "margin-bottom",
          "margin-left",
        ]),
      ),
    },
    {
      label: "duration",
      note: "DL-1.2 caps duration at 300ms but does not say which durations exist.",
      entries: tally(rules, matches(/\b\d+(?:\.\d+)?m?s\b/g)),
    },
    {
      label: "z-index",
      note: "Stacking order is a set of loose integers, not a named layer scale.",
      entries: tally(rules, declared("z-index")),
    },
    {
      label: "state mix over --fg",
      note: "DL-5.1 specifies one 4% wash. Token definitions in `:root` are excluded, so every value here was chosen at a use site.",
      entries: tally(authored, matches(/var\(--fg\)\s+\d+%/g)),
    },
    {
      label: "state mix over --accent",
      note: "DL-3.1 governs where accent may appear, not how strong it is.",
      entries: tally(authored, matches(/var\(--accent\)\s+\d+%/g)),
    },
    {
      label: "hardcoded colour",
      note: "DL-2.1 forbids these outside `:root`, so anything listed is a live violation. Named colours are included now: the first version scanned hex and rgb only and missed a `white` inside a color-mix.",
      entries: tally(authored, hardcodedColours),
    },
  ];
}
