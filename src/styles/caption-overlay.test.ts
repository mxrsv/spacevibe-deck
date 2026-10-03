// @vitest-environment jsdom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRules, type Rule } from "./css-weight-sites";

/**
 * Guard for `src/styles/22-caption-overlay.css`, the right-hand mirror of the
 * macOS traffic-light inset: on Windows the Electron host has the OS paint its
 * caption buttons inside Deck's frame row at the window's top-right, over the
 * web contents, so whatever Deck lays out there sits underneath them.
 *
 * No Windows device exists and jsdom has no layout, so this reads the real
 * stylesheets and proves what text can prove: the token is zero outside the
 * marker, every rule that spends it is scoped under the marker (so a
 * macOS-visible rule cannot slip in), the arithmetic yields the footprint, and
 * each state's right-end occupant is reached by a reservation. How the OS
 * buttons overlap the reserved box pixel for pixel is not covered here.
 */

// Relative to the repo root, where vitest runs: `import.meta.url` is not a
// file URL under the jsdom environment this file needs for `Element.matches`.
const ROOT = ".";
const STYLES = join(ROOT, "src/styles");
const OVERLAY_FILE = "22-caption-overlay.css";
const MARKER_CLASS = "window--caption-overlay";
const MARKER = `.${MARKER_CLASS}`;
const TOKEN = "--frame-controls-w";
const FALLBACK_TOKEN = "--frame-controls-fallback-w";
/** Three 46px caption buttons at 100% scale. */
const FOOTPRINT_PX = 138;

function rulesOf(file: string): Rule[] {
  return parseRules(file, readFileSync(join(STYLES, file), "utf8"));
}

const cssFiles = readdirSync(STYLES)
  .filter((file) => file.endsWith(".css"))
  .sort();
const allRules = cssFiles.flatMap(rulesOf);
const overlayRules = cssFiles.includes(OVERLAY_FILE) ? rulesOf(OVERLAY_FILE) : [];

const declarationsOf = (rule: Rule, prop: string) =>
  rule.declarations.filter((d) => d.prop === prop);

describe("the caption-button inset's stylesheet", () => {
  // The marker already out-specifies every rule it adjusts, so order is a
  // belt-and-braces property, not a requirement: a later partial may follow it.
  it("is imported by the index, after the partials whose occupants it pads", () => {
    const imports = [
      ...readFileSync(join(ROOT, "src/styles.css"), "utf8").matchAll(/@import "(.+?)";/g),
    ].map((match) => match[1]);
    const at = (file: string) => imports.indexOf(`./styles/${file}`);
    expect(at(OVERLAY_FILE)).toBeGreaterThan(-1);
    for (const adjusted of [
      "05-tab-bar-toolbar.css",
      "06-stage-panes.css",
      "11-settings-screen.css",
      "14-dock.css",
    ]) {
      expect(at(OVERLAY_FILE), adjusted).toBeGreaterThan(at(adjusted));
    }
  });

  it("declares the token 0px on :root, and nowhere else but under the marker", () => {
    const declared = allRules.flatMap((rule) =>
      declarationsOf(rule, TOKEN).map(({ value }) => ({
        file: rule.file,
        selectors: rule.selectors,
        value,
      })),
    );
    const onRoot = declared.filter((d) => d.selectors.includes(":root"));
    expect(onRoot).toEqual([{ file: "01-tokens.css", selectors: [":root"], value: "0px" }]);
    const elsewhere = declared.filter((d) => !d.selectors.includes(":root"));
    expect(elsewhere.map((d) => [d.file, d.selectors])).toEqual([[OVERLAY_FILE, [MARKER]]]);
  });

  it("scopes every rule under the marker, so no macOS-visible selector can slip in", () => {
    expect(overlayRules.length).toBeGreaterThan(0);
    const unscoped = overlayRules.flatMap((rule) =>
      rule.selectors.filter((s) => s !== MARKER && !s.startsWith(`${MARKER} `)),
    );
    expect(unscoped).toEqual([]);
  });

  it("is the only partial that spends the token", () => {
    const spenders = allRules
      .filter((rule) => rule.file !== OVERLAY_FILE)
      .filter((rule) =>
        rule.declarations.some(
          (d) => d.value.includes(`var(${TOKEN})`) || d.value.includes(`var(${FALLBACK_TOKEN})`),
        ),
      )
      .map((rule) => `${rule.file}:${rule.line}`);
    expect(spenders).toEqual([]);
  });
});

/**
 * Evaluates the token's `calc()` the way the browser would, for a viewport
 * width and a set of defined `env()` names (an undefined one takes its
 * fallback). Only `calc`, `env`, `var`, `vw` and `px` appear in the token, so
 * the expression becomes plain JavaScript arithmetic.
 */
function footprint(vw: number, env: Readonly<Record<string, number>>): number {
  const marker = overlayRules.find((rule) => rule.selectors.includes(MARKER));
  let value = declarationsOf(marker!, TOKEN)[0].value;
  const fallback = allRules
    .flatMap((rule) => declarationsOf(rule, FALLBACK_TOKEN))
    .map((d) => d.value)[0];
  value = value.replaceAll(`var(${FALLBACK_TOKEN})`, fallback);
  const js = value
    .replace(/calc\(/g, "(")
    .replace(/(\d+(?:\.\d+)?)vw/g, (_, n) => `(${n}/100*VW)`)
    .replace(/(\d+(?:\.\d+)?)px/g, "$1")
    .replace(/env\(([a-z-]+),/g, 'ENV("$1",');
  const lookup = (name: string, fallbackValue: number) => env[name] ?? fallbackValue;
  return new Function("VW", "ENV", `return ${js};`)(vw, lookup) as number;
}

describe("the footprint arithmetic", () => {
  it("names the 138px of three caption buttons once, as the fallback token", () => {
    const values = allRules
      .flatMap((rule) => declarationsOf(rule, FALLBACK_TOKEN))
      .map((d) => d.value);
    expect(values).toEqual([`${FOOTPRINT_PX}px`]);
  });

  it.each([800, 1280, 1920])("is 138px at %ipx wide when env() is undefined", (vw) => {
    expect(footprint(vw, {})).toBe(FOOTPRINT_PX);
  });

  it.each([800, 1280, 1920])(
    "is the real button width at %ipx wide when env() is defined",
    (vw) => {
      // Buttons on the right: the title-bar area starts at 0 and stops short of them.
      expect(footprint(vw, { "titlebar-area-x": 0, "titlebar-area-width": vw - 150 })).toBe(150);
      // Fullscreen: the OS buttons are gone and the title-bar area is the window.
      expect(footprint(vw, { "titlebar-area-x": 0, "titlebar-area-width": vw })).toBe(0);
    },
  );
});

/** True when a rule of the overlay partial pads this element's right edge by the footprint. */
function reservesRight(element: Element): boolean {
  return overlayRules.some(
    (rule) =>
      rule.selectors.some((selector) => element.matches(selector)) &&
      declarationsOf(rule, "padding-right").some((d) => d.value.includes(`var(${TOKEN})`)),
  );
}

interface LayoutState {
  readonly name: string;
  readonly root: string;
  readonly markup: string;
  /** Occupants that end at the window's right edge in this state. */
  readonly reserved: readonly string[];
  /** Occupants present but NOT at the edge, where a reservation would be a dead gap. */
  readonly clear: readonly string[];
}

const SETTINGS = `<div class="settings-screen is-open"><header class="settings-screen__head"></header></div>`;
const DOCK = `<aside class="dock-panel"><div class="dock-panel__header"></div></aside>`;
const STRIP = `<div class="stage__strip"></div>`;

/**
 * One row per state a Windows window can be in. The sidebar's collapsed state is
 * the first row too: collapsing only hides the left column, so the strip is
 * still what ends at the right edge. The markup is the shape `App` mounts
 * (`app.tsx`), checked against the source below.
 */
const STATES: readonly LayoutState[] = [
  {
    name: "sidebar layout, dock closed (expanded or collapsed)",
    root: "window--sidebar",
    markup: `<main class="stage stage--strip">${STRIP}</main>`,
    reserved: [".stage__strip"],
    clear: [],
  },
  {
    name: "sidebar layout, dock open: the dock owns the corner",
    root: "window--sidebar",
    markup: `<main class="stage stage--strip stage--dock">${STRIP}${DOCK}</main>`,
    reserved: [".dock-panel__header"],
    clear: [".stage__strip"],
  },
  {
    name: "top-tab layout",
    root: "",
    markup: `<header class="tabbar"></header><main class="stage"></main>`,
    reserved: [".tabbar"],
    clear: [],
  },
  {
    name: "top-tab layout, dock open: the dock sits under the tab bar",
    root: "",
    markup: `<header class="tabbar"></header><main class="stage stage--dock">${DOCK}</main>`,
    reserved: [".tabbar"],
    clear: [".dock-panel__header"],
  },
  {
    name: "sidebar layout, Settings open",
    root: "window--sidebar",
    markup: `<main class="stage stage--strip">${STRIP}${SETTINGS}</main>`,
    reserved: [".stage__strip", ".settings-screen__head"],
    clear: [],
  },
  {
    name: "top-tab layout, Settings open",
    root: "",
    markup: `<header class="tabbar"></header><main class="stage">${SETTINGS}</main>`,
    reserved: [".tabbar", ".settings-screen__head"],
    clear: [],
  },
];

function build(rootClasses: string, markup: string): HTMLElement {
  const root = document.createElement("div");
  root.className = `window ${rootClasses}`;
  root.innerHTML = markup;
  return root;
}

describe("the right-end occupant of each layout state", () => {
  it.each(STATES)("$name: reserved where it ends at the edge, clear where it does not", (state) => {
    const root = build(`window--windows ${MARKER_CLASS} ${state.root}`, state.markup);
    for (const selector of state.reserved) {
      expect(reservesRight(root.querySelector(selector)!), `${selector} is reserved`).toBe(true);
    }
    for (const selector of state.clear) {
      expect(reservesRight(root.querySelector(selector)!), `${selector} is clear`).toBe(false);
    }
  });

  it.each(STATES)("$name: reserves nothing without the marker (macOS, or no overlay)", (state) => {
    const root = build(state.root, state.markup);
    for (const element of root.querySelectorAll("*")) {
      expect(reservesRight(element), element.className).toBe(false);
    }
  });

  it("matches the structure App, TabBar, DockPanel and SettingsScreen really render", () => {
    const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
    const app = read("src/ui/app.tsx");
    expect(app).toContain('<div class="stage__strip"');
    expect(app).toContain('sidebar ? "stage--strip" : ""');
    expect(app).toContain('"stage--dock"');
    expect(read("src/ui/tab-bar.tsx")).toContain('<header class="tabbar"');
    expect(read("src/ui/dock/dock-panel.tsx")).toContain('<div class="dock-panel__header">');
    expect(read("src/ui/settings/settings-screen.tsx")).toContain(
      '<header class="settings-screen__head"',
    );
  });
});
