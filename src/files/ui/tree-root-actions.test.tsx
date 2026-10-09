// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeRootActions } from "./tree-root-actions";

let host: HTMLDivElement;
const handlers = () => ({
  showHidden: false,
  onNewFile: vi.fn(),
  onNewFolder: vi.fn(),
  onToggleHidden: vi.fn(),
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
  it("draws five controls in spec order when the host can create", () => {
    act(() => render(<TreeRootActions canCreate tabIndex={0} {...handlers()} />, host));
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "New file",
      "New folder",
      "Show hidden files",
      "Refresh",
      "Collapse all",
    ]);
  });

  it("omits the two create controls when the host cannot answer", () => {
    // Design §6.4: a control that cannot answer is worse than no control
    // (DL-19.7's own reasoning). Show hidden files, Refresh and Collapse All
    // are renderer-only, so the cluster never disappears entirely.
    act(() => render(<TreeRootActions canCreate={false} tabIndex={0} {...handlers()} />, host));
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Show hidden files",
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
    // None of them is a keymap action, so there is no chord to print.
    expect(tip?.querySelector(".action-tip__kbd")).toBeNull();
  });

  describe("Show hidden files", () => {
    const toggle = (): HTMLButtonElement =>
      host.querySelector<HTMLButtonElement>('[aria-label="Show hidden files"]')!;
    const glyph = (): string[] => [...toggle().querySelector("svg")!.classList];

    it("is a toggle whose state and glyph follow the prop", () => {
      const props = handlers();
      act(() => render(<TreeRootActions canCreate tabIndex={0} {...props} />, host));
      expect(toggle().getAttribute("aria-pressed")).toBe("false");
      expect(glyph()).toContain("deck-icon--eye-slash");

      act(() => render(<TreeRootActions canCreate tabIndex={0} {...props} showHidden />, host));
      expect(toggle().getAttribute("aria-pressed")).toBe("true");
      expect(glyph()).toContain("deck-icon--eye");
      expect(glyph()).not.toContain("deck-icon--eye-slash");
    });

    it("keeps one constant label and carries no wash class in either state", () => {
      const props = handlers();
      act(() => render(<TreeRootActions canCreate tabIndex={0} {...props} />, host));
      const off = toggle().className;
      act(() => render(<TreeRootActions canCreate tabIndex={0} {...props} showHidden />, host));
      expect(toggle().getAttribute("aria-label")).toBe("Show hidden files");
      expect(toggle().className).toBe(off);
    });

    it("leaves aria-pressed off the plain actions", () => {
      act(() => render(<TreeRootActions canCreate tabIndex={0} {...handlers()} />, host));
      const pressed = [...host.querySelectorAll("button")].filter((b) =>
        b.hasAttribute("aria-pressed"),
      );
      expect(pressed.map((b) => b.getAttribute("aria-label"))).toEqual(["Show hidden files"]);
    });

    it("presses once and does not reach the row behind it", () => {
      const rowClick = vi.fn();
      host.addEventListener("click", rowClick);
      const props = handlers();
      act(() => render(<TreeRootActions canCreate tabIndex={0} {...props} />, host));
      act(() => toggle().click());
      expect(props.onToggleHidden).toHaveBeenCalledTimes(1);
      expect(rowClick).not.toHaveBeenCalled();
    });

    it("is named by a tooltip with no chord", () => {
      act(() => render(<TreeRootActions canCreate tabIndex={0} {...handlers()} />, host));
      expect(toggle().getAttribute("title")).toBeNull();
      act(() => {
        toggle().dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
      });
      const tip = document.querySelector(".action-tip");
      expect(tip?.textContent).toContain("Show hidden files");
      expect(tip?.querySelector(".action-tip__kbd")).toBeNull();
    });
  });
});
