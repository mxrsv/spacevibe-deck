// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same stub set as open-board.removal.test.tsx — the board pulls Tauri-backed
// stores and IPC in through its imports.
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

const NOW = 1_800_000_000_000;

function seed(paths: readonly string[]): void {
  const recents: RecentWorkspace[] = paths.map((path, index) => ({
    path,
    lastOpenedAt: NOW - index,
  }));
  workspacesData.value = { version: WORKSPACES_VERSION, recents };
}

describe("OpenBoard home/config views", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "macos",
      homeDir: "/Users/dev",
    });
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    missingPaths.clear();
    pickedFolder = null;
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
    props: { canCancel?: boolean } = {},
  ): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          canCancel={props.canCancel ?? false}
          onCancel={() => {}}
          onOpen={onOpen}
          onNewPreset={() => {}}
        />,
        host,
      );
    });
  };

  const keydown = async (init: KeyboardEventInit): Promise<void> => {
    const board = host.querySelector<HTMLDivElement>(".open-board");
    await act(async () => {
      board?.dispatchEvent(
        new KeyboardEvent("keydown", { ...init, bubbles: true }),
      );
    });
  };

  it("home view renders the logo, Open project, and grouped recents — Create worktree stays hidden while its capability gate resolves false", async () => {
    seed(["/w/alpha", "/w/ghost"]);
    missingPaths.add("/w/ghost");
    await mount();

    expect(host.querySelector(".board-home")).not.toBeNull();
    expect(
      host.querySelector(".board-home img[alt='SpaceVibe Deck']"),
    ).not.toBeNull();
    expect(host.querySelector(".home-action")?.textContent).toContain(
      "Open project",
    );
    expect(
      [...host.querySelectorAll(".home-action")].some((el) =>
        el.textContent?.includes("Create worktree"),
      ),
    ).toBe(false);
    expect(
      [...host.querySelectorAll(".row .row__name")].map((el) => el.textContent),
    ).toEqual(["alpha", "ghost"]);
    expect(host.querySelector(".gsep")).not.toBeNull();
    // Config-only surface must not be present on the default view.
    expect(host.querySelector(".board-config")).toBeNull();
  });

  it("empty recents renders no list — logo and buttons only", async () => {
    await mount();

    expect(host.querySelector(".board-home")).not.toBeNull();
    expect(host.querySelector(".home-action")).not.toBeNull();
    expect(host.querySelectorAll(".row")).toHaveLength(0);
    expect(host.querySelector(".board-home__recents")).toBeNull();
  });

  it("selecting a recent switches to config view with that path shown", async () => {
    seed(["/w/alpha"]);
    await mount();

    const row = host.querySelector<HTMLLIElement>(".row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector(".board-home")).toBeNull();
    expect(host.querySelector(".board-config")).not.toBeNull();
    expect(host.querySelector(".wshead__title")?.textContent).toBe("alpha");
  });

  it("back returns home", async () => {
    seed(["/w/alpha"]);
    await mount();

    const row = host.querySelector<HTMLLIElement>(".row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".board-config")).not.toBeNull();

    const back = host.querySelector<HTMLButtonElement>(".board-back");
    await act(async () => {
      back?.click();
    });

    expect(host.querySelector(".board-home")).not.toBeNull();
    expect(host.querySelector(".board-config")).toBeNull();
  });

  it("double-click calls onOpen with the remembered preset/agent", async () => {
    presetsData.value = {
      version: PRESETS_VERSION,
      presets: [{ id: "p-grid", name: "Grid", layout: { type: "leaf" } }],
    };
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        {
          path: "/w/beta",
          lastOpenedAt: NOW,
          lastPresetId: "p-grid",
          lastAgent: null,
        },
      ],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    const row = host.querySelector<HTMLLIElement>(".row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });

    expect(onOpen).toHaveBeenCalledWith(
      "/w/beta",
      expect.objectContaining({ id: "p-grid" }),
      null,
    );
  });

  it("Escape in config view returns to home before it cancels the board", async () => {
    seed(["/w/alpha"]);
    const onCancel = vi.fn();
    await act(async () => {
      render(
        <OpenBoard
          canCancel={true}
          onCancel={onCancel}
          onOpen={async () => true}
          onNewPreset={() => {}}
        />,
        host,
      );
    });

    const row = host.querySelector<HTMLLIElement>(".row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(host.querySelector(".board-config")).not.toBeNull();

    await keydown({ key: "Escape" });
    expect(host.querySelector(".board-home")).not.toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    await keydown({ key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
