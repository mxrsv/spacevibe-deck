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
  it("reaches nothing outside the switch's two classes", () => {
    const prefix = ".stage--flush";
    const frame = ":root.shell-frame";
    const loose = rules.flatMap((rule) =>
      rule.selectors.filter(
        (selector) =>
          selector !== prefix &&
          selector !== frame &&
          !selector.startsWith(`${prefix} `) &&
          !selector.startsWith(`${frame} `),
      ),
    );
    expect(loose, "a selector without the switch's class changes the old look").toEqual([]);
  });

  it("raises the frame row to the mock's 40px only under the switch's root class", () => {
    expect(value(":root.shell-frame", "--frame-h")).toBe("40px");
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

  it("sets the bar's text on the type scale's xs step with 12px of air at each end", () => {
    expect(value(".stage--flush .space-bar__name", "font-size")).toBe("var(--text-xs)");
    expect(value(".stage--flush .space-bar", "margin-left")).toBe("4px");
    expect(value(".stage--flush .stage__strip-actions", "margin-right")).toBe("4px");
  });

  it("draws the browser and board chips as icons", () => {
    expect(value(".stage--flush .tabbar__tabs .tab__label", "display")).toBe("none");
  });

  it("rings a lone pane while the keyboard is inside it", () => {
    expect(value(".stage--flush .pane-slot:focus-within > .pane", "border-color")).toBe(
      "var(--text-muted)",
    );
    expect(value(".stage--flush .pane-slot:focus-within::after", "height")).toBe("2px");
  });

  it("keeps the sentence for a screen reader without drawing it", () => {
    expect(value(".stage--flush .pane-agent-header__message--hidden", "clip-path")).toBe(
      "inset(50%)",
    );
  });

  it("switches the top-tab bar, which sits outside the stage, with the same rules", () => {
    expect(value(":root.shell-frame .tabbar .space-bar__name", "font-size")).toBe("var(--text-xs)");
    expect(value(":root.shell-frame .tabbar .space-bar__space", "font-weight")).toBe("600");
    expect(value(":root.shell-frame .tabbar .tabbar__tabs .tab__label", "display")).toBe("none");
  });

  it("lights the seam, not a gutter, when the grip is hovered", () => {
    expect(value(":root.shell-frame .sidebar-grip::after", "width")).toBe("1px");
  });
});
