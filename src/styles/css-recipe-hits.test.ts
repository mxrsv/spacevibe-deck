import { describe, expect, it } from "vitest";
import { emptyExceptions, excepted } from "../../scripts/ui-composition-ledger";
import { findCssRecipeHits } from "./css-recipe-hits";
import { parseRules } from "./css-weight-sites";

/** AC-4's CSS kinds: each seeded value fails, and the same value under `ui-scale:` passes. */
function hits(css: string): string[] {
  const lines = css.split("\n");
  return findCssRecipeHits(parseRules("seed.css", css), {
    isTextField: (selector) => selector.includes(".text-input"),
    weights: true,
  })
    .filter((hit) => !excepted(lines, hit.line))
    .map(({ rule, line }) => `${rule}@${line}`);
}

describe("findCssRecipeHits", () => {
  it("fails one seeded value of each kind", () => {
    const css = `.a {
  border-radius: 5px;
  height: 30px;
  padding: 3px 8px;
  font-weight: 500;
  box-shadow: 0 2px 8px black;
}
.b:focus-visible { box-shadow: 0 0 0 3px var(--focus-ring); }
.c:hover { background: color-mix(in srgb, var(--tone) 9%, transparent); }
.d.is-active { background-color: var(--accent); }
.e { font: 500 var(--type-body) var(--ui-font); }
.f { box-shadow: var(--elev-1); transition: box-shadow 150ms; }
.g { margin: -5px; gap: 0.3rem; }`;
    expect(hits(css)).toEqual([
      "radius@2",
      "height@3",
      "spacing@4",
      "weight@5",
      "shadow@6",
      "focus@8",
      "state-bg@9",
      "state-bg@10",
      "weight@11",
      "shadow@12",
      "spacing@13",
      "spacing@13",
    ]);
  });

  it("passes the recipes and the values that are not recipes", () => {
    const css = `.a {
  border-radius: var(--radius-control) var(--radius-control) 0 0;
  height: 28px;
  min-height: var(--row-44);
  padding: 0 var(--control-pad-32) 2px;
  margin: -4px auto;
  font-weight: var(--weight-strong);
  box-shadow: inset 0 0 0 1px var(--control-frame);
}
.big { height: 36px; border-radius: 6px; }
.circle { border-radius: 50%; height: 120px; width: 13px; }
.text-input:focus-visible { box-shadow: 0 0 0 var(--ring-w) var(--focus-ring); }
.row:hover { background: var(--state-hover-bg); }
.row:active { background-image: linear-gradient(var(--state-pressed-bg), var(--state-pressed-bg)); }
.row.is-selected:focus-visible { background: var(--tab-active-focus-bg); }
.row[aria-pressed="true"] { background: transparent; }
.btn-primary:hover { background: var(--primary-hover); }
.pane-divider:hover { background: var(--ring); }
.menu { box-shadow: var(--elev-1); transition: background-color var(--duration); }
.x { font: var(--type-body) / var(--leading-body) var(--ui-font); }`;
    expect(hits(css)).toEqual([]);
  });

  it("allows 6px only on a block 36 to 40 high, and --ring only on the resize gutter", () => {
    expect(hits(`.a { height: 28px; border-radius: 6px; }`)).toEqual(["radius@1"]);
    expect(hits(`.row:hover { background: var(--ring); }`)).toEqual(["state-bg@1"]);
  });

  it("passes a value under `ui-scale: <reason>` and fails a reasonless one", () => {
    const css = `.a {
  /* ui-scale: the native traffic lights need 26 */
  height: 26px;
  /* ui-scale: */
  padding: 3px;
}`;
    expect(hits(css)).toEqual(["spacing@5"]);
    expect(emptyExceptions(css)).toEqual([4]);
  });
});
