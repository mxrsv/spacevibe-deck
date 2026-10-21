import { describe, expect, it } from "vitest";
import { lintFixtures } from "./lint-fixtures";

const findings = lintFixtures("no-outset-state-indicators", {
  "inset.tsx": `const a = <div className="focus-visible:ring-2 focus-visible:ring-inset" />;`,
  "inset-in-cn.tsx": `const b = cn("focus-visible:ring-2", active && "x", "focus-visible:ring-inset");`,
  "thin-outline.tsx": `const c = "focus-visible:outline-2 focus-visible:outline-ring";`,
  "pulled-in.tsx": `const d = "focus-visible:outline-3 focus-visible:-outline-offset-3";`,
  "no-state.tsx": `const e = "ring-1 ring-border";`,
  "ring-colour.tsx": `const f = "focus-visible:ring-ring/50 focus-visible:ring-offset-background";`,
  "prose.tsx": `const g = "focus the ring";`,
  "outset-ring.tsx": `const h = "focus-visible:ring-2 focus-visible:ring-ring/30";`,
  "inset-wrong-state.tsx": `const i = "focus-visible:ring-2 hover:ring-inset";`,
  "positive-offset.tsx": `const j = "outline-offset-2";`,
  "thick-outline.tsx": `const k = "data-selected:outline-4 data-selected:-outline-offset-2";`,
  "aria-state.tsx": "const l = `aria-checked:ring-[3px] ${x}`;",
});

describe("deck/no-outset-state-indicators", () => {
  it.each([
    "inset.tsx",
    "inset-in-cn.tsx",
    "thin-outline.tsx",
    "pulled-in.tsx",
    "no-state.tsx",
    "ring-colour.tsx",
    "prose.tsx",
  ])("accepts %s", (name) => {
    expect(findings[name]).toEqual([]);
  });

  it.each([
    ["outset-ring.tsx", "focus-visible:ring-2"],
    ["inset-wrong-state.tsx", "focus-visible:ring-2"],
    ["positive-offset.tsx", "outline-offset-2"],
    ["thick-outline.tsx", "data-selected:outline-4"],
    ["aria-state.tsx", "aria-checked:ring-[3px]"],
  ])("reports %s", (name, indicator) => {
    expect(findings[name]).toEqual([
      { line: 1, message: expect.stringContaining(`${indicator} paints`) },
    ]);
  });
});
