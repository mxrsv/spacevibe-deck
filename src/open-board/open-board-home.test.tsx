// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { OpenBoardHome, type OpenBoardHomeProps } from "./open-board-home";

const RECENT: RecentWorkspace = {
  path: "/Users/dev/deck",
  lastOpenedAt: Date.now() - 60_000,
  lastPresetId: "grid",
  lastAgent: "claude",
};

describe("OpenBoardHome start surface", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
  });

  function mount(overrides: Partial<OpenBoardHomeProps> = {}) {
    const handlers = {
      describeCombo: () => "Grid · Claude Code",
      onPickFolder: vi.fn(),
      onCreateWorktree: vi.fn(),
      onBrowseSessions: vi.fn(),
      onOpen: vi.fn(),
      onRemove: vi.fn(),
    };
    act(() => {
      render(
        <OpenBoardHome
          homeDir="/Users/dev"
          openFolderShortcut="⌘O"
          canCreateWorktree={true}
          canBrowseSessions={true}
          alive={[RECENT]}
          missingGroup={[]}
          openWorkspacePaths={new Set()}
          opening={false}
          notice={null}
          {...handlers}
          {...overrides}
        />,
        host,
      );
    });
    return handlers;
  }

  it("presents one primary start action and keeps history out of the home list", () => {
    mount();

    expect(host.querySelector("h1")?.textContent).toBe("Start a workspace");
    expect(host.querySelector(".home-action--primary")?.textContent).toContain("Open workspace");
    expect(host.querySelector(".home-action--secondary")?.textContent).toContain("Create worktree");
    expect(host.querySelector(".board-home__resume")?.textContent).toContain(
      "Resume a previous session",
    );
    expect(host.textContent).not.toContain("Recent sessions");
  });

  it("omits capability-backed actions instead of disabling promises", () => {
    mount({ canCreateWorktree: false, canBrowseSessions: false });

    expect(host.textContent).not.toContain("Create worktree");
    expect(host.textContent).not.toContain("Resume a previous session");
  });

  it("shows the remembered combo and already-open state without hover", () => {
    mount({ openWorkspacePaths: new Set([RECENT.path]) });

    expect(host.querySelector(".row__combo")?.textContent).toBe("Grid · Claude Code");
    expect(host.querySelector(".row__state")?.textContent).toBe("Open");
    expect(host.querySelector(".row__open")?.getAttribute("aria-label")).toContain(
      "Start another session in deck",
    );
  });

  it("uses a native button for keyboard activation", () => {
    const handlers = mount();
    const open = host.querySelector<HTMLButtonElement>(".row__open");

    act(() => {
      open?.click();
    });

    expect(open?.tagName).toBe("BUTTON");
    expect(handlers.onOpen).toHaveBeenCalledWith(RECENT.path);
  });

  it("announces a pending open and disables competing start actions", () => {
    mount({ opening: true });

    expect(host.querySelector(".board-home")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector(".board-home__opening")?.textContent).toContain("Opening workspace");
    expect(host.querySelector<HTMLButtonElement>(".row__open")?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".home-action--primary")?.disabled).toBe(true);
  });

  it("keeps missing workspaces collapsed until requested", () => {
    mount({ alive: [], missingGroup: [RECENT] });

    expect(host.querySelector(".row.is-missing")).toBeNull();
    const disclosure = host.querySelector<HTMLButtonElement>(".board-home__missing-toggle");
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");

    act(() => {
      disclosure?.click();
    });

    expect(host.querySelector(".row.is-missing")).not.toBeNull();
    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
  });
});
