import { describe, expect, it } from "vitest";
import { findRecipeHits } from "./ui-recipe-classes";

/** AC-4's `.tsx` kinds: each seeded value fails, and the same value under `ui-scale:` passes. */
const rules = (source: string, path = "src/ui/x.tsx") =>
  findRecipeHits(source, path).map(({ rule, detail }) => `${rule} ${detail}`);

describe("findRecipeHits", () => {
  it("fails one seeded value of each kind", () => {
    const source = `const a = <div className="h-[30px] px-[7px] rounded-[5px] gap-[3px] min-h-[22px] size-[13px]" />;
const b = <div className="p-5 gap-7 -mx-3.5 px-px" />;
const c = <div className="font-medium font-bold font-[500]" />;
const d = <div className="shadow-md shadow-[0_2px_4px_black] shadow" />;
const e = <div className="focus-visible:ring-2 focus:ring-ring" />;`;
    expect(rules(source)).toEqual([
      "arbitrary h-[30px]",
      "arbitrary px-[7px]",
      "arbitrary rounded-[5px]",
      "arbitrary gap-[3px]",
      "arbitrary min-h-[22px]",
      "arbitrary size-[13px]",
      "spacing-step p-5",
      "spacing-step gap-7",
      "spacing-step -mx-3.5",
      "spacing-step px-px",
      "weight font-medium",
      "weight font-bold",
      "weight font-[500]",
      "shadow shadow-md",
      "shadow shadow-[0_2px_4px_black]",
      "shadow shadow",
      "ring focus-visible:ring-2",
      "ring focus:ring-ring",
    ]);
  });

  it("counts each Phosphor import, in .ts files too", () => {
    const source = `import { X } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react/dist/lib/types";
const a = "h-[30px]";`;
    expect(rules(source, "src/terminal/search-bar.ts")).toEqual([
      "phosphor @phosphor-icons/react",
      "phosphor @phosphor-icons/react/dist/lib/types",
    ]);
  });

  it("passes the scale, token references and layout utilities", () => {
    const source = `const a = <div className="h-(--row-32) h-[var(--row-44)] p-2 gap-1.5 px-2.5 m-0 space-y-6 rounded-[inherit]" />;
const b = <div className="w-[240px] max-h-[60vh] inset-x-[3px] translate-x-[1px] grid-cols-[1fr_auto]" />;
const c = <div className="font-normal font-semibold font-sans shadow-none shadow-(--elev-1) shadow-[var(--elev-3)]" />;
const d = <div className="ring-1 aria-invalid:border-destructive hover:bg-muted text-[13px]" />;`;
    expect(rules(source)).toEqual([]);
  });

  it("keeps the two control carve-outs to their control", () => {
    expect(rules(`const a = "px-3.5";`, "src/ui/controls/button.tsx")).toEqual([]);
    expect(rules(`const a = "px-3.5";`, "src/ui/controls/chip.tsx")).toEqual([
      "spacing-step px-3.5",
    ]);
    expect(rules(`const a = "focus-visible:ring-3";`, "src/ui/controls/input.tsx")).toEqual([]);
    expect(rules(`const a = "focus-visible:ring-3";`, "src/ui/controls/select.tsx")).toEqual([
      "ring focus-visible:ring-3",
    ]);
  });

  it("passes a value under `ui-scale: <reason>` on the line above, in both comment forms", () => {
    const source = `// ui-scale: the native traffic lights need 26
const a = "h-[26px]";
const b = (
  <div>
    {/* ui-scale: glyph geometry of the grip */}
    <span className="p-5" />
  </div>
);
// ui-scale:
const c = "h-[26px]";
const d = "font-medium";`;
    expect(findRecipeHits(source, "src/ui/x.tsx").map(({ line }) => line)).toEqual([10, 11]);
  });

  it("does not read a class from a comment or JSX text", () => {
    const source = `// shadow-md was the old popup
const a = <p>use p-5 here</p>;`;
    expect(rules(source)).toEqual([]);
  });
});
