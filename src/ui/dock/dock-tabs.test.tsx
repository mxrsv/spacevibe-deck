// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockTabs } from "./dock-tabs";
import { DOCK_TABS, availableDockTabs } from "./dock-tab-registry";
import { shortcutLabel } from "../../lib/shortcut-label";

describe("DockTabs", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const getTabs = (): HTMLButtonElement[] => Array.from(host.querySelectorAll('[role="tab"]'));

  it("renders one tab per item, in order, inside a labelled tablist", () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={vi.fn()} />, host));

    const tablist = host.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
    expect(tablist?.getAttribute("aria-label")).toBeTruthy();

    const tabs = getTabs();
    expect(tabs).toHaveLength(DOCK_TABS.length);
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(
      DOCK_TABS.map((item) => item.label),
    );
    // No native `title` since 2026-08-19: the §23 tooltip carries the name
    // and its chord, and two tooltips for one chip is one too many.
    expect(tabs.every((tab) => tab.getAttribute("title") === null)).toBe(true);
    expect(tabs.every((tab) => tab.textContent === "")).toBe(true);
  });

  it("marks only the active chip with is-active and aria-selected", () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="usage" onSelect={vi.fn()} />, host));

    getTabs().forEach((tab, index) => {
      const shouldBeActive = DOCK_TABS[index].id === "usage";
      expect(tab.classList.contains("is-active")).toBe(shouldBeActive);
      expect(tab.getAttribute("aria-selected")).toBe(String(shouldBeActive));
    });
  });

  it("reports the clicked id and keeps no state of its own", () => {
    const onSelect = vi.fn();
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={onSelect} />, host));

    const tabs = getTabs();
    act(() => {
      tabs[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(DOCK_TABS[1].id);
    // Nothing repainted: the caller owns `active`, this component does not.
    expect(tabs[1].classList.contains("is-active")).toBe(false);
  });

  it("renders exactly the items it is given — a caller narrowing to two tabs sees two", () => {
    const narrowed = availableDockTabs(false);
    act(() => render(<DockTabs items={narrowed} active="explorer" onSelect={vi.fn()} />, host));

    const tabs = getTabs();
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "File explorer",
      "Token usage",
    ]);
  });

  it("draws each chip's icon through DeckIcon, never a raw glyph", () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={vi.fn()} />, host));

    getTabs().forEach((tab) => {
      const icon = tab.querySelector("svg.deck-icon");
      expect(icon).not.toBeNull();
      // `FEATURE_ICON`, one rung up from chrome since 2026-08-19 (DL-14.2):
      // these three chips are feature entry points, not tab-bar furniture.
      expect(icon?.getAttribute("width")).toBe("15");
    });
  });

  // DL-23.1, 2026-08-19: the chip is icon-only, so the tooltip is the only
  // place its name and chord are ever printed. It opens on hover AND on focus
  // — the native `title` it replaced did neither for a keyboard.
  it("says the tab's name and its chord on hover, and again on focus", () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={vi.fn()} />, host));

    const explorer = getTabs()[0];
    expect(document.querySelector('[role="tooltip"]')).toBeNull();

    act(() => {
      explorer.dispatchEvent(new Event("pointerenter", { bubbles: true }));
    });

    const tip = document.querySelector('[role="tooltip"]');
    expect(tip?.textContent).toContain("File explorer");
    // The chord comes from the keymap through `shortcutLabel`, never from a
    // literal here: a rebind has to reach this text.
    expect(tip?.querySelector("kbd")?.textContent).toBe(shortcutLabel("toggle-explorer", "macos"));
    expect(explorer.getAttribute("aria-describedby")).toBe(tip?.id);

    act(() => {
      explorer.dispatchEvent(new Event("pointerleave", { bubbles: true }));
    });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  // Every tab has a chord since `toggle-sessions` was added the same day —
  // sessions was the one chip whose tooltip could print nothing but a name.
  it("gives all three tabs an action whose chord resolves", () => {
    expect(DOCK_TABS.map((item) => item.action)).toEqual([
      "toggle-explorer",
      "toggle-usage",
      "toggle-sessions",
    ]);
    for (const item of DOCK_TABS) {
      expect(shortcutLabel(item.action, "macos")).not.toBeNull();
    }
  });

  it("draws all three dock icons with Phosphor's fill weight", () => {
    act(() => render(<DockTabs items={DOCK_TABS} active="explorer" onSelect={vi.fn()} />, host));

    getTabs().forEach((tab, index) => {
      const reference = document.createElement("div");
      document.body.appendChild(reference);
      const Icon = DOCK_TABS[index].icon;
      act(() => render(<Icon size={13} weight="fill" />, reference));

      const paths = (node: ParentNode): string =>
        Array.from(node.querySelectorAll("path"))
          .map((path) => path.getAttribute("d"))
          .join("|");
      expect(paths(tab)).toBe(paths(reference));
      reference.remove();
    });
  });
});
