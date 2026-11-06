// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The same host stubs `agent-rail.test.tsx` needs: the rail's import graph reaches the host.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../../terminal/file-drop", () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));
// Phosphor components are React `forwardRef` objects that jsdom cannot use as a tag.
vi.mock("../controls/deck-icon", () => ({
  CHROME_ICON: 13,
  GLYPH_INLINE: 12,
  GLYPH_ROW: 14,
  GLYPH_FEATURE: 16,
  ROW_ICON: 14,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

// `pinHost` turns every switch on; the launcher's is pinned apart so the shipped empty state stays testable.
const stage = vi.hoisted(() => ({ on: false }));
vi.mock("../../launcher/stage-launcher-enabled", () => ({ stageLauncherEnabled: () => stage.on }));

import { activeTabIndex, tabViews } from "../../terminal/tabs-store";
import { resetDesktopEnvironmentForTests } from "../../lib/platform";
import { MAX_RECENTS, WORKSPACES_VERSION } from "../../lib/workspace-recents";
import { workspacesData } from "../../open-board/workspaces-store";
import { STATE_NEEDS_YOU } from "../blocks/recipe-classes";
import { setRailQuery } from "./project-rail-state";
import {
  click,
  headers,
  host,
  installRailHarness,
  MINUTE,
  mount,
  names,
  NOW,
  pane,
  pinHost,
  press,
  row,
  rows,
  settle,
  tab,
  text,
  unmount,
  workdayFocusing,
} from "./project-rail-test-kit";

installRailHarness();

describe("AgentRail behind the projectRail switch", () => {
  it("keeps the shipped cluster list while the switch is off", async () => {
    pinHost(false);
    mount();
    await settle();

    expect(host.querySelectorAll(".asr-cluster").length).toBeGreaterThan(0);
    expect(rows()).toHaveLength(0);
  });

  it("replaces the cluster list and the create row when the switch is on", async () => {
    pinHost(true);
    mount({ footer: <div data-testid="footer" /> });
    await settle();

    expect(host.querySelector(".asr-cluster")).toBeNull();
    expect(rows()).toHaveLength(5);
    // The controls strip stands where the create row stood; the footer and the nav that
    // places them are still the old ones.
    expect(host.querySelector(".rail-create")).toBeNull();
    expect(host.querySelector('input[aria-label="Search sessions"]')).not.toBeNull();
    expect(host.querySelector("nav.asr-rail--mounted")).not.toBeNull();
    expect(host.querySelector("[data-testid=footer]")).not.toBeNull();
  });

  it("keeps the shipped create row while the switch is off", async () => {
    pinHost(false);
    mount();
    await settle();

    expect(host.querySelector(".rail-create")).not.toBeNull();
    expect(host.querySelector('input[aria-label="Search sessions"]')).toBeNull();
  });

  it("draws no avatar column when collapsed with the switch on: the rail stays mounted for the stylesheet to hide", async () => {
    pinHost(true);
    mount({ collapsed: true });
    await settle();

    expect(host.querySelector(".asr-rail--column")).toBeNull();
    expect(rows().length).toBeGreaterThan(0);
  });

  it("keeps the avatar column when collapsed with the switch off", async () => {
    pinHost(false);
    mount({ collapsed: true });
    await settle();

    expect(host.querySelector(".asr-rail--column")).not.toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it("raises the same callback with the same arguments as the shipped rows", async () => {
    // Shipped rows are found by what they open; the new list orders them its own way.
    const oldRow = (id: string) =>
      id.startsWith("shell")
        ? host.querySelector('.asr-card__row[data-kind="shell"] .asr-card__hit')
        : host.querySelector(`.asr-card__row[data-pane-id="${id.slice(5)}"] .asr-card__hit`);
    const ids = ["pane:11", "pane:12", "pane:21", "pane:31", "shell:4"];
    const pressed = async (development: boolean, find: (id: string) => Element | null) => {
      pinHost(development);
      const onFocusPane = vi.fn();
      const onSelectTab = vi.fn();
      mount({ onFocusPane, onSelectTab });
      await settle();
      const calls = ids.map((id) => {
        onFocusPane.mockClear();
        onSelectTab.mockClear();
        click(find(id));
        return [onFocusPane.mock.calls, onSelectTab.mock.calls];
      });
      unmount();
      resetDesktopEnvironmentForTests();
      return calls;
    };

    const shipped = await pressed(false, oldRow);
    const projectFirst = await pressed(true, row);

    expect(projectFirst).toEqual(shipped);
    expect(shipped[0]).toEqual([[[0, 11]], []]);
    expect(shipped[4]).toEqual([[], [[3]]]);
  });
});

describe("project list", () => {
  beforeEach(() => {
    pinHost(true);
  });

  it("lists every project once, in the order the rail builds them, remembered ones last", async () => {
    mount();
    await settle();

    expect(names()).toEqual(["main", "api", "notes"]);
    expect(
      host.querySelector("section[aria-label=main]")?.querySelectorAll("[data-rail-row]"),
    ).toHaveLength(3);
  });

  it("orders a project's rows newest first, across its checkouts", async () => {
    mount();
    await settle();

    const main = host.querySelector("section[aria-label=main]");
    expect(
      [...(main?.querySelectorAll("[data-rail-row]") ?? [])].map((r) =>
        r.getAttribute("data-rail-row"),
      ),
    ).toEqual(["pane:12", "pane:21", "pane:11"]);
  });

  it("folds a project over its rows and unfolds it again", async () => {
    mount();
    await settle();

    const [main] = headers();
    expect(main.getAttribute("aria-expanded")).toBe("true");
    click(main);
    expect(headers()[0].getAttribute("aria-expanded")).toBe("false");
    expect(rows().map((r) => r.dataset.railRow)).toEqual(["pane:31", "shell:4"]);
    click(headers()[0]);
    expect(rows()).toHaveLength(5);
  });

  it("shows a folded project's agent count on its logo and nothing per status", async () => {
    mount();
    await settle();

    // Open: its rows are listed, so the header carries no count.
    expect(headers()[0].querySelector("[data-rail-count]")).toBeNull();

    click(headers()[0]);
    const folded = headers()[0];
    expect(folded.querySelector("[data-rail-count]")?.textContent).toBe("3");
    // The count is announced as sessions, and no status (needs you, working, unread) is drawn or said.
    expect(text(folded)).toContain("3 sessions");
    expect(text(folded)).not.toMatch(/needs you|working|unread|failed/);
    expect(folded.querySelector("[data-state]")).toBeNull();

    // A failed agent beside a shell reads the same way: a count, no status.
    click(headers()[1]);
    const api = headers()[1];
    expect(api.querySelector("[data-rail-count]")?.textContent).toBe("2");
    expect(text(api)).toContain("2 sessions");
    expect(text(api)).not.toContain("failed");
    expect(api.querySelector("[data-state]")).toBeNull();
  });

  it.each([
    [9, "9"],
    [10, "9+"],
    [11, "9+"],
  ])("shows %i agents on a folded project's logo as %s", async (agents, shown) => {
    tabViews.value = [
      tab({ panes: Array.from({ length: agents }, (_, i) => pane({ paneId: 100 + i })) }),
    ];
    mount();
    await settle();

    click(headers()[0]);
    expect(headers()[0].querySelector("[data-rail-count]")?.textContent).toBe(shown);
    // The sr-only words keep the true number.
    expect(text(headers()[0])).toContain(`${agents} sessions`);
  });

  it("draws a workspace without a logo as the 13px fallback folder in the logo box (RH-23)", async () => {
    mount();
    await settle();

    expect(headers()[0].querySelectorAll('[data-deck-icon-size="13"]')).toHaveLength(1);
  });

  it("draws no count on a folded workspace that has no agents (RH-15)", async () => {
    mount();
    await settle();

    const notes = host.querySelector("section[aria-label=notes]");
    click(notes?.querySelector("[data-rail-project]"));
    const folded = host.querySelector("section[aria-label=notes] [data-rail-project]");
    expect(folded?.getAttribute("aria-expanded")).toBe("false");
    expect(folded?.querySelector("[data-rail-count]")).toBeNull();
  });

  it("pins each header to the top of the list while its rows scroll under it", async () => {
    mount();
    await settle();

    for (const header of headers()) {
      const wrapper = header.closest("[data-rail-item]");
      expect(wrapper?.classList.contains("sticky")).toBe(true);
      expect(wrapper?.classList.contains("top-0")).toBe(true);
    }
  });

  it("keeps a remembered project's header with no rows under it", async () => {
    mount();
    await settle();

    const notes = host.querySelector("section[aria-label=notes]");
    expect(notes?.querySelectorAll("[data-rail-row]")).toHaveLength(0);
    // One header line: no "No sessions" line stands under it (SR-5).
    expect(text(notes)).not.toContain("No sessions");
    expect(notes?.children).toHaveLength(1);
    expect(text(notes)).toContain("0 sessions");
  });

  it("says so when there is nothing to list", async () => {
    tabViews.value = [];
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
    mount();
    await settle();

    expect(headers()).toHaveLength(0);
    expect(text(host.querySelector("section[aria-label='Open agents']"))).toBe("Nothing here");
  });
});

describe("a long workspace history", () => {
  it("lists the newest few remembered projects, as it did when the store held only those", async () => {
    pinHost(true);
    tabViews.value = [];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: Array.from({ length: 23 }, (_, i) => ({ path: `/w/p${i}`, lastOpenedAt: 100 - i })),
    };
    mount();
    await settle();

    expect(headers()).toHaveLength(MAX_RECENTS);
    expect(names()).toContain("p0");
    expect(names()).not.toContain("p8");
  });
});

describe("the first-run hint (stageLauncher)", () => {
  const empty = () => {
    tabViews.value = [];
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  };
  const list = () => text(host.querySelector("section[aria-label='Open agents']"));

  beforeEach(() => {
    pinHost(true);
    stage.on = true;
  });
  afterEach(() => {
    stage.on = false;
  });

  it("says where projects will land when there is no project and no live tab", async () => {
    empty();
    mount();
    await settle();

    expect(list()).toBe("Projects you open land here");
    expect(
      host.querySelector("section[aria-label='Open agents'] [data-deck-icon-size='12']"),
    ).not.toBeNull();
  });

  it("is gone once a workspace is remembered", async () => {
    tabViews.value = [];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/api", lastOpenedAt: NOW }],
    };
    mount();
    await settle();

    expect(list()).not.toContain("Projects you open land here");
    expect(headers()).toHaveLength(1);
  });

  it("leaves a search with no match saying so", async () => {
    mount();
    await settle();
    act(() => setRailQuery("zzzz"));
    await settle();

    expect(list()).toContain("No sessions match");
  });
});

describe("row", () => {
  beforeEach(() => {
    pinHost(true);
  });

  it("shows the title, agent, branch and time in state", async () => {
    mount();
    await settle();

    const named = row("pane:21");
    expect(text(named)).toContain("token refresh");
    expect(text(named)).toContain("side");
    expect(text(named)).toContain("3m");
    // The words behind the status reach the accessible name, inferred ones qualified (SR-8).
    expect(text(named)).toContain("Claude, unread (inferred)");
    expect(text(row("pane:12"))).toContain("Codex, working");
    expect(text(row("pane:12"))).toContain("main");
    expect(text(row("pane:11"))).toContain("Claude, needs you");
    expect(text(row("pane:11"))).toContain("10m");
  });

  it("draws no status mark in any row or header, open or folded", async () => {
    mount();
    await settle();
    const marks = () => host.querySelectorAll(".state-mark, [data-state]");

    expect(rows().length).toBeGreaterThan(0);
    expect(marks()).toHaveLength(0);
    click(headers()[0]);
    click(headers()[1]);
    expect(marks()).toHaveLength(0);
  });

  it("carries unread and needs-you in a 600 title and the status ink of the branch line", async () => {
    mount();
    await settle();

    const title = (id: string) => row(id)?.querySelector<HTMLElement>("[data-rail-title]");
    const metaOf = (id: string) => row(id)?.querySelector<HTMLElement>("[data-rail-meta]");
    // needs-you (11) and unread (21) are loud; working (12) and failed (31) are not.
    expect(title("pane:11")?.classList.contains("font-semibold")).toBe(true);
    expect(title("pane:21")?.classList.contains("font-semibold")).toBe(true);
    expect(title("pane:12")?.classList.contains("font-semibold")).toBe(false);
    expect(title("pane:31")?.classList.contains("font-semibold")).toBe(false);

    expect(metaOf("pane:11")?.classList.contains("text-(--ink-need)")).toBe(true);
    expect(metaOf("pane:21")?.classList.contains("text-(--ink-need)")).toBe(true);
    expect(metaOf("pane:31")?.classList.contains("text-(--ink-fail)")).toBe(true);
    expect(metaOf("pane:12")?.classList.contains("text-(--status-working)")).toBe(true);
    // Only a needs-you row is tinted; an unread one is not.
    expect(row("pane:11")?.className).toContain(STATE_NEEDS_YOU);
    expect(row("pane:21")?.className).not.toContain(STATE_NEEDS_YOU);
  });

  it.each([
    ["done", {}, "text-(--ink-ok)"],
    ["ended", { phase: "exited" as const }, "text-(--text-faint)"],
    ["idle", { hasRun: false }, "text-(--text-faint)"],
  ])("reads a %s row in a regular title and its status ink", async (_status, change, ink) => {
    tabViews.value = [tab({ panes: [pane({ paneId: 11, ...change })] })];
    mount();
    await settle();

    const named = row("pane:11");
    expect(named?.querySelector("[data-rail-title]")?.classList.contains("font-semibold")).toBe(
      false,
    );
    expect(named?.querySelector("[data-rail-meta]")?.classList.contains(ink)).toBe(true);
  });

  it("keeps the date faint on every row, whatever the status ink (SR-4)", async () => {
    mount();
    await settle();

    // Needs-you, unread, failed and done rows: the branch takes the ink, the date never does.
    for (const id of ["pane:11", "pane:21", "pane:31"]) {
      const date = row(id)?.querySelector("[data-rail-meta]")?.lastElementChild;
      expect(date?.classList.contains("text-(--text-faint)"), id).toBe(true);
    }
  });

  it("turns a working row's branch into a thinking line with three dots for its date", async () => {
    mount();
    await settle();

    const working = row("pane:12");
    expect(working?.querySelector(".rail-thinking")?.textContent).toBe("main");
    expect(working?.querySelectorAll(".rail-dots > i")).toHaveLength(3);
    // The dots stand where the age stood, and nothing else loops.
    expect(text(working)).not.toContain("1m");
    for (const id of ["pane:11", "pane:21", "pane:31", "shell:4"]) {
      expect(row(id)?.querySelector(".rail-thinking, .rail-dots")).toBeNull();
    }
  });

  it("says folder only where git knows no branch, and draws a shell row without an agent", async () => {
    mount();
    await settle();

    const failed = row("pane:31");
    expect(text(failed)).toContain("folder only");
    // The folder's own name is the project header's, never repeated on the row.
    expect(failed?.querySelector(".rail-thinking")).toBeNull();
    expect(text(row("pane:12"))).not.toContain("folder only");
    const shell = row("shell:4");
    expect(text(shell)).toContain("shell, idle");
    expect(text(shell)).toContain("folder only");
  });

  it("highlights the row that holds the keyboard and no other", async () => {
    tabViews.value = workdayFocusing(2);
    activeTabIndex.value = 1;
    mount();
    await settle();

    expect(rows().filter((r) => r.getAttribute("aria-current") === "true")).toEqual([
      row("pane:21"),
    ]);
  });

  it("keeps the time in state current as the clock ticks, and still while the window is hidden", async () => {
    tabViews.value = [tab({ panes: [pane({ paneId: 11, changedAt: NOW - 4 * MINUTE - 30_000 })] })];
    mount();
    await settle();
    expect(text(row("pane:11"))).toContain("4m");

    act(() => {
      vi.advanceTimersByTime(MINUTE);
    });
    expect(text(row("pane:11"))).toContain("5m");

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => {
      vi.advanceTimersByTime(10 * MINUTE);
    });
    expect(text(row("pane:11"))).toContain("5m");
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(text(row("pane:11"))).toContain("15m");
  });

  it("stops the clock when the rail unmounts", async () => {
    mount();
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("keyboard", () => {
  beforeEach(() => {
    pinHost(true);
  });

  it("gives Tab one row to land on: the focused row, else the first", async () => {
    mount();
    await settle();
    expect(
      rows()
        .filter((r) => r.tabIndex === 0)
        .map((r) => r.dataset.railRow),
    ).toEqual(["pane:12"]);

    unmount();
    tabViews.value = workdayFocusing(3);
    activeTabIndex.value = 2;
    mount();
    await settle();
    expect(
      rows()
        .filter((r) => r.tabIndex === 0)
        .map((r) => r.dataset.railRow),
    ).toEqual(["pane:31"]);
  });

  it("walks headers and rows with the arrow keys and stops at the ends", async () => {
    mount();
    await settle();
    const stops = [...host.querySelectorAll<HTMLElement>("[data-rail-project],[data-rail-row]")];

    stops[0].focus();
    expect(press(stops[0], "ArrowDown")).toBe(true);
    expect(document.activeElement).toBe(stops[1]);
    expect(press(stops[1], "ArrowUp")).toBe(true);
    expect(document.activeElement).toBe(stops[0]);
    // Past the first stop the key is left to the list's own scrolling.
    expect(press(stops[0], "ArrowUp")).toBe(false);
    expect(document.activeElement).toBe(stops[0]);
    const last = stops[stops.length - 1];
    last.focus();
    expect(press(last, "ArrowDown")).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it("skips the rows of a folded project", async () => {
    mount();
    await settle();
    click(headers()[0]);
    const folded = headers()[0];
    folded.focus();

    press(folded, "ArrowDown");

    expect(document.activeElement).toBe(headers()[1]);
  });

  it("selects the focused row once on Enter, exactly as a press does", async () => {
    const onFocusPane = vi.fn();
    const onSelectTab = vi.fn();
    mount({ onFocusPane, onSelectTab });
    await settle();

    const target = row("pane:21");
    target?.focus();
    expect(press(target, "Enter")).toBe(true);
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(1, 21);

    const shell = row("shell:4");
    press(shell, "Enter");
    expect(onSelectTab).toHaveBeenCalledExactlyOnceWith(3);
  });

  it.each([
    ["ArrowDown", { metaKey: true }],
    ["ArrowUp", { metaKey: true, altKey: true }],
    ["ArrowDown", { ctrlKey: true, shiftKey: true }],
    ["Enter", { metaKey: true, shiftKey: true }],
  ] as const)("leaves the chord %s with %o to the keymap", async (key, modifiers) => {
    const onFocusPane = vi.fn();
    mount({ onFocusPane });
    await settle();
    const target = row("pane:12");
    target?.focus();

    expect(press(target, key, modifiers)).toBe(false);
    expect(document.activeElement).toBe(target);
    expect(onFocusPane).not.toHaveBeenCalled();
  });

  it("leaves Enter on a project header to fold it, and ignores other keys", async () => {
    const onFocusPane = vi.fn();
    mount({ onFocusPane });
    await settle();

    expect(press(headers()[0], "Enter")).toBe(false);
    expect(press(row("pane:12"), "a")).toBe(false);
    expect(onFocusPane).not.toHaveBeenCalled();
  });
});
