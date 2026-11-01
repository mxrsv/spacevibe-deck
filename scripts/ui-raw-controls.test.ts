import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditRawControls,
  findRawControls,
  parseDebt,
  type RawControlHit,
} from "./ui-raw-controls";

/**
 * Shipping UI is built from `src/ui/controls`, so a raw `<button>`, `<input>`, `<select>` or
 * `<textarea>` in a `.tsx` file under `src/` is a control that skipped the library and its look
 * (AGENTS.md R12; spec AC-8, LAY-12). Elements that predate this test are counted per file in
 * `ui-raw-controls-debt.txt`, which may only shrink. A new one needs a control, or the line
 * `// raw-control: <reason>` (`{/* raw-control: <reason> *\/}` among JSX children) directly above
 * it, with no blank line between.
 *
 * Not scanned: `*.test.tsx`; `src/gallery/` (not shipping); `src/ui/controls/` (the definition
 * site: Button renders the `<button>`). `src/ui/blocks/` takes no debt at all.
 *
 * Not machine-checked, and still the rule: a hand-built row, section header, setting row, theme
 * card or panel surface where the library has one, and a control built in `.ts` with imperative
 * DOM (`terminal/search-bar.ts`). Only the four tags in JSX are seen; review catches the rest.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEBT_FILE = "scripts/ui-raw-controls-debt.txt";
const UNSCANNED = [/\.test\.tsx$/, /^src\/gallery\//, /^src\/ui\/controls\//];

const toPath = (full: string): string => relative(ROOT, full).replaceAll("\\", "/");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const scanned = new Map<string, RawControlHit[]>();
for (const full of tsxFiles(join(ROOT, "src"))) {
  const path = toPath(full);
  if (!UNSCANNED.some((pattern) => pattern.test(path))) {
    scanned.set(path, findRawControls(readFileSync(full, "utf8")));
  }
}

const hit = (status: RawControlHit["status"], line = 1, tag = "button"): RawControlHit => ({
  tag,
  line,
  status,
});

describe("the tree", () => {
  it("scans shipping files at all — an empty scan would pass everything", () => {
    expect(scanned.size).toBeGreaterThan(100);
    expect(scanned.has("src/ui/app.tsx")).toBe(true);
  });

  it("holds no raw control beyond the debt file", () => {
    const { debt, problems } = parseDebt(readFileSync(join(ROOT, DEBT_FILE), "utf8"));
    expect(problems).toEqual([]);
    expect(auditRawControls(scanned, debt)).toEqual([]);
  });
});

describe("findRawControls", () => {
  const tags = (source: string) => findRawControls(source).map(({ tag, status }) => [tag, status]);

  it("counts each of the four tags once, however it is closed", () => {
    const source = `const a = (
  <div>
    <button type="button">Go</button>
    <input value="" />
    <select><option /></select>
    <textarea></textarea>
  </div>
);`;
    expect(tags(source)).toEqual([
      ["button", "counted"],
      ["input", "counted"],
      ["select", "counted"],
      ["textarea", "counted"],
    ]);
  });

  it("does not count a component, a member tag or another element", () => {
    const source = `const a = (
  <div>
    <Button>Go</Button>
    <Input />
    <ui.button />
    <buttons />
    <span>button</span>
  </div>
);`;
    expect(findRawControls(source)).toEqual([]);
  });

  it("does not count a tag written in a comment, a string or a template", () => {
    const source = `// <button> once lived here
/** A row is a plain \`<button>\`, not an <input />. */
const a = "<select>";
const b = \`<textarea>\${a}</textarea>\`;
const c = <p title="<button>">{/* <input /> */}</p>;`;
    expect(findRawControls(source)).toEqual([]);
  });

  it("counts nested raw controls separately", () => {
    const found = findRawControls("const a = <button><input /></button>;");
    expect(found.map(({ tag }) => tag)).toEqual(["button", "input"]);
  });

  it("accepts a // reason on the line above, in expression position", () => {
    const source = `function Row() {
  return (
    // raw-control: a whole-row target no control variant spans
    <button type="button">Row</button>
  );
}`;
    expect(findRawControls(source)).toEqual([{ tag: "button", line: 4, status: "exempt" }]);
  });

  it("accepts a {/* reason */} child on the line above", () => {
    const source = `const a = (
  <div>
    {/* raw-control: the row is the click target */}
    <button type="button">Row</button>
    <input />
  </div>
);`;
    expect(tags(source)).toEqual([
      ["button", "exempt"],
      ["input", "counted"],
    ]);
  });

  it("exempts only the element directly below the comment", () => {
    const source = `const a = (
  <div>
    {/* raw-control: because */}
    <div>
      <button />
    </div>
  </div>
);`;
    expect(tags(source)).toEqual([["button", "counted"]]);
  });

  it("does not let a blank line carry an exemption", () => {
    const source = `const a = (
  <div>
    {/* raw-control: because */}

    <button />
  </div>
);
const b = (
  // raw-control: because

  <input />
);`;
    expect(tags(source)).toEqual([
      ["button", "counted"],
      ["input", "counted"],
    ]);
  });

  it("flags a raw-control comment with no reason", () => {
    const source = `const a = (
  <div>
    {/* raw-control: */}
    <button />
    {/* raw-control:    */}
    <input />
  </div>
);
const b = (
  // raw-control:
  <select />
);`;
    expect(tags(source)).toEqual([
      ["button", "empty-reason"],
      ["input", "empty-reason"],
      ["select", "empty-reason"],
    ]);
  });

  it("ignores a comment that only mentions raw-control", () => {
    const source = `const a = (
  <div>
    {/* raw-control */}
    <button />
    {/* see raw-control: elsewhere */}
    <input />
  </div>
);`;
    expect(tags(source)).toEqual([
      ["button", "counted"],
      ["input", "counted"],
    ]);
  });

  it("reads a file with CRLF line endings the same way", () => {
    const source =
      "const a = (\r\n  <div>\r\n    {/* raw-control: why */}\r\n    <button />\r\n    <input />\r\n  </div>\r\n);";
    expect(tags(source)).toEqual([
      ["button", "exempt"],
      ["input", "counted"],
    ]);
  });
});

describe("parseDebt", () => {
  it("reads `path count` lines and skips comments and blanks", () => {
    const { debt, problems } = parseDebt("# why\n\nsrc/a.tsx 3\nsrc/b.tsx 1\n");
    expect(problems).toEqual([]);
    expect([...debt]).toEqual([
      ["src/a.tsx", 3],
      ["src/b.tsx", 1],
    ]);
  });

  it("reports a malformed or repeated line instead of skipping it", () => {
    const { problems } = parseDebt("src/a.tsx three\nsrc/b.tsx 1\nsrc/b.tsx 2\n");
    expect(problems).toEqual([
      'debt line 1 is not "path count": src/a.tsx three',
      "debt lists src/b.tsx twice",
    ]);
  });
});

describe("auditRawControls", () => {
  const counted = (n: number) => Array.from({ length: n }, (_, i) => hit("counted", i + 1));
  const audit = (files: Record<string, RawControlHit[]>, debt: Record<string, number>) =>
    auditRawControls(new Map(Object.entries(files)), new Map(Object.entries(debt)));

  it("passes a file at its debt, a clean file and an exempt element", () => {
    expect(
      audit(
        { "src/a.tsx": counted(2), "src/b.tsx": [], "src/c.tsx": [hit("exempt")] },
        { "src/a.tsx": 2 },
      ),
    ).toEqual([]);
  });

  it("fails a file that is not in the debt file", () => {
    const [problem, ...rest] = audit({ "src/new.tsx": counted(1) }, {});
    expect(rest).toEqual([]);
    expect(problem).toContain("src/new.tsx has 1 raw control(s) and is not in the debt file");
    expect(problem).toContain("// raw-control: <reason>");
  });

  it("fails a count above its entry", () => {
    expect(audit({ "src/a.tsx": counted(3) }, { "src/a.tsx": 2 })).toEqual([
      expect.stringContaining("src/a.tsx has 3 raw controls, over its debt of 2"),
    ]);
  });

  it("fails a count below its entry, so debt only shrinks", () => {
    expect(audit({ "src/a.tsx": counted(1) }, { "src/a.tsx": 2 })).toEqual([
      "src/a.tsx has 1 raw controls, under its debt of 2: lower the entry to 1",
    ]);
  });

  it("fails an entry whose file is clean now", () => {
    expect(audit({ "src/a.tsx": [hit("exempt")] }, { "src/a.tsx": 1 })).toEqual([
      "src/a.tsx is clean now: remove its line from the debt file",
    ]);
  });

  it("fails an entry for a file that is gone or not scanned", () => {
    expect(audit({}, { "src/gone.tsx": 1 })).toEqual([
      expect.stringContaining("src/gone.tsx is in the debt file but is not a scanned"),
    ]);
  });

  it("fails an empty reason, even in a file with debt", () => {
    expect(
      audit({ "src/a.tsx": [hit("counted"), hit("empty-reason", 9)] }, { "src/a.tsx": 1 }),
    ).toEqual([expect.stringContaining("src/a.tsx:9 <button> has `raw-control:` with no reason")]);
  });

  it("lets a block carry an exempt element but never a counted one or a debt entry", () => {
    expect(audit({ "src/ui/blocks/row.tsx": [hit("exempt")] }, {})).toEqual([]);
    expect(audit({ "src/ui/blocks/row.tsx": counted(1) }, {})).toEqual([
      expect.stringContaining("src/ui/blocks/row.tsx is a block and may hold no raw control"),
    ]);
    expect(audit({ "src/ui/blocks/row.tsx": counted(1) }, { "src/ui/blocks/row.tsx": 1 })).toEqual([
      expect.stringContaining("is a block and may hold no raw control"),
      "src/ui/blocks/row.tsx is a block: blocks take no debt, remove the entry",
    ]);
    expect(audit({ "src/ui/blocks/row.tsx": [] }, { "src/ui/blocks/row.tsx": 1 })).toEqual([
      "src/ui/blocks/row.tsx is a block: blocks take no debt, remove the entry",
    ]);
  });
});
