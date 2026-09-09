// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTabStripDrag } from "./tab-strip-drag";

const box = (left: number, width: number): DOMRect => ({
  left,
  right: left + width,
  top: 0,
  bottom: 30,
  width,
  height: 30,
  x: left,
  y: 0,
  toJSON: () => ({}),
});
function pointer(target: EventTarget, type: string, x: number, y = 10): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("tab strip pointer reorder", () => {
  let list: HTMLDivElement;
  let dispose: () => void;
  let drop: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    list = document.createElement("div");
    list.innerHTML = [1, 2, 3]
      .map(
        (key) =>
          `<div data-strip-key="${key}" data-pinned="false"><span class="tab__label">${key}</span><button>Close</button></div>`,
      )
      .join("");
    document.body.append(list);
    list.getBoundingClientRect = () => box(0, 300);
    [...list.children].forEach((el, index) => {
      el.getBoundingClientRect = () => box(index * 100, 100);
    });
    drop = vi.fn();
    dispose = createTabStripDrag(list, { onStart: vi.fn(), onDrop: drop });
  });
  afterEach(() => {
    dispose();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("remeasures the release position even before the animation frame fires", () => {
    pointer(list.children[0]!, "pointerdown", 10);
    pointer(window, "pointermove", 130);
    pointer(window, "pointerup", 290);
    expect(drop).toHaveBeenCalledExactlyOnceWith(1, null);
    expect(document.querySelector(".tab-strip-ghost")).toBeNull();
  });
  it("leaves normal clicks and close buttons alone", () => {
    pointer(list.children[0]!, "pointerdown", 10);
    pointer(window, "pointerup", 12);
    pointer(list.querySelector("button")!, "pointerdown", 10);
    pointer(window, "pointermove", 250);
    pointer(window, "pointerup", 250);
    expect(drop).not.toHaveBeenCalled();
  });
  it("Escape cancels the drop and suppresses the following selection click", () => {
    const click = vi.fn();
    list.addEventListener("click", click);
    pointer(list.children[0]!, "pointerdown", 10);
    pointer(window, "pointermove", 150);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    pointer(window, "pointerup", 200);
    list.children[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(drop).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
  it("abandons a removed source and drops outside the strip", () => {
    pointer(list.children[0]!, "pointerdown", 10);
    pointer(window, "pointermove", 150);
    list.children[0]!.remove();
    pointer(window, "pointerup", 200);
    expect(drop).not.toHaveBeenCalled();
    pointer(list.children[0]!, "pointerdown", 110);
    pointer(window, "pointermove", 150, 100);
    pointer(window, "pointerup", 200, 100);
    expect(drop).not.toHaveBeenCalled();
  });
  it("restricts a pinned source to the pinned group", () => {
    (list.children[0] as HTMLElement).dataset.pinned = "true";
    (list.children[1] as HTMLElement).dataset.pinned = "true";
    pointer(list.children[0]!, "pointerdown", 10);
    pointer(window, "pointermove", 290);
    pointer(window, "pointerup", 290);
    expect(drop).toHaveBeenCalledExactlyOnceWith(1, null);
  });
});
