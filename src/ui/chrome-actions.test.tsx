// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChromeActions } from "./chrome-actions";

/**
 * `ChromeActions` had no test file before the icon migration — nothing else
 * rendered it, so nothing proved its six buttons keep their names, their
 * pressed state or their handlers while their icons were swapped out.
 */
describe("ChromeActions", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  const handlers = () => ({
    onSplitRow: vi.fn(),
    onSplitColumn: vi.fn(),
    onClosePane: vi.fn(),
    onToggleExpand: vi.fn(),
    onTogglePrompts: vi.fn(),
    onToggleSettings: vi.fn(),
  });

  function mount(overrides: Record<string, unknown> = {}) {
    const on = handlers();
    act(() =>
      render(
        <ChromeActions
          settingsOpen={false}
          expandActive={false}
          promptsOpen={false}
          promptsDisabled={false}
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

  const actions: Array<{
    name: string;
    icon: string;
    fires: keyof ReturnType<typeof handlers>;
  }> = [
    {
      name: "Split pane vertically",
      icon: "lucide-columns-2",
      fires: "onSplitRow",
    },
    {
      name: "Split pane horizontally",
      icon: "lucide-rows-2",
      fires: "onSplitColumn",
    },
    {
      name: "Close current pane",
      icon: "lucide-square-x",
      fires: "onClosePane",
    },
    {
      name: "Toggle focus expand",
      icon: "lucide-maximize-2",
      fires: "onToggleExpand",
    },
    {
      name: "Open the prompt board",
      icon: "lucide-message-square-text",
      fires: "onTogglePrompts",
    },
    {
      name: "Open settings",
      icon: "lucide-settings",
      fires: "onToggleSettings",
    },
  ];

  for (const { name, icon, fires } of actions) {
    it(`${name} draws ${icon} at chrome scale and calls its handler`, () => {
      const on = mount();
      const target = button(name);

      const svg = target.querySelector("svg");
      expect(svg?.classList.contains(icon)).toBe(true);
      expect(svg?.getAttribute("width")).toBe("13");
      expect(svg?.getAttribute("aria-hidden")).toBe("true");

      target.click();
      expect(on[fires]).toHaveBeenCalledTimes(1);
    });
  }

  it("keeps every action reachable by name and none named by its glyph", () => {
    mount();
    expect(host.querySelectorAll("button")).toHaveLength(actions.length);
    for (const { name } of actions) {
      expect(button(name).textContent).toBe("");
    }
  });

  it("carries the toggle state of expand, prompts and settings", () => {
    mount({ expandActive: true, promptsOpen: true, settingsOpen: true });

    expect(button("Toggle focus expand").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(button("Open the prompt board").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(button("Open settings").getAttribute("aria-pressed")).toBe("true");
  });

  it("disables the prompt board when there is no pane to paste into", () => {
    mount({ promptsDisabled: true });

    expect(button("Open the prompt board").disabled).toBe(true);
  });
});
