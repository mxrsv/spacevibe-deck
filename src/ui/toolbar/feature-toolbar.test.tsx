// @vitest-environment jsdom
import { Columns2, FolderTree, Settings, SquareX } from "lucide-preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureToolbar } from "./feature-toolbar";
import type { ToolbarItem } from "./toolbar-item";

/**
 * What the design promises about the toolbar that a screenshot cannot show:
 * that the same tooltip answers to the pointer and to the keyboard, that an
 * unavailable action stays reachable while refusing to run, and that an
 * action which overflows keeps its name, its chord and its command path.
 */

type ResizeCallback = () => void;

let resizeCallbacks: ResizeCallback[] = [];

class StubResizeObserver {
  constructor(callback: ResizeCallback) {
    resizeCallbacks.push(callback);
  }
  observe(): void {}
  disconnect(): void {}
}

describe("FeatureToolbar", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resizeCallbacks = [];
    globalThis.ResizeObserver =
      StubResizeObserver as unknown as typeof ResizeObserver;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    host.remove();
  });

  const activations = {
    explorer: vi.fn(),
    split: vi.fn(),
    close: vi.fn(),
    settings: vi.fn(),
  };

  function items(): readonly ToolbarItem[] {
    return [
      {
        id: "explorer",
        label: "Explorer",
        icon: FolderTree,
        group: "tools",
        shortcut: "⌘⇧E",
        state: { kind: "active" },
        overflowOrder: null,
        toggles: "pressed",
        onActivate: activations.explorer,
      },
      {
        id: "split-row",
        label: "Split Vertically",
        icon: Columns2,
        group: "pane",
        shortcut: "⌘D",
        state: { kind: "idle" },
        overflowOrder: 2,
        onActivate: activations.split,
      },
      {
        id: "close-pane",
        label: "Close Pane",
        icon: SquareX,
        group: "pane",
        shortcut: "⌘W",
        state: { kind: "unavailable", reason: "only one pane is open" },
        overflowOrder: 1,
        onActivate: activations.close,
      },
      {
        id: "settings",
        label: "Settings",
        icon: Settings,
        group: "global",
        shortcut: "⌘,",
        state: { kind: "idle" },
        overflowOrder: null,
        toggles: "pressed",
        onActivate: activations.settings,
      },
    ];
  }

  function mount(): void {
    act(() => render(<FeatureToolbar items={items()} />, host));
  }

  const button = (name: string): HTMLButtonElement => {
    const found = Array.from(host.querySelectorAll("button")).find(
      (candidate) => candidate.getAttribute("aria-label") === name,
    );
    if (found === undefined) {
      throw new Error(`no control named ${name}`);
    }
    return found;
  };

  /** jsdom lays nothing out, so the observed width is supplied here. */
  function resizeTo(width: number): void {
    const root = host.querySelector(".ftoolbar");
    if (root === null) {
      throw new Error("no toolbar");
    }
    Object.defineProperty(root, "clientWidth", {
      value: width,
      configurable: true,
    });
    act(() => {
      for (const callback of resizeCallbacks) {
        callback();
      }
    });
  }

  const tip = (): HTMLElement | null => host.querySelector(".action-tip");

  beforeEach(() => {
    for (const spy of Object.values(activations)) {
      spy.mockClear();
    }
  });

  it("draws one control per action, with Settings rightmost", () => {
    mount();
    const names = Array.from(host.querySelectorAll("button")).map((control) =>
      control.getAttribute("aria-label"),
    );
    expect(names).toEqual([
      "Explorer",
      "Split Vertically",
      "Close Pane",
      "Settings",
    ]);
  });

  it("separates the groups it drew, and only those", () => {
    mount();
    // tools | pane | global — two boundaries, so two hairlines.
    expect(host.querySelectorAll(".tabbar__sep")).toHaveLength(2);
  });

  it("shows the name and the chord on hover, and takes them away again", () => {
    mount();
    act(() => {
      button("Explorer").dispatchEvent(new Event("pointerenter"));
    });
    expect(tip()?.textContent).toContain("Explorer");
    expect(host.querySelector(".action-tip__kbd")?.textContent).toBe("⌘⇧E");
    expect(button("Explorer").getAttribute("aria-describedby")).toBe(
      tip()?.id ?? null,
    );

    act(() => {
      button("Explorer").dispatchEvent(new Event("pointerleave"));
    });
    expect(tip()).toBeNull();
  });

  it("shows the same tooltip on keyboard focus, and keeps it while focused", () => {
    mount();
    act(() => button("Split Vertically").focus());
    expect(tip()?.textContent).toContain("Split Vertically");

    // The pointer crossing a focused control must not steal the description.
    act(() => {
      button("Split Vertically").dispatchEvent(new Event("pointerleave"));
    });
    expect(tip()).not.toBeNull();

    act(() => button("Split Vertically").blur());
    expect(tip()).toBeNull();
  });

  it("states why an unavailable action cannot run, instead of a chord", () => {
    mount();
    act(() => {
      button("Close Pane").dispatchEvent(new Event("pointerenter"));
    });
    expect(host.querySelector(".action-tip__reason")?.textContent).toBe(
      "only one pane is open",
    );
    expect(host.querySelector(".action-tip__kbd")).toBeNull();
  });

  it("leaves an unavailable action focusable but refuses to run it", () => {
    mount();
    const control = button("Close Pane");
    expect(control.getAttribute("aria-disabled")).toBe("true");
    expect(control.disabled).toBe(false);

    act(() => control.click());
    expect(activations.close).not.toHaveBeenCalled();

    act(() => control.focus());
    expect(document.activeElement).toBe(control);
  });

  it("runs an available action through its own command path", () => {
    mount();
    act(() => button("Explorer").click());
    expect(activations.explorer).toHaveBeenCalledTimes(1);
  });

  it("moves what does not fit into More, keeping name, chord and handler", () => {
    mount();
    resizeTo(80);

    // What is left in the bar, and where More sits: immediately before the
    // action the design pins rightmost.
    expect(
      Array.from(host.querySelectorAll(".ftoolbar__slot button")).map(
        (control) => control.getAttribute("aria-label"),
      ),
    ).toEqual(["Explorer", "More actions", "Settings"]);

    act(() => button("More actions").click());

    const rows = Array.from(host.querySelectorAll(".toolbar-menu__row"));
    expect(
      rows.map((row) => row.querySelector(".toolbar-menu__label")?.textContent),
    ).toEqual(["Split Vertically", "Close Pane"]);
    expect(rows[0].querySelector(".toolbar-menu__kbd")?.textContent).toBe("⌘D");
    expect(rows[1].getAttribute("aria-disabled")).toBe("true");

    act(() => (rows[0] as HTMLButtonElement).click());
    expect(activations.split).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".toolbar-menu")).toBeNull();
  });

  // The shipping projection hands every action to `pinnedMenu` (DL-23.8), so
  // the bar itself draws no groups at all. `More` used to be rendered from
  // inside the group loop, which meant an empty bar rendered nothing — the
  // toolbar would have disappeared rather than collapsed.
  it("still draws More when the bar itself has no controls", () => {
    act(() => render(<FeatureToolbar items={[]} pinnedMenu={items()} />, host));

    expect(
      Array.from(host.querySelectorAll(".ftoolbar__slot button")).map(
        (control) => control.getAttribute("aria-label"),
      ),
    ).toEqual(["More actions"]);
    expect(host.querySelectorAll(".tabbar__sep")).toHaveLength(0);

    act(() => button("More actions").click());
    expect(
      Array.from(host.querySelectorAll(".toolbar-menu__row")).map(
        (row) => row.querySelector(".toolbar-menu__label")?.textContent,
      ),
    ).toEqual(["Explorer", "Split Vertically", "Close Pane", "Settings"]);
  });

  it("closes More on Escape", () => {
    mount();
    resizeTo(80);
    act(() => button("More actions").click());
    expect(host.querySelector(".toolbar-menu")).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector(".toolbar-menu")).toBeNull();
  });

  it("returns focus to the More trigger when Escape closes the menu", () => {
    mount();
    resizeTo(80);
    act(() => button("More actions").click());
    const rows = Array.from(host.querySelectorAll(".toolbar-menu__row"));
    act(() => (rows[0] as HTMLButtonElement).focus());

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.activeElement).toBe(button("More actions"));
  });

  it("returns focus to the More trigger when activating a row", () => {
    mount();
    resizeTo(80);
    act(() => button("More actions").click());
    const rows = Array.from(host.querySelectorAll(".toolbar-menu__row"));

    act(() => (rows[0] as HTMLButtonElement).click());
    expect(document.activeElement).toBe(button("More actions"));
  });
});
