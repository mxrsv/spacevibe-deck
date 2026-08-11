import { describe, expect, it } from "vitest";
import {
  FORCED_STATES,
  forcedStateCss,
  scopeSelector,
  type StyleRuleSource,
} from "./force-states";

/**
 * The DOM half of `force-states` is one `document.head.append`. The half worth
 * testing is the selector transform, which is pure string work and is where
 * every way of getting this wrong lives.
 */

describe("scopeSelector", () => {
  it("strips the pseudo-class and scopes what is left", () => {
    expect(scopeSelector(".tab:hover", "hover")).toBe(".gx-force--hover .tab");
  });

  it("scopes every part of a selector list, not only the first", () => {
    expect(scopeSelector(".a:hover, .b:hover", "hover")).toBe(
      ".gx-force--hover .a, .gx-force--hover .b",
    );
  });

  it("scopes a rule that carries no pseudo-class at all", () => {
    // Copying these is what preserves the cascade: without them a forced
    // hover rule would jump ahead of every later rule in the file.
    expect(scopeSelector(".tab.is-active", "hover")).toBe(
      ".gx-force--hover .tab.is-active",
    );
  });

  it("strips the long focus pseudo-classes before the short one", () => {
    // `:focus-visible` contains `:focus`. Stripping `:focus` first would leave
    // `.cfg-btn-visible`, a selector that matches nothing and fails silently.
    expect(scopeSelector(".cfg-btn:focus-visible", "focus")).toBe(
      ".gx-force--focus .cfg-btn",
    );
    expect(scopeSelector(".cfg-btn--overlay:focus-within", "focus")).toBe(
      ".gx-force--focus .cfg-btn--overlay",
    );
  });

  it("leaves a pseudo-class the state does not own in place", () => {
    // `.update-action:hover:not(:disabled)` must keep the `:not(:disabled)`,
    // or the forced cell would style a disabled control as hovered.
    expect(scopeSelector(".update-action:hover:not(:disabled)", "hover")).toBe(
      ".gx-force--hover .update-action:not(:disabled)",
    );
  });

  it("does not mistake the is-active class for the active pseudo-class", () => {
    expect(scopeSelector(".tab.is-active", "active")).toBe(
      ".gx-force--active .tab.is-active",
    );
  });
});

describe("forcedStateCss", () => {
  const rules: readonly StyleRuleSource[] = [
    { selectorText: ".tab:hover", declarations: "background: red;" },
    { selectorText: ".tab.is-active", declarations: "background: blue;" },
  ];

  it("emits one scoped copy of the whole input per state", () => {
    const css = forcedStateCss(rules);
    for (const state of FORCED_STATES) {
      expect(css).toContain(`.gx-force--${state} .tab.is-active`);
    }
    expect(css.split("\n")).toHaveLength(rules.length * FORCED_STATES.length);
  });

  it("keeps source order inside a state, so later rules still win", () => {
    const css = forcedStateCss(rules);
    const hovered = css.indexOf(".gx-force--hover .tab {");
    const selected = css.indexOf(".gx-force--hover .tab.is-active");
    expect(hovered).toBeGreaterThanOrEqual(0);
    expect(selected).toBeGreaterThan(hovered);
  });

  it("drops a rule with an empty declaration block", () => {
    expect(forcedStateCss([{ selectorText: ".x", declarations: "" }])).toBe("");
  });
});
