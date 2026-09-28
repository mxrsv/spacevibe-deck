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
    index: null,
    path: "/w/spacevibe-deck",
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
