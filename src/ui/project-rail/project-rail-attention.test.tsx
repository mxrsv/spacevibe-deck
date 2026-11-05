// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  GLYPH_INLINE: 12,
  GLYPH_ROW: 14,
  GLYPH_FEATURE: 16,
  ROW_ICON: 14,
  FEATURE_ICON: 15,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

// The stage bar carries the pill while the flush stage is on (every switch is on under
// `pinHost(true)`); `stage.pillOnStage = false` is the rail's own pill, which a build with the
// project rail and without the flush stage still draws.
const stage = vi.hoisted(() => ({ pillOnStage: true }));
vi.mock("../shell-stage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shell-stage")>()),
  stageAttentionPillEnabled: () => stage.pillOnStage,
}));

import { activeTabIndex, tabViews, type TabView } from "../../terminal/tabs-store";
import { StageAttentionPill } from "./project-rail-attention-pill";
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

/** The stage bar's mount point: a sibling of the rail, as in the shell. */
let bar = document.createElement("div");

beforeEach(() => {
  pinHost(true);
  stage.pillOnStage = true;
  bar = document.createElement("div");
  document.body.appendChild(bar);
});

afterEach(() => {
  act(() => render(null, bar));
  bar.remove();
});

/** The rail, and beside it the pill the stage bar mounts, with the same host callbacks. */
function mountShell(props: Parameters<typeof mount>[0] = {}): void {
  mount(props);
  act(() => {
    render(<StageAttentionPill onFocusPane={props.onFocusPane ?? NOOP} onSelectTab={NOOP} />, bar);
  });
}

const NOOP = (): void => {};

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
  [...bar.querySelectorAll<HTMLElement>("button")].find((button) =>
    /^\d+ agents? needs? you$/.test(button.getAttribute("aria-label") ?? ""),
  ) ?? null;
const label = (element: Element | null) => element?.getAttribute("aria-label") ?? "";

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
    mountShell();
    await settle();
    expect(label(pill())).toBe("3 agents need you");

    act(() => {
      setRailProjectHidden(MAIN, true);
      archiveItem("pane:31");
      toggleProjectFolded(NOTES);
    });
    await settle();

    // None of the three is on screen, and the pill still says all three are waiting.
    expect(rowIds()).toEqual([]);
    expect(label(pill())).toBe("3 agents need you");
  });

  it("offers the next agent in its tooltip and names no chord", async () => {
    tabViews.value = projects("requested", "none", "none");
    mountShell();
    await settle();

    act(() => pill()?.focus());
    await waitUntil(() => tooltip() !== null);

    expect(text(tooltip())).toBe("Next agent that needs you");
  });

  it("counts a failed agent and leaves a finished run alone", async () => {
    tabViews.value = projects("error", "completed", "none");
    mountShell();
    await settle();

    expect(label(pill())).toBe("1 agent needs you");
  });

  it("is absent while no agent needs the user", async () => {
    tabViews.value = projects("none", "completed", "none");
    mountShell();
    await settle();

    expect(pill()).toBeNull();
    expect(headers()).toHaveLength(3);
  });

  it("disappears once the last waiting agent has been answered", async () => {
    tabViews.value = projects("requested", "none", "none");
    mountShell();
    await settle();
    expect(label(pill())).toBe("1 agent needs you");

    tabViews.value = projects("none", "none", "none");
    await settle();

    expect(pill()).toBeNull();
  });

  it("sends the user to the next waiting agent and wraps around", async () => {
    tabViews.value = projects("requested", "requested", "requested");
    const focus = windowFocus();
    mountShell({ onFocusPane: focus });
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
    mountShell({ onFocusPane: focus });
    await settle();
    act(() => focus(1, 31));

    click(pill());
    await settle();

    expect(focus).toHaveBeenLastCalledWith(2, 41);
  });

  it("reaches agents the list does not show, and unfolds a folded project on arrival", async () => {
    tabViews.value = projects("requested", "requested", "requested");
    const focus = windowFocus();
    mountShell({ onFocusPane: focus });
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
    expect(label(pill())).toBe("3 agents need you");
  });
});

describe("where the pill lives", () => {
  const railPill = () =>
    [...host.querySelectorAll<HTMLElement>("button")].find((button) =>
      /^\d+ need you$/.test(text(button)),
    ) ?? null;

  it("shows the count and the louder state on the bar, with no words", async () => {
    tabViews.value = projects("requested", "error", "none");
    mountShell();
    await settle();

    expect(text(pill())).toBe("2");
    expect(pill()?.querySelector('[data-state="failed"]')).not.toBeNull();
    expect(pill()?.querySelector("[data-state]")?.getAttribute("data-surface")).toBe("pill");
    expect(railPill()).toBeNull();
  });

  it("leaves the rail's search row to the stage bar while the flush stage is on", async () => {
    tabViews.value = projects("requested", "none", "none");
    mountShell();
    await settle();

    expect(railPill()).toBeNull();
    expect(pill()).not.toBeNull();
  });

  it("stays in the rail's search row while the flush stage is off", async () => {
    stage.pillOnStage = false;
    tabViews.value = projects("requested", "none", "none");
    mount();
    await settle();

    expect(text(railPill())).toBe("1 need you");
    const drawn = railPill()?.querySelector("[data-state]");
    expect(drawn?.getAttribute("data-state")).toBe("needs-input");
    expect(drawn?.getAttribute("data-surface")).toBe("pill");
  });
});
