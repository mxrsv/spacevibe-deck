// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The board pulls Tauri-backed stores and IPC in through its imports; stub
// them so the tree mounts under jsdom, mirroring workspace-sidebar.test.tsx.
// `missingPaths` steers the dirs_exist answer per test.
const missingPaths = new Set<string>();
let pickedFolder: string | null = null;
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => pickedFolder),
}));
vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => {
    throw new Error("OpenBoard must use the initialized desktop environment");
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
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

describe("OpenBoard removal flow", () => {
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
    onOpen: () => Promise<boolean> = async () => true,
  ): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          canCancel={false}
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

  const rowNames = (): string[] =>
    [...host.querySelectorAll(".row .row__name")].map(
      (el) => el.textContent ?? "",
    );

  it("draws the folder, remove and new-layout actions as icons", async () => {
    seed(["/w/alpha"]);
    await mount();

    expect(host.querySelector(".row__ico.lucide-folder-open")).not.toBeNull();
    expect(host.querySelector(".openfolder .lucide-folder-plus")).not.toBeNull();

    const x = host.querySelector<HTMLButtonElement>(".row.is-selected .row__x");
    // Removing a recent forgets a pointer; it deletes nothing on disk, so it
    // is a dismissal (X), not a trash can.
    expect(x?.querySelector(".lucide-x")).not.toBeNull();
    expect(x?.textContent).toBe("");
    expect(host.querySelector(".lcard--new .lucide-plus")).not.toBeNull();
  });

  it("removing the selected recent moves selection to the next row", async () => {
    seed(["/w/alpha", "/w/beta", "/w/gamma"]);
    await mount();
    expect(rowNames()).toEqual(["alpha", "beta", "gamma"]);

    const x = host.querySelector<HTMLButtonElement>(".row.is-selected .row__x");
    expect(x).not.toBeNull();
    await act(async () => {
      x?.click();
    });

    // The removed path must not resurrect as a fabricated "picked" entry.
    expect(rowNames()).toEqual(["beta", "gamma"]);
    expect(host.querySelector(".row.is-selected .row__name")?.textContent).toBe(
      "beta",
    );
  });

  it("uses the initialized Windows home directory for display", async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: "C:/Users/dev",
    });
    seed(["C:/Users/dev/repo"]);

    await mount();

    expect(host.querySelector(".row__path")?.textContent).toBe("~/repo");
  });

  it("remove-all missing clears the group", async () => {
    seed(["/w/ghost", "/w/wraith"]);
    missingPaths.add("/w/ghost").add("/w/wraith");
    await mount();

    const removeAll = host.querySelector<HTMLButtonElement>(".gsep button");
    expect(removeAll?.textContent).toBe("Remove 2");
    await act(async () => {
      removeAll?.click();
    });

    expect(host.querySelector(".gsep")).toBeNull();
    expect(host.querySelectorAll(".row")).toHaveLength(0);
  });

  it("Backspace on the workspace section removes the selected recent", async () => {
    seed(["/w/alpha", "/w/beta"]);
    await mount();

    await keydown({ key: "Backspace" });

    expect(rowNames()).toEqual(["beta"]);
    expect(host.querySelector(".row.is-selected .row__name")?.textContent).toBe(
      "beta",
    );
  });

  it("double-clicking a row's × removes without opening the workspace", async () => {
    seed(["/w/alpha", "/w/beta"]);
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    const x = host.querySelector<HTMLButtonElement>(".row.is-selected .row__x");
    await act(async () => {
      x?.click();
    });
    // Second rapid click on the same spot fires a dblclick on the × of the
    // row that moved up — it must not bubble into the row's open handler.
    const nextX = host.querySelector<HTMLButtonElement>(
      ".row.is-selected .row__x",
    );
    await act(async () => {
      nextX?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it("Backspace does not discard a just-picked folder that is not a recent yet", async () => {
    seed(["/w/alpha"]);
    pickedFolder = "/w/fresh";
    await mount();

    await keydown({ key: "o", metaKey: true }); // ⌘O → picks /w/fresh
    expect(rowNames()).toEqual(["fresh", "alpha"]);

    await keydown({ key: "Backspace" });

    // The pick survives, stays selected, and the store is untouched.
    expect(rowNames()).toEqual(["fresh", "alpha"]);
    expect(host.querySelector(".row.is-selected .row__name")?.textContent).toBe(
      "fresh",
    );
    expect(workspacesData.value.recents.map((r) => r.path)).toEqual([
      "/w/alpha",
    ]);
  });

  it("opens the folder picker with Ctrl+Shift+O on Windows", async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: "windows",
      homeDir: String.raw`C:\Users\dev`,
    });
    pickedFolder = String.raw`C:\work`;
    await mount();

    expect(host.querySelector(".openfolder kbd")?.textContent).toBe(
      "Ctrl+Shift+O",
    );
    await keydown({ key: "o", ctrlKey: true });
    expect(rowNames()).toEqual([]);

    await keydown({ key: "O", ctrlKey: true, shiftKey: true });
    expect(rowNames()).toHaveLength(1);
  });

  it("removal applies the next row's remembered preset/agent combo", async () => {
    presetsData.value = {
      version: PRESETS_VERSION,
      presets: [{ id: "p-grid", name: "Grid", layout: { type: "leaf" } }],
    };
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/w/alpha", lastOpenedAt: NOW },
        { path: "/w/beta", lastOpenedAt: NOW - 1, lastPresetId: "p-grid" },
      ],
    };
    await mount();
    // alpha remembers nothing → the default built-in preset starts selected.
    expect(
      host.querySelector(".lcard.is-selected .lcard__name")?.textContent,
    ).toBe("Single pane");

    await keydown({ key: "Backspace" }); // removes alpha, selects beta

    // selectWorkspace ran for beta: its remembered preset is now selected.
    expect(host.querySelector(".row.is-selected .row__name")?.textContent).toBe(
      "beta",
    );
    expect(
      host.querySelector(".lcard.is-selected .lcard__name")?.textContent,
    ).toBe("Grid");
  });
});
