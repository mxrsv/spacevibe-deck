import { buildForcedStates, type RuleNode } from "../force-states";

/**
 * Forced hover, focus and pressed for the small-UI section, built from the controls' own
 * Tailwind rules. `force-states.ts` reads `src/styles.css` only, and the preset's rules sit in
 * `@layer`s of the section's own stylesheet, so this reads that sheet instead and hands the
 * rules to the same transform. Nothing here restates a declaration: a control that changes its
 * hover colour changes the forced cell with it.
 */

/** The part of a CSSOM rule this reads, so a test can pass plain objects. */
export interface CssRuleLike {
  readonly cssText: string;
  readonly selectorText?: string;
  readonly style?: { readonly cssText: string };
  readonly cssRules?: ArrayLike<CssRuleLike>;
}

/** The at-rules that scope other rules. `@keyframes`, `@font-face` and `@property` are left out. */
const GROUPING = /^@(?:media|supports|layer|container)\b/;

/** Written by Vite into the `data-vite-dev-id` of the style element this section's CSS becomes. */
const SECTION_SHEET = "sections/control-states-section.css";

const preludeOf = (rule: CssRuleLike): string =>
  rule.cssText.slice(0, rule.cssText.indexOf("{")).trim();

/**
 * Tailwind writes a colour fallback and its `@supports` upgrade as one rule with the at-rule
 * nested inside. A CSSOM style's `cssText` leaves nested rules out, so each nested group is
 * lifted to a group of its own around the same selector, right after its parent: the order the
 * browser applies them in.
 */
function nestedGroups(rule: CssRuleLike, selectorText: string): RuleNode[] {
  const lifted: RuleNode[] = [];
  for (const inner of Array.from(rule.cssRules ?? [])) {
    const condition = preludeOf(inner);
    if (inner.cssRules === undefined || !GROUPING.test(condition)) continue;
    const declarations = Array.from(inner.cssRules)
      .flatMap((nested) =>
        nested.selectorText === undefined && nested.style ? [nested.style.cssText] : [],
      )
      .join(" ");
    if (declarations !== "")
      lifted.push({
        kind: "group",
        condition,
        children: [{ kind: "style", selectorText, declarations }],
      });
  }
  return lifted;
}

/** The rules as `RuleNode`s with their `@layer`, `@media` and `@supports` kept, in source order. */
export function ruleNodes(rules: ArrayLike<CssRuleLike>): RuleNode[] {
  const nodes: RuleNode[] = [];
  for (const rule of Array.from(rules)) {
    if (rule.selectorText !== undefined && rule.style !== undefined) {
      nodes.push(
        { kind: "style", selectorText: rule.selectorText, declarations: rule.style.cssText },
        ...nestedGroups(rule, rule.selectorText),
      );
    } else if (rule.cssRules !== undefined) {
      const condition = preludeOf(rule);
      if (GROUPING.test(condition)) {
        nodes.push({ kind: "group", condition, children: ruleNodes(rule.cssRules) });
      }
    }
  }
  return nodes;
}

/**
 * A Tailwind class such as `hover:bg-muted` is written `.hover\:bg-muted:hover`, and
 * `scopeSelector` replaces every `:hover` it finds, the escaped one in the class name included,
 * which renames the class and matches nothing. Escaped colons are hidden from it for the build
 * and put back in the result.
 */
const HIDDEN_COLON = "\uE000";

const hideColons = (nodes: readonly RuleNode[]): RuleNode[] =>
  nodes.map((node) =>
    node.kind === "style"
      ? { ...node, selectorText: node.selectorText.replaceAll("\\:", HIDDEN_COLON) }
      : { ...node, children: hideColons(node.children) },
  );

/** The forced-state stylesheet for these rules. */
export function forcedCss(nodes: readonly RuleNode[]): string {
  return buildForcedStates(hideColons(nodes)).css.replaceAll(HIDDEN_COLON, "\\:");
}

/**
 * Appends the forced-state sheet of one section stylesheet (the small-UI section's by default)
 * and returns the undo. A document without the sheet gets nothing.
 */
export function installControlStateForcing(sheetSuffix: string = SECTION_SHEET): () => void {
  const nodes: RuleNode[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode;
    const id = owner instanceof HTMLElement ? owner.dataset.viteDevId : undefined;
    if (id?.endsWith(sheetSuffix))
      nodes.push(...ruleNodes(sheet.cssRules as ArrayLike<CssRuleLike>));
  }
  const style = document.createElement("style");
  style.dataset.gxControlStates = "";
  style.textContent = forcedCss(nodes);
  document.head.append(style);
  return () => {
    style.remove();
  };
}
