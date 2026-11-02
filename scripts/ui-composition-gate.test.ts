import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditComposition,
  findCompositionHits,
  parseDebt,
  type CompositionHit,
} from "./ui-composition-gate";

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
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEBT_FILE = "scripts/ui-composition-debt.txt";
const UNSCANNED = [/\.test\.tsx$/, /^src\/gallery\//, /^src\/ui\/controls\//];

const toPath = (full: string): string => relative(ROOT, full).replaceAll("\\", "/");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const scanned = new Map<string, CompositionHit[]>();
for (const full of tsxFiles(join(ROOT, "src"))) {
  const path = toPath(full);
  if (!UNSCANNED.some((pattern) => pattern.test(path))) {
    scanned.set(path, findCompositionHits(readFileSync(full, "utf8")));
  }
}

describe("the tree", () => {
  it("scans shipping files at all — an empty scan would pass everything", () => {
    expect(scanned.size).toBeGreaterThan(100);
    expect(scanned.has("src/ui/app.tsx")).toBe(true);
  });

  it("holds no small text or hand-drawn chip beyond the debt file", () => {
    const { debt, problems } = parseDebt(readFileSync(join(ROOT, DEBT_FILE), "utf8"));
    expect(problems).toEqual([]);
    expect(auditComposition(scanned, debt)).toEqual([]);
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

  it("reports a malformed, unknown-rule or repeated line instead of skipping it", () => {
    const { problems } = parseDebt(
      "src/a.tsx 3\nsrc/b.tsx tiny 1\nsrc/c.tsx chip-like 1\nsrc/c.tsx chip-like 2\n",
    );
    expect(problems).toEqual([
      'debt line 1 is not "path small-text|chip-like count": src/a.tsx 3',
      'debt line 2 is not "path small-text|chip-like count": src/b.tsx tiny 1',
      "debt lists src/c.tsx chip-like twice",
    ]);
  });
});

describe("auditComposition", () => {
  const hits = (rule: CompositionHit["rule"], n: number): CompositionHit[] =>
    Array.from({ length: n }, (_, i) => ({ rule, line: i + 1, detail: "x" }));
  const audit = (files: Record<string, CompositionHit[]>, debt: Record<string, number>) =>
    auditComposition(new Map(Object.entries(files)), new Map(Object.entries(debt)));

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
});
