import { describe, expect, it } from "vitest";
import { buildForcedStates, scopeSelector, splitSelectorList, type RuleNode } from "./force-states";

/**
 * The DOM half of `force-states` is one `document.head.append`. The half worth
 * testing is the selector transform and the cascade it has to preserve, which
 * is pure string work and is where every way of getting this wrong lives —
 * three of the cases below are regressions an external review found after the
 * first version shipped.
 */

const style = (selectorText: string, declarations = "color: red;"): RuleNode => ({
  kind: "style",
  selectorText,
  declarations,
});

describe("splitSelectorList", () => {
  it("splits on top-level commas", () => {
    expect(splitSelectorList(".a, .b")).toEqual([".a", ".b"]);
  });

  it("does not split inside a functional pseudo-class", () => {
    // A plain split(",") cuts this into `.a:not(.b` and `.c)`, and one
    // invalid component drops the whole rule without an error.
    expect(splitSelectorList(".a:not(.b, .c), .d")).toEqual([".a:not(.b, .c)", ".d"]);
  });

  it("does not split inside an attribute value", () => {
    expect(splitSelectorList('[data-x="a,b"], .c')).toEqual(['[data-x="a,b"]', ".c"]);
  });
});

describe("scopeSelector", () => {
  it("neutralises the pseudo-class and scopes what is left", () => {
    expect(scopeSelector(".tab:hover", "hover")).toBe(".gx-force--hover .tab:not(.gx-never)");
  });

  it("keeps the pseudo-class's specificity instead of deleting it", () => {
    // `.a:hover` and `.a.b` are tied in the app. Deleting `:hover` would cost
    // the state rule a class and silently hand the tie to its neighbour, so
    // the replacement has to weigh exactly one class.
    const hovered = scopeSelector(".a:hover", "hover");
    const sibling = scopeSelector(".a.b", "hover");
    const classes = (selector: string): number => selector.split(".").length - 1;
    expect(classes(hovered)).toBe(classes(sibling));
  });

  it("scopes every part of a selector list, not only the first", () => {
    expect(scopeSelector(".a:hover, .b:hover", "hover")).toBe(
      ".gx-force--hover .a:not(.gx-never), .gx-force--hover .b:not(.gx-never)",
    );
  });

  it("scopes a rule that carries no pseudo-class at all", () => {
    // Copying these is what preserves the cascade: without them a forced
    // hover rule would jump ahead of every later rule in the file.
    expect(scopeSelector(".tab.is-active", "hover")).toBe(".gx-force--hover .tab.is-active");
  });

  it("replaces the long focus pseudo-classes before the short one", () => {
    // `:focus-visible` contains `:focus`. Replacing `:focus` first would
    // leave `-visible` behind and the rule would match nothing.
    expect(scopeSelector(".cfg-btn:focus-visible", "focus")).toBe(
      ".gx-force--focus .cfg-btn:not(.gx-never)",
    );
    expect(scopeSelector(".cfg-btn--overlay:focus-within", "focus")).toBe(
      ".gx-force--focus .cfg-btn--overlay:not(.gx-never)",
    );
  });

  it("leaves a pseudo-class the state does not own in place", () => {
    // `.update-action:hover:not(:disabled)` must keep the `:not(:disabled)`,
    // or the forced cell would style a disabled control as hovered.
    expect(scopeSelector(".update-action:hover:not(:disabled)", "hover")).toBe(
      ".gx-force--hover .update-action:not(.gx-never):not(:disabled)",
    );
  });

  it("does not mistake the is-active class for the active pseudo-class", () => {
    expect(scopeSelector(".tab.is-active", "active")).toBe(".gx-force--active .tab.is-active");
  });
});

describe("buildForcedStates", () => {
  const nodes: readonly RuleNode[] = [
    style(".tab:hover", "background: red;"),
    style(".tab.is-active", "background: blue;"),
    style(".cfg-btn:focus-visible", "outline: 1px;"),
  ];

  it("keeps source order inside a state, so later rules still win", () => {
    const { css } = buildForcedStates(nodes);
    const hovered = css.indexOf(".gx-force--hover .tab:not(.gx-never) {");
    const selected = css.indexOf(".gx-force--hover .tab.is-active");
    expect(hovered).toBeGreaterThanOrEqual(0);
    expect(selected).toBeGreaterThan(hovered);
  });

  it("reports a state no rule declares and emits nothing for it", () => {
    // styles.css declares no `:active` rule today, so its copy would be the
    // app's own declarations restated for no visual difference.
    const built = buildForcedStates(nodes);
    expect(built.absent).toEqual(["active"]);
    expect(built.present).toEqual(["hover", "focus"]);
    expect(built.css).not.toContain("gx-force--active");
  });

  it("keeps a conditional block's condition instead of flattening it", () => {
    // Flattening was not neutral: the unconditional copies outrank the
    // reduced-motion rules they were meant to leave alone, so a forced cell
    // got its transitions back (DL-1.5).
    const built = buildForcedStates([
      style(".tab:hover", "transition: background 0.16s;"),
      {
        kind: "group",
        condition: "@media (prefers-reduced-motion: reduce)",
        children: [style(".tabbar *", "transition: none;")],
      },
    ]);
    expect(built.css).toContain("@media (prefers-reduced-motion: reduce) {");
    expect(built.css).toContain(".gx-force--hover .tabbar *");
    expect(built.css.indexOf("@media")).toBeGreaterThan(
      built.css.indexOf(".gx-force--hover .tab:not(.gx-never)"),
    );
  });

  it("drops an empty conditional block rather than emitting a bare at-rule", () => {
    const built = buildForcedStates([
      style(".a:hover"),
      {
        kind: "group",
        condition: "@media print",
        children: [style(".b", "")],
      },
    ]);
    expect(built.css).not.toContain("@media print");
  });

  it("drops a rule with an empty declaration block", () => {
    expect(buildForcedStates([style(".a:hover", "")]).css).toBe("");
  });
});
