import { describe, expect, it } from "vitest";
import { needsWindowsDecision, parseRules, shorthandWeight, toSites } from "./css-weight-sites";

/**
 * The reader behind `windows-weights.test.ts` must fail closed: a shorthand it
 * cannot read is `"unsupported"`, which that test rejects, never a quiet 400.
 * Fixtures here are strings, not repo CSS, so they keep failing the way they
 * should even while every shipped stylesheet is clean.
 */
describe("shorthandWeight", () => {
  it.each([
    ["500 var(--type-meta) / 1.2 var(--ui-font)", 500],
    ["650 22px/1.08 var(--ui-font)", 650],
    // Each of these once read as 400 and let a new 500 through.
    ["normal 500 var(--type-body) / 1.3 var(--ui-font)", 500],
    ["500 italic 12px/1 var(--ui-font)", 500],
    ["500 clamp(11px, 1vw, 13px)/1 var(--ui-font)", 500],
    ["italic small-caps condensed bold 12px/1 sans-serif", 700],
    ["oblique 10deg 620 12px sans-serif", 620],
    ["bold 12px sans-serif", 700],
  ])("reads the weight in `font: %s`", (value, weight) => {
    expect(shorthandWeight(value)).toBe(weight);
  });

  it.each([
    ["12px/1.4 var(--ui-font)"],
    ["var(--type-body) var(--ui-font)"],
    ["var(--type-meta)/1.35 var(--ui-font)"],
    ["normal 12px sans-serif"],
  ])("reads a shorthand with no weight token as normal: `font: %s`", (value) => {
    expect(shorthandWeight(value)).toBe(400);
  });

  it.each([["inherit"], ["initial"], ["unset"]])("says nothing for `font: %s`", (value) => {
    expect(shorthandWeight(value)).toBe("inherit");
  });

  it.each([
    ["500 wat 12px sans-serif", "an unknown token before the size"],
    ["bolder 12px sans-serif", "a relative weight"],
    ["lighter 12px sans-serif", "a relative weight"],
    ["caption", "a system font"],
    ["var(--font)", "a whole shorthand from a variable"],
    ["500 12px", "a size with no family"],
    ["500", "no size at all"],
  ])("fails closed on `font: %s` (%s)", (value) => {
    expect(shorthandWeight(value)).toBe("unsupported");
  });
});

describe("weights a stylesheet states", () => {
  const fixture = `
    .a { font: normal 500 var(--type-body) / 1.3 var(--ui-font); }
    .b { font: 500 italic 12px/1 var(--ui-font); }
    .c { font: 500 clamp(11px, 1vw, 13px)/1 var(--ui-font); }
    .d { font-weight: 500; }
    .e { font: 600 12px/1 sans-serif; }
    @media (max-width: 400px) { .f { font-weight: 520; } }
  `;
  const sites = toSites(parseRules("fixture.css", fixture));

  it("owes a Windows decision for every 500, whichever way it is written", () => {
    expect(sites.filter(needsWindowsDecision).map((site) => site.selector)).toEqual([
      ".a",
      ".b",
      ".c",
      ".d",
      ".f",
    ]);
  });

  it("keeps the at-rule wrapper a decision must mirror", () => {
    expect(sites.find((site) => site.selector === ".f")?.wrap).toBe("@media (max-width: 400px)");
  });

  it("lets the last weight declaration in a rule win, as the cascade does", () => {
    const rules = parseRules(
      "fixture.css",
      ".g { font-weight: 500; font: 12px/1 sans-serif; } .h { font: 12px/1 sans-serif; font-weight: 700; }",
    );
    expect(rules.map((rule) => rule.weight)).toEqual([400, 700]);
  });
});
