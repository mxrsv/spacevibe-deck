// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeRootActions } from "./tree-root-actions";

let host: HTMLDivElement;
const handlers = () => ({
  onNewFile: vi.fn(),
  onNewFolder: vi.fn(),
  onRefresh: vi.fn(),
  onCollapseAll: vi.fn(),
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

describe("TreeRootActions", () => {
  it("draws four controls in spec order when the host can create", () => {
    act(() => render(<TreeRootActions canCreate tabIndex={0} {...handlers()} />, host));
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "New file",
      "New folder",
      "Refresh",
      "Collapse all",
    ]);
  });

  it("omits the two create controls when the host cannot answer", () => {
    // Design §6.4: a control that cannot answer is worse than no control
    // (DL-19.7's own reasoning). Refresh and Collapse All are renderer-only,
    // so the cluster never disappears entirely.
    act(() => render(<TreeRootActions canCreate={false} tabIndex={0} {...handlers()} />, host));
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Refresh",
      "Collapse all",
    ]);
  });

  it("mirrors the row's roving tab stop onto every button", () => {
    act(() => render(<TreeRootActions canCreate tabIndex={-1} {...handlers()} />, host));
    for (const button of host.querySelectorAll("button")) {
      expect(button.tabIndex).toBe(-1);
    }
  });

  it("stops a click from reaching the row behind it", () => {
    const rowClick = vi.fn();
    host.addEventListener("click", rowClick);
    const props = handlers();
    act(() => render(<TreeRootActions canCreate tabIndex={0} {...props} />, host));
    act(() => {
      (host.querySelector("button") as HTMLElement).click();
    });
    expect(props.onNewFile).toHaveBeenCalledTimes(1);
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("drops the native title and describes itself on hover (DL-23.10)", () => {
    act(() => render(<TreeRootActions canCreate tabIndex={0} {...handlers()} />, host));
    const button = host.querySelector("button") as HTMLButtonElement;
    expect(button.getAttribute("title")).toBeNull();
    act(() => {
      button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    });
    const tip = document.querySelector(".action-tip");
    expect(tip?.textContent).toContain("New file");
    // None of the four is a keymap action, so there is no chord to print.
    expect(tip?.querySelector(".action-tip__kbd")).toBeNull();
  });
});
