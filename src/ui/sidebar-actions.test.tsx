// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { railCardMenuOpen } from "../chrome/events";
import { SidebarActions } from "./sidebar-actions";

describe("SidebarActions", () => {
  let host: HTMLDivElement;

  const base = {
    sessionsAvailable: true,
    promptsOpen: false,
    promptsUnavailable: null,
    onOpenSessions: vi.fn(),
    onOpenUsage: vi.fn(),
    onOpenExplorer: vi.fn(),
    onOpenPrompts: vi.fn(),
    onOpenBrowser: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  function tools(): HTMLButtonElement[] {
    return Array.from(host.querySelectorAll(".sidebar-actions__tool"));
  }

  const names = (): (string | null)[] => tools().map((tool) => tool.getAttribute("aria-label"));

  it("names every surface the rail can open, in the owner's order", () => {
    act(() => render(<SidebarActions {...base} />, host));

    expect(names()).toEqual([
      "Session history",
      "Token usage",
      "Explorer",
      "Prompts",
      "Browser",
      "Settings",
    ]);
  });

  it("draws icons only — no label text in the row", () => {
    act(() => render(<SidebarActions {...base} />, host));

    for (const tool of tools()) {
      expect(tool.textContent).toBe("");
      expect(tool.querySelectorAll("svg")).toHaveLength(1);
      expect(tool.querySelector("svg")?.getAttribute("width")).toBe("16");
    }
  });

  // Same precedent as the dock's own tab row: a control that opens an empty
  // surface is worse than none.
  it("drops Session history on a host that cannot answer for it", () => {
    act(() => render(<SidebarActions {...base} sessionsAvailable={false} />, host));

    expect(names()).not.toContain("Session history");
    expect(tools()).toHaveLength(5);
  });

  it("routes each icon to its own callback, once", () => {
    act(() => render(<SidebarActions {...base} />, host));

    for (const tool of tools()) {
      act(() => tool.click());
    }

    expect(base.onOpenSessions).toHaveBeenCalledTimes(1);
    expect(base.onOpenUsage).toHaveBeenCalledTimes(1);
    expect(base.onOpenExplorer).toHaveBeenCalledTimes(1);
    expect(base.onOpenPrompts).toHaveBeenCalledTimes(1);
    expect(base.onOpenBrowser).toHaveBeenCalledTimes(1);
    expect(base.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  // DL-28.5 / DL-21.8: these open and report nothing — no pressed icon, no
  // `aria-pressed`, no `aria-expanded`, nothing that implies a second press
  // would put the surface away.
  it("paints no selection state, even while its surfaces are open", () => {
    act(() => render(<SidebarActions {...base} promptsOpen />, host));

    for (const tool of tools()) {
      expect(tool.classList.contains("is-active")).toBe(false);
      expect(tool.hasAttribute("aria-pressed")).toBe(false);
      expect(tool.hasAttribute("aria-expanded")).toBe(false);
    }
  });

  it("marks only Prompts as opening a popover", () => {
    act(() => render(<SidebarActions {...base} />, host));

    const popups = tools().filter((tool) => tool.hasAttribute("aria-haspopup"));
    expect(popups.map((tool) => tool.getAttribute("aria-label"))).toEqual(["Prompts"]);
    expect(popups[0]?.getAttribute("aria-haspopup")).toBe("dialog");
  });

  // DL-23.6: unavailable is not disabled. The icon keeps its place in the tab
  // order so the reason stays reachable without a pointer; only activation is
  // blocked.
  it("keeps an unavailable Prompts icon focusable but inert, and says why on focus", () => {
    act(() =>
      render(<SidebarActions {...base} promptsUnavailable="no pane to paste into" />, host),
    );

    const prompts = tools().find((tool) => tool.getAttribute("aria-label") === "Prompts")!;
    expect(prompts.getAttribute("aria-disabled")).toBe("true");
    expect(prompts.hasAttribute("disabled")).toBe(false);
    expect(prompts.classList.contains("is-unavailable")).toBe(true);

    act(() => prompts.click());
    expect(base.onOpenPrompts).not.toHaveBeenCalled();

    act(() => prompts.focus());
    const tip = document.querySelector(".action-tip");
    expect(tip?.textContent).toContain("no pane to paste into");
  });

  it("opens a tooltip above the icon on keyboard focus, carrying name and chord", () => {
    act(() => render(<SidebarActions {...base} />, host));

    const explorer = tools().find((tool) => tool.getAttribute("aria-label") === "Explorer")!;
    act(() => explorer.focus());

    const tip = document.querySelector(".action-tip");
    expect(tip?.classList.contains("action-tip--above")).toBe(true);
    expect(tip?.querySelector(".action-tip__label")?.textContent).toBe("Explorer");
    expect(tip?.querySelector(".action-tip__kbd")?.textContent).not.toBe("");
    expect(explorer.getAttribute("aria-describedby")).toBe(tip?.id);
  });

  it("hangs the popover off the row's slot, and only while it is open", () => {
    act(() => render(<SidebarActions {...base} promptPopover={<div class="pp" />} />, host));
    expect(host.querySelector(".sidebar-actions__slot .pp")).toBeNull();

    act(() =>
      render(<SidebarActions {...base} promptsOpen promptPopover={<div class="pp" />} />, host),
    );
    expect(host.querySelector(".sidebar-actions__slot .pp")).not.toBeNull();
  });

  it("keeps tooltips off the popover's path while it is open", () => {
    act(() =>
      render(<SidebarActions {...base} promptsOpen promptPopover={<div class="pp" />} />, host),
    );

    act(() => tools()[0]?.focus());
    expect(document.querySelector(".action-tip")).toBeNull();
  });

  // DL-28.6: collapsed, the six icons are one `Tools` button and its popover.
  describe("collapsed", () => {
    const button = (): HTMLButtonElement =>
      host.querySelector<HTMLButtonElement>('button[aria-label="Tools"]')!;
    const menu = (): HTMLElement | null => document.querySelector(".rail-tools-menu");
    const rows = (): HTMLButtonElement[] =>
      Array.from(document.querySelectorAll<HTMLButtonElement>(".rail-tools-menu [role=menuitem]"));
    const press = (element: Element): void => {
      act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
    };
    const key = (name: string): void => {
      act(() => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
        );
      });
    };

    it("draws one Tools button and no icon row; expanded draws the reverse", () => {
      act(() => render(<SidebarActions {...base} collapsed />, host));
      expect(button()).not.toBeNull();
      expect(tools()).toHaveLength(1);
      expect(host.querySelector(".sidebar-actions__tools")).toBeNull();

      act(() => render(<SidebarActions {...base} />, host));
      expect(host.querySelector('button[aria-label="Tools"]')).toBeNull();
      expect(tools()).toHaveLength(6);
    });

    it("opens the six tools as rows with their chords, in order", () => {
      act(() => render(<SidebarActions {...base} collapsed />, host));
      expect(menu()).toBeNull();

      press(button());

      expect(button().getAttribute("aria-expanded")).toBe("true");
      expect(rows().map((row) => row.querySelector(".toolbar-menu__label")?.textContent)).toEqual([
        "Session history",
        "Token usage",
        "Explorer",
        "Prompts",
        "Browser",
        "Settings",
      ]);
      for (const row of rows()) {
        expect(row.querySelector(".toolbar-menu__kbd")?.textContent).not.toBe("");
      }
      // Focus lands on the first row once the menu is placed.
      expect(document.activeElement).toBe(rows()[0]);
    });

    it("runs a chosen row once and closes without taking focus back", () => {
      act(() => render(<SidebarActions {...base} collapsed />, host));
      press(button());

      press(rows()[2]!);

      expect(base.onOpenExplorer).toHaveBeenCalledTimes(1);
      expect(menu()).toBeNull();
      expect(document.activeElement).not.toBe(button());
    });

    it("keeps an unavailable Prompts row in place, inert, with its reason", () => {
      act(() =>
        render(
          <SidebarActions {...base} collapsed promptsUnavailable="no pane to paste into" />,
          host,
        ),
      );
      press(button());

      const prompts = rows()[3]!;
      expect(prompts.getAttribute("aria-disabled")).toBe("true");
      expect(prompts.textContent).toContain("no pane to paste into");
      press(prompts);
      expect(base.onOpenPrompts).not.toHaveBeenCalled();
      expect(menu()).not.toBeNull();
    });

    it("closes on Escape and returns focus to the button", () => {
      act(() => render(<SidebarActions {...base} collapsed />, host));
      press(button());

      key("Escape");

      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(button());
    });

    it("closes on an outside press, and a second press on the button toggles it shut", () => {
      act(() => render(<SidebarActions {...base} collapsed />, host));
      press(button());
      act(() => {
        document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      });
      expect(menu()).toBeNull();

      press(button());
      expect(menu()).not.toBeNull();
      press(button());
      expect(menu()).toBeNull();
    });

    it("moves between rows with the arrow keys, wrapping", () => {
      act(() => render(<SidebarActions {...base} collapsed />, host));
      press(button());

      key("ArrowUp");
      expect(document.activeElement).toBe(rows()[5]);
      key("ArrowDown");
      expect(document.activeElement).toBe(rows()[0]);
    });

    it("raises the stage overlay flag while open and clears it after", async () => {
      // The flag's release is delayed on purpose (`useStageOverlayFlag`), so a
      // sweep across menus is one hide; the earlier tests' releases land first.
      const released = (): Promise<void> =>
        act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 320));
        });
      await released();
      act(() => render(<SidebarActions {...base} collapsed />, host));
      expect(railCardMenuOpen.value).toBe(false);

      press(button());
      expect(railCardMenuOpen.value).toBe(true);

      key("Escape");
      await released();
      expect(railCardMenuOpen.value).toBe(false);
    });

    it("anchors the Prompt Board popover to the button's slot", () => {
      act(() =>
        render(
          <SidebarActions {...base} collapsed promptsOpen promptPopover={<div class="pp" />} />,
          host,
        ),
      );

      expect(host.querySelector(".sidebar-actions__slot .pp")).not.toBeNull();
    });
  });
});
