// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The host stubs `project-rail.test.tsx` needs, and a `DeckIcon` jsdom can draw.
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
vi.mock("../controls/deck-icon", () => ({
  CHROME_ICON: 13,
  ROW_ICON: 14,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import { activeTabIndex, tabViews, type TabView } from "../../terminal/tabs-store";
import { waitUntil } from "../controls/preset-test-kit";
import {
  click,
  headers,
  host,
  installRailHarness,
  mount,
  pane,
  pinHost,
  rows,
  settle,
  tab,
  text,
} from "./project-rail-test-kit";
import { archiveItem, setRailProjectHidden, toggleProjectFolded } from "./project-rail-state";

installRailHarness();

beforeEach(() => {
  pinHost(true);
});

// Project keys: the repository's `.git`, and `plain:<folder>` for a folder git does not know.
const MAIN = "/r/.git";
const NOTES = "plain:/w/notes";

/** Three projects, a tab each; `attentions` is the attention of pane 11, 31 and 41. */
function projects(...attentions: readonly [string, string, string]): TabView[] {
  const [main, api, notes] = attentions.map((attention) => ({
    attention: attention as "none" | "requested" | "completed" | "error",
    phase: "idle" as const,
  }));
  return [
    tab({ key: 1, workspacePath: "/r/main", panes: [pane({ paneId: 11, ...main })] }),
    tab({ key: 2, workspacePath: "/w/api", panes: [pane({ paneId: 31, ...api })] }),
    tab({ key: 3, workspacePath: "/w/notes", panes: [pane({ paneId: 41, ...notes })] }),
  ];
}

const pill = () =>
  [...host.querySelectorAll<HTMLElement>("button")].find((button) =>
    /^\d+ need you$/.test(text(button)),
  ) ?? null;

const rowIds = () => rows().map((r) => r.dataset.railRow);
const tooltip = () => document.body.querySelector<HTMLElement>('[data-slot="tooltip-content"]');

/** The host's pane-exact focus: the pane takes the window's keyboard, as `focusRailPane` does. */
function windowFocus() {
  return vi.fn((tabIndex: number, paneId: number) => {
    activeTabIndex.value = tabIndex;
    tabViews.value = tabViews.value.map((view, at) => ({
      ...view,
      panes: (view.panes ?? []).map((p) => ({
        ...p,
        focused: at === tabIndex && p.paneId === paneId,
      })),
    }));
  });
}

describe("the N need you pill", () => {
  it("counts an agent in a hidden project, an archived row and a folded project", async () => {
    tabViews.value = projects("requested", "requested", "requested");
    mount();
    await settle();
    expect(text(pill())).toBe("3 need you");

    act(() => {
      setRailProjectHidden(MAIN, true);
      archiveItem("pane:31");
      toggleProjectFolded(NOTES);
    });
    await settle();

    // None of the three is on screen, and the pill still says all three are waiting.
    expect(rowIds()).toEqual([]);
    expect(text(pill())).toBe("3 need you");
  });

  it("offers the next agent in its tooltip and names no chord", async () => {
    tabViews.value = projects("requested", "none", "none");
    mount();
    await settle();

    act(() => pill()?.focus());
    await waitUntil(() => tooltip() !== null);

    expect(text(tooltip())).toBe("Next");
  });

  it("counts a failed agent and leaves a finished run alone", async () => {
    tabViews.value = projects("error", "completed", "none");
    mount();
    await settle();

    expect(text(pill())).toBe("1 need you");
  });

  it("is absent while no agent needs the user", async () => {
    tabViews.value = projects("none", "completed", "none");
    mount();
    await settle();

    expect(pill()).toBeNull();
    expect(headers()).toHaveLength(3);
  });

  it("disappears once the last waiting agent has been answered", async () => {
    tabViews.value = projects("requested", "none", "none");
    mount();
    await settle();
    expect(text(pill())).toBe("1 need you");

    tabViews.value = projects("none", "none", "none");
    await settle();

    expect(pill()).toBeNull();
  });

  it("sends the user to the next waiting agent and wraps around", async () => {
    tabViews.value = projects("requested", "requested", "requested");
    const focus = windowFocus();
    mount({ onFocusPane: focus });
    await settle();
    const order = rowIds();
    expect(order).toHaveLength(3);

    const landed: (string | undefined)[] = [];
    for (let press = 0; press < 4; press += 1) {
      click(pill());
      await settle();
      landed.push(`pane:${focus.mock.calls.at(-1)?.[1]}`);
    }

    expect(landed).toEqual([...order, order[0]]);
  });

  it("goes on from the agent that holds the keyboard, not from the top", async () => {
    tabViews.value = projects("requested", "requested", "requested");
    const focus = windowFocus();
    mount({ onFocusPane: focus });
    await settle();
    act(() => focus(1, 31));

    click(pill());
    await settle();

    expect(focus).toHaveBeenLastCalledWith(2, 41);
  });

  it("reaches agents the list does not show, and unfolds a folded project on arrival", async () => {
    tabViews.value = projects("requested", "requested", "requested");
    const focus = windowFocus();
    mount({ onFocusPane: focus });
    await settle();
    act(() => {
      setRailProjectHidden(MAIN, true);
      archiveItem("pane:31");
      toggleProjectFolded(NOTES);
    });
    await settle();

    click(pill());
    await settle();
    expect(focus).toHaveBeenLastCalledWith(0, 11);
    click(pill());
    await settle();
    expect(focus).toHaveBeenLastCalledWith(1, 31);
    expect(rowIds()).toEqual([]);

    click(pill());
    await settle();
    expect(focus).toHaveBeenLastCalledWith(2, 41);
    // The folded project opened, so the row the keyboard went to is on screen.
    expect(rowIds()).toEqual(["pane:41"]);
    expect(text(pill())).toBe("3 need you");
  });
});
