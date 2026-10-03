import { describe, expect, it } from "vitest";
import { hiddenNeeds } from "./space-edge";

const FRAME = { left: 100, right: 300 };
const at = (x: number) => ({ left: x - 8, right: x + 8 });

describe("hiddenNeeds", () => {
  it("is empty when every needs-you mark is inside the frame", () => {
    expect(hiddenNeeds(FRAME, [at(120), at(280)])).toEqual({ left: null, right: null });
    expect(hiddenNeeds(FRAME, [])).toEqual({ left: null, right: null });
  });

  it("names the side a needs-you mark has scrolled off, in red", () => {
    expect(hiddenNeeds(FRAME, [at(40)])).toEqual({ left: "red", right: null });
    expect(hiddenNeeds(FRAME, [at(360)])).toEqual({ left: null, right: "red" });
    expect(hiddenNeeds(FRAME, [at(40), at(200), at(360)])).toEqual({ left: "red", right: "red" });
  });

  it("keeps a mark whose dot is still showing out of the edge", () => {
    // Half under the left edge, but its centre (the dot) is inside.
    expect(hiddenNeeds(FRAME, [at(101)])).toEqual({ left: null, right: null });
  });
});
