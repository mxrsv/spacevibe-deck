// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { trackCapturedDrag } from "./captured-pointer-drag";

describe("trackCapturedDrag", () => {
  it("calls onEnd exactly once when releasePointerCapture throws NotFoundError", () => {
    const target = document.createElement("div");
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn(() => {
      const error = new DOMException("The pointer is not active", "NotFoundError");
      throw error;
    });

    const onMove = vi.fn();
    const onEnd = vi.fn();

    trackCapturedDrag(target, 42, { onMove, onEnd });

    expect(target.setPointerCapture).toHaveBeenCalledWith(42);

    // Trigger pointerup
    const pointerUpEvent = new Event("pointerup");
    target.dispatchEvent(pointerUpEvent);

    expect(target.releasePointerCapture).toHaveBeenCalledWith(42);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("releases pointer capture normally when it does not throw", () => {
    const target = document.createElement("div");
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    const onMove = vi.fn();
    const onEnd = vi.fn();

    trackCapturedDrag(target, 1, { onMove, onEnd });

    const pointerUpEvent = new Event("pointerup");
    target.dispatchEvent(pointerUpEvent);

    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it("calls onEnd when lostpointercapture or blur fires", () => {
    const target = document.createElement("div");
    target.setPointerCapture = vi.fn();
    target.releasePointerCapture = vi.fn();

    const onMove = vi.fn();
    const onEnd = vi.fn();

    trackCapturedDrag(target, 2, { onMove, onEnd });

    // Window blur
    window.dispatchEvent(new Event("blur"));

    expect(onEnd).toHaveBeenCalledTimes(1);

    // Later pointerup should not trigger onEnd again
    target.dispatchEvent(new Event("pointerup"));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
