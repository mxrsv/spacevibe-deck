// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same stubs as open-board.removal.test.tsx: the board pulls Tauri-backed
// stores and IPC in through its imports, so they have to answer under jsdom.
const missingPaths = new Set<string>();
const saved: unknown[] = [];
vi.mock("@tauri-apps/plugin-store", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async (_key: string, value: unknown) => {
        saved.push(value);
      }),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
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
const ROW_HEIGHT = 40;

function seed(paths: readonly string[]): void {
  const recents: RecentWorkspace[] = paths.map((path, index) => ({
    path,
    lastOpenedAt: NOW - index,
  }));
  workspacesData.value = { version: WORKSPACES_VERSION, recents };
}

describe("OpenBoard reorder flow", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
    missingPaths.clear();
    saved.length = 0;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
    presetsData.value = { version: PRESETS_VERSION, presets: [] };
    resetDesktopEnvironmentForTests();
  });

  const mount = async (): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          canCancel={false}
          onCancel={() => {}}
          onOpen={async () => true}
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

  const rows = (): HTMLLIElement[] => [
    ...host.querySelectorAll<HTMLLIElement>("li.row"),
  ];

  const rowNames = (): string[] =>
    [...host.querySelectorAll(".row .row__name")].map(
      (el) => el.textContent ?? "",
    );

  const storedPaths = (): string[] =>
    workspacesData.value.recents.map((entry) => entry.path);

  /**
   * jsdom has no DragEvent and lays nothing out, so a MouseEvent under the
   * drag name carries the pointer position (Preact dispatches by name) and
   * each row is given a box: which half `clientY` falls in is the whole
   * before/after decision under test.
   */
  const dragEvent = async (
    row: HTMLLIElement,
    type: "dragstart" | "dragover" | "drop" | "dragend",
    clientY = 0,
  ): Promise<void> => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientY,
    });
    // A real drag always carries one; jsdom's MouseEvent does not, and the
    // board writes to it.
    Object.defineProperty(event, "dataTransfer", {
      value: { setData: () => {}, effectAllowed: "none", dropEffect: "none" },
    });
    await act(async () => {
      row.dispatchEvent(event);
    });
  };

  const layOut = (): void => {
    rows().forEach((row, index) => {
      row.getBoundingClientRect = () =>
        ({
          top: index * ROW_HEIGHT,
          bottom: (index + 1) * ROW_HEIGHT,
          height: ROW_HEIGHT,
          left: 0,
          right: 200,
          width: 200,
          x: 0,
          y: index * ROW_HEIGHT,
          toJSON: () => ({}),
        }) as DOMRect;
    });
  };

  it("drags a row onto the lower half of another and drops it below", async () => {
    seed(["/w/alpha", "/w/beta", "/w/gamma"]);
    await mount();
    layOut();

    await dragEvent(rows()[0], "dragstart");
    // gamma spans 80–120; 110 is its lower half → alpha lands after it.
    await dragEvent(rows()[2], "dragover", 110);
    expect(
      host.querySelector(".row.is-drop-after .row__name")?.textContent,
    ).toBe("gamma");
    await dragEvent(rows()[2], "drop", 110);

    expect(rowNames()).toEqual(["beta", "gamma", "alpha"]);
    expect(storedPaths()).toEqual(["/w/beta", "/w/gamma", "/w/alpha"]);
  });

  it("dropping on the upper half inserts above the target", async () => {
    seed(["/w/alpha", "/w/beta", "/w/gamma"]);
    await mount();
    layOut();

    await dragEvent(rows()[2], "dragstart");
    // beta spans 40–80; 45 is its upper half → gamma lands before it.
    await dragEvent(rows()[1], "dragover", 45);
    expect(
      host.querySelector(".row.is-drop-before .row__name")?.textContent,
    ).toBe("beta");
    await dragEvent(rows()[1], "drop", 45);

    expect(rowNames()).toEqual(["alpha", "gamma", "beta"]);
  });

  it("an abandoned drag leaves the order and the markers alone", async () => {
    seed(["/w/alpha", "/w/beta"]);
    await mount();
    layOut();

    await dragEvent(rows()[0], "dragstart");
    await dragEvent(rows()[1], "dragover", 70);
    expect(host.querySelector(".row.is-dragging")).not.toBeNull();

    await dragEvent(rows()[0], "dragend");

    expect(host.querySelector(".row.is-dragging")).toBeNull();
    expect(host.querySelector(".row.is-drop-after")).toBeNull();
    expect(storedPaths()).toEqual(["/w/alpha", "/w/beta"]);
    expect(saved).toHaveLength(0);
  });

  it("missing rows are neither draggable nor a drop destination", async () => {
    seed(["/w/alpha", "/w/ghost"]);
    missingPaths.add("/w/ghost");
    await mount();
    layOut();

    const ghost = rows().find(
      (row) => row.querySelector(".row__name")?.textContent === "ghost",
    );
    expect(ghost?.getAttribute("draggable")).toBe("false");

    await dragEvent(rows()[0], "dragstart");
    await dragEvent(ghost as HTMLLIElement, "dragover", 70);
    expect(host.querySelector(".row.is-drop-after")).toBeNull();
    expect(host.querySelector(".row.is-drop-before")).toBeNull();
  });

  it("⌥↓ moves the selected row down and keeps it selected", async () => {
    seed(["/w/alpha", "/w/beta", "/w/gamma"]);
    await mount();

    await keydown({ key: "ArrowDown", altKey: true });

    expect(rowNames()).toEqual(["beta", "alpha", "gamma"]);
    expect(storedPaths()).toEqual(["/w/beta", "/w/alpha", "/w/gamma"]);
    // Selection follows the folder, so holding ⌥↓ walks it further down.
    expect(host.querySelector(".row.is-selected .row__name")?.textContent).toBe(
      "alpha",
    );

    await keydown({ key: "ArrowDown", altKey: true });
    expect(rowNames()).toEqual(["beta", "gamma", "alpha"]);
  });

  it("⌥↑ at the top of the list does nothing", async () => {
    seed(["/w/alpha", "/w/beta"]);
    await mount();

    await keydown({ key: "ArrowUp", altKey: true });

    expect(rowNames()).toEqual(["alpha", "beta"]);
    expect(saved).toHaveLength(0);
  });

  it("plain ↑↓ still moves the selection, not the row", async () => {
    seed(["/w/alpha", "/w/beta"]);
    await mount();

    await keydown({ key: "ArrowDown" });

    expect(rowNames()).toEqual(["alpha", "beta"]);
    expect(host.querySelector(".row.is-selected .row__name")?.textContent).toBe(
      "beta",
    );
  });

  it("⌥↓ cannot push a live row into the Missing group", async () => {
    seed(["/w/alpha", "/w/ghost"]);
    missingPaths.add("/w/ghost");
    await mount();

    await keydown({ key: "ArrowDown", altKey: true });

    expect(storedPaths()).toEqual(["/w/alpha", "/w/ghost"]);
    expect(saved).toHaveLength(0);
  });
});
