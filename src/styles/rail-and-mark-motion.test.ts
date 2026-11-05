import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const MARK = read("32-state-mark.css");
const WORKING = read("33-rail-working.css");
const TOKENS = read("01-tokens.css");

const NO_PREFERENCE = "@media (prefers-reduced-motion: no-preference)";

/** The stylesheet with every `no-preference` block cut out: what runs for everyone. */
function outsideNoPreference(css: string): string {
  let rest = css;
  for (let at = rest.indexOf(NO_PREFERENCE); at !== -1; at = rest.indexOf(NO_PREFERENCE)) {
    const open = rest.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < rest.length; end += 1) {
      if (rest[end] === "{") depth += 1;
      if (rest[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    rest = rest.slice(0, at) + rest.slice(end + 1);
  }
  return rest;
}

describe("the mark's and the working row's loops (DL-1.2, SR-4)", () => {
  it.each([
    ["32-state-mark.css", MARK],
    ["33-rail-working.css", WORKING],
  ])("%s starts no animation and hides no text outside the no-preference block", (_file, css) => {
    const everyone = outsideNoPreference(css);
    // Reduced motion holds the still frame; a loop here would run for the people who opted out,
    // and a text-clip left outside would leave the working branch invisible.
    expect(everyone).not.toMatch(/\banimation(-delay|-name)?\s*:/);
    expect(everyone).not.toMatch(/text-fill-color\s*:\s*transparent/);
  });

  it("holds every motion to the named loops, and only those", () => {
    const loops = [...`${MARK}${WORKING}`.matchAll(/animation:\s*([\w-]+)\s[^;]*infinite/g)].map(
      (match) => match[1],
    );
    expect([...new Set(loops)].sort()).toEqual([
      "braille-frame",
      "mark-radiate",
      "rail-dot",
      "rail-shimmer",
    ]);
  });
});

describe("the mark's surface sizes (SR-7, RH-6)", () => {
  it.each(["pill", "pane"])("sizes the %s mark through its own token", (surface) => {
    expect(MARK).toMatch(
      new RegExp(
        `\\.state-mark\\[data-surface="${surface}"\\]\\s*\\{[^}]*--mark-box:\\s*var\\(--mark-size-${surface}\\)`,
      ),
    );
    expect(TOKENS).toMatch(new RegExp(`--mark-size-${surface}\\s*:`));
  });
});
