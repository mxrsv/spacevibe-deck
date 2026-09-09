// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phosphor components are React `forwardRef` objects; jsdom under Vitest
// cannot use them as a tag name (the same trap `agent-rail.test.tsx`
// documents). The menu never touches Phosphor directly — everything goes
// through `DeckIcon` — so stubbing that one module is enough.
vi.mock("./controls/deck-icon", () => ({
  CHROME_ICON: 13,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { CardActionsMenu, type CardActions, type MenuPlacement } from "./worktree-card-menus";
import type { MenuSubject } from "./agent-rail-card-model";
import { railCardMenuOpen } from "../chrome/events";

/**
 * The actions menu's two placements (`openspec/changes/rail-create-consolidation`,
 * design D1; DL-13.7 and DL-27.25 amended). `worktree-card.test.tsx` drives the
 * ANCHORED placement through the card that raises it; this file mounts the
 * surface directly, which is the only way to reach the FREE-STANDING one —
 * `⌘T` raises it with no card on screen.
 */

const CHECKOUT: MenuSubject = {
  project: "spacevibe-bench",
  path: "/r/bench",
  repositoryPath: "/r/bench",
  branch: "main",
  label: "main",
  labelled: true,
};

const FOLDER: MenuSubject = {
  project: "notes",
  path: "/w/notes",
  repositoryPath: "/w/notes",
  branch: null,
  label: "notes",
  labelled: false,
};

function actions(extra: Partial<CardActions> = {}): CardActions {
  return {
    agents: [{ id: "claude", label: "Claude", detail: "claude" }],
    agentsResolved: true,
    onRunAgent: vi.fn(),
    onSplitHere: vi.fn(),
    onOpenBoard: vi.fn(),
    ...extra,
  };
}

let host: HTMLDivElement;
let strip: HTMLDivElement;

function mount(
  placement: MenuPlacement,
  subject: MenuSubject,
  acts: CardActions,
  onClose: () => void = () => {},
): HTMLElement | null {
  act(() => {
    render(
      <CardActionsMenu
        placement={placement}
        subject={subject}
        actions={acts}
        rect={placement === "anchored" ? { left: 10, top: 20, right: 270, bottom: 60 } : null}
        trigger={null}
        onClose={onClose}
      />,
      host,
    );
  });
  return host.querySelector<HTMLElement>(".asr-pop--actions");
}

function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  // The anchor the free-standing placement reads: the stage strip, as
  // `App` mounts it in sidebar mode.
  strip = document.createElement("div");
  strip.className = "stage__strip";
  document.body.append(strip, host);
  railCardMenuOpen.value = false;
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  strip.remove();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  railCardMenuOpen.value = false;
});

describe("CardActionsMenu placements", () => {
  it("prints no heading and no board row when anchored to a card", () => {
    const menu = mount("anchored", CHECKOUT, actions());

    expect(menu?.dataset.placement).toBe("anchored");
    expect(menu?.querySelector(".asr-act__where")).toBeNull();
    expect(menu?.textContent).not.toContain("Open another project");
    // The first thing in the menu is an action row — the card 6px away states
    // the subject (DL-27.25, amended 2026-08-30).
    expect(menu?.firstElementChild?.getAttribute("role")).toBe("menuitem");
  });

  it("states its destination in a heading and ends with the board row when free-standing", () => {
    const menu = mount("free-standing", CHECKOUT, actions());

    expect(menu?.dataset.placement).toBe("free-standing");
    const heading = menu?.querySelector(".asr-act__where");
    // ONE line, the composed destination — never the two-line `Actions for` /
    // `Runs in` head that came off on 2026-08-30.
    expect(heading?.textContent).toBe("spacevibe-bench · main");
    expect(menu?.textContent).not.toContain("Actions for");
    expect(menu?.textContent).not.toContain("Runs in");
    const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    expect(items.map((item) => item.querySelector(".asr-act__title")?.textContent)).toEqual([
      "Claude",
      "New split here",
      "Open another project…",
    ]);
  });

  it("names a folder git does not know by its name alone, and says folder", () => {
    const menu = mount("free-standing", FOLDER, actions({ onCreateBranch: vi.fn() }));

    expect(menu?.querySelector(".asr-act__where")?.textContent).toBe("notes");
    expect(menu?.textContent).not.toContain("Create branch");
    expect(menu?.textContent).toContain("runs in this folder");
  });

  it("raises the board from its own row and closes", () => {
    const acts = actions();
    const onClose = vi.fn();
    const menu = mount("free-standing", CHECKOUT, acts, onClose);

    const board = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].at(-1);
    click(board);
    expect(acts.onOpenBoard).toHaveBeenCalledTimes(1);
    expect(acts.onRunAgent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs the chosen agent in the subject's checkout", () => {
    const acts = actions();
    const menu = mount("free-standing", CHECKOUT, acts);

    click(menu?.querySelector<HTMLElement>('[role="menuitem"]'));
    expect(acts.onRunAgent).toHaveBeenCalledWith("claude", "/r/bench");
  });

  it("closes on Escape without starting anything", () => {
    const acts = actions();
    const onClose = vi.fn();
    mount("free-standing", CHECKOUT, acts, onClose);

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(acts.onRunAgent).not.toHaveBeenCalled();
    expect(acts.onSplitHere).not.toHaveBeenCalled();
    expect(acts.onOpenBoard).not.toHaveBeenCalled();
  });

  it("marks the stage obscured while it is up, so the browser view cannot paint over it", () => {
    mount("free-standing", CHECKOUT, actions());
    expect(railCardMenuOpen.value).toBe(true);

    act(() => render(null, host));
    // The release is delayed (2026-08-31): a sweep across several menus is
    // one hide, not several.
    expect(railCardMenuOpen.value).toBe(true);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(railCardMenuOpen.value).toBe(false);
  });

  it("hangs under the stage strip's leading edge", () => {
    // jsdom has no layout: `getBoundingClientRect` on the strip answers a rect
    // only when stubbed, and the surface's own `offsetWidth` is 0. That is
    // enough to prove WHICH edges the placement reads — the strip's bottom and
    // left — while the gallery measurement proves the pixels.
    strip.getBoundingClientRect = () =>
      ({ left: 276, top: 0, right: 1200, bottom: 38, width: 924, height: 38 }) as DOMRect;
    const menu = mount("free-standing", CHECKOUT, actions());

    expect(menu?.style.left).toBe("276px");
    // `bottom + SURFACE_GAP`, the gap every rail popover keeps from its anchor.
    expect(menu?.style.top).toBe("44px");
  });

  it("focuses its first row on open and hands focus back on close", () => {
    const returnTo = document.createElement("button");
    document.body.append(returnTo);
    returnTo.focus();
    const menu = mount("free-standing", CHECKOUT, actions());

    expect(document.activeElement).toBe(menu?.querySelector('[role="menuitem"]'));
    act(() => render(null, host));
    expect(document.activeElement).toBe(returnTo);
    returnTo.remove();
  });
});
