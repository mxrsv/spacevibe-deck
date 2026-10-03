// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Space } from "../spaces/space-model";
import { MissionControl, type MissionControlProps, type MissionExit } from "./mission-control";

/**
 * jsdom has no `matchMedia`, which `space-motion.ts` reads as reduced motion:
 * every exit here settles at once, which is exactly DL-35.4's path.
 */

function space(key: number, overrides: Partial<Space> = {}): Space {
  return {
    tabIndex: key - 1,
    key,
    folder: "spacevibe-deck",
    name: null,
    index: null,
    path: "/w/spacevibe-deck",
    group: "plain:/w/spacevibe-deck",
    groupLabel: "spacevibe-deck",
    branch: null,
    panes: [{ paneId: key * 10, agent: "claude", state: "working" }],
    agentCount: 1,
    needsCount: 0,
    failedCount: 0,
    current: false,
    ...overrides,
  };
}

describe("MissionControl", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
  });

  function mount(overrides: Partial<MissionControlProps> = {}) {
    const exits: MissionExit[] = [];
    const done = vi.fn();
    const props: MissionControlProps = {
      spaces: [
        space(1, { current: true }),
        space(2, {
          folder: "spacevibe-api",
          path: "/w/spacevibe-api",
          group: "plain:/w/spacevibe-api",
          groupLabel: "spacevibe-api",
          needsCount: 1,
          panes: [
            { paneId: 20, agent: "codex", state: "asked" },
            { paneId: 21, agent: null, state: "shell" },
          ],
        }),
      ],
      snapshot: (paneId) => `rows of ${paneId}`,
      caption: () => "",
      focusedPaneId: 10,
      fromRects: [],
      onExit: (exit) => exits.push(exit),
      onRename: vi.fn(),
      landingRects: () => [],
      onDone: done,
      leaveRef: { current: null },
      ...overrides,
    };
    act(() => render(<MissionControl {...props} />, host));
    return { exits, done, props };
  }

  const windows = () => [...host.querySelectorAll<HTMLButtonElement>(".mc-window")];

  it("opens on the current space's windows, as snapshots, with focus on the focused pane", () => {
    mount();
    expect(windows().map((item) => item.dataset.pane)).toEqual(["10"]);
    expect(host.querySelector(".mc-window__body")?.textContent).toBe("rows of 10");
    expect(document.activeElement).toBe(windows()[0]);
  });

  it("sets spaces by project: a worktree sits under its repository's name", () => {
    mount({
      spaces: [
        space(1, { current: true }),
        space(2, { folder: "fix-rail", path: "/w/fix-rail" }),
        space(3, { folder: "spacevibe-api", group: "plain:/w/spacevibe-api", groupLabel: "spacevibe-api" }),
      ],
    });
    const sets = [...host.querySelectorAll(".mc-shelf__set")];
    expect(sets.map((set) => set.querySelector(".mc-shelf__folder")?.textContent)).toEqual([
      "spacevibe-deck",
      "spacevibe-api",
    ]);
    expect(sets[0].querySelectorAll(".mc-space")).toHaveLength(2);
  });

  it("previews another space on hover, and marks asked windows by state", () => {
    mount();
    const thumbs = host.querySelectorAll<HTMLButtonElement>(".mc-space");
    act(() => {
      thumbs[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      thumbs[1].dispatchEvent(new MouseEvent("mouseenter"));
    });
    expect(windows().map((item) => item.dataset.pane)).toEqual(["20", "21"]);
    expect(windows()[0].dataset.state).toBe("asked");
    expect(windows()[1].getAttribute("aria-label")).toBe("shell");
    expect(thumbs[1].getAttribute("aria-label")).toBe("spacevibe-api · 1 agent · 1 need you");
  });

  it("returns to exactly the pressed pane, then finishes", async () => {
    const { exits, done } = mount();
    await act(async () => windows()[0].click());
    expect(exits).toEqual([
      { kind: "pane", space: expect.objectContaining({ key: 1 }), paneId: 10 },
    ]);
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  });

  it("enters a space from its thumbnail", async () => {
    const { exits } = mount();
    await act(async () => host.querySelectorAll<HTMLButtonElement>(".mc-space")[1].click());
    expect(exits).toEqual([{ kind: "space", space: expect.objectContaining({ key: 2 }) }]);
  });

  it("enters a space from the keyboard, though its thumbnail is not a <button>", async () => {
    const { exits } = mount();
    const thumb = host.querySelectorAll<HTMLElement>(".mc-space")[1];
    await act(async () => {
      thumb.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(exits).toEqual([{ kind: "space", space: expect.objectContaining({ key: 2 }) }]);
  });

  describe("naming a space on the shelf (DL-35.1)", () => {
    const named = [
      space(1, { current: true, index: 1, name: "auth" }),
      space(2, { index: 2 }),
      space(3, { folder: "spacevibe-api", path: "/w/spacevibe-api" }),
    ];
    const label = (at: number): string =>
      host.querySelectorAll(".mc-space")[at].querySelector(".mc-space__label")!.textContent!;
    const nameOf = (at: number): HTMLElement =>
      host.querySelectorAll(".mc-space")[at].querySelector<HTMLElement>(".mc-space__name")!;
    const field = (): HTMLInputElement | null => host.querySelector("input.space-rename");
    const edit = (at: number): void => {
      act(() => {
        nameOf(at).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
    };
    const press = (key: string): void => {
      act(() => {
        field()!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    };

    it("shows a name where an unnamed space shows its index, and keeps the folder header", () => {
      mount({ spaces: named });
      expect([label(0), label(1), label(2)]).toEqual(["auth", "2", ""]);
      expect(host.querySelector(".mc-shelf__folder")?.textContent).toBe("spacevibe-deck");
      expect(host.querySelectorAll(".mc-space")[0].getAttribute("aria-label")).toBe(
        "auth · 1 agent",
      );
    });

    it("renames on a double-click of the label, without entering the space", async () => {
      const onRename = vi.fn();
      const { exits } = mount({ spaces: named, onRename });
      // The first press of a double-click must not leave Mission Control.
      await act(async () => nameOf(1).click());
      expect(exits).toEqual([]);
      edit(1);
      expect(field()!.placeholder).toBe("spacevibe-deck 2");

      act(() => {
        field()!.value = "scroll fix";
      });
      press("Enter");
      expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ key: 2 }), "scroll fix");
      expect(field()).toBeNull();
    });

    it("lets Escape cancel the edit without closing Mission Control", async () => {
      const onRename = vi.fn();
      const { exits } = mount({ spaces: named, onRename });
      edit(0);
      expect(field()!.value).toBe("auth");
      await act(async () => press("Escape"));
      expect(field()).toBeNull();
      expect(onRename).not.toHaveBeenCalled();
      expect(exits).toEqual([]);
      expect(host.querySelector(".mc")).not.toBeNull();
    });
  });

  it("returns unchanged on Escape and on the empty spread, and leaves only once", async () => {
    const { exits, done, props } = mount();
    await act(async () => {
      host
        .querySelector(".mc")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await act(async () => {
      host.querySelector(".mc__spread")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      props.leaveRef.current?.({ kind: "back" });
    });
    expect(exits).toEqual([{ kind: "back" }]);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to a menu stacked over it", async () => {
    const { exits } = mount();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.appendChild(item);
    document.body.appendChild(menu);
    item.focus();

    await act(async () => {
      item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(exits).toEqual([]);
  });

  it("answers Escape and keeps Tab inside from anywhere in the document", async () => {
    const { exits } = mount();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(host.querySelector(".mc")?.contains(document.activeElement)).toBe(true);

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(exits).toEqual([{ kind: "back" }]);
    expect(host.querySelector(".mc")?.getAttribute("aria-modal")).toBe("true");
  });
});
