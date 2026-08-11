import { describe, expect, it } from "vitest";
import {
  createDirtyRegistry,
  createPushingDirtyRegistry,
} from "./dirty-registry";

describe("createDirtyRegistry", () => {
  it("reports a transition only when the set actually changed", () => {
    const registry = createDirtyRegistry();
    expect(registry.set("/r/a.ts", true)).toBe(true);
    // Every keystroke re-reports dirty; only the first one is a transition, or
    // the bridge would put an IPC message on the wire per character.
    expect(registry.set("/r/a.ts", true)).toBe(false);
    expect(registry.set("/r/a.ts", false)).toBe(true);
    expect(registry.set("/r/a.ts", false)).toBe(false);
  });

  it("clears on save and on close", () => {
    const registry = createDirtyRegistry();
    registry.set("/r/a.ts", true);
    registry.set("/r/b.ts", true);
    registry.set("/r/a.ts", false); // saved
    registry.forget("/r/b.ts"); // tab closed, guard already ran
    expect(registry.paths()).toEqual([]);
  });

  it("returns its paths sorted, so the payload is stable across pushes", () => {
    const registry = createDirtyRegistry();
    registry.set("/r/z.ts", true);
    registry.set("/r/a.ts", true);
    expect(registry.paths()).toEqual(["/r/a.ts", "/r/z.ts"]);
  });

  it("prunes everything outside the live set", () => {
    const registry = createDirtyRegistry();
    registry.set("/r/a.ts", true);
    registry.set("/r/b.ts", true);
    expect(registry.prune(["/r/a.ts"])).toBe(true);
    expect(registry.paths()).toEqual(["/r/a.ts"]);
    expect(registry.prune(["/r/a.ts"])).toBe(false);
  });
});

describe("fails toward asking", () => {
  // The safe answer is NOT the symmetric one, so both directions are asserted
  // rather than one being inferred from the other.
  it("resolves an unknown state toward dirty", () => {
    const registry = createDirtyRegistry();
    expect(registry.set("/r/a.ts", "unknown")).toBe(true);
    expect(registry.has("/r/a.ts")).toBe(true);
  });

  it("keeps a dirty file dirty when its state becomes unknown", () => {
    const registry = createDirtyRegistry();
    registry.set("/r/a.ts", true);
    expect(registry.set("/r/a.ts", "unknown")).toBe(false);
    expect(registry.has("/r/a.ts")).toBe(true);
  });

  it("only an explicit false clears a path", () => {
    const registry = createDirtyRegistry();
    registry.set("/r/a.ts", "unknown");
    registry.set("/r/a.ts", false);
    expect(registry.has("/r/a.ts")).toBe(false);
  });
});

describe("createPushingDirtyRegistry", () => {
  it("pushes the COMPLETE set on every transition, never a partial delta", () => {
    const pushes: readonly string[][] = [];
    const sent: string[][] = [];
    const registry = createPushingDirtyRegistry((paths) => {
      sent.push([...paths]);
    });
    registry.set("/r/a.ts", true);
    registry.set("/r/b.ts", true);
    registry.set("/r/a.ts", false);
    expect(sent).toEqual([["/r/a.ts"], ["/r/a.ts", "/r/b.ts"], ["/r/b.ts"]]);
    expect(pushes).toEqual([]);
  });

  it("stays silent when nothing changed", () => {
    const sent: string[][] = [];
    const registry = createPushingDirtyRegistry((paths) => {
      sent.push([...paths]);
    });
    registry.set("/r/a.ts", true);
    registry.set("/r/a.ts", true);
    registry.forget("/r/missing.ts");
    expect(sent).toHaveLength(1);
  });

  it("pushes an empty set when the last dirty file is saved", () => {
    const sent: string[][] = [];
    const registry = createPushingDirtyRegistry((paths) => {
      sent.push([...paths]);
    });
    registry.set("/r/a.ts", true);
    registry.set("/r/a.ts", false);
    expect(sent[1]).toEqual([]);
  });
});
