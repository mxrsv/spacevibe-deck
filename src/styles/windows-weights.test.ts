/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  STATIC_WEIGHTS,
  describeSite,
  modifiesBase,
  needsWindowsDecision,
  parseRules,
  refines,
  siteKey,
  specificity,
  toSites,
  type Site,
  type Weight,
} from "./css-weight-sites";

/**
 * Guard for `src/styles/21-windows-weights.css`, the ledger that maps chrome
 * font weights onto the three faces static Segoe UI ships (400 / 600 / 700).
 *
 * macOS draws chrome in a variable face where every weight between 430 and 650
 * is distinct; on Windows the browser folds them onto 400 / 600 / 700 by its
 * font-matching rules (modelled with `@font-face` in Chromium, not measured
 * through DirectWrite: 500 -> 400 but 510 -> 600). No Windows device exists to
 * look at the result, so this reads the real stylesheets and proves the
 * ledger's shape instead: every weight the face lacks has a Windows-scoped
 * decision, the decisions only use weights the face has, and roles that sit
 * beside each other on one surface still differ.
 *
 * It is also the tripwire for the next `font-weight: 500`: the failure names
 * the site and the file to edit.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const INDEX = "src/styles.css";
const LEDGER = "src/styles/21-windows-weights.css";
const WINDOWS_SCOPE = ".window--windows ";
/** Never bundled into the app (R7): specimens for the gallery page. */
const NOT_SHIPPED = "src/gallery/";

const HOW_TO_FIX =
  "Windows draws chrome in static Segoe UI (400 / 600 / 700). Add\n" +
  "`.window--windows <the same selector> { font-weight: 400 | 600 | 700; }` to " +
  `${LEDGER}, in the role group that matches, and keep the wrapper (@media / @container) of the original.`;

function posix(path: string): string {
  return path.split(sep).join("/");
}

/**
 * Every source file the app ships whose name matches `extension`. For CSS that
 * is a directory walk rather than the `src/styles.css` `@import` index,
 * because three chrome sheets sit beside their components and are imported from
 * TSX instead (`pane-agent-header.css`, `agent-launch-page.css`,
 * `board-agent-launcher.css`); a walk keeps a fourth from escaping.
 */
function shippingFiles(extension: RegExp, dir = join(ROOT, "src")): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const path = join(dir, entry);
      const name = posix(relative(ROOT, path));
      if (name.startsWith(NOT_SHIPPED) || name === INDEX || name === LEDGER) return [];
      if (statSync(path).isDirectory()) return shippingFiles(extension, path);
      return extension.test(name) && !/\.test\.tsx?$/.test(name) ? [name] : [];
    });
}

/** Missing files read as empty, so a deleted ledger fails on its findings, not on ENOENT. */
function read(file: string): string {
  const path = join(ROOT, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

const authored: Site[] = shippingFiles(/\.css$/).flatMap((file) =>
  toSites(parseRules(file, read(file))),
);
const ledgerRules = parseRules(LEDGER, read(LEDGER));
const authoredBySelector = new Map(
  authored.map((site) => [siteKey(site.wrap, site.selector), site]),
);

/** Ledger selector (scope stripped) -> the weight it sets and the position of its rule. */
const overrides = new Map<string, Weight>();
const ledgerPosition = new Map<string, number>();
ledgerRules.forEach((rule, position) => {
  for (const selector of rule.selectors) {
    if (rule.weight === null || !selector.startsWith(WINDOWS_SCOPE)) continue;
    const key = siteKey(rule.wrap, selector.slice(WINDOWS_SCOPE.length));
    overrides.set(key, rule.weight);
    ledgerPosition.set(key, position);
  }
});

describe("windows weight ledger", () => {
  it("is imported by the stylesheet index", () => {
    // Source order is not load-bearing here: every rule is its original plus
    // one class, so specificity wins wherever the two sheets load. A ledger
    // nobody imports would silently do nothing on Windows.
    const imports = [...read(INDEX).matchAll(/@import\s+["']([^"']+)["'];/g)].map((m) => m[1]);
    expect(imports, "src/styles.css must @import the ledger").toContain(
      "./styles/21-windows-weights.css",
    );
  });

  it("lets every weight the face lacks fall to a Windows-scoped decision", () => {
    const missing = authored
      .filter(needsWindowsDecision)
      .filter((site) => !overrides.has(siteKey(site.wrap, site.selector)))
      .map(describeSite);
    expect(missing, `${missing.length} weights have no Windows decision.\n${HOW_TO_FIX}`).toEqual(
      [],
    );
  });

  it("states chrome weights as numbers, never bolder / lighter / var() or an unreadable font: shorthand", () => {
    const unmappable = authored.filter((site) => site.weight === "unsupported").map(describeSite);
    expect(
      unmappable,
      "a relative or variable weight, or a font: shorthand this reader cannot parse, cannot be mapped onto 400 / 600 / 700",
    ).toEqual([]);
  });

  it("uses only the three weights static Segoe UI has, and only under .window--windows", () => {
    const offenders = ledgerRules.flatMap((rule) => [
      ...rule.selectors
        .filter((selector) => !selector.startsWith(WINDOWS_SCOPE))
        .map((selector) => `${LEDGER}:${rule.line}  ${selector} is not scoped to .window--windows`),
      ...rule.declarations
        .filter(
          ({ prop, value }) => prop !== "font-weight" || !STATIC_WEIGHTS.includes(Number(value)),
        )
        .map(
          ({ prop, value }) => `${LEDGER}:${rule.line}  ${prop}: ${value} is not 400 / 600 / 700`,
        ),
    ]);
    expect(offenders).toEqual([]);
  });

  it("has no decision for a selector that no longer carries a weight", () => {
    const orphans = [...overrides.keys()]
      .filter((key) => !authoredBySelector.has(key))
      .map((key) => key.replace("|", " "));
    expect(orphans, "renamed or removed on macOS: drop or rename the Windows decision").toEqual([]);
  });

  it("mirrors a more specific macOS rule beside the rule it refines", () => {
    // `.window--windows .a` (one class up) would otherwise tie or beat an
    // authored `.scope .a`, and the Windows result would stop following macOS.
    const unmirrored = authored
      .filter(needsWindowsDecision)
      .flatMap((base) =>
        authored
          .filter(
            (more) =>
              more.wrap === base.wrap &&
              refines(more.selector, base.selector) &&
              specificity(more.selector) >= specificity(base.selector) &&
              !overrides.has(siteKey(more.wrap, more.selector)),
          )
          .map((more) => `${describeSite(more)} refines ${base.selector}`),
      );
    expect(unmirrored, "give the refining rule its own Windows-scoped weight").toEqual([]);
  });

  it("keeps a base class ahead of its modifier, as the macOS cascade has them", () => {
    // Both overrides carry one class more than their originals, so they stay
    // tied with each other and source order decides, as it does on macOS.
    const position = (site: Site): number =>
      ledgerPosition.get(siteKey(site.wrap, site.selector)) ?? -1;
    const inverted = authored.flatMap((modifier) =>
      authored
        .filter(
          (base) =>
            base.file === modifier.file &&
            base.line < modifier.line &&
            modifiesBase(modifier.selector, base.selector) &&
            position(modifier) !== -1 &&
            position(base) > position(modifier),
        )
        .map((base) => `${modifier.selector} is listed before ${base.selector}`),
    );
    expect(inverted, "a modifier's Windows rule must come after its base class's").toEqual([]);
  });
});

/**
 * Roles that share one surface and that macOS separates by weight, heavier
 * first. Static Segoe UI has three rungs, so a pair can merge unless the
 * ledger keeps it apart; this is the list of pairs it must keep apart.
 * Add a pair here when a new role sits beside another on one surface. Only
 * roles a shipped component renders belong: a pair guarding an unmounted class
 * (`.asr-wt__name`, `.asr-needs__chip`) constrains nothing anyone sees.
 */
const NEIGHBOURS: [why: string, heavier: string, lighter: string][] = [
  ["project label over a checkout's label", ".asr-cluster__toggle", ".asr-checkout__name"],
  [
    "the current checkout's label over its siblings (DL-27.28's current mark)",
    '.asr-checkout[data-current="true"] .asr-checkout__name',
    ".asr-checkout__name",
  ],
  ["menu row title over its detail (DL-13.8)", ".asr-act__title", ".asr-act__detail"],
  [
    "field caption over the helper text of its field",
    ".nt-create-workspace__body label > span",
    ".nt-create-workspace__body p",
  ],
  [
    "primary action over the chips beside it",
    ".nt-primary-action",
    ".nt-context-control__copy strong",
  ],
  ["last-session title over its meta", ".nt-last-session__title", ".nt-last-session__meta"],
  [
    "launcher title over its eyebrow",
    ".nt-quick-launch__head strong",
    ".nt-quick-launch__head span",
  ],
  [
    "inline emphasis over its sentence",
    ".nt-quick-launch__retarget strong",
    ".nt-quick-launch__retarget p",
  ],
  ["launcher heading over its eyebrow", ".nt-board__head h2", ".nt-board__head > span"],
  ["composer label over the prompt", ".nt-composer__prompt-head label", ".nt-composer__textarea"],
  [
    "folder trigger over its menu rows",
    ".nt-workspace-picker__trigger",
    ".nt-workspace-picker__menu button",
  ],
  ["primary button over the secondary", ".btn--primary", ".btn"],
  ["group separator over its action", ".gsep", ".gsep button"],
  ["board title over its section heads", ".board-home__title", ".board-home__recents-head"],
  ["settings title over a group label", ".settings-screen__title", ".cfg-group"],
  [
    "session heading over its summary",
    ".recent-session-activity__heading",
    ".recent-session-activity__summary",
  ],
];

function authoredWeight(selector: string): number {
  const site = authoredBySelector.get(siteKey("", selector));
  if (!site || typeof site.weight !== "number") {
    throw new Error(`no weight authored for ${selector}`);
  }
  return site.weight;
}

/** What Windows draws: the ledger's decision, else the authored weight if the face has it. */
function windowsWeight(selector: string): number {
  const decided = overrides.get(siteKey("", selector));
  if (typeof decided === "number") return decided;
  const authoredValue = authoredWeight(selector);
  if (!STATIC_WEIGHTS.includes(authoredValue)) throw new Error(`no Windows weight for ${selector}`);
  return authoredValue;
}

describe("windows weights keep neighbouring roles apart", () => {
  it("names only classes a shipped component renders", () => {
    const markup = shippingFiles(/\.tsx?$/)
      .map(read)
      .join("\n");
    const unmounted = NEIGHBOURS.flatMap(([, heavier, lighter]) =>
      [heavier, lighter].flatMap((selector) =>
        [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
      ),
    ).filter((cls) => !markup.includes(cls));
    expect(unmounted, "a pair whose class no component renders guards nothing").toEqual([]);
  });

  it.each(NEIGHBOURS)("%s", (_why, heavier, lighter) => {
    expect(
      authoredWeight(heavier),
      "table premise: macOS separates the pair by weight",
    ).toBeGreaterThan(authoredWeight(lighter));
    expect(windowsWeight(heavier), `${heavier} must stay heavier than ${lighter}`).toBeGreaterThan(
      windowsWeight(lighter),
    );
  });
});
