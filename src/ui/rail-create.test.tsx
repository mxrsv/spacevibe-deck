// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../host/worktree-host", () => ({ addWorktree: vi.fn(), available: true }));
vi.mock("../host/dialog-host", () => ({ open: vi.fn() }));
vi.mock("./rail-add-folder", () => ({ rememberOnRail: vi.fn(), addFolderToRail: vi.fn() }));
vi.mock("./worktree-card-row", () => ({ whereOf: () => "repo · main" }));
vi.mock("./controls/deck-icon", () => ({ ROW_ICON: 14, DeckIcon: () => <span /> }));

import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import type { RailStreamGroup } from "./agent-rail-model";
import { RailCreate } from "./rail-create";
import type { CardActions } from "./worktree-card-menus";

const STREAM = [
  {
    project: "repo",
    worktrees: [{ active: true, labelled: true, path: "/r/main", repositoryPath: "/r/main" }],
  },
] as unknown as readonly RailStreamGroup[];

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
});

function mount(stream: readonly RailStreamGroup[]): void {
  act(() => {
    render(<RailCreate variant="column" stream={stream} onOpenBoard={() => {}} />, host);
  });
}

describe("RailCreate worktree target (ROW-C1, ROW-C7)", () => {
  it("names the focused project in the Worktree tooltip", () => {
    mount(STREAM);
    const button = host.querySelector('.rail-create__button[data-verb="worktree"]');

    expect(button?.getAttribute("aria-label") ?? button?.getAttribute("title")).toBe(
      "New worktree in repo",
    );
  });

  it("falls back to plain copy with no repository", () => {
    mount([]);
    const button = host.querySelector('.rail-create__button[data-verb="worktree"]');

    expect(button?.getAttribute("aria-label") ?? button?.getAttribute("title")).toBe(
      "New worktree",
    );
  });
});

describe("RailCreate Agent button and the stage launcher", () => {
  function pinHost(isDevelopment: boolean): void {
    vi.stubGlobal("__deckHost", {});
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
  }
  const cardActions = (onOpenAgentLauncher: CardActions["onOpenAgentLauncher"]): CardActions => ({
    agents: [],
    agentsResolved: true,
    onRunAgent: () => {},
    onSplitHere: () => {},
    onOpenAgentLauncher,
  });
  function pressAgent(stream: readonly RailStreamGroup[], actions: CardActions): () => number {
    const onOpenBoard = vi.fn();
    act(() => {
      render(
        <RailCreate variant="column" stream={stream} actions={actions} onOpenBoard={onOpenBoard} />,
        host,
      );
    });
    act(() => {
      host.querySelector<HTMLElement>('.rail-create__button[data-verb="agent"]')?.click();
    });
    return () => onOpenBoard.mock.calls.length;
  }

  it("opens the launcher on the focused checkout", () => {
    pinHost(true);
    const open = vi.fn();
    const boardOpens = pressAgent(STREAM, cardActions(open));
    expect(open).toHaveBeenCalledExactlyOnceWith("/r/main");
    expect(boardOpens()).toBe(0);
  });

  it("opens the launcher with no checkout to name when the switch is on, not the board", () => {
    pinHost(true);
    const open = vi.fn();
    const boardOpens = pressAgent([], cardActions(open));
    expect(open).toHaveBeenCalledExactlyOnceWith(null);
    expect(boardOpens()).toBe(0);
  });

  it("keeps raising the board with no checkout to name when the switch is off", () => {
    pinHost(false);
    const open = vi.fn();
    const boardOpens = pressAgent([], cardActions(open));
    expect(open).not.toHaveBeenCalled();
    expect(boardOpens()).toBe(1);
  });
});
