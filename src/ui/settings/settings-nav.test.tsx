// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The registry's sections pull in the Tauri-backed settings store — stub it
// so the tree mounts under jsdom, same convention as
// `sections/reset-section.test.tsx`.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({
  ask: vi.fn(async () => false),
}));

import { SettingsNav } from "./settings-nav";
import { activeCategory } from "./active-category-store";
import { SETTINGS_CATEGORIES } from "./settings-categories";

describe("SettingsNav", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    // `activeCategory` is a module-level signal shared across test files —
    // reset it so no case here passes merely because an earlier file (or an
    // earlier case) left it in a convenient state.
    activeCategory.value = "appearance";
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  const mount = (): void => {
    act(() => {
      render(<SettingsNav />, host);
    });
  };

  const getTabs = (): HTMLButtonElement[] => Array.from(host.querySelectorAll('[role="tab"]'));

  it("renders every registered category as a tab, in registry order", () => {
    mount();
    const tabs = getTabs();
    expect(tabs).toHaveLength(SETTINGS_CATEGORIES.length);
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      SETTINGS_CATEGORIES.map((category) => category.label),
    );
  });

  it("clicking each tab sets activeCategory.value to the matching id", () => {
    mount();
    const tabs = getTabs();

    SETTINGS_CATEGORIES.forEach((category, index) => {
      act(() => {
        tabs[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(activeCategory.value).toBe(category.id);
    });
  });

  it("marks the active tab with is-active and aria-selected, and no other", () => {
    activeCategory.value = "terminal";
    mount();
    const tabs = getTabs();

    tabs.forEach((tab, index) => {
      const shouldBeActive = SETTINGS_CATEGORIES[index].id === "terminal";
      expect(tab.classList.contains("is-active")).toBe(shouldBeActive);
      expect(tab.getAttribute("aria-selected")).toBe(String(shouldBeActive));
    });
  });

  it("ArrowDown from the last item wraps to the first, moving focus with it", () => {
    activeCategory.value = "reset"; // last category
    mount();
    const tabs = getTabs();
    tabs[tabs.length - 1].focus();

    act(() => {
      tabs[tabs.length - 1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(activeCategory.value).toBe("appearance");
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("ArrowUp from the first item wraps to the last, moving focus with it", () => {
    activeCategory.value = "appearance"; // first category
    mount();
    const tabs = getTabs();
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });

    expect(activeCategory.value).toBe("reset");
    expect(document.activeElement).toBe(tabs[tabs.length - 1]);
  });

  /**
   * Inverted on 2026-08-19 (owner, DL-11.5 amended). This case used to assert
   * the opposite — a reset button mounted OUTSIDE the tab list, in a pinned
   * foot, that did not move `activeCategory`. `reset` is an ordinary category
   * now, so the rail holds nothing but tabs and reset is reached by selecting
   * one. The destructive control lives in the section on the right, and what
   * keeps it safe is the confirm `reset-section.test.tsx` covers.
   */
  it("holds nothing but tabs — the reset action is no longer in the rail", () => {
    mount();

    expect(host.querySelectorAll(".cfg-btn--danger")).toHaveLength(0);
    expect(host.querySelector(".settings-nav__foot")).toBeNull();
    expect(getTabs()).toHaveLength(SETTINGS_CATEGORIES.length);
    // Every focusable thing in the rail IS a tab.
    expect(host.querySelectorAll("button")).toHaveLength(getTabs().length);
  });

  it("reaches reset by selecting it, like any other category", () => {
    mount();
    const tabs = getTabs();
    const resetTab = tabs[tabs.length - 1];

    expect(resetTab.textContent?.trim()).toBe("Reset");
    act(() => {
      resetTab.click();
    });

    expect(activeCategory.value).toBe("reset");
  });
});
