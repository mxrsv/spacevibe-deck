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
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";

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

/** A plain shell tab — no agent panes, so it never produces an agent row. */
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
const WHERE = "spacevibe-bench · ai-terminal · feature/ai-terminal";

/**
 * What a checkout's `+` raises when no launch page is wired: one agent, so
 * the first `menuitem` is `Claude`. A fresh pair of mocks per test.
 */
function cardActions(): CardActions {
  return {
    agents: [{ id: "claude", label: "Claude", detail: "claude" }],
    agentsResolved: true,
    onRunAgent: vi.fn(),
    onSplitHere: vi.fn(),
  };
}

function mount(props: Partial<WorktreeCardProps> & { readonly group: RailWorktreeGroup }): void {
  act(() => {
    render(
      <WorktreeCard
        project="spacevibe-bench"
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
  settings.value = DEFAULT_SETTINGS;
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

function contextMenu(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  });
}

const line = (): HTMLElement | null => host.querySelector(".asr-checkout__line");
const focusButton = (): HTMLElement | null => host.querySelector("button.asr-checkout__focus");
const add = (): HTMLButtonElement | null => host.querySelector(".asr-checkout__add");

describe("WorktreeCard label line (DL-27.28)", () => {
  it("focuses the first pane using its global tab index", () => {
    const onFocusPane = vi.fn();
    mount({ group: group({ panes: [pane({ tabIndex: 8 })] }), onFocusPane });
    click(focusButton());
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(8, 11);
  });

  it("keeps the focused pane when the current checkout's label is pressed", () => {
    const onFocusPane = vi.fn();
    mount({
      group: group({
        active: true,
        panes: [pane(), pane({ paneId: 22, tabIndex: 8, focused: true })],
      }),
      onFocusPane,
    });
    click(focusButton());
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(8, 22);
  });

  it("selects a shell-only checkout through the existing tab callback", () => {
    const onSelectTab = vi.fn();
    const onFocusPane = vi.fn();
    mount({ group: group({ entries: [shell()] }), onSelectTab, onFocusPane });
    click(focusButton());
    expect(onSelectTab).toHaveBeenCalledExactlyOnceWith(4);
    expect(onFocusPane).not.toHaveBeenCalled();
  });

  it("names a linked worktree by its branch and tags it `worktree`", () => {
    mount({ group: group({ panes: [pane()] }) });

    expect(line()?.querySelector(".asr-checkout__name")?.textContent).toBe("feature/ai-terminal");
    expect(line()?.querySelector(".asr-checkout__tag")?.textContent).toBe("worktree");
    expect(line()?.querySelector(".asr-checkout__glyph [data-deck-icon-size]")).not.toBeNull();
    expect(focusButton()?.getAttribute("title")).toBe(WHERE);
    expect(focusButton()?.getAttribute("aria-label")).toBe(`Focus ${WHERE}`);
  });

  it("names the primary checkout by its branch alone, so the project word is not printed twice", () => {
    mount({
      project: "spacevibe-board",
      group: group({ name: "spacevibe-board", branch: "main", primary: true, panes: [pane()] }),
    });

    expect(line()?.querySelector(".asr-checkout__name")?.textContent).toBe("main");
    expect(line()?.querySelector(".asr-checkout__tag")).toBeNull();
    expect(line()?.textContent).not.toContain("spacevibe-board");
  });

  it("marks only the checkout holding the focused pane as current", () => {
    mount({ group: group({ active: true, panes: [pane({ focused: true })] }) });
    expect(host.querySelector(".asr-checkout")?.getAttribute("data-current")).toBe("true");
    expect(focusButton()?.getAttribute("aria-current")).toBe("true");

    mount({ group: group({ active: false, panes: [pane()] }) });
    expect(host.querySelector(".asr-checkout")?.getAttribute("data-current")).toBe("false");
    expect(focusButton()?.hasAttribute("aria-current")).toBe(false);
  });

  it("draws no card: no frame, no disclosure, no folded strip and no age line", () => {
    mount({
      group: group({ age: "5m", panes: [pane(), pane({ paneId: 22 })] }),
      actions: cardActions(),
    });

    expect(host.querySelector(".asr-card")).toBeNull();
    expect(host.querySelector(".asr-card__head")).toBeNull();
    expect(host.querySelector(".asr-card__strip")).toBeNull();
    expect(host.querySelector(".asr-card__new")).toBeNull();
    // The checkout has no disclosure; its menu is the right-click one.
    expect(host.querySelectorAll("[aria-expanded]")).toHaveLength(0);
    expect(host.textContent).not.toContain("5m");
    // The rows are the checkout's own children, after its label line.
    const children = [...(host.querySelector(".asr-checkout")?.children ?? [])];
    expect(children[0]?.classList.contains("asr-checkout__line")).toBe(true);
    expect(children.filter((child) => child.classList.contains("asr-card__row"))).toHaveLength(2);
  });

  it("does not redirect row or close presses to the first pane", () => {
    const onFocusPane = vi.fn();
    const onClosePane = vi.fn();
    mount({
      group: group({ panes: [pane(), pane({ paneId: 22, tabIndex: 8 })] }),
      onFocusPane,
      onClosePane,
      actions: cardActions(),
    });
    click(host.querySelectorAll(".asr-card__hit")[1]);
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(8, 22);
    click(host.querySelector(".asr-row__action--close"));
    expect(onFocusPane).toHaveBeenCalledTimes(1);
    expect(onClosePane).toHaveBeenCalledTimes(1);
  });
});

describe("WorktreeCard create control (DL-27.26, amended 2026-10-08)", () => {
  const label = (): HTMLElement | null => host.querySelector(".asr-checkout__focus");

  it("draws no `+` on the line, with or without a launcher", () => {
    mount({ actions: cardActions(), group: group({ panes: [pane()] }) });
    expect(add()).toBeNull();
    mount({
      actions: { ...cardActions(), onOpenAgentLauncher: vi.fn() },
      group: group({ panes: [] }),
    });
    expect(add()).toBeNull();
  });

  it("opens the launch page when a bare checkout's label is pressed", () => {
    const onOpenAgentLauncher = vi.fn();
    const actions = { ...cardActions(), onOpenAgentLauncher };
    mount({ group: group({ panes: [] }), actions });

    expect(label()?.tagName).toBe("BUTTON");
    expect(label()?.getAttribute("aria-label")).toBe(`New agent in ${WHERE}`);
    click(label());
    expect(onOpenAgentLauncher).toHaveBeenCalledExactlyOnceWith("/repo/ai-terminal");
    expect(actions.onRunAgent).not.toHaveBeenCalled();
    expect(host.querySelector('[role="menu"]')).toBeNull();
    contextMenu(line());
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
  });

  it("keeps a bare checkout's label as text without a launcher", () => {
    mount({ group: group({ panes: [] }), actions: cardActions() });
    expect(label()?.tagName).toBe("SPAN");
  });

  it("focuses the checkout instead when it has rows", () => {
    const onOpenAgentLauncher = vi.fn();
    mount({
      group: group({ panes: [pane()] }),
      actions: { ...cardActions(), onOpenAgentLauncher },
    });
    click(label());
    expect(onOpenAgentLauncher).not.toHaveBeenCalled();
  });
});

describe("WorktreeCard actions menu", () => {
  const CHECKOUT = group({
    name: "wt",
    branch: "feat/strip-actions",
    panes: [pane({ paneId: 1 })],
  });

  function openMenu(actions: Partial<CardActions> = {}): HTMLElement | null {
    mount({
      group: CHECKOUT,
      actions: {
        agents: [{ id: "claude", label: "Claude", detail: "Sonnet 4.5" }],
        agentsResolved: true,
        onRunAgent: () => {},
        onSplitHere: () => {},
        ...actions,
      },
    });
    contextMenu(line());
    return host.querySelector<HTMLElement>(".asr-pop--actions");
  }

  it("opens on an action row — no heading, and no separator above the first group", () => {
    const menu = openMenu();

    expect(menu).not.toBeNull();
    expect(menu?.textContent).not.toContain("Actions for");
    expect(menu?.textContent).not.toContain("Runs in");
    expect(menu?.querySelector(".asr-act__head")).toBeNull();
    expect(menu?.firstElementChild?.classList.contains("asr-pop__sep")).toBe(false);
    expect(menu?.firstElementChild?.classList.contains("asr-act")).toBe(true);
    // The subject is still stated for a reader who cannot see the rail.
    expect(menu?.getAttribute("aria-label")).toBe(
      "Actions for spacevibe-bench · wt · feat/strip-actions",
    );
  });

  it("carries the agent rows the `+` exists to offer", () => {
    const menu = openMenu();
    expect(menu?.querySelector(".asr-act__title")?.textContent).toBe("Claude");
  });

  it("states a probe still running as a note the arrow keys cannot land on", () => {
    const menu = openMenu({ agents: [], agentsResolved: false });

    const note = menu?.querySelector(".asr-act__note");
    expect(note?.textContent).toContain("Looking for");
    expect(note?.tagName).toBe("P");
    const buttons = [...(menu?.querySelectorAll("button") ?? [])];
    expect(buttons.some((button) => button.contains(note ?? null))).toBe(false);
    expect(buttons[0]?.querySelector(".asr-act__title")?.textContent).toBe("New split here");
  });

  it("replaces the note with the agent rows when discovery lands, without reopening", () => {
    const menu = openMenu({ agents: [], agentsResolved: false });
    expect(menu?.querySelector(".asr-act__note")).not.toBeNull();

    mount({
      group: CHECKOUT,
      actions: {
        agents: [{ id: "claude", label: "Claude", detail: "Sonnet 4.5" }],
        agentsResolved: true,
        onRunAgent: () => {},
        onSplitHere: () => {},
      },
    });

    const after = host.querySelector<HTMLElement>(".asr-pop--actions");
    expect(after).toBe(menu);
    expect(after?.querySelector(".asr-act__note")).toBeNull();
    expect(after?.querySelector(".asr-act__title")?.textContent).toBe("Claude");
  });

  it("routes an empty answer to Settings instead of leaving the group out", () => {
    const onManageAgents = vi.fn();
    const menu = openMenu({ agents: [], agentsResolved: true, onManageAgents });

    const first = menu?.querySelector(".asr-act");
    expect(first?.querySelector(".asr-act__title")?.textContent).toBe("Choose quick agents");
    click(first);
    expect(onManageAgents).toHaveBeenCalledTimes(1);
  });
});

describe("WorktreeCard session rows", () => {
  it("lists every pane of the checkout, with no tab row between them", () => {
    mount({
      group: group({
        panes: [
          pane({ paneId: 1, tabIndex: 0, label: "Claude" }),
          pane({ paneId: 2, tabIndex: 3, label: "Codex" }),
          pane({ paneId: 3, tabIndex: 3, label: "Codex (Split)" }),
        ],
      }),
    });

    expect(host.querySelectorAll(".asr-card__row")).toHaveLength(3);
    expect(host.querySelector(".asr-row--tab")).toBeNull();
    expect(host.querySelector(".asr-leaf")).toBeNull();
  });

  it("reserves the trailing spacer on every row so each keeps one trailing cell", () => {
    mount({
      group: group({
        panes: [pane({ paneId: 1, state: "idle" }), pane({ paneId: 2, state: "working" })],
      }),
    });

    const loads = host.querySelectorAll(".asr-card__load");
    expect(loads).toHaveLength(2);
    expect(loads[0].children).toHaveLength(0);
    expect(loads[1].children).toHaveLength(0);
  });

  it("swaps the working spinner for the finished badge when work finishes", () => {
    mount({ group: group({ panes: [pane({ state: "working" })] }) });
    expect(host.querySelectorAll(".asr-card__dot[data-state='working'] > i")).toHaveLength(10);

    mount({ group: group({ panes: [pane({ state: "done", confidence: "inferred" })] }) });
    expect(host.querySelectorAll(".asr-card__dot > i")).toHaveLength(0);
    expect(host.querySelector(".asr-card__dot")?.getAttribute("data-state")).toBe("done");
    expect(host.querySelector('[aria-label*="done (inferred)"]')).not.toBeNull();
  });

  it("puts the busy spinner on the logo, not in the trailing cell, with no model pill", () => {
    mount({ group: group({ panes: [pane({ paneId: 1, state: "working", model: "GPT-5.1" })] }) });

    const row = host.querySelector(".asr-card__row");
    const children = [...(row?.children ?? [])];
    const statusAt = children.findIndex((node) => node.classList.contains("asr-card__status"));
    const textAt = children.findIndex((node) => node.classList.contains("asr-card__text"));
    expect(textAt).toBeGreaterThan(-1);
    expect(statusAt).toBeGreaterThan(textAt);
    expect(children[statusAt].querySelectorAll("i")).toHaveLength(0);
    expect(
      row?.querySelector(".asr-card__glyph > .asr-card__dot")?.getAttribute("data-state"),
    ).toBe("working");
    expect(row?.querySelector(".asr-card__pill")).toBeNull();
  });

  it("moves the model into the row's tooltip, after the agent's name", () => {
    mount({ group: group({ panes: [pane({ paneId: 1, state: "working", model: "GPT-5.1" })] }) });
    expect(host.querySelector(".asr-card__hit")?.getAttribute("title")).toBe(
      "Claude — Claude · GPT-5.1 — working",
    );
    expect(host.querySelector(".asr-card__row")?.textContent).not.toContain("GPT-5.1");
  });

  // RAIL5's pin: a tree row's press is `onFocusPane(tabIndex, paneId)` for that
  // exact pane, which `App` routes through `activateForAttention`.
  it("focuses that exact pane, by its own tab, when a tree row is pressed (RAIL5)", () => {
    const onFocusPane = vi.fn();
    mount({
      onFocusPane,
      group: group({
        panes: [pane({ paneId: 99, tabIndex: 7 }), pane({ paneId: 100, tabIndex: 8 })],
      }),
    });

    const rows = host.querySelectorAll<HTMLElement>(".asr-card__row");
    click(rows[1].querySelector(".asr-card__hit"));
    expect(onFocusPane).toHaveBeenCalledExactlyOnceWith(8, 100);
    expect(rows[1].querySelector(".asr-card__hit")?.getAttribute("aria-label")).toContain(WHERE);
  });

  it("marks the focused row with aria-current and washes exactly one row", () => {
    mount({
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
    expect([...rows].map((row) => row.dataset.focused)).toEqual(["false", "true", "false"]);
  });

  it("closes THAT pane from its own row, never the tab", () => {
    const onClosePane = vi.fn();
    mount({
      onClosePane,
      group: group({
        panes: [pane({ paneId: 41, tabIndex: 2 }), pane({ paneId: 42, tabIndex: 5 })],
      }),
    });

    const closes = host.querySelectorAll<HTMLElement>(".asr-card__row .asr-row__action--close");
    expect(closes).toHaveLength(2);
    expect(closes[1].getAttribute("aria-label")).toContain(WHERE);
    click(closes[1]);
    expect(onClosePane).toHaveBeenCalledExactlyOnceWith(5, 42);
  });
});

describe("WorktreeCard two-line rows (DL-27.28)", () => {
  const named = pane({
    tabIndex: 2,
    tabName: "auth",
    sentence: "Fixing login",
    label: "auth · Fixing login",
    taskLabel: "auth",
    secondLine: "Claude · Fixing login",
  });
  const hit = (): Element => host.querySelector(".asr-card__hit")!;
  const field = (): HTMLInputElement | null => host.querySelector("input.space-rename");
  const dblclick = (): void => {
    act(() => {
      hit().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  };
  const key = (name: string, value?: string): void => {
    act(() => {
      if (value !== undefined) field()!.value = value;
      field()!.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    });
  };

  it("is always two lines — a hand-made row with no second line reads its state word", () => {
    mount({ group: group({ panes: [pane({ taskLabel: "Codex", state: "working" })] }) });
    const row = host.querySelector(".asr-card__row")!;
    expect(row.querySelector(".asr-card__name")?.textContent).toBe("Codex");
    expect(row.querySelector(".asr-card__sentence")?.textContent).toBe("Working");
  });

  it("puts the task label on top and the agent · turn beneath, naming the row by both", () => {
    mount({ group: group({ panes: [named] }) });
    const row = host.querySelector(".asr-card__row")!;
    expect(row.querySelector(".asr-card__name")?.textContent).toBe("auth");
    expect(row.querySelector(".asr-card__sentence")?.textContent).toBe("Claude · Fixing login");
    expect(hit().getAttribute("aria-label")).toContain("Focus auth · Fixing login in");
  });

  it("leads an unnamed row with its first prompt, the full text in the tooltip", () => {
    const prompt = "Make the rail a tree with a breadcrumb on the strip";
    mount({
      group: group({
        panes: [
          pane({
            label: `${prompt} · Reading`,
            taskLabel: prompt,
            secondLine: "Claude · Reading",
          }),
        ],
      }),
    });
    expect(host.querySelector(".asr-card__name")?.textContent).toBe(prompt);
    expect(hit().getAttribute("title")).toContain(prompt);
  });

  it("renames the pane's tab on a double-click, keeping the row's own index", () => {
    const onRenameTab = vi.fn();
    mount({ group: group({ panes: [named] }), onRenameTab });
    dblclick();
    expect(field()!.value).toBe("auth");
    key("Enter", "scroll fix");
    expect(onRenameTab).toHaveBeenCalledWith(2, "scroll fix");
    expect(field()).toBeNull();
  });

  it("offers an unnamed row the empty field, its task label as the placeholder", () => {
    const onRenameTab = vi.fn();
    mount({
      group: group({
        panes: [pane({ tabIndex: 1, taskLabel: "Fix login", secondLine: "Claude" })],
      }),
      onRenameTab,
    });
    dblclick();
    expect(field()!.value).toBe("");
    expect(field()!.placeholder).toBe("Fix login");
    key("Escape");
    expect(onRenameTab).not.toHaveBeenCalled();
    expect(field()).toBeNull();
  });

  it("does nothing on a double-click where no rename is wired", () => {
    mount({ group: group({ panes: [named] }) });
    dblclick();
    expect(field()).toBeNull();
  });
});

describe("WorktreeCard checkout with nothing open", () => {
  it("is its label line alone, the label text rather than a focus button", () => {
    mount({ group: group({ name: "docs", branch: "main", primary: true, panes: [] }) });

    expect(host.querySelector(".asr-card__row")).toBeNull();
    expect(focusButton()).toBeNull();
    const label = host.querySelector("span.asr-checkout__focus");
    expect(label?.querySelector(".asr-checkout__name")?.textContent).toBe("main");
  });

  it("keeps the checkout reachable through its right-click menu", () => {
    const actions = cardActions();
    mount({ actions, group: group({ path: "/repo/docs", panes: [] }) });

    contextMenu(line());
    expect(actions.onRunAgent).not.toHaveBeenCalled();
    click(host.querySelector<HTMLElement>('.asr-pop--actions [role="menuitem"]'));
    expect(actions.onRunAgent).toHaveBeenCalledWith("claude", "/repo/docs");
  });

  it("degrades to a static line rather than an inert control when unwired (DL-19.7)", () => {
    mount({ group: group({ panes: [] }) });
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("WorktreeCard shell rows", () => {
  it("keeps a live shell tab under its checkout instead of claiming the checkout is empty", () => {
    const actions = cardActions();
    const onSelectTab = vi.fn();
    mount({
      actions,
      onSelectTab,
      group: group({
        path: "/repo/docs",
        entries: [shell({ tabIndex: 4 })],
        panes: [],
        rows: [tabRow({ index: 4 })],
      }),
    });

    const row = host.querySelector('.asr-card__row[data-kind="shell"]');
    expect(row).not.toBeNull();
    click(row?.querySelector(".asr-card__hit"));
    expect(onSelectTab).toHaveBeenCalledExactlyOnceWith(4);
    expect(actions.onRunAgent).not.toHaveBeenCalled();
  });

  it("closes the shell tab through the tab callback", () => {
    const onCloseTab = vi.fn();
    mount({ onCloseTab, group: group({ entries: [shell()], panes: [], rows: [tabRow()] }) });

    click(host.querySelector('.asr-card__row[data-kind="shell"] .asr-row__action--close'));
    expect(onCloseTab).toHaveBeenCalledWith(4);
  });
});

describe("WorktreeCard folder git does not know (DL-27.23, amended 2026-09-23)", () => {
  // `labelled: false` is the synthetic worktree of a plain folder: primary,
  // named after the folder, with the basename standing in for a branch.
  const folder = (overrides: Partial<RailWorktreeGroup> = {}): RailWorktreeGroup =>
    group({
      key: "/w/scratch",
      name: "scratch",
      branch: "scratch",
      path: "/w/scratch",
      repositoryPath: "/w/scratch",
      primary: true,
      labelled: false,
      ...overrides,
    });

  it("draws the same tree as a checkout, tagged `folder`", () => {
    mount({
      project: "scratch",
      group: folder({ panes: [pane({ paneId: 1 }), pane({ paneId: 2 })] }),
    });

    expect(line()?.querySelector(".asr-checkout__name")?.textContent).toBe("scratch");
    expect(line()?.querySelector(".asr-checkout__tag")?.textContent).toBe("folder");
    expect(host.querySelectorAll(".asr-card__row")).toHaveLength(2);
  });

  it("is its label line alone when nothing is open in it", () => {
    mount({ project: "scratch", group: folder() });

    expect(host.querySelector(".asr-card__row")).toBeNull();
    expect(line()?.querySelector(".asr-checkout__tag")?.textContent).toBe("folder");
  });
});

describe("WorktreeCard row badge (DL-27.21, amended 2026-10-09)", () => {
  // The state sits on the logo's corner: the mark is beside the name the eye
  // is reading, and the trailing cell keeps only close.
  it.each(["asked", "failed", "done", "ended"] as const)(
    "draws %s as the badge on the row's own logo and nothing in the trailing cell",
    (state) => {
      mount({ group: group({ panes: [pane({ state })] }) });

      const row = host.querySelector(".asr-card__row")!;
      const badge = row.querySelector(".asr-card__glyph > .asr-card__dot");
      expect(badge?.getAttribute("data-state")).toBe(state);
      expect(badge?.getAttribute("aria-hidden")).toBe("true");
      expect(row.querySelectorAll(".asr-card__dot")).toHaveLength(1);
      expect(row.querySelector(".asr-card__status .asr-card__dot")).toBeNull();
      expect(row.querySelector(".asr-card__status .asr-card__load")).not.toBeNull();
    },
  );

  it("draws a working row as the braille spinner on the logo", () => {
    mount({ group: group({ panes: [pane({ state: "working" })] }) });

    const row = host.querySelector(".asr-card__row")!;
    const frames = [
      ...row.querySelectorAll(".asr-card__glyph > .asr-card__dot[data-state='working'] > i"),
    ];
    expect(frames.map((frame) => frame.textContent)).toEqual([
      "⠋",
      "⠙",
      "⠹",
      "⠸",
      "⠼",
      "⠴",
      "⠦",
      "⠧",
      "⠇",
      "⠏",
    ]);
    expect(row.querySelector(".asr-card__status .asr-card__dot")).toBeNull();
    expect(row.querySelector(".asr-card__status i")).toBeNull();
  });

  it("carries no badge on an idle row", () => {
    mount({ group: group({ panes: [pane({ state: "idle" })] }) });

    expect(host.querySelector(".asr-card__row .asr-card__dot")).toBeNull();
  });

  it("keeps the agent label and the state word in the name and tooltip", () => {
    mount({ group: group({ panes: [pane({ state: "asked", label: "Claude" })] }) });

    const hit = host.querySelector<HTMLElement>(".asr-card__hit")!;
    expect(hit.getAttribute("aria-label")).toMatch(/^Focus Claude in .*, needs you$/);
    expect(hit.getAttribute("title")).toBe("Claude — needs you");
  });
});

describe("WorktreeCard logos keep their colour (DL-27.21, amended 2026-10-07)", () => {
  // Quiet logos are withdrawn: no row carries `data-quiet`, whatever its state,
  // so no rule can fade a logo; the corner badge alone carries the state.
  it.each(["asked", "failed", "working", "done", "idle", "ended"] as const)(
    "leaves a %s row's logo unchanged",
    (state) => {
      mount({ group: group({ panes: [pane({ state })] }) });

      const row = host.querySelector<HTMLElement>(".asr-card__row")!;
      expect(row.dataset.state).toBe(state);
      expect(row.hasAttribute("data-quiet")).toBe(false);
      expect(row.querySelector(".asr-card__logo")).not.toBeNull();
    },
  );

  it("draws every kind of logo inside the row", () => {
    mount({
      group: group({
        panes: [
          pane({ paneId: 1, agent: "claude", state: "done" }),
          pane({ paneId: 2, agent: "codex", label: "Codex", state: "done" }),
          pane({ paneId: 3, agent: "crush", label: "Crush", state: "done" }),
        ],
      }),
    });

    const logos = [...host.querySelectorAll(".asr-card__row .asr-card__glyph > .asr-card__logo")];
    expect(logos.map((logo) => logo.tagName.toLowerCase())).toEqual(["img", "svg", "span"]);
    expect(logos[2].classList.contains("asr-card__logo--letter")).toBe(true);
  });
});
