import { describe, expect, it } from "vitest";
import { forcedCss, ruleNodes, type CssRuleLike } from "./control-states-force";

const style = (selectorText: string, cssText: string): CssRuleLike => ({
  cssText: `${selectorText} { ${cssText} }`,
  selectorText,
  style: { cssText },
});
const group = (prelude: string, cssRules: CssRuleLike[]): CssRuleLike => ({
  cssText: `${prelude} { ... }`,
  cssRules,
});

describe("ruleNodes", () => {
  it("keeps a style rule's selector and declarations", () => {
    expect(ruleNodes([style(".a", "color: red;")])).toEqual([
      { kind: "style", selectorText: ".a", declarations: "color: red;" },
    ]);
  });

  it("keeps @layer, @media and @supports around their rules, nested", () => {
    const nodes = ruleNodes([
      group("@layer utilities", [
        style(".a", "color: red;"),
        group("@supports (color: color-mix(in lab, red, red))", [style(".b", "color: blue;")]),
      ]),
      group("@media (min-width: 40em)", [style(".c", "color: green;")]),
    ]);
    expect(nodes).toEqual([
      {
        kind: "group",
        condition: "@layer utilities",
        children: [
          { kind: "style", selectorText: ".a", declarations: "color: red;" },
          {
            kind: "group",
            condition: "@supports (color: color-mix(in lab, red, red))",
            children: [{ kind: "style", selectorText: ".b", declarations: "color: blue;" }],
          },
        ],
      },
      {
        kind: "group",
        condition: "@media (min-width: 40em)",
        children: [{ kind: "style", selectorText: ".c", declarations: "color: green;" }],
      },
    ]);
  });

  it("drops what has no selector to scope", () => {
    expect(
      ruleNodes([
        group("@keyframes spin", [style("to", "rotate: 1turn;")]),
        { cssText: "@layer theme, base, utilities;" },
        { cssText: "@font-face { font-family: X; }" },
      ]),
    ).toEqual([]);
  });
});

describe("a Tailwind rule nested with its @supports upgrade", () => {
  it("lifts the nested group to a group of its own, after its parent", () => {
    const rule: CssRuleLike = {
      ...style(".bg-x", "background-color: var(--x);"),
      cssRules: [
        {
          cssText: "@supports (color: color-mix(in lab, red, red)) { }",
          cssRules: [
            {
              cssText: "",
              style: { cssText: "background-color: color-mix(in oklab, red 10%, transparent);" },
            },
          ],
        },
      ],
    };
    expect(ruleNodes([rule])).toEqual([
      { kind: "style", selectorText: ".bg-x", declarations: "background-color: var(--x);" },
      {
        kind: "group",
        condition: "@supports (color: color-mix(in lab, red, red))",
        children: [
          {
            kind: "style",
            selectorText: ".bg-x",
            declarations: "background-color: color-mix(in oklab, red 10%, transparent);",
          },
        ],
      },
    ]);
  });
});

describe("forcedCss", () => {
  it("forces a layered hover rule inside the same layer, under the wrapper class", () => {
    const css = forcedCss(
      ruleNodes([
        group("@layer utilities", [
          style(".hover\\:bg-muted:hover", "background-color: var(--muted);"),
          style(".text-sm", "font-size: 14px;"),
        ]),
      ]),
    );
    expect(css).toContain("@layer utilities {");
    expect(css).toContain(
      ".gx-force--hover .hover\\:bg-muted:not(.gx-never) { background-color: var(--muted); }",
    );
    // The cascade survives: every rule is copied, so a later non-state rule keeps its place.
    expect(css).toContain(".gx-force--hover .text-sm { font-size: 14px; }");
  });

  it("keeps the escaped colon of a variant class name, which is not a pseudo-class", () => {
    const css = forcedCss(
      ruleNodes([
        style(".dark\\:hover\\:bg-muted:is(.dark *):hover", "background-color: var(--muted);"),
      ]),
    );
    expect(css).toContain(
      ".gx-force--hover .dark\\:hover\\:bg-muted:is(.dark *):not(.gx-never) { background-color: var(--muted); }",
    );
  });
});
