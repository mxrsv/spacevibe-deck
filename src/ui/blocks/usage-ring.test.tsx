// @vitest-environment jsdom
import { render } from "preact";
import { describe, expect, it } from "vitest";
import { UsageRing } from "./usage-ring";

function ring(remaining: number | null): HTMLElement {
  const host = document.createElement("div");
  render(
    <UsageRing remaining={remaining}>
      <i data-logo />
    </UsageRing>,
    host,
  );
  return host.firstElementChild as HTMLElement;
}
const arc = (element: HTMLElement) => element.querySelector("[data-slot=usage-ring-value]");

describe("UsageRing", () => {
  it("draws the share left around the caller's logo", () => {
    const element = ring(77);
    expect(arc(element)?.getAttribute("stroke-dasharray")).toBe("77 100");
    expect(element.querySelector("[data-logo]")).not.toBeNull();
    expect(element.hasAttribute("data-low")).toBe(false);
  });

  it("turns low at the threshold, not above it", () => {
    expect(ring(20).hasAttribute("data-low")).toBe(true);
    expect(ring(21).hasAttribute("data-low")).toBe(false);
  });

  it("draws only the track without a reading, and no number it does not have", () => {
    const element = ring(null);
    expect(arc(element)).toBeNull();
    expect(element.hasAttribute("data-low")).toBe(false);
  });

  it("keeps a reading out of range inside the ring", () => {
    expect(arc(ring(140))?.getAttribute("stroke-dasharray")).toBe("100 100");
    expect(arc(ring(-5))?.getAttribute("stroke-dasharray")).toBe("0 100");
  });
});
