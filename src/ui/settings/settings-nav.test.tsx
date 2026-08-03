// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The rail's foot mounts `ResetSection`, and the registry's sections pull in
// the Tauri-backed settings store — stub both so the tree mounts under
// jsdom, same convention as `sections/reset-section.test.tsx`.
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
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

  const getTabs = (): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll('[role="tab"]'));

  it("renders exactly the five categories as tabs, in registry order", () => {
    mount();
    const tabs = getTabs();
    expect(tabs).toHaveLength(5);
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
    activeCategory.value = "notifications"; // last category
    mount();
    const tabs = getTabs();
    tabs[4].focus();

    act(() => {
      tabs[4].dispatchEvent(
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
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });

    expect(activeCategory.value).toBe("notifications");
    expect(document.activeElement).toBe(tabs[4]);
  });

  it("renders the reset action once, outside the five tabs, and clicking it does not change activeCategory", () => {
    mount();
    const resetButtons = host.querySelectorAll(".cfg-btn--danger");
    expect(resetButtons).toHaveLength(1);

    const resetButton = resetButtons[0] as HTMLButtonElement;
    expect(resetButton.getAttribute("role")).not.toBe("tab");
    expect(getTabs()).toHaveLength(5);

    act(() => {
      resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(activeCategory.value).toBe("appearance");
  });
});
