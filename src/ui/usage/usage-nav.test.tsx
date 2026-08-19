// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The registry imports the sections, which import the usage store; the store's
// client reaches `invoke`. Stub it so the tree mounts under jsdom.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { UsageNav } from "./usage-nav";
import { activeUsageView } from "./active-usage-view-store";
import { USAGE_VIEWS } from "./usage-views";

describe("UsageNav", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    // Module-level signal shared across test files — reset it so nothing here
    // passes because an earlier file left it convenient.
    activeUsageView.value = "overview";
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    activeUsageView.value = "overview";
  });

  const mount = (): void => {
    act(() => {
      render(<UsageNav />, host);
    });
  };

  const getTabs = (): HTMLButtonElement[] => Array.from(host.querySelectorAll('[role="tab"]'));

  it("renders the three views in registry order, labels sentence-case (DL-11.4)", () => {
    mount();
    const tabs = getTabs();
    expect(tabs).toHaveLength(USAGE_VIEWS.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Daily", "Breakdown"]);
    for (const tab of tabs) {
      expect(tab.textContent).not.toBe(tab.textContent?.toUpperCase());
    }
  });

  it("clicking each tab sets activeUsageView.value to the matching id", () => {
    mount();
    const tabs = getTabs();
    USAGE_VIEWS.forEach((view, index) => {
      act(() => {
        tabs[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(activeUsageView.value).toBe(view.id);
    });
  });

  it("marks exactly one tab active", () => {
    activeUsageView.value = "daily";
    mount();
    for (const tab of getTabs()) {
      const shouldBeActive = tab.textContent === "Daily";
      expect(tab.classList.contains("is-active")).toBe(shouldBeActive);
      expect(tab.getAttribute("aria-selected")).toBe(String(shouldBeActive));
    }
  });

  it("ArrowDown from the last item wraps to the first, moving focus with it", () => {
    activeUsageView.value = "breakdown";
    mount();
    const tabs = getTabs();
    tabs[tabs.length - 1].focus();

    act(() => {
      tabs[tabs.length - 1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(activeUsageView.value).toBe("overview");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("ArrowUp from the first item wraps to the last, moving focus with it", () => {
    mount();
    const tabs = getTabs();
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });

    expect(activeUsageView.value).toBe("breakdown");
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
  });

  it("has no rail foot — there is no destructive action here (DL-11.5)", () => {
    mount();
    expect(host.querySelector(".usage-nav__foot")).toBeNull();
    expect(host.querySelector(".cfg-btn--danger")).toBeNull();
  });

  it("draws every rail icon through DeckIcon at 16px (DL-11.3, DL-14.2)", () => {
    mount();
    const icons = host.querySelectorAll("svg");
    expect(icons).toHaveLength(USAGE_VIEWS.length);
    for (const icon of icons) {
      expect(icon.getAttribute("width")).toBe("16");
      expect(icon.getAttribute("height")).toBe("16");
    }
  });
});
