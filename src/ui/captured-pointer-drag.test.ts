// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackCapturedDrag } from "./captured-pointer-drag";

/**
 * A target that holds pointer capture the way Chromium does: `releasePointerCapture` throws
 * `NotFoundError` once the pointer is no longer active, as a touch or pen pointer is after its
 * `pointerup`. jsdom implements no pointer capture of its own.
 */
function seam(): { target: HTMLElement; deactivate: () => void } {
  const target = document.createElement("div");
  document.body.append(target);
  let captured: number | null = null;
  let active = true;
  target.setPointerCapture = (id: number) => {
    captured = id;
  };
  target.hasPointerCapture = (id: number) => active && captured === id;
  target.releasePointerCapture = (id: number) => {
    if (!active) {
      throw new DOMException("No active pointer with the given id is found.", "NotFoundError");
    }
    if (captured === id) {
      captured = null;
    }
  };
  return {
    target,
    deactivate: () => {
      active = false;
    },
  };
}

const pointer = (type: string, buttons: number): PointerEvent =>
  new PointerEvent(type, { pointerId: 1, buttons, bubbles: true });

afterEach(() => {
  document.body.replaceChildren();
});

describe("trackCapturedDrag", () => {
  it("ends a touch drag once its pointer is gone, even though releasing the capture throws", () => {
    const { target, deactivate } = seam();
    const onMove = vi.fn();
    const onEnd = vi.fn();
    trackCapturedDrag(target, 1, { onMove, onEnd });

    target.dispatchEvent(pointer("pointermove", 1));
    deactivate();
    expect(() => target.dispatchEvent(pointer("pointerup", 0))).not.toThrow();

    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    // Later moves no longer reach the drag.
    target.dispatchEvent(pointer("pointermove", 1));
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it("gives the capture back when a lost release surfaces as a move with no button held", () => {
    const { target } = seam();
    const onEnd = vi.fn();
    trackCapturedDrag(target, 1, { onMove: vi.fn(), onEnd });

    expect(target.hasPointerCapture(1)).toBe(true);
    target.dispatchEvent(pointer("pointermove", 0));

    expect(target.hasPointerCapture(1)).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
