// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarActions } from "./sidebar-actions";

describe("SidebarActions", () => {
  let host: HTMLDivElement;

  const base = {
    sessionsAvailable: true,
    promptsOpen: false,
    promptsUnavailable: null,
    onOpenBrowser: vi.fn(),
    onOpenUsage: vi.fn(),
    onOpenSessions: vi.fn(),
    onOpenPrompts: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    for (const spy of [
      base.onOpenBrowser,
      base.onOpenUsage,
      base.onOpenSessions,
      base.onOpenPrompts,
      base.onOpenSettings,
    ]) {
      spy.mockClear();
    }
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  function rows(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll(".sidebar-actions__row"));
  }

  it("names every surface the rail can open, in order", () => {
    act(() => render(<SidebarActions {...base} />, host));

    expect(rows().map((row) => row.textContent)).toEqual([
      "Open browser",
      "Token usage",
      "Session history",
      "Prompts",
      "Settings",
    ]);
  });

  it("gives each launcher one prominent feature glyph larger than its text", () => {
    act(() => render(<SidebarActions {...base} />, host));

    for (const row of rows()) {
      const icons = row.querySelectorAll("svg.feature-glyph");
      expect(icons).toHaveLength(1);
      expect(icons[0]?.getAttribute("width")).toBe("15");
    }
  });

  // Same precedent as the dock's own tab row: a row that opens an empty
  // surface is worse than no row.
  it("drops Session history on a host that cannot answer for it", () => {
    act(() => render(<SidebarActions {...base} sessionsAvailable={false} />, host));

    expect(rows().map((row) => row.textContent)).not.toContain("Session history");
  });

  it("routes each row to its own callback", () => {
    act(() => render(<SidebarActions {...base} />, host));

    for (const row of rows()) {
      act(() => row.click());
    }

    expect(base.onOpenBrowser).toHaveBeenCalledTimes(1);
    expect(base.onOpenUsage).toHaveBeenCalledTimes(1);
    expect(base.onOpenSessions).toHaveBeenCalledTimes(1);
    expect(base.onOpenPrompts).toHaveBeenCalledTimes(1);
    expect(base.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  // These rows are shortcuts that open, not toggles. They must report no
  // selection state at all — no pressed row, no `aria-pressed`, nothing that
  // implies pressing again would put the surface away.
  it("paints no selection state, even while its surfaces are open", () => {
    act(() => render(<SidebarActions {...base} promptsOpen />, host));

    for (const row of rows()) {
      expect(row.classList.contains("is-active")).toBe(false);
      expect(row.hasAttribute("aria-pressed")).toBe(false);
      expect(row.hasAttribute("aria-expanded")).toBe(false);
    }
  });

  // DL-23.6: unavailable is not disabled. The row keeps its place in the tab
  // order so the reason stays reachable without a pointer; only activation is
  // blocked.
  it("keeps an unavailable Prompts row focusable but inert, with its reason", () => {
    act(() =>
      render(<SidebarActions {...base} promptsUnavailable="no pane to paste into" />, host),
    );

    const prompts = rows().find((row) => row.textContent === "Prompts")!;
    expect(prompts.getAttribute("aria-disabled")).toBe("true");
    expect(prompts.hasAttribute("disabled")).toBe(false);
    expect(prompts.getAttribute("title")).toBe("no pane to paste into");

    act(() => prompts.click());
    expect(base.onOpenPrompts).not.toHaveBeenCalled();
  });

  it("hangs the popover off the Prompts row, and only while it is open", () => {
    act(() => render(<SidebarActions {...base} promptPopover={<div class="pp" />} />, host));
    expect(host.querySelector(".sidebar-actions__slot .pp")).toBeNull();

    act(() =>
      render(<SidebarActions {...base} promptsOpen promptPopover={<div class="pp" />} />, host),
    );
    expect(host.querySelector(".sidebar-actions__slot .pp")).not.toBeNull();
  });
});
