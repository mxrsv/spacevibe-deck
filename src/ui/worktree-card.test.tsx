// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phosphor components are React `forwardRef` objects; jsdom under Vitest
// cannot use them as a tag name (the same trap `agent-rail.test.tsx`
// documents). `WorktreeCard` never touches Phosphor directly — everything
// goes through `DeckIcon` — so stubbing that one module is enough.
vi.mock("./controls/deck-icon", () => ({
  CHROME_ICON: 13,
  DeckIcon: ({ size }: { readonly size: number }) => <span data-deck-icon-size={size} />,
}));

import type { RailCardPane, RailWorktreeGroup } from "./agent-rail-model";
import { WorktreeCard, type WorktreeCardProps } from "./worktree-card";

function pane(overrides: Partial<RailCardPane> = {}): RailCardPane {
  return {
    paneId: 11,
    agent: "claude",
    state: "idle",
    message: "",
    age: "",
    changedAt: 0,
    focused: false,
    tabIndex: 0,
    model: "",
    label: "Claude",
    ...overrides,
  };
}

function group(overrides: Partial<RailWorktreeGroup> = {}): RailWorktreeGroup {
  return {
    key: "/repo/ai-terminal",
    branch: "feature/ai-terminal",
    name: "ai-terminal",
    path: "/repo/ai-terminal",
    primary: false,
    labelled: true,
    panes: [],
    live: false,
    age: "",
    active: false,
    rows: [],
    ...overrides,
  };
}

let host: HTMLDivElement;

const NOOP_FOCUS = (): void => {};
const NOOP_CLOSE = (): void => {};

function mount(props: Partial<WorktreeCardProps> & { readonly group: RailWorktreeGroup }): void {
  act(() => {
    render(
      <WorktreeCard
        open={false}
        onToggle={() => {}}
        onFocusPane={NOOP_FOCUS}
        onClosePane={NOOP_CLOSE}
        {...props}
      />,
      host,
    );
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("WorktreeCard head (design §4)", () => {
  it("draws the head as mark, basename and branch badge, with no caret and no age", () => {
    mount({
      group: group({
        name: "ai-terminal",
        branch: "feature/ai-terminal",
        age: "5m",
        panes: [pane()],
      }),
    });

    const head = host.querySelector(".asr-card__head");
    expect(head).not.toBeNull();
    expect(head?.querySelector(".asr-card__mark")).not.toBeNull();
    expect(head?.querySelector(".asr-card__name")?.textContent).toBe("ai-terminal");
    expect(head?.querySelector(".asr-card__badge")?.textContent).toContain("feature/ai-terminal");
    // No caret: the badge's `GitBranch` glyph is the head's ONLY icon.
    expect(head?.querySelectorAll("[data-deck-icon-size]")).toHaveLength(1);
    // No age on the head — it lives on the meta line, a sibling of the head.
    expect(head?.textContent).not.toContain("5m");
    expect(host.querySelector(".asr-card__meta")?.textContent).toBe("5m");
  });

  it("draws a closed card's strip with segments, never sharing the open row's class", () => {
    // Regression pin: a strip segment and an open row were briefly the same
    // class, which made "how many rows are open" indistinguishable from "how
    // wide is the closed strip" — an agent-rail integration test passed
    // vacuously against a card that was never opened until this was caught.
    mount({
      open: false,
      group: group({ panes: [pane({ paneId: 1 }), pane({ paneId: 2 })] }),
    });

    expect(host.querySelectorAll(".asr-card__strip .asr-card__seg")).toHaveLength(2);
    expect(host.querySelector(".asr-card__strip .asr-card__row")).toBeNull();
    expect(host.querySelector(".asr-card__row")).toBeNull();
  });
});

describe("WorktreeCard open list (design §5)", () => {
  it("lists every pane of the checkout when open, with no tab row between them", () => {
    mount({
      open: true,
      group: group({
        panes: [
          pane({ paneId: 1, tabIndex: 0, label: "Claude" }),
          pane({ paneId: 2, tabIndex: 3, label: "Codex" }),
          pane({ paneId: 3, tabIndex: 3, label: "Codex (Split)" }),
        ],
      }),
    });

    // Three panes across two different tabs, and no wrapper stands between
    // the card and its rows — DL-27.19's frame and the old `.asr-item` /
    // `.asr-row--tab` / `.asr-leaf` shapes are entirely gone.
    expect(host.querySelectorAll(".asr-card__row")).toHaveLength(3);
    expect(host.querySelector(".asr-row--tab")).toBeNull();
    expect(host.querySelector(".asr-leaf")).toBeNull();
    expect(host.querySelector(".asr-card__strip")).toBeNull();
  });

  it("reserves the loading track on an idle row so the pills share one right edge", () => {
    mount({
      open: true,
      group: group({
        panes: [
          pane({ paneId: 1, state: "idle", model: "Sonnet 4.5" }),
          pane({ paneId: 2, state: "working", model: "GPT-5.1" }),
        ],
      }),
    });

    const loads = host.querySelectorAll(".asr-card__load");
    expect(loads).toHaveLength(2);
    // The idle row's track is present but empty — no bars — while the busy
    // row's carries its three.
    expect(loads[0].children).toHaveLength(0);
    expect(loads[0].getAttribute("data-busy")).toBe("false");
    expect(loads[1].children).toHaveLength(3);
    expect(loads[1].getAttribute("data-busy")).toBe("true");
  });

  it("focuses the pane's own tab when a row is pressed", () => {
    const onFocusPane = vi.fn();
    mount({
      open: true,
      onFocusPane,
      group: group({
        panes: [
          pane({ paneId: 99, tabIndex: 7 }),
          pane({ paneId: 100, tabIndex: 8 }),
        ],
      }),
    });

    const rows = host.querySelectorAll<HTMLElement>(".asr-card__row");
    click(rows[1].querySelector(".asr-card__hit"));
    expect(onFocusPane).toHaveBeenCalledWith(8, 100);
    expect(onFocusPane).toHaveBeenCalledTimes(1);
  });

  it("opens the launcher pinned to this checkout from New agent", () => {
    const onNewTabIn = vi.fn();
    mount({
      open: true,
      onNewTabIn,
      group: group({ path: "/repo/ai-terminal", panes: [pane()] }),
    });

    click(host.querySelector(".asr-card__row--new"));
    expect(onNewTabIn).toHaveBeenCalledWith("/repo/ai-terminal");
    expect(onNewTabIn).toHaveBeenCalledTimes(1);
  });

  it("marks the focused row with aria-current and washes exactly one row", () => {
    mount({
      open: true,
      group: group({
        panes: [
          pane({ paneId: 1, focused: false }),
          pane({ paneId: 2, focused: true }),
          pane({ paneId: 3, focused: false }),
        ],
      }),
    });

    const hits = host.querySelectorAll<HTMLElement>(".asr-card__hit");
    const current = [...hits].filter((hit) => hit.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    const rows = host.querySelectorAll<HTMLElement>(".asr-card__row");
    expect(rows[1].dataset.focused).toBe("true");
    expect(rows[0].dataset.focused).toBe("false");
    expect(rows[2].dataset.focused).toBe("false");
  });

  it("closes THAT pane from its own row, never the tab", () => {
    const onClosePane = vi.fn();
    mount({
      open: true,
      onClosePane,
      group: group({
        panes: [pane({ paneId: 41, tabIndex: 2 }), pane({ paneId: 42, tabIndex: 5 })],
      }),
    });

    const closes = host.querySelectorAll<HTMLElement>(".asr-card__row .asr-row__action--close");
    expect(closes).toHaveLength(2);
    click(closes[1]);
    expect(onClosePane).toHaveBeenCalledWith(5, 42);
    expect(onClosePane).toHaveBeenCalledTimes(1);
  });

  it("omits New agent when the host cannot open one (DL-19.7)", () => {
    mount({ open: true, group: group({ panes: [pane()] }) });

    expect(host.querySelector(".asr-card__row--new")).toBeNull();
  });
});

describe("WorktreeCard bare row (design §6)", () => {
  it("renders the bare row — mark, name, badge — for a checkout with no panes", () => {
    mount({ group: group({ name: "docs", branch: "main", panes: [] }) });

    expect(host.querySelector(".asr-card")).toBeNull();
    const bare = host.querySelector(".asr-bare");
    expect(bare).not.toBeNull();
    expect(bare?.querySelector(".asr-bare__mark")).not.toBeNull();
    expect(bare?.querySelector(".asr-bare__name")?.textContent).toBe("docs");
    expect(bare?.querySelector(".asr-bare__badge")?.textContent).toContain("main");
  });

  it("keeps a bare row reachable: pressing it opens the launcher for that checkout", () => {
    const onNewTabIn = vi.fn();
    mount({
      onNewTabIn,
      group: group({ path: "/repo/docs", panes: [] }),
    });

    const bare = host.querySelector("button.asr-bare");
    expect(bare).not.toBeNull();
    click(bare);
    expect(onNewTabIn).toHaveBeenCalledWith("/repo/docs");
  });

  it("degrades to a static row rather than an inert button when unwired (DL-19.7)", () => {
    mount({ group: group({ panes: [] }) });

    expect(host.querySelector("button.asr-bare")).toBeNull();
    expect(host.querySelector("div.asr-bare")).not.toBeNull();
  });
});

describe("WorktreeCard unlabelled checkout", () => {
  it("renders panes with no card box for a project git does not know", () => {
    // `labelled: false` is the synthetic worktree of a plain folder or a
    // Tauri host: the cluster header above already names it.
    mount({
      open: true,
      group: group({ labelled: false, panes: [pane({ paneId: 1 }), pane({ paneId: 2 })] }),
    });

    expect(host.querySelector(".asr-card")).toBeNull();
    expect(host.querySelector(".asr-bare")).toBeNull();
    expect(host.querySelectorAll(".asr-card__row")).toHaveLength(2);
  });
});
