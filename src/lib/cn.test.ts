import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn, TYPE_SCALE_STEPS } from "./cn";

describe("cn", () => {
  it("keeps a type-scale size beside a text colour", () => {
    expect(cn("font-mono text-code text-(--term-fg)")).toBe("font-mono text-code text-(--term-fg)");
    expect(cn("text-2xs", "text-muted-foreground")).toBe("text-2xs text-muted-foreground");
  });

  it("lets a later size replace a type-scale size", () => {
    expect(cn("text-code", "text-xs")).toBe("text-xs");
    expect(cn("text-sm", "text-3xs")).toBe("text-3xs");
  });

  it("knows every step the type scale declares", () => {
    const css = readFileSync(new URL("../ui/type-scale.css", import.meta.url), "utf8");
    const declared = [...css.matchAll(/--text-([\w-]+):/g)].map((match) => match[1]);
    expect([...TYPE_SCALE_STEPS].sort()).toEqual(declared.sort());
  });
});
