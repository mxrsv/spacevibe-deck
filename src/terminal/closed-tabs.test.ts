import { describe, expect, it } from "vitest";
import {
  MAX_CLOSED_TABS,
  popClosedTab,
  pushClosedTab,
  type ClosedTabSnapshot,
} from "./closed-tabs";

function snap(name: string): ClosedTabSnapshot {
  return {
    layout: { type: "leaf" },
    name,
    dotColor: null,
    cwds: [null],
    workspacePath: null,
  };
}

describe("pushClosedTab / popClosedTab", () => {
  it("pops in LIFO order without mutating the input", () => {
    const stack = pushClosedTab(pushClosedTab([], snap("a")), snap("b"));
    const [top, rest] = popClosedTab(stack);
    expect(top?.name).toBe("b");
    expect(rest.map((s) => s.name)).toEqual(["a"]);
    expect(stack).toHaveLength(2); // no mutation
  });

  it("caps the stack at MAX_CLOSED_TABS, dropping the oldest", () => {
    let stack: readonly ClosedTabSnapshot[] = [];
    for (let i = 0; i < MAX_CLOSED_TABS + 3; i += 1) {
      stack = pushClosedTab(stack, snap(`t${i}`));
    }
    expect(stack).toHaveLength(MAX_CLOSED_TABS);
    expect(stack[0].name).toBe("t3"); // oldest three dropped
    expect(stack[stack.length - 1].name).toBe(`t${MAX_CLOSED_TABS + 2}`);
  });

  it("pops null from an empty stack", () => {
    const [top, rest] = popClosedTab([]);
    expect(top).toBeNull();
    expect(rest).toEqual([]);
  });
});
