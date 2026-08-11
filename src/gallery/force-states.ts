import { appStyleSheets } from "./css-audit";

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
 * the pseudo-class stripped and every selector scoped under a marker class:
 *
 *     .tab:hover { … }        →   .gx-force--hover .tab { … }
 *     .cfg-btn:focus-visible  →   .gx-force--focus .cfg-btn
 *
 * Every rule is copied, not only the ones carrying a pseudo-class, and they
 * are copied in source order. That is what keeps the cascade honest: the
 * prefix adds exactly one class to every selector alike, so specificity and
 * order between two rules inside a forced cell stay in the relation they have
 * in the app, while every forced rule outranks its unprefixed original.
 * Emitting only the pseudo rules would move them past every later rule in the
 * file and a selected tab would start reading as a hovered one.
 *
 * Two omissions, both deliberate:
 *
 *   - Rules inside `@media` / `@supports` are skipped. Their condition is
 *     about the viewport, and a cell is not a viewport — flattening
 *     `max-width: 520px` into a 360px cell would show a responsive state the
 *     app never shows at this window size.
 *   - `:disabled` and `:checked` are not forced. They are properties of a
 *     real element, so the matrix passes `disabled` to the real component and
 *     lets the browser apply them.
 */

export type ForcedState = "hover" | "active" | "focus";

export const FORCED_STATES: readonly ForcedState[] = [
  "hover",
  "active",
  "focus",
];

/**
 * Longest first. `:focus-visible` and `:focus-within` both contain `:focus`,
 * so stripping the short one first would leave `-visible` stranded in the
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

/** One rule reduced to the two parts the transform needs. */
export interface StyleRuleSource {
  readonly selectorText: string;
  /** The declaration block without its braces, `!important` intact. */
  readonly declarations: string;
}

/** `.a:hover, .b` under `hover` becomes `.gx-force--hover .a, .gx-force--hover .b`. */
export function scopeSelector(
  selectorText: string,
  state: ForcedState,
): string {
  return selectorText
    .split(",")
    .map((part) => {
      let selector = part.trim();
      for (const pseudo of FORCED_PSEUDOS[state]) {
        // `split`/`join` rather than `replaceAll`: this repo's `lib` target
        // predates it, and a tsconfig bump is not this change's business.
        selector = selector.split(pseudo).join("");
      }
      return `.${FORCE_CLASS[state]} ${selector}`;
    })
    .join(", ");
}

/** The whole forced-state stylesheet, one scoped copy of the input per state. */
export function forcedStateCss(rules: readonly StyleRuleSource[]): string {
  const lines: string[] = [];
  for (const state of FORCED_STATES) {
    for (const rule of rules) {
      if (rule.declarations === "") {
        continue;
      }
      lines.push(
        `${scopeSelector(rule.selectorText, state)} { ${rule.declarations} }`,
      );
    }
  }
  return lines.join("\n");
}

/** Top-level style rules of the app sheet, in source order. */
function appRules(): readonly StyleRuleSource[] {
  const rules: StyleRuleSource[] = [];
  for (const sheet of appStyleSheets()) {
    for (const rule of sheet.cssRules) {
      // Anything that is not a plain style rule is skipped here rather than
      // descended into: `@media` carries a condition the scoping cannot
      // express, and `@keyframes` has no selector at all.
      if (rule instanceof CSSStyleRule) {
        rules.push({
          selectorText: rule.selectorText,
          declarations: rule.style.cssText,
        });
      }
    }
  }
  return rules;
}

/**
 * Appends the forced-state sheet and returns the undo.
 *
 * It must be appended after the app sheet, which in dev is already in the
 * document by the time any component mounts. Rebuilding on mount rather than
 * once at boot is what makes an HMR edit to `styles.css` reach the forced
 * copies: leave the section and come back.
 */
export function installForcedStates(): () => void {
  const style = document.createElement("style");
  style.dataset.gxForcedStates = "";
  style.textContent = forcedStateCss(appRules());
  document.head.append(style);
  return () => {
    style.remove();
  };
}
