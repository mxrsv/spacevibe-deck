// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SidebarGrip,
  sidebarCollapseArmed,
  sidebarWidthLive,
} from "./sidebar-grip";
import { SIDEBAR_WIDTH_MIN } from "../settings/settings-schema";

let host: HTMLDivElement;

function mount(props: {
  width: number;
  onWidthChange: (width: number) => void;
  onCollapsedChange: (collapsed: boolean) => void;
}): HTMLElement {
  act(() => {
    render(<SidebarGrip {...props} />, host);
  });
  const grip = host.querySelector<HTMLElement>(".sidebar-grip")!;
  // jsdom implements neither pointer capture method.
  grip.setPointerCapture = vi.fn();
  grip.releasePointerCapture = vi.fn();
  return grip;
}

function drag(grip: HTMLElement, from: number, to: readonly number[]): void {
  act(() => {
    grip.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: from,
        pointerId: 1,
        bubbles: true,
      }),
    );
    for (const x of to) {
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: x,
          pointerId: 1,
          bubbles: true,
        }),
      );
    }
  });
}

function release(grip: HTMLElement): void {
  act(() => {
    grip.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, bubbles: true }),
    );
  });
}

beforeEach(() => {
  sidebarWidthLive.value = null;
  sidebarCollapseArmed.value = false;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  sidebarWidthLive.value = null;
  sidebarCollapseArmed.value = false;
});

describe("SidebarGrip", () => {
  it("widens the column when dragged outward and commits once on release", () => {
    const onWidthChange = vi.fn();
    const onCollapsedChange = vi.fn();
    const grip = mount({ width: 275, onWidthChange, onCollapsedChange });

    // This grip is on the column's OUTER edge, the mirror of the explorer's:
    // dragging right widens it.
    drag(grip, 275, [335]);
    expect(sidebarWidthLive.value).toBe(335);
    expect(onWidthChange).not.toHaveBeenCalled();

    release(grip);
    expect(onWidthChange).toHaveBeenCalledTimes(1);
    expect(onWidthChange).toHaveBeenCalledWith(335);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(sidebarWidthLive.value).toBeNull();
  });

  it("arms the collapse past the floor and collapses on release without writing a width", () => {
    const onWidthChange = vi.fn();
    const onCollapsedChange = vi.fn();
    const grip = mount({ width: 275, onWidthChange, onCollapsedChange });

    // 275 - 175 = 100 raw, past the 140px floor-minus-slack threshold.
    drag(grip, 275, [100]);
    expect(sidebarCollapseArmed.value).toBe(true);
    // Still mounted, still at the floor: collapsing mid-drag would resize the
    // element the gesture is anchored to.
    expect(sidebarWidthLive.value).toBe(SIDEBAR_WIDTH_MIN);
    expect(onCollapsedChange).not.toHaveBeenCalled();

    release(grip);
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(onWidthChange).not.toHaveBeenCalled();
    expect(sidebarCollapseArmed.value).toBe(false);
  });

  it("pulls a hidden column back out, restoring both the width and the state", () => {
    const onWidthChange = vi.fn();
    const onCollapsedChange = vi.fn();
    // `width` is what the column is PAINTED at, and a hidden column is painted
    // at zero (DL-18.9, revised 2026-08-16) — not at the stored setting.
    const grip = mount({ width: 0, onWidthChange, onCollapsedChange });

    drag(grip, 0, [400]);
    expect(sidebarCollapseArmed.value).toBe(false);

    release(grip);
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
    expect(onWidthChange).toHaveBeenCalledWith(400);
  });

  it("ignores a press with no movement — toggling is the stage control's job", () => {
    const onWidthChange = vi.fn();
    const onCollapsedChange = vi.fn();
    const grip = mount({ width: 275, onWidthChange, onCollapsedChange });

    drag(grip, 275, []);
    release(grip);

    expect(onWidthChange).not.toHaveBeenCalled();
    expect(onCollapsedChange).not.toHaveBeenCalled();
  });

  // DL-18.9, amended 2026-08-19: the seam lights for the whole gesture, not
  // only while the pointer is still over its 9px target.
  it("marks itself dragging for the length of the gesture", () => {
    const grip = mount({
      width: 275,
      onWidthChange: vi.fn(),
      onCollapsedChange: vi.fn(),
    });
    expect(grip.className).not.toContain("is-dragging");

    drag(grip, 275, [330]);
    expect(
      host.querySelector<HTMLElement>(".sidebar-grip")!.className,
    ).toContain("is-dragging");

    release(grip);
    expect(
      host.querySelector<HTMLElement>(".sidebar-grip")!.className,
    ).not.toContain("is-dragging");
  });

  it("abandons the drag on pointercancel the same way it ends on pointerup", () => {
    const onWidthChange = vi.fn();
    const onCollapsedChange = vi.fn();
    const grip = mount({ width: 275, onWidthChange, onCollapsedChange });

    drag(grip, 275, [330]);
    act(() => {
      grip.dispatchEvent(
        new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }),
      );
    });

    expect(onWidthChange).toHaveBeenCalledWith(330);
    expect(sidebarWidthLive.value).toBeNull();
  });
});
