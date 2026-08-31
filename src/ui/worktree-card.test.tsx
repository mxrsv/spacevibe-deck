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

import type {
  RailCardPane,
  RailCardShell,
  RailTabRow,
  RailWorktreeGroup,
} from "./agent-rail-model";
import { WorktreeCard, type WorktreeCardProps } from "./worktree-card";
import type { CardActions } from "./worktree-card-menus";

function pane(overrides: Partial<RailCardPane> = {}): RailCardPane {
  return {
    kind: "agent",
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

function shell(overrides: Partial<RailCardShell> = {}): RailCardShell {
  return {
    kind: "shell",
    key: "shell:7",
    tabIndex: 4,
    label: "Shell",
    active: false,
    ...overrides,
  };
}

function group(overrides: Partial<RailWorktreeGroup> = {}): RailWorktreeGroup {
  const panes = overrides.panes ?? [];
  return {
    key: "/repo/ai-terminal",
    branch: "feature/ai-terminal",
    name: "ai-terminal",
    path: "/repo/ai-terminal",
    repositoryPath: "/repo",
    primary: false,
    labelled: true,
    entries: overrides.entries ?? panes,
    panes,
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
        onCloseTab={NOOP_CLOSE}
        onSelectTab={NOOP_CLOSE}
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

  it("names the primary checkout by its branch, so the project word is not printed twice", () => {
    // The defect: a primary checkout sits at the repository root, so its
    // basename IS the project name the cluster header printed directly above.
    mount({
      project: "spacevibe-board",
      group: group({
        name: "spacevibe-board",
        branch: "main",
        primary: true,
        panes: [pane()],
      }),
    });

    const head = host.querySelector(".asr-card__head");
    expect(head?.querySelector(".asr-card__name")?.textContent).toBe("main");
    // The badge cannot restate the label, so it states the role instead.
    expect(head?.querySelector(".asr-card__badge")?.textContent).toBe("Primary");
    expect(head?.querySelector(".asr-card__badge")?.getAttribute("data-kind")).toBe("role");
    // A `role` badge carries no glyph, so the head draws none at all.
    expect(head?.querySelectorAll("[data-deck-icon-size]")).toHaveLength(0);
    expect(head?.textContent).not.toContain("spacevibe-board");
    expect(head?.getAttribute("title")).toBe("spacevibe-board · main");
  });

  it("states a worktree named after its branch exactly once", () => {
    // `git worktree add ../fix-login fix-login` — folder and branch are one
    // word, so a branch badge beside that label would repeat it.
    mount({
      project: "spacevibe-board",
      group: group({ name: "fix-login", branch: "fix-login", panes: [pane()] }),
    });

    const head = host.querySelector(".asr-card__head");
    expect(head?.querySelector(".asr-card__name")?.textContent).toBe("fix-login");
    expect(head?.querySelector(".asr-card__badge")?.textContent).toBe("Worktree");
    expect(head?.getAttribute("title")).toBe("spacevibe-board · fix-login");
  });

  it("merges a closed card's segments by agent kind, never sharing the open row's class", () => {
    // Regression pin: a strip segment and an open row were briefly the same
    // class, which made "how many rows are open" indistinguishable from "how
    // wide is the closed strip" — an agent-rail integration test passed
    // vacuously against a card that was never opened until this was caught.
    //
    // Rewritten 2026-08-27 (spec
    // `docs/specs/2026-08-27-rail-card-strip-actions-design.md` §4/§5.2): a
    // segment is one agent KIND, so two Claudes are ONE segment carrying `×2`;
    // it is a `<button>` rather than a `<span role="img">`; and the native
    // `title` is gone (DL-23.10 — a `title` never appears on keyboard focus,
    // so the state word lives in the accessible name alone).
    mount({
      open: false,
      group: group({
        panes: [pane({ paneId: 1 }), pane({ paneId: 2, label: "Claude 2" })],
      }),
    });

    const segments = [...host.querySelectorAll(".asr-card__strip .asr-card__seg")];
    expect(host.querySelector(".asr-card__strip .asr-card__row")).toBeNull();
    expect(host.querySelector(".asr-card__row")).toBeNull();
    expect(
      segments.map((segment) => ({
        tag: segment.tagName,
        title: segment.getAttribute("title"),
        label: segment.getAttribute("aria-label"),
      })),
    ).toEqual([
      {
        tag: "BUTTON",
        title: null,
        label:
          "Focus 2 Claude agents, loudest idle in spacevibe-bench · ai-terminal · feature/ai-terminal",
      },
    ]);
    expect(segments[0]?.textContent).toContain("×2");
  });

  it("gives a closed card no `+` when nothing can wire the actions menu (DL-19.7)", () => {
    mount({ open: false, group: group({ panes: [pane({ paneId: 1 })] }) });
    expect(host.querySelector(".asr-card__seg--add")).toBeNull();
  });

  it("carries the `+` after the segments once the actions menu is wired", () => {
    mount({
      open: false,
      group: group({ panes: [pane({ paneId: 1 })] }),
      actions: {
        agents: [],
        agentsResolved: true,
        onRunAgent: () => {},
        onSplitHere: () => {},
      },
    });

    const segments = [...host.querySelectorAll(".asr-card__strip .asr-card__seg")];
    // Last, so the bar reads agents → more agents → create. Indexed rather
    // than `Array.at`, which this suite's `lib` does not carry.
    const add = segments[segments.length - 1];
    expect(add?.classList.contains("asr-card__seg--add")).toBe(true);
    expect(add?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("WorktreeCard actions menu", () => {
  const CARD = group({ name: "wt", branch: "feat/strip-actions", panes: [pane({ paneId: 1 })] });

  function openMenu(actions: Partial<CardActions> = {}): HTMLElement | null {
    mount({
      open: false,
      group: CARD,
      actions: {
        agents: [{ id: "claude", label: "Claude", detail: "Sonnet 4.5" }],
        agentsResolved: true,
        onRunAgent: () => {},
        onSplitHere: () => {},
        ...actions,
      },
    });
    click(host.querySelector(".asr-card__seg--add"));
    return host.querySelector<HTMLElement>(".asr-pop--actions");
  }

  it("opens on an action row — no heading, and no separator above the first group", () => {
    const menu = openMenu();

    expect(menu).not.toBeNull();
    // The head printed the checkout and branch 6px from a card that states
    // both (owner, 2026-08-30).
    expect(menu?.textContent).not.toContain("Actions for");
    expect(menu?.textContent).not.toContain("Runs in");
    expect(menu?.querySelector(".asr-act__head")).toBeNull();
    expect(menu?.firstElementChild?.classList.contains("asr-pop__sep")).toBe(false);
    expect(menu?.firstElementChild?.classList.contains("asr-act")).toBe(true);
    // The subject is still stated for a reader who cannot see the card.
    expect(menu?.getAttribute("aria-label")).toBe(
      "Actions for spacevibe-bench · wt · feat/strip-actions",
    );
  });

  it("carries the agent rows the `+` exists to offer", () => {
    const menu = openMenu();
    const first = menu?.querySelector(".asr-act__title");
    expect(first?.textContent).toBe("Run Claude");
  });

  it("states a probe still running as a note the arrow keys cannot land on", () => {
    const menu = openMenu({ agents: [], agentsResolved: false });

    const note = menu?.querySelector(".asr-act__note");
    expect(note?.textContent).toContain("Looking for");
    // The roving focus walks buttons; a note must not be one, or it would take
    // an Arrow-key stop and do nothing there.
    expect(note?.tagName).toBe("P");
    const buttons = [...(menu?.querySelectorAll("button") ?? [])];
    expect(buttons.some((button) => button.contains(note ?? null))).toBe(false);
    expect(buttons[0]?.querySelector(".asr-act__title")?.textContent).toBe("New split here");
  });

  it("replaces the note with the agent rows when discovery lands, without reopening", () => {
    const menu = openMenu({ agents: [], agentsResolved: false });
    expect(menu?.querySelector(".asr-act__note")).not.toBeNull();

    mount({
      open: false,
      group: CARD,
      actions: {
        agents: [{ id: "claude", label: "Claude", detail: "Sonnet 4.5" }],
        agentsResolved: true,
        onRunAgent: () => {},
        onSplitHere: () => {},
      },
    });

    const after = host.querySelector<HTMLElement>(".asr-pop--actions");
    // The same node: the menu updated in place rather than being reopened.
    expect(after).toBe(menu);
    expect(after?.querySelector(".asr-act__note")).toBeNull();
    expect(after?.querySelector(".asr-act__title")?.textContent).toBe("Run Claude");
  });

  it("routes an empty answer to Settings instead of leaving the group out", () => {
    const onManageAgents = vi.fn();
    const menu = openMenu({ agents: [], agentsResolved: true, onManageAgents });

    const first = menu?.querySelector(".asr-act");
    expect(first?.querySelector(".asr-act__title")?.textContent).toBe("No agent to run");
    click(first);
    expect(onManageAgents).toHaveBeenCalledTimes(1);
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
    // row's carries one compositor-friendly pulse.
    expect(loads[0].children).toHaveLength(0);
    expect(loads[0].getAttribute("data-busy")).toBe("false");
    expect(loads[1].children).toHaveLength(1);
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

    // Two panes of ONE agent kind — one merged segment since 2026-08-27.
    expect(host.querySelectorAll(".asr-card__seg")).toHaveLength(1);
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

  it("follows the head's naming rule when the primary checkout has nothing open", () => {
    mount({
      project: "spacevibe-board",
      group: group({ name: "spacevibe-board", branch: "main", primary: true, panes: [] }),
    });

    const bare = host.querySelector(".asr-bare");
    expect(bare?.querySelector(".asr-bare__name")?.textContent).toBe("main");
    expect(bare?.querySelector(".asr-bare__badge")?.textContent).toBe("Primary");
    expect(bare?.textContent).not.toContain("spacevibe-board");
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

describe("WorktreeCard shell rows", () => {
  it("keeps a live shell tab inside the card instead of claiming the checkout is empty", () => {
    const onNewTabIn = vi.fn();
    const onSelectTab = vi.fn();
    mount({
      onNewTabIn,
      onSelectTab,
      open: true,
      group: group({
        path: "/repo/docs",
        entries: [shell({ tabIndex: 4 })],
        panes: [],
        rows: [tabRow({ index: 4 })],
      }),
    });

    expect(host.querySelector(".asr-card")).not.toBeNull();
    const row = host.querySelector('.asr-card__row[data-kind="shell"]');
    expect(row).not.toBeNull();

    click(row?.querySelector(".asr-card__hit"));
    expect(onSelectTab).toHaveBeenCalledWith(4);
    expect(onSelectTab).toHaveBeenCalledTimes(1);
    expect(onNewTabIn).not.toHaveBeenCalled();
  });

  it("closes the shell tab through the tab callback", () => {
    const onCloseTab = vi.fn();
    mount({
      open: true,
      onCloseTab,
      group: group({ entries: [shell()], panes: [], rows: [tabRow()] }),
    });

    click(host.querySelector('.asr-card__row[data-kind="shell"] .asr-row__action--close'));
    expect(onCloseTab).toHaveBeenCalledWith(4);
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
