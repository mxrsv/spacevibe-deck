// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

// The host stubs the rail's import graph reaches, and a `DeckIcon` jsdom can draw.
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

import { WORKSPACES_VERSION } from "../../lib/workspace-recents";
import { workspacesData } from "../../open-board/workspaces-store";
import { tabViews } from "../../terminal/tabs-store";
import { setRailQuery } from "./project-rail-state";
import type { CardActions } from "../worktree-card-menus";
import {
  activate,
  click,
  closeMenu,
  host,
  installRailHarness,
  item,
  menuLabels,
  mount,
  openMenuByRightClick,
  pick,
  pinHost,
  settle,
  unmount,
  workday,
} from "./project-rail-test-kit";

installRailHarness();

beforeEach(() => {
  pinHost(true);
});

const MAIN = "/r/.git";

function actions(over: Partial<CardActions> = {}): CardActions {
  return {
    agents: [{ id: "claude", label: "Claude Code", detail: "claude" }],
    agentsResolved: true,
    onRunAgent: vi.fn(),
    onSplitHere: vi.fn(),
    onOpenShell: vi.fn(),
    onOpenAgentLauncher: vi.fn(),
    ...over,
  };
}

/**
 * Nothing of the repository is open, and history remembers two of its checkouts: the project
 * stands on the rail as a remembered cluster whose checkouts have no rows.
 */
function rememberedRepository(): void {
  tabViews.value = workday().filter((view) => view.key >= 3);
  workspacesData.value = {
    version: WORKSPACES_VERSION,
    recents: [
      { path: "/r/main", lastOpenedAt: 4 },
      { path: "/r/side", lastOpenedAt: 3 },
      { path: "/w/api", lastOpenedAt: 2 },
    ],
  };
}

const sideLine = () => host.querySelector<HTMLElement>('[data-rail-item="checkout:/r/side"]');

describe("rowless checkout", () => {
  it("gets a line per checkout under a remembered project, and none while a checkout has rows", async () => {
    mount({ cardActions: actions() });
    await settle();
    expect(host.querySelector("[data-rail-checkout]")).toBeNull();

    unmount();
    rememberedRepository();
    mount({ cardActions: actions() });
    await settle();
    const section = sideLine()?.closest("section");
    expect(section?.querySelectorAll("[data-rail-checkout]")).toHaveLength(2);
    expect(sideLine()?.querySelector("[data-rail-checkout]")?.getAttribute("aria-label")).toBe(
      "New agent in main · side",
    );
  });

  it("opens the launch page on it when pressed", async () => {
    const cardActions = actions();
    rememberedRepository();
    mount({ cardActions });
    await settle();

    click(sideLine()?.querySelector("[data-rail-checkout]"));
    expect(cardActions.onOpenAgentLauncher).toHaveBeenCalledExactlyOnceWith("/r/side");
  });

  it("offers the shipped checkout menu on right-click and the hover button, calling its handlers", async () => {
    const cardActions = actions();
    rememberedRepository();
    mount({ cardActions });
    await settle();

    // The stage launcher is on in the development host the harness pins (LCH-4): one item
    // opens the launcher where the per-agent list used to be.
    expect(await openMenuByRightClick("checkout:/r/side")).toBe(true);
    expect(menuLabels()).toEqual(["New agent…", "Open shell", "New split here"]);
    await closeMenu();

    await activate(sideLine()?.querySelector('button[aria-label^="Actions for"]'));
    expect(menuLabels()).toEqual(["New agent…", "Open shell", "New split here"]);
    await pick("New agent…");
    expect(cardActions.onOpenAgentLauncher).toHaveBeenCalledExactlyOnceWith("/r/side");
    expect(cardActions.onRunAgent).not.toHaveBeenCalled();

    await openMenuByRightClick("checkout:/r/side");
    await pick("Open shell");
    expect(cardActions.onOpenShell).toHaveBeenCalledExactlyOnceWith("/r/side");

    await openMenuByRightClick("checkout:/r/side");
    await pick("New split here");
    expect(cardActions.onSplitHere).toHaveBeenCalledExactlyOnceWith("/r/side");
  });

  it("still offers the one New agent… item when no quick agent is available", async () => {
    const cardActions = actions({ agents: [] });
    rememberedRepository();
    mount({ cardActions });
    await settle();

    await openMenuByRightClick("checkout:/r/side");
    expect(menuLabels()).toEqual(["New agent…", "Open shell", "New split here"]);
  });

  it("is left out while a search is set", async () => {
    rememberedRepository();
    mount({ cardActions: actions() });
    await settle();
    expect(sideLine()).not.toBeNull();

    const field = host.querySelector<HTMLInputElement>("input[data-rail-search]");
    await activate(field);
    field?.focus();
    setRailQuery("api");
    await settle();
    expect(sideLine()).toBeNull();
  });
});

describe("row menu: New here", () => {
  it("runs the same handlers on the row's checkout", async () => {
    const cardActions = actions();
    mount({ cardActions });
    await settle();

    await openMenuByRightClick("pane:21");
    expect(menuLabels()).toContain("New here");
    await activate(
      document.body.querySelector<HTMLElement>('[data-slot="dropdown-menu-sub-trigger"]'),
    );
    await pick("Open shell");
    expect(cardActions.onOpenShell).toHaveBeenCalledExactlyOnceWith("/r/side");
  });
});

describe("project header press", () => {
  it("focuses the project's active checkout and folds it", async () => {
    const onFocusPane = vi.fn();
    mount({ onFocusPane, cardActions: actions() });
    await settle();

    click(item(`project:${MAIN}`)?.querySelector("[data-rail-project]"));
    // The workday's keyboard stands in the first tab of this repository.
    expect(onFocusPane).toHaveBeenCalledOnce();
    expect(
      item(`project:${MAIN}`)?.querySelector("[data-rail-project]")?.getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
