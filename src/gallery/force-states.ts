import { appRuleLists } from "./css-audit";

/**
 * Interaction states forced onto a specimen, built from the app's own rules.
 *
 * A grid cannot show hover: the pointer is in exactly one place, and a matrix
 * exists precisely to put four themes side by side in the same state. Copying
 * the hover declarations into `gallery.css` would work once and then drift —
 * the gallery would be asserting what the app used to look like, which is the
 * failure `marketing/stage/appwin.js` already demonstrates.
 *
 * So the rules are read back out of the live stylesheet and re-emitted with
 * the pseudo-class neutralised and every selector scoped under a marker class:
 *
 *     .tab:hover { … }        →   .gx-force--hover .tab:not(.gx-never) { … }
 *     .cfg-btn:focus-visible  →   .gx-force--focus .cfg-btn:not(.gx-never)
 *
 * Three properties make that faithful rather than merely plausible, and all
 * three were wrong in the first version:
 *
 *   1. **Every rule is copied, in source order**, not only the ones carrying a
 *      pseudo-class. Copying only those would move them past every later rule
 *      in the file, and a selected tab would start reading as a hovered one.
 *   2. **The pseudo-class is replaced, not deleted.** `:hover` weighs one
 *      class, so removing it would cost every state rule a full class against
 *      its non-pseudo neighbours — `.a:hover` and `.a.b` are tied in the app
 *      and would stop being tied here. `:not(.gx-never)` weighs the same one
 *      class and matches everything, because nothing carries that class.
 *   3. **`@media` and `@supports` keep their condition** instead of being
 *      skipped. Skipping them was not neutral: the unconditional copies land
 *      at a higher specificity and later in the document, so a cell under
 *      `prefers-reduced-motion: reduce` got its transitions back and the
 *      workspace spinner started turning — the forced sheet quietly overrode
 *      the very rules DL-1.5 exists for. A condition is evaluated against the
 *      viewport either way, which is what the app does too.
 *
 * `:disabled` and `:checked` are not forced. They are properties of a real
 * element, so the matrix passes `disabled` to the real component and lets the
 * browser apply them.
 */

export type ForcedState = "hover" | "active" | "focus";

export const FORCED_STATES: readonly ForcedState[] = [
  "hover",
  "active",
  "focus",
];

/**
 * Longest first. `:focus-visible` and `:focus-within` both contain `:focus`,
 * so replacing the short one first would leave `-visible` stranded in the
 * selector and the rule would silently match nothing.
 */
const FORCED_PSEUDOS: Record<ForcedState, readonly string[]> = {
  hover: [":hover"],
  active: [":active"],
  focus: [":focus-visible", ":focus-within", ":focus"],
};

export const FORCE_CLASS: Record<ForcedState, string> = {
  hover: "gx-force--hover",
  active: "gx-force--active",
  focus: "gx-force--focus",
};

/**
 * The stand-in for a stripped pseudo-class: one class of specificity, and it
 * matches every element because nothing anywhere sets this class.
 */
const NEVER = ":not(.gx-never)";

/** The app stylesheet reduced to what the transform needs, in source order. */
export type RuleNode =
  | {
      readonly kind: "style";
      readonly selectorText: string;
      /** The declaration block without its braces, `!important` intact. */
      readonly declarations: string;
    }
  | {
      readonly kind: "group";
      /** The at-rule as it will be re-opened, e.g. `@media (min-width: 40em)`. */
      readonly condition: string;
      readonly children: readonly RuleNode[];
    };

/**
 * Splits a selector list on its top-level commas only.
 *
 * A plain `split(",")` cuts inside `:not(.a, .b)` and inside an attribute
 * value, producing two selector fragments that are each invalid — and one
 * invalid component drops the whole comma-joined rule, so the failure is
 * silent. `styles.css` has no such selector today; this is what keeps the next
 * one from quietly deleting a rule from the forced sheet.
 */
export function splitSelectorList(selectorText: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < selectorText.length; i += 1) {
    const char = selectorText[i];
    if (quote !== null) {
      if (char === quote && selectorText[i - 1] !== "\\") {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(selectorText.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selectorText.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/** Whether a selector carries any pseudo-class this state forces. */
function carries(selectorText: string, state: ForcedState): boolean {
  return FORCED_PSEUDOS[state].some((pseudo) => selectorText.includes(pseudo));
}

/** `.a:hover, .b` under `hover` → `.gx-force--hover .a:not(.gx-never), .gx-force--hover .b`. */
export function scopeSelector(
  selectorText: string,
  state: ForcedState,
): string {
  return splitSelectorList(selectorText)
    .map((part) => {
      let selector = part;
      for (const pseudo of FORCED_PSEUDOS[state]) {
        // `split`/`join` rather than `replaceAll`: this repo's `lib` target
        // predates it, and a tsconfig bump is not this change's business.
        selector = selector.split(pseudo).join(NEVER);
      }
      return `.${FORCE_CLASS[state]} ${selector}`;
    })
    .join(", ");
}

function emit(
  nodes: readonly RuleNode[],
  state: ForcedState,
  into: string[],
): void {
  for (const node of nodes) {
    if (node.kind === "style") {
      if (node.declarations !== "") {
        into.push(
          `${scopeSelector(node.selectorText, state)} { ${node.declarations} }`,
        );
      }
      continue;
    }
    const inner: string[] = [];
    emit(node.children, state, inner);
    if (inner.length > 0) {
      into.push(`${node.condition} {\n${inner.join("\n")}\n}`);
    }
  }
}

function anyCarries(nodes: readonly RuleNode[], state: ForcedState): boolean {
  return nodes.some((node) =>
    node.kind === "style"
      ? carries(node.selectorText, state)
      : anyCarries(node.children, state),
  );
}

export interface ForcedStateSheet {
  readonly css: string;
  /** States the stylesheet actually declares a rule for. */
  readonly present: readonly ForcedState[];
  /**
   * States no rule declares. Their copy is not emitted at all — it would be
   * the app's own declarations restated at a higher specificity for no visual
   * difference — and the matrix says so on the row rather than showing a cell
   * that silently equals its neighbour. `:active` is in here today.
   */
  readonly absent: readonly ForcedState[];
}

export function buildForcedStates(
  nodes: readonly RuleNode[],
): ForcedStateSheet {
  const present: ForcedState[] = [];
  const absent: ForcedState[] = [];
  const lines: string[] = [];
  for (const state of FORCED_STATES) {
    if (!anyCarries(nodes, state)) {
      absent.push(state);
      continue;
    }
    present.push(state);
    emit(nodes, state, lines);
  }
  return { css: lines.join("\n"), present, absent };
}

/** The app sheet as `RuleNode`s, conditions preserved, in source order. */
function appRules(): readonly RuleNode[] {
  const read = (list: CSSRuleList): RuleNode[] => {
    const nodes: RuleNode[] = [];
    for (const rule of list) {
      if (rule instanceof CSSStyleRule) {
        nodes.push({
          kind: "style",
          selectorText: rule.selectorText,
          declarations: rule.style.cssText,
        });
      } else if (rule instanceof CSSMediaRule) {
        nodes.push({
          kind: "group",
          condition: `@media ${rule.conditionText}`,
          children: read(rule.cssRules),
        });
      } else if (rule instanceof CSSSupportsRule) {
        nodes.push({
          kind: "group",
          condition: `@supports ${rule.conditionText}`,
          children: read(rule.cssRules),
        });
      }
      // `@keyframes` has no selector to scope, and its frames are reached
      // through the `animation-name` the copied rules already carry.
    }
    return nodes;
  };
  return appRuleLists().flatMap(read);
}

export interface InstalledForcedStates {
  readonly absent: readonly ForcedState[];
  dispose(): void;
}

/**
 * Appends the forced-state sheet and returns the undo plus what it could not
 * build.
 *
 * It must be appended after the app sheet, which in dev is already in the
 * document by the time any component mounts. Rebuilding on mount rather than
 * once at boot is what makes an HMR edit to `styles.css` reach the forced
 * copies: leave the section and come back.
 */
export function installForcedStates(): InstalledForcedStates {
  const built = buildForcedStates(appRules());
  const style = document.createElement("style");
  style.dataset.gxForcedStates = "";
  style.textContent = built.css;
  document.head.append(style);
  return {
    absent: built.absent,
    dispose: () => {
      style.remove();
    },
  };
}
