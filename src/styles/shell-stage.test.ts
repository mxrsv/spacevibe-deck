import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRules } from "./css-weight-sites";

/**
 * The flush stage ships behind a release switch, so the card panes of `06-stage-panes.css` must
 * stay what a packaged build draws. The only thing that keeps the new sheet from leaking into
 * them is its selector prefix; this reads the sheet for it.
 */

const FILE = "src/styles/31-shell-stage.css";
const rules = parseRules(FILE, readFileSync(FILE, "utf8"));
const value = (selector: string, prop: string): string | undefined =>
  rules
    .filter((rule) => rule.selectors.includes(selector))
    .flatMap((rule) => rule.declarations)
    .findLast((declaration) => declaration.prop === prop)?.value;

describe("the flush stage stylesheet", () => {
  it("reaches nothing outside a stage that carries the switch's class", () => {
    const prefix = ".stage--flush";
    const loose = rules.flatMap((rule) =>
      rule.selectors.filter(
        (selector) => selector !== prefix && !selector.startsWith(`${prefix} `),
      ),
    );
    expect(loose, "every selector must start with `.stage--flush` or the old look changes").toEqual(
      [],
    );
  });

  it("closes the gutter, the corners and the card edge", () => {
    expect(value(".stage--flush", "--stage-gutter")).toBe("0px");
    expect(value(".stage--flush .pane", "border-radius")).toBe("0");
    expect(value(".stage--flush .pane", "border-color")).toBe("transparent");
  });

  it("draws the seam between panes with the divider, one pixel wide", () => {
    expect(value(".stage--flush .split__divider", "flex-basis")).toBe("1px");
    expect(value(".stage--flush .split__divider", "background")).toBe("var(--seam-divider)");
  });

  it("puts a 1px border under the bar above the stage", () => {
    expect(value(".stage--flush .stage__strip", "border-bottom")).toBe(
      "1px solid var(--seam-divider)",
    );
  });
});
