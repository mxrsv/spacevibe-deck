// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActionTooltip, tooltipAnchor } from "./action-tooltip";

/** A trigger at a fixed rect; jsdom lays nothing out, so the rect is stubbed. */
function trigger(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const element = document.createElement("button");
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
    }) as DOMRect;
  return element;
}

describe("tooltipAnchor", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  });

  it("opens below by default, from the trigger's bottom edge", () => {
    const anchor = tooltipAnchor(trigger({ left: 400, top: 10, width: 24, height: 24 }));

    expect(anchor).toEqual({ left: 412, top: 40 });
  });

  it("opens above from the trigger's top edge and says so", () => {
    const anchor = tooltipAnchor(trigger({ left: 400, top: 800, width: 24, height: 24 }), "above");

    expect(anchor).toEqual({ left: 412, top: 794, placement: "above" });
  });

  // The rail's first icon sits about 20px from the window's edge. A tooltip is
  // centred on `left` and capped at 240px, so `left` must be at least half of it.
  it("keeps an above tooltip fully on screen from a trigger at the left edge", () => {
    const anchor = tooltipAnchor(trigger({ left: 8, top: 800, width: 24, height: 24 }), "above");

    expect(anchor.left - 240 / 2).toBeGreaterThanOrEqual(0);
  });

  it("keeps an above tooltip fully on screen from a trigger at the right edge", () => {
    const anchor = tooltipAnchor(trigger({ left: 1176, top: 800, width: 24, height: 24 }), "above");

    expect(anchor.left + 240 / 2).toBeLessThanOrEqual(window.innerWidth);
  });
});

describe("ActionTooltip", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const props = { id: "tip", label: "Explorer", shortcut: "⌘⇧B", reason: null };

  it("carries the above modifier only for an above anchor", () => {
    act(() => render(<ActionTooltip {...props} anchor={{ left: 10, top: 20 }} />, host));
    expect(host.querySelector(".action-tip--above")).toBeNull();

    act(() =>
      render(<ActionTooltip {...props} anchor={{ left: 10, top: 20, placement: "above" }} />, host),
    );
    expect(host.querySelector(".action-tip.action-tip--above")).not.toBeNull();
  });
});
