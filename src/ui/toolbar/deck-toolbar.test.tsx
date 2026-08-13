// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeckToolbar, toolbarLabel } from "./deck-toolbar";

/**
 * The shipping projection: registry actions in, `ToolbarItem`s out, both
 * layouts mounting the same element. What matters here is the boundary work —
 * label re-casing (D6), the D7 group contents, unavailable-not-disabled for
 * Prompts, and the two presentation carriers (`iconbtn--gear`, the anchored
 * popover) surviving the move off `ChromeActions`.
 */
describe("DeckToolbar", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  const handlers = () => ({
    onToggleBrowser: vi.fn(),
    onSplitRow: vi.fn(),
    onSplitColumn: vi.fn(),
    onToggleExpand: vi.fn(),
    onClosePane: vi.fn(),
    onTogglePrompts: vi.fn(),
    onToggleSettings: vi.fn(),
  });

  function mount(overrides: Record<string, unknown> = {}) {
    const on = handlers();
    act(() =>
      render(
        <DeckToolbar
          browserOpen={false}
          settingsOpen={false}
          expandActive={false}
          promptsOpen={false}
          promptsUnavailable={null}
          {...on}
          {...overrides}
        />,
        host,
      ),
    );
    return on;
  }

  const button = (name: string): HTMLButtonElement => {
    const found = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === name,
    );
    if (found === undefined) {
      throw new Error(`no button named ${name}`);
    }
    return found;
  };

  it("re-cases registry labels to sentence case and drops menu ellipses", () => {
    expect(toolbarLabel("split-row")).toBe("Split vertically");
    expect(toolbarLabel("toggle-settings")).toBe("Settings");
    expect(toolbarLabel("toggle-prompts")).toBe("Prompts");
    expect(toolbarLabel("toggle-browser")).toBe("Browser");
  });

  it("renders the D7 set — Browser is the only tools item", () => {
    mount();
    const labels = Array.from(host.querySelectorAll("button")).map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "Browser",
      "Split vertically",
      "Split horizontally",
      "Focus expand",
      "Close pane",
      "Prompts",
      "Settings",
    ]);
  });

  it("routes Browser activation and reflects the open panel", () => {
    const on = mount({ browserOpen: true });
    const browser = button("Browser");
    expect(browser.getAttribute("aria-pressed")).toBe("true");
    browser.click();
    expect(on.onToggleBrowser).toHaveBeenCalledTimes(1);
  });

  it("keeps unavailable Prompts focusable but inert", () => {
    const on = mount({ promptsUnavailable: "no pane to paste into" });
    const prompts = button("Prompts");
    expect(prompts.getAttribute("aria-disabled")).toBe("true");
    expect(prompts.hasAttribute("disabled")).toBe(false);
    prompts.click();
    expect(on.onTogglePrompts).not.toHaveBeenCalled();
  });

  it("anchors the popover to the Prompts slot while open", () => {
    mount({
      promptsOpen: true,
      promptPopover: <div data-testid="popover" />,
    });
    const slot = button("Prompts").closest(".ftoolbar__slot");
    expect(slot?.querySelector("[data-testid=popover]")).not.toBeNull();
  });

  it("keeps the Settings gear class so its spin survives", () => {
    mount();
    expect(button("Settings").classList.contains("iconbtn--gear")).toBe(true);
  });

  it("hands the window's free width back as a drag surface", () => {
    mount();
    expect(host.querySelector(".ftoolbar__drag")).not.toBeNull();
  });
});
