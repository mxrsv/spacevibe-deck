// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub set as open-board.views.test.tsx, plus a mocked worktree-host —
// the one facade this file exists to exercise.
const missingPaths = new Set<string>();
let pickedFolder: string | null = null;
vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../host/dialog-host", () => ({
  open: vi.fn(async () => pickedFolder),
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => {
    throw new Error("OpenBoard must use the initialized desktop environment");
  }),
}));
vi.mock("../host/bridge", () => ({
  invoke: vi.fn(async (cmd: string, args?: { paths?: string[] }) => {
    if (cmd === "dirs_exist") {
      return (args?.paths ?? []).map((path) => !missingPaths.has(path));
    }
    return null;
  }),
}));
vi.mock("../terminal/pty-client", () => ({
  defaultPtyClient: { detectAgents: vi.fn(async () => []) },
}));

const addWorktreeMock = vi.fn();
vi.mock("../host/worktree-host", () => ({
  available: true,
  addWorktree: (...args: unknown[]) => addWorktreeMock(...args),
}));

import { WORKSPACES_VERSION } from "../lib/workspace-recents";
import type { RecentWorkspace } from "../lib/workspace-recents";
import { PRESETS_VERSION } from "../lib/preset-schema";
import { presetsData } from "../presets/presets-store";
import { workspacesData } from "./workspaces-store";
import { OpenBoard } from "./open-board";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
} from "../lib/platform";
import { resetAgentDetectionForTests } from "../terminal/agent-detection-store";

const NOW = 1_800_000_000_000;

function seed(paths: readonly string[]): void {
  const recents: RecentWorkspace[] = paths.map((path, index) => ({
    path,
    lastOpenedAt: NOW - index,
  }));
  workspacesData.value = { version: WORKSPACES_VERSION, recents };
}

/**
 * Drain the open path's awaits before asserting.
 *
 * One click opens, and `openWorkspace` awaits the agent probe AND the
 * `dirs_exist` liveness pass before it reaches `onOpen`. A bare `act` returns
 * while those are still in flight, so an assertion could read the board
 * mid-click.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("OpenBoard create-worktree flow", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    // The probe is cached in a module store now, so a list one test detected
    // would otherwise answer for the next one.
    resetAgentDetectionForTests();
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    missingPaths.clear();
    pickedFolder = null;
    addWorktreeMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
    presetsData.value = { version: PRESETS_VERSION, presets: [] };
    resetDesktopEnvironmentForTests();
  });

  const mount = async (
    onOpen: (
      workspace: string,
      preset: { id: string },
      agent: string | null,
    ) => Promise<boolean> = async () => true,
  ): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          canCancel={true}
          onCancel={() => {}}
          onOpen={onOpen}
          recentSessions={[]}
          onResumeSession={() => {}}
        />,
        host,
      );
    });
  };

  it("shows Create worktree on the home view when the host capability is available", async () => {
    await mount();
    expect(
      [...host.querySelectorAll(".home-action")].some((el) =>
        el.textContent?.includes("Create worktree"),
      ),
    ).toBe(true);
  });

  it("opens the worktree form and prefills the destination from repo + branch", async () => {
    seed(["/Users/dev/deck"]);
    await mount();

    const createButton = [...host.querySelectorAll(".home-action")].find((el) =>
      el.textContent?.includes("Create worktree"),
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
    });
    expect(host.querySelector(".board-worktree")).not.toBeNull();

    const repoSelect = host.querySelector<HTMLSelectElement>("#wtf-repo");
    await act(async () => {
      repoSelect!.value = "/Users/dev/deck";
      repoSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const branchInput = host.querySelector<HTMLInputElement>("#wtf-branch");
    await act(async () => {
      branchInput!.value = "redesign";
      branchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const destInput = host.querySelector<HTMLInputElement>("#wtf-dest");
    expect(destInput?.value).toBe("/Users/dev/deck-worktrees/redesign");
  });

  it("does not overwrite a manually edited destination", async () => {
    seed(["/Users/dev/deck"]);
    await mount();

    const createButton = [...host.querySelectorAll(".home-action")].find((el) =>
      el.textContent?.includes("Create worktree"),
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
    });

    const repoSelect = host.querySelector<HTMLSelectElement>("#wtf-repo");
    await act(async () => {
      repoSelect!.value = "/Users/dev/deck";
      repoSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const destInput = host.querySelector<HTMLInputElement>("#wtf-dest");
    await act(async () => {
      destInput!.value = "/somewhere/else";
      destInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const branchInput = host.querySelector<HTMLInputElement>("#wtf-branch");
    await act(async () => {
      branchInput!.value = "redesign";
      branchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(host.querySelector<HTMLInputElement>("#wtf-dest")?.value).toBe(
      "/somewhere/else",
    );
  });

  it("shows friendly error copy when addWorktree fails, never raw git text", async () => {
    seed(["/Users/dev/deck"]);
    addWorktreeMock.mockResolvedValue({
      ok: false,
      error: "branch-exists",
    });
    await mount();

    const createButton = [...host.querySelectorAll(".home-action")].find((el) =>
      el.textContent?.includes("Create worktree"),
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
    });
    const repoSelect = host.querySelector<HTMLSelectElement>("#wtf-repo");
    await act(async () => {
      repoSelect!.value = "/Users/dev/deck";
      repoSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const branchInput = host.querySelector<HTMLInputElement>("#wtf-branch");
    await act(async () => {
      branchInput!.value = "redesign";
      branchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = host.querySelector<HTMLButtonElement>(".btn--primary");
    await act(async () => {
      submit?.click();
    });

    expect(addWorktreeMock).toHaveBeenCalledWith({
      repoPath: "/Users/dev/deck",
      branch: "redesign",
      destPath: "/Users/dev/deck-worktrees/redesign",
    });
    const notice = host.querySelector(".wtf__error");
    expect(notice?.textContent).toBe("A branch with that name already exists");
    expect(notice?.textContent).not.toContain("fatal:");
  });

  it("success opens the new worktree straight through", async () => {
    seed(["/Users/dev/deck"]);
    addWorktreeMock.mockResolvedValue({
      ok: true,
      path: "/Users/dev/deck-worktrees/redesign",
    });
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    const createButton = [...host.querySelectorAll(".home-action")].find((el) =>
      el.textContent?.includes("Create worktree"),
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
    });
    const repoSelect = host.querySelector<HTMLSelectElement>("#wtf-repo");
    await act(async () => {
      repoSelect!.value = "/Users/dev/deck";
      repoSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const branchInput = host.querySelector<HTMLInputElement>("#wtf-branch");
    await act(async () => {
      branchInput!.value = "redesign";
      branchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = host.querySelector<HTMLButtonElement>(".btn--primary");
    await act(async () => {
      submit?.click();
    });

    await settle();

    // A freshly created worktree has no remembered combo, so it opens with
    // the default preset and whatever the probe found (nothing → Shell).
    expect(onOpen).toHaveBeenCalledWith(
      "/Users/dev/deck-worktrees/redesign",
      expect.anything(),
      null,
    );
  });

  it("Escape in the worktree view returns home before it cancels the board", async () => {
    await mount();

    const createButton = [...host.querySelectorAll(".home-action")].find((el) =>
      el.textContent?.includes("Create worktree"),
    ) as HTMLButtonElement;
    await act(async () => {
      createButton.click();
    });
    expect(host.querySelector(".board-worktree")).not.toBeNull();

    const board = host.querySelector<HTMLDivElement>(".open-board");
    await act(async () => {
      board?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });

    expect(host.querySelector(".board-home")).not.toBeNull();
    expect(host.querySelector(".board-worktree")).toBeNull();
  });
});
