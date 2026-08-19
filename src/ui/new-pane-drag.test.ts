// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaneRect } from "../lib/pane-geometry";
import { createNewPaneDragController } from "./new-pane-drag";

/** One 200×100 pane at the origin — every edge is unambiguous inside it. */
const PANE: PaneRect = { id: 7, left: 0, top: 0, right: 200, bottom: 100 };

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  // jsdom has no PointerEvent constructor; MouseEvent carries every field
  // this controller reads, and `pointerId` is patched on after construction.
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: x,
    clientY: y,
    button: 0,
    ...init,
  }) as unknown as PointerEvent;
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

describe("createNewPaneDragController", () => {
  let handle: HTMLButtonElement;
  let rects: readonly PaneRect[];
  const onDrop = vi.fn<(id: number, edge: string) => void>();
  const onDragStart = vi.fn();

  beforeEach(() => {
    document.body.innerHTML = "";
    handle = document.createElement("button");
    document.body.append(handle);
    rects = [PANE];
    onDrop.mockClear();
    onDragStart.mockClear();
  });
  afterEach(() => {
    document.body.className = "";
  });

  function install() {
    return createNewPaneDragController(handle, {
      ghostLabel: "New agent pane",
      slotRects: () => rects,
      onDragStart,
      onDrop,
    });
  }

  it("stays a plain button below the drag threshold", () => {
    const controller = install();

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 502, 502));
    window.dispatchEvent(pointer("pointerup", 502, 502));

    expect(onDragStart).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.querySelector(".pane-drag-ghost")).toBeNull();
    controller.dispose();
  });

  it("reports the pane and the nearest edge on drop", () => {
    const controller = install();

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 520, 520));
    // x=180 of 200 is closest to the right edge; y=50 is centred.
    window.dispatchEvent(pointer("pointermove", 180, 50));
    window.dispatchEvent(pointer("pointerup", 180, 50));

    expect(onDragStart).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(7, "right");
    controller.dispose();
  });

  it("paints a ghost and an edge overlay while dragging, and clears both", () => {
    const controller = install();

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 10, 50));

    const overlay = document.querySelector<HTMLElement>(".drop-overlay");
    expect(document.querySelector(".pane-drag-ghost")?.textContent).toBe("New agent pane");
    // Left edge → the left half of the pane.
    expect(overlay?.style.width).toBe("100px");
    expect(overlay?.style.left).toBe("0px");
    expect(document.body.classList.contains("is-pane-dragging")).toBe(true);

    window.dispatchEvent(pointer("pointerup", 10, 50));

    expect(document.querySelector(".drop-overlay")).toBeNull();
    expect(document.querySelector(".pane-drag-ghost")).toBeNull();
    expect(document.body.classList.contains("is-pane-dragging")).toBe(false);
    controller.dispose();
  });

  it("drops nothing when the cursor is outside every pane", () => {
    const controller = install();

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 480, 480));
    window.dispatchEvent(pointer("pointerup", 480, 480));

    expect(onDrop).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("drops nothing when the host reports no targets (a covered stage)", () => {
    const controller = install();
    rects = [];

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 100, 50));
    window.dispatchEvent(pointer("pointerup", 100, 50));

    expect(onDrop).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("cancels on Escape without dropping", () => {
    const controller = install();

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 100, 50));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(pointer("pointerup", 100, 50));

    expect(onDrop).not.toHaveBeenCalled();
    expect(document.querySelector(".drop-overlay")).toBeNull();
    controller.dispose();
  });

  it("swallows the click a drag released over the handle would fire", () => {
    const controller = install();
    const click = vi.fn();
    handle.addEventListener("click", click);

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 520, 520));
    window.dispatchEvent(pointer("pointerup", 520, 520));
    handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(click).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("leaves an ordinary click alone", () => {
    const controller = install();
    const click = vi.fn();
    handle.addEventListener("click", click);

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointerup", 500, 500));
    handle.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(click).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("stops listening after dispose", () => {
    const controller = install();
    controller.dispose();

    handle.dispatchEvent(pointer("pointerdown", 500, 500));
    window.dispatchEvent(pointer("pointermove", 100, 50));
    window.dispatchEvent(pointer("pointerup", 100, 50));

    expect(onDrop).not.toHaveBeenCalled();
  });
});
