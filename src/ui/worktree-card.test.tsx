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

import type { RailCardPane, RailTabRow, RailWorktreeGroup } from "./agent-rail-model";
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

/** A plain shell tab — no agent panes, so it never produces a card row. */
function tabRow(overrides: Partial<RailTabRow> = {}): RailTabRow {
  return {
    key: 7,
    index: 4,
    project: "spacevibe-bench",
    identity: "shell",
    title: "shell",
    named: false,
    message: "",
    age: "",
    changedAt: 0,
    openedAt: 0,
    state: "idle",
    panes: [],
    voice: null,
    active: false,
    workspacePath: "/repo/ai-terminal",
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
        project="spacevibe-bench"
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
    // The project prefix (review fix, 2026-08-26): `project · checkout · branch`.
    expect(head?.getAttribute("title")).toBe("spacevibe-bench · ai-terminal · feature/ai-terminal");
    expect(head?.getAttribute("aria-label")).toContain(
      "spacevibe-bench · ai-terminal · feature/ai-terminal",
    );
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

  // The reversed half of the decision above (owner, 2026-08-26): the track is
  // still reserved, but it now precedes the model pill instead of trailing it.
  // Pinned as DOM order rather than as a grid column, because the DOM order is
  // what the stylesheet's two `grid-column` pins are declared to agree with —
  // and because a row read by a screen reader announces the children in this
  // order, not in the grid's.
  it("puts the loading track before the model pill", () => {
    mount({
      open: true,
      group: group({ panes: [pane({ paneId: 1, state: "working", model: "GPT-5.1" })] }),
    });

    const row = host.querySelector(".asr-card__row");
    expect(row).not.toBeNull();
    const children = [...(row?.children ?? [])];
    const loadAt = children.findIndex((node) => node.classList.contains("asr-card__load"));
    const pillAt = children.findIndex((node) => node.classList.contains("asr-card__pill"));
    expect(loadAt).toBeGreaterThan(-1);
    expect(pillAt).toBeGreaterThan(-1);
    expect(loadAt).toBeLessThan(pillAt);
  });

  it("focuses the pane's own tab when a row is pressed", () => {
    const onFocusPane = vi.fn();
    mount({
      open: true,
      onFocusPane,
      group: group({
        panes: [pane({ paneId: 99, tabIndex: 7 }), pane({ paneId: 100, tabIndex: 8 })],
      }),
    });

    const rows = host.querySelectorAll<HTMLElement>(".asr-card__row");
    click(rows[1].querySelector(".asr-card__hit"));
    expect(onFocusPane).toHaveBeenCalledWith(8, 100);
    expect(onFocusPane).toHaveBeenCalledTimes(1);
    // The focus control's accessible name also carries the project prefix.
    expect(rows[1].querySelector(".asr-card__hit")?.getAttribute("aria-label")).toContain(
      "spacevibe-bench · ai-terminal · feature/ai-terminal",
    );
  });

  it("opens the launcher pinned to this checkout from New agent", () => {
    const onNewTabIn = vi.fn();
    mount({
      open: true,
      onNewTabIn,
      group: group({ path: "/repo/ai-terminal", panes: [pane()] }),
    });

    // `.asr-card__new` — its own leaf, not `.asr-card__row` (review fix,
    // 2026-08-26): it shares no press target or accessible name with an
    // agent row, and briefly sharing `__row` broke a `rows()`-style test
    // selector's vacuity guarantee.
    const launcher = host.querySelector(".asr-card__new");
    expect(launcher).not.toBeNull();
    expect(launcher?.classList.contains("asr-card__row")).toBe(false);
    click(launcher);
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
    expect(closes[1].getAttribute("aria-label")).toContain(
      "spacevibe-bench · ai-terminal · feature/ai-terminal",
    );
    click(closes[1]);
    expect(onClosePane).toHaveBeenCalledWith(5, 42);
    expect(onClosePane).toHaveBeenCalledTimes(1);
  });

  it("omits New agent when the host cannot open one (DL-19.7)", () => {
    mount({ open: true, group: group({ panes: [pane()] }) });

    expect(host.querySelector(".asr-card__new")).toBeNull();
  });
});

describe("WorktreeCard host parity — no gate (review reversal, 2026-08-26)", () => {
  // Round 1 added a `showAgentPresence` gate here on a reviewer finding;
  // round 2 reversed it on the SAME reviewer's own follow-up, once the
  // `FlatPanes` consequence was named (see the file's top-of-module
  // comment). `WorktreeCardProps` carries no such field any more — these
  // pin that a card's strip and its open-list rows draw unconditionally,
  // on both the labelled and the unlabelled (`FlatPanes`) path.

  it("draws the closed strip regardless of host", () => {
    mount({
      open: false,
      group: group({ panes: [pane({ paneId: 1 }), pane({ paneId: 2 })] }),
    });

    expect(host.querySelectorAll(".asr-card__seg")).toHaveLength(2);
  });

  it("draws the open list's rows regardless of host", () => {
    mount({
      open: true,
      group: group({ age: "5m", panes: [pane({ paneId: 1 }), pane({ paneId: 2 })] }),
    });

    expect(host.querySelectorAll(".asr-card__row")).toHaveLength(2);
  });

  it("draws FlatPanes' rows regardless of host — the dominant real-Tauri path", () => {
    // `git_repository` is Electron-only, so under REAL Tauri almost every
    // checkout is unlabelled and renders through here, not through a card
    // at all. A gate scoped to the labelled path alone would have left this
    // branch — the one that matters in practice — untouched either way.
    mount({
      group: group({ labelled: false, panes: [pane({ paneId: 1 }), pane({ paneId: 2 })] }),
    });

    expect(host.querySelectorAll(".asr-card__row")).toHaveLength(2);
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
    expect(bare?.getAttribute("aria-label")).toBe(
      "New agent in spacevibe-bench · ai-terminal · feature/ai-terminal",
    );
    click(bare);
    expect(onNewTabIn).toHaveBeenCalledWith("/repo/docs");
  });

  it("degrades to a static row rather than an inert button when unwired (DL-19.7)", () => {
    mount({ group: group({ panes: [] }) });

    expect(host.querySelector("button.asr-bare")).toBeNull();
    expect(host.querySelector("div.asr-bare")).not.toBeNull();
  });

  it("marks a truly empty checkout as such (data-shell=false)", () => {
    mount({ group: group({ panes: [], rows: [] }) });

    expect(host.querySelector(".asr-bare")?.getAttribute("data-shell")).toBe("false");
  });
});

describe("WorktreeCard bare row — a live shell tab (item 1 fix, review 2026-08-26)", () => {
  it("does not claim the checkout is empty, and reaches the shell tab instead of spawning", () => {
    const onNewTabIn = vi.fn();
    const onSelectTab = vi.fn();
    mount({
      onNewTabIn,
      onSelectTab,
      group: group({ path: "/repo/docs", panes: [], rows: [tabRow({ index: 4 })] }),
    });

    // Still a bare row (no agent panes to build a card from) — but the
    // shell tab already open here must be distinguishable and reachable.
    expect(host.querySelector(".asr-card")).toBeNull();
    const bare = host.querySelector("button.asr-bare");
    expect(bare).not.toBeNull();
    expect(bare?.getAttribute("data-shell")).toBe("true");
    expect(bare?.getAttribute("aria-label")).toBe(
      "Open shell tab in spacevibe-bench · ai-terminal · feature/ai-terminal",
    );

    click(bare);
    expect(onSelectTab).toHaveBeenCalledWith(4);
    expect(onSelectTab).toHaveBeenCalledTimes(1);
    expect(onNewTabIn).not.toHaveBeenCalled();
  });

  it("degrades to a static row rather than an inert button when onSelectTab is unwired (DL-19.7)", () => {
    mount({ group: group({ panes: [], rows: [tabRow()] }) });

    const bare = host.querySelector(".asr-bare");
    expect(bare).not.toBeNull();
    expect(bare?.tagName).toBe("DIV");
    expect(bare?.getAttribute("data-shell")).toBe("true");
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
