import { describe, expect, it } from "vitest";
import { lintFixtures } from "./lint-fixtures";
import { DEBT_FILE } from "./no-arbitrary-font-size.mjs";

const findings = lintFixtures("no-arbitrary-font-size", {
  [DEBT_FILE]: [
    "# a comment line",
    "src/ui/at-debt.tsx 2",
    "src/ui/over-debt.tsx 1",
    "src/ui/under-debt.tsx 3",
    "src/ui/paid-off.tsx 1",
    "",
  ].join("\n"),
  "src/ui/scale.tsx": 'export const A = () => <span className="text-2xs text-xs">a</span>;\n',
  "src/ui/attribute.tsx": 'export const A = () => <span className="px-2 text-[11px]">a</span>;\n',
  "src/ui/template.tsx":
    "export const A = (on: boolean) => (\n  <span className={`md:text-[0.7rem] ${on ? 'x' : ''}`}>a</span>\n);\n",
  "src/ui/call.tsx":
    'const cn = (...c: string[]) => c.join(" ");\nexport const c = cn("p-1", "text-[10px]");\n',
  "src/ui/other-arbitrary.tsx":
    'export const A = () => <span className="text-[#fff] w-[11px] leading-[11px]">a</span>;\n',
  "src/ui/at-debt.tsx": 'export const a = "text-[11px]";\nexport const b = "text-[10px]";\n',
  "src/ui/over-debt.tsx": 'export const a = "text-[11px]";\nexport const b = "text-[10px]";\n',
  "src/ui/under-debt.tsx": '\nexport const a = "text-[11px]";\n',
  "src/ui/paid-off.tsx": 'export const a = "text-2xs";\n',
  "src/ui/controls/button.tsx": 'export const a = "text-[11px]";\n',
  "src/gallery/layout-mocks/surfaces/browser/browser-page.tsx": 'export const a = "text-[13px]";\n',
  "src/ui/view.test.tsx": 'export const a = "text-[11px]";\n',
  "src/ui/sizes.ts": 'export const a = "text-[11px]";\n',
  "electron/window.tsx": 'export const a = "text-[11px]";\n',
});

describe("deck/no-arbitrary-font-size", () => {
  it.each([
    "src/ui/scale.tsx",
    "src/ui/other-arbitrary.tsx",
    "src/ui/at-debt.tsx",
    "src/ui/controls/button.tsx",
    "src/gallery/layout-mocks/surfaces/browser/browser-page.tsx",
    "src/ui/view.test.tsx",
    "src/ui/sizes.ts",
    "electron/window.tsx",
  ])("accepts %s", (name) => {
    expect(findings[name]).toEqual([]);
  });

  it.each([
    ["src/ui/attribute.tsx", 1],
    ["src/ui/template.tsx", 2],
    ["src/ui/call.tsx", 2],
  ])("reports a new arbitrary size in %s on line %i", (name, line) => {
    expect(findings[name]).toEqual([
      { line, message: expect.stringMatching(/^Use a type-scale step/) },
    ]);
  });

  it("reports every use once a file holds more than its recorded debt", () => {
    expect(findings["src/ui/over-debt.tsx"]).toEqual([
      { line: 1, message: expect.stringContaining("has 2 arbitrary font sizes") },
      { line: 2, message: expect.stringContaining("allows 1") },
    ]);
  });

  it("asks to lower the recorded debt when a file holds less", () => {
    expect(findings["src/ui/under-debt.tsx"]).toEqual([
      {
        line: expect.any(Number),
        message: expect.stringContaining("fell to 1; lower its count to 1"),
      },
    ]);
    expect(findings["src/ui/paid-off.tsx"]).toEqual([
      { line: expect.any(Number), message: expect.stringContaining("fell to 0; remove its line") },
    ]);
  });
});
