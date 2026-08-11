import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SIDEBAR_DECORATION_IDS } from "../src/lib/sidebar-decorations";

/**
 * A sidebar decoration is spread across three files that nothing at runtime
 * ties together: the id list in `lib/sidebar-decorations.ts`, the artwork in
 * `src/assets/decor/`, and the mask rules in `styles.css`. Rename an id in one
 * of them and the app still builds, still passes typecheck, and quietly paints
 * an empty 44px box — the failure is invisible until someone looks at the
 * sidebar. This file is the tie.
 *
 * It lives under `scripts/` with the repo's other source-scanning gates rather
 * than beside the component: Vite rewrites a `new URL("…svg", import.meta.url)`
 * inside `src/` into a served asset URL, which is exactly the path this test
 * needs to read off disk.
 */

const SOURCE_ROOT = fileURLToPath(new URL("../src/", import.meta.url));

const ART_IDS = SIDEBAR_DECORATION_IDS.filter((id) => id !== "off");

describe("sidebar decoration assets", () => {
  it("has decorations to check at all — an empty list would pass everything", () => {
    expect(ART_IDS.length).toBeGreaterThan(0);
  });

  it("ships an SVG for every id that is not off", () => {
    const missing = ART_IDS.filter(
      (id) => !existsSync(`${SOURCE_ROOT}assets/decor/${id}.svg`),
    );
    expect(missing).toEqual([]);
  });

  it("has exactly one stylesheet rule per id, and no orphan rules", () => {
    const css = readFileSync(`${SOURCE_ROOT}styles.css`, "utf8");
    const ruled = [
      ...css.matchAll(/\.wsbar__decor\[data-decor="([a-z-]+)"\]/g),
    ].map((match) => match[1]);

    expect([...new Set(ruled)].sort()).toEqual([...ART_IDS].sort());
  });

  it("points every rule at the file that id actually ships", () => {
    const css = readFileSync(`${SOURCE_ROOT}styles.css`, "utf8");
    for (const id of ART_IDS) {
      expect(css).toContain(`url("./assets/decor/${id}.svg")`);
    }
  });

  /**
   * The ornament's ink comes from `--decor` so it follows the theme (DL-16.2).
   * A file that carries its own `fill="#hex"` would paint that color through
   * the mask's alpha only by accident, and would read as a hardcoded color the
   * moment someone switched the element from a mask to an `<img>`.
   */
  it("keeps the artwork monochrome — shape only, no palette of its own", () => {
    const colored = ART_IDS.filter((id) => {
      const svg = readFileSync(`${SOURCE_ROOT}assets/decor/${id}.svg`, "utf8");
      const fills = [...svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map(
        (match) => match[1],
      );
      return fills.some((value) => value !== "#000" && value !== "none");
    });
    expect(colored).toEqual([]);
  });
});
