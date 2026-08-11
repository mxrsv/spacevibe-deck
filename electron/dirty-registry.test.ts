import { describe, expect, it } from "vitest";
import { MainDirtyRegistry } from "./dirty-registry";

describe("MainDirtyRegistry", () => {
  it("keeps each window's unsaved files separate", () => {
    const registry = new MainDirtyRegistry();
    registry.replace("main", ["/r/a.ts"]);
    registry.replace("deck-2", ["/r/b.ts"]);
    expect(registry.forWindow("main")).toEqual(["/r/a.ts"]);
    expect(registry.forWindow("deck-2")).toEqual(["/r/b.ts"]);
    expect(registry.all().sort()).toEqual(["/r/a.ts", "/r/b.ts"]);
  });

  it("REPLACES a window's set rather than merging into it", () => {
    // The renderer sends its complete set on every transition, so the host's
    // view cannot drift if a message is dropped or arrives twice.
    const registry = new MainDirtyRegistry();
    registry.replace("main", ["/r/a.ts", "/r/b.ts"]);
    registry.replace("main", ["/r/b.ts"]);
    expect(registry.forWindow("main")).toEqual(["/r/b.ts"]);
  });

  it("deduplicates the same file open in two windows", () => {
    // One quit dialog naming it twice reads as two different problems.
    const registry = new MainDirtyRegistry();
    registry.replace("main", ["/r/shared.ts"]);
    registry.replace("deck-2", ["/r/shared.ts"]);
    expect(registry.all()).toEqual(["/r/shared.ts"]);
  });

  it("forgets a window's entries when it dies", () => {
    // Without this a renderer that died mid-edit leaves main permanently
    // believing a file is unsaved, and ⌘Q asks about a window that is gone.
    const registry = new MainDirtyRegistry();
    registry.replace("main", ["/r/a.ts"]);
    registry.forgetWindow("main");
    expect(registry.forWindow("main")).toEqual([]);
    expect(registry.anyDirty()).toBe(false);
  });

  it("answers anyDirty across every window — the ⌘Q early return's question", () => {
    const registry = new MainDirtyRegistry();
    expect(registry.anyDirty()).toBe(false);
    registry.replace("deck-3", ["/r/a.ts"]);
    expect(registry.anyDirty()).toBe(true);
    registry.replace("deck-3", []);
    expect(registry.anyDirty()).toBe(false);
  });

  it("drops non-string entries rather than trusting the renderer", () => {
    const registry = new MainDirtyRegistry();
    registry.replace("main", ["/r/a.ts", 7, null, "", { path: "/r/b.ts" }]);
    expect(registry.forWindow("main")).toEqual(["/r/a.ts"]);
  });

  it("bounds what one window can make the host hold", () => {
    const registry = new MainDirtyRegistry();
    registry.replace(
      "main",
      Array.from({ length: 5000 }, (_, index) => `/r/${index}.ts`),
    );
    expect(registry.forWindow("main")).toHaveLength(512);
    // Truncation still leaves the census reporting files, so the guard asks.
    expect(registry.anyDirty()).toBe(true);
  });

  it("returns a copy, so a caller cannot mutate the registry's state", () => {
    const registry = new MainDirtyRegistry();
    registry.replace("main", ["/r/a.ts"]);
    registry.forWindow("main").push("/r/injected.ts");
    expect(registry.forWindow("main")).toEqual(["/r/a.ts"]);
  });
});
