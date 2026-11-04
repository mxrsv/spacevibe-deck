import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findCompositionHits } from "./ui-composition-gate";
import {
  auditComposition,
  emptyExceptions,
  parseDebt,
  TSX_RULES,
  type CompositionHit,
  type LedgerScope,
} from "./ui-composition-ledger";
import { findRecipeHits } from "./ui-recipe-classes";

/**
 * The small UI has sizes (spec 2026-11-03-ui-composition): nothing under 12px (CMP-10) and chips,
 * badges and buttons from `src/ui`, not drawn by hand (CMP-5 to CMP-7). A `.tsx` file under `src/`
 * that writes a text size under 12px, or an element that looks like a chip, fails here unless the
 * file is in `ui-composition-debt.txt`, whose counts may only shrink. What the detector cannot
 * see is written at the top of `ui-composition-gate.ts`.
 *
 * Not scanned: `*.test.tsx`; `src/gallery/` (not shipping); `src/ui/controls/` (the definition
 * site: Badge and Kbd draw their own box). The size of an arbitrary `text-[Npx]` is also counted
 * by the oxlint rule `deck/no-arbitrary-font-size`; the two counts do not interfere.
 *
 * The recipe ratchet's `.tsx` half (spec 2026-11-05-ui-recipes-ratchet, RCP-26) counts in the same
 * file: arbitrary values, off-scale spacing steps, weights, shadows, focus rings outside Input and
 * Phosphor imports. It reads `src/ui/controls/` too, where the preset's weights, shadows and rings
 * live, and reads `.ts` files for Phosphor only. Its limits are in `ui-recipe-classes.ts`.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEBT_FILE = "scripts/ui-composition-debt.txt";
const UNSCANNED = [/\.test\.tsx?$/, /\.d\.ts$/, /^src\/gallery\//];
/** `small-text` and `chip-like` keep their scope: the controls are where chips are defined. */
const CHIP_SITES = /^src\/ui\/controls\//;

const toPath = (full: string): string => relative(ROOT, full).replaceAll("\\", "/");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const sources = new Map<string, string>();
const scanned = new Map<string, CompositionHit[]>();
for (const full of sourceFiles(join(ROOT, "src"))) {
  const path = toPath(full);
  if (UNSCANNED.some((pattern) => pattern.test(path))) continue;
  const text = readFileSync(full, "utf8");
  sources.set(path, text);
  const old = path.endsWith(".tsx") && !CHIP_SITES.test(path) ? findCompositionHits(text) : [];
  scanned.set(path, [...old, ...findRecipeHits(text, path)]);
}

const SCOPE: LedgerScope = {
  rules: TSX_RULES,
  owns: (path) => /\.tsx?$/.test(path),
  how: {
    "small-text": "use `text-xs` (12px) or larger; nothing in the app is below 12 (CMP-10)",
    "chip-like":
      "use `Chip` (a pressable), `Badge` (read only) or `Button` from src/ui, not a hand-drawn element (CMP-5 to CMP-7)",
    arbitrary:
      "read a token instead of a bracketed value: `h-(--row-32)`, `p-(--space-8)`, `rounded-(--radius-control)` (RCP-26)",
    "spacing-step":
      "use a step on 0/2/4/6/8/10/12/16/24 (`p-2`, `gap-1.5`) or a `--space-*` token (RCP-6)",
    weight: "use `font-normal` (400) or `font-semibold` (600); nothing is 500 (RCP-5)",
    shadow:
      "a floating element reads `shadow-(--elev-1|2|3)`; anything else is `shadow-none` (RCP-11)",
    ring: "only the Input control paints a focus ring; paint focus like hover (RCP-9, CMP-11)",
    phosphor: "draw the icon from Hugeicons through `DeckIcon` (RCP-14)",
  },
};

describe("the tree", () => {
  it("scans shipping files at all — an empty scan would pass everything", () => {
    expect(scanned.size).toBeGreaterThan(100);
    expect(scanned.has("src/ui/app.tsx")).toBe(true);
    expect(scanned.has("src/ui/controls/button.tsx")).toBe(true);
    expect(scanned.has("src/terminal/search-bar.ts")).toBe(true);
  });

  it("holds no small text, hand-drawn chip or off-recipe class beyond the debt file", () => {
    const { debt, problems } = parseDebt(readFileSync(join(ROOT, DEBT_FILE), "utf8"));
    expect(problems).toEqual([]);
    expect(auditComposition(scanned, debt, SCOPE)).toEqual([]);
  });

  it("writes no `ui-scale:` without a reason (RCP-27)", () => {
    const empty = [...sources].flatMap(([path, text]) =>
      emptyExceptions(text).map((line) => `${path}:${line}`),
    );
    expect(empty).toEqual([]);
  });
});

describe("findCompositionHits", () => {
  const rules = (source: string) => findCompositionHits(source).map(({ rule }) => rule);

  it("finds the named steps under 12px, with any variant prefix", () => {
    const source = `const a = <p className="text-2xs">a</p>;
const b = <p className="md:hover:text-3xs">b</p>;`;
    expect(findCompositionHits(source)).toEqual([
      { rule: "small-text", line: 1, detail: "text-2xs (11px)" },
      { rule: "small-text", line: 2, detail: "md:hover:text-3xs (10px)" },
    ]);
  });

  it("finds an arbitrary size under 12px in px and rem, and passes 12px and up", () => {
    const source = `const a = [
  "text-[11px]",
  "text-[0.6875rem]",
  "text-[12px]",
  "text-[0.75rem]",
  "text-[14px]",
];`;
    expect(findCompositionHits(source).map(({ detail }) => detail)).toEqual([
      "text-[11px] (11px)",
      "text-[0.6875rem] (11px)",
    ]);
  });

  it("passes the scale from 12px and the other text utilities", () => {
    const source = `const a = <p className="text-xs text-sm text-code text-muted-foreground text-center">a</p>;`;
    expect(findCompositionHits(source)).toEqual([]);
  });

  it("reads class names in a template, a cva string and the Preact `class` attribute", () => {
    const source = `const base = cva("text-3xs font-medium");
const a = <p class={\`flex \${x} text-2xs\`}>a</p>;`;
    expect(rules(source)).toEqual(["small-text", "small-text"]);
  });

  it("does not read a size from a comment or a JSX text", () => {
    const source = `// text-2xs was the old caption
const a = <p>use text-3xs here</p>;`;
    expect(findCompositionHits(source)).toEqual([]);
  });

  it("finds a hand-drawn chip: fixed height, horizontal padding, fill or radius", () => {
    const source = `const a = <span className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5">x</span>;
const b = <span className="h-6 px-2 rounded-md">y</span>;
const c = <a className="h-[22px] pl-2 hover:bg-muted">z</a>;`;
    expect(findCompositionHits(source).map(({ rule, line }) => [rule, line])).toEqual([
      ["chip-like", 1],
      ["chip-like", 2],
      ["chip-like", 3],
    ]);
  });

  it("passes what is not a chip: no padding, no fill, a height over 28px or a square", () => {
    const source = `const a = <span className="h-5 rounded-sm bg-muted">no padding</span>;
const b = <span className="h-5 px-2">no fill or radius</span>;
const c = <span className="h-8 px-2 rounded-md">too tall</span>;
const d = <span className="size-5 rounded-sm bg-muted px-1">square</span>;
const e = <span className="min-h-5 px-2 rounded-md">min height</span>;`;
    expect(findCompositionHits(source)).toEqual([]);
  });

  it("passes a component and the library's own elements", () => {
    const source = `const a = (
  <>
    <Chip className="h-5 px-2 rounded-md bg-muted" />
    <Badge className="h-5 px-2 rounded-md bg-muted" />
    <button className="h-6 px-2 rounded-md bg-muted" />
  </>
);`;
    expect(findCompositionHits(source)).toEqual([]);
  });

  it("passes a block <div> row and finds a div that sets an inline display", () => {
    const row = `const a = <div className="flex h-7 items-center rounded-md px-2.5 hover:bg-muted">row</div>;`;
    const chip = `const a = <div className="inline-flex h-7 items-center rounded-md px-2.5">chip</div>;`;
    expect(findCompositionHits(row)).toEqual([]);
    expect(rules(chip)).toEqual(["chip-like"]);
  });

  it("reads the class strings of a call or a conditional as one set", () => {
    const source = `const a = <span className={cn("h-5 px-2", on && "bg-muted")}>x</span>;`;
    expect(rules(source)).toEqual(["chip-like"]);
  });
});

describe("parseDebt", () => {
  it("reads `path rule count` lines and skips comments and blanks", () => {
    const { debt, problems } = parseDebt(
      "# why\n\nsrc/a.tsx small-text 3\nsrc/a.tsx chip-like 1\n",
    );
    expect(problems).toEqual([]);
    expect([...debt]).toEqual([
      ["src/a.tsx small-text", 3],
      ["src/a.tsx chip-like", 1],
    ]);
  });

  it("reports a malformed, unknown-rule, zero or repeated line instead of skipping it", () => {
    const { problems } = parseDebt(
      "src/a.tsx 3\nsrc/b.tsx tiny 1\nsrc/d.css radius 0\nsrc/c.tsx chip-like 1\nsrc/c.tsx chip-like 2\n",
    );
    expect(problems).toEqual([
      'debt line 1 is not "path rule count" with a known rule: src/a.tsx 3',
      'debt line 2 is not "path rule count" with a known rule: src/b.tsx tiny 1',
      'debt line 3 is not "path rule count" with a known rule: src/d.css radius 0',
      "debt lists src/c.tsx chip-like twice",
    ]);
  });
});

describe("auditComposition", () => {
  const hits = (rule: CompositionHit["rule"], n: number): CompositionHit[] =>
    Array.from({ length: n }, (_, i) => ({ rule, line: i + 1, detail: "x" }));
  const audit = (files: Record<string, CompositionHit[]>, debt: Record<string, number>) =>
    auditComposition(new Map(Object.entries(files)), new Map(Object.entries(debt)), SCOPE);

  it("passes a file at its debt and a clean file", () => {
    expect(
      audit(
        { "src/a.tsx": [...hits("small-text", 2), ...hits("chip-like", 1)], "src/b.tsx": [] },
        { "src/a.tsx small-text": 2, "src/a.tsx chip-like": 1 },
      ),
    ).toEqual([]);
  });

  it("fails a file that is not in the debt file, naming the way out", () => {
    const [problem, ...rest] = audit({ "src/new.tsx": hits("chip-like", 1) }, {});
    expect(rest).toEqual([]);
    expect(problem).toContain("src/new.tsx has 1 chip-like hit(s) and is not in the debt file");
    expect(problem).toContain("Chip");
  });

  it("counts each rule on its own", () => {
    expect(audit({ "src/a.tsx": hits("small-text", 1) }, { "src/a.tsx chip-like": 1 })).toEqual([
      "src/a.tsx has 1 small-text hit(s) and is not in the debt file (x at line 1): use `text-xs` (12px) or larger; nothing in the app is below 12 (CMP-10)",
      "src/a.tsx chip-like is clean now: remove its line from the debt file",
    ]);
  });

  it("fails a count above its entry", () => {
    expect(audit({ "src/a.tsx": hits("small-text", 3) }, { "src/a.tsx small-text": 2 })).toEqual([
      expect.stringContaining("src/a.tsx has 3 small-text hits, over its debt of 2"),
    ]);
  });

  it("fails a count below its entry, so debt only shrinks", () => {
    expect(audit({ "src/a.tsx": hits("chip-like", 1) }, { "src/a.tsx chip-like": 2 })).toEqual([
      "src/a.tsx has 1 chip-like hits, under its debt of 2: lower the entry to 1",
    ]);
  });

  it("fails an entry whose file is gone or not scanned", () => {
    expect(audit({}, { "src/gone.tsx small-text": 1 })).toEqual([
      expect.stringContaining("src/gone.tsx is in the debt file but is not a scanned"),
    ]);
  });

  it("leaves the stylesheets' lines to the CSS suite", () => {
    expect(audit({}, { "src/styles/02-shell.css radius": 1 })).toEqual([]);
  });

  it("fails a line whose rule does not apply to its kind of file", () => {
    expect(audit({ "src/a.tsx": [] }, { "src/a.tsx radius": 1 })).toEqual([
      "src/a.tsx radius: radius is not a rule for this kind of file",
    ]);
  });
});
