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
// `detectGate` lets a test hold the probe open past a click, which is the
// race one-click-opens introduced: a click that resolves its remembered agent
// against an empty list would quietly spawn a Shell instead.
let detected: { readonly name: string; readonly path: string }[] = [];
let detectGate: Promise<void> | null = null;
vi.mock("../terminal/pty-client", () => ({
  defaultPtyClient: {
    detectAgents: vi.fn(async () => {
      if (detectGate !== null) {
        await detectGate;
      }
      return detected;
    }),
  },
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

describe("OpenBoard home view", () => {
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
    detected = [];
    detectGate = null;
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
          recentSessions={[]}
          onResumeSession={() => {}}
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
    // The retired config view (2026-08-16) has no mount left anywhere.
    expect(host.querySelector(".board-config")).toBeNull();
    expect(host.querySelector(".achip")).toBeNull();
    expect(host.querySelector(".lgrid")).toBeNull();
  });

  it("empty recents renders no list — logo and buttons only", async () => {
    await mount();

    expect(host.querySelector(".board-home")).not.toBeNull();
    expect(host.querySelector(".home-action")).not.toBeNull();
    expect(host.querySelectorAll(".row")).toHaveLength(0);
    expect(host.querySelector(".board-home__recents")).toBeNull();
  });

  it("one click opens the recent with its remembered preset and agent", async () => {
    // Non-empty detection matters here: against an EMPTY list a dropped
    // `null` would fall back to `null` too, and the assertion below would
    // pass without proving the remembered Shell was carried at all.
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
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
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // `null` is a remembered Shell-only open and it is carried through — the
    // config view's "Shell is only ever an explicit click" rule went with it.
    expect(onOpen).toHaveBeenCalledWith(
      "/w/beta",
      expect.objectContaining({ id: "p-grid" }),
      null,
    );
  });

  it("waits for the agent probe before opening, so a fast click keeps its remembered agent", async () => {
    let release!: () => void;
    detectGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    const row = host.querySelector<HTMLLIElement>(".row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpen).not.toHaveBeenCalled();

    await act(async () => {
      release();
      await detectGate;
    });

    expect(onOpen).toHaveBeenCalledWith("/w/beta", expect.anything(), "claude");
  });

  it("a missing folder says so instead of opening nothing", async () => {
    seed(["/w/ghost"]);
    missingPaths.add("/w/ghost");
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    const row = host.querySelector<HTMLLIElement>(".row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".board-home__notice")?.textContent).toContain(
      "ghost is missing",
    );
  });

  it("a failed open is said on home — the board's only place to say it", async () => {
    seed(["/w/alpha"]);
    const onOpen = vi.fn(async () => false);
    await mount(onOpen);

    const row = host.querySelector<HTMLLIElement>(".row");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const notice = host.querySelector(".board-home__notice");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toContain("Couldn't start a shell here");
  });

  it("Escape cancels the board from home", async () => {
    seed(["/w/alpha"]);
    const onCancel = vi.fn();
    await act(async () => {
      render(
        <OpenBoard
          canCancel={true}
          onCancel={onCancel}
          onOpen={async () => true}
          recentSessions={[]}
          onResumeSession={() => {}}
        />,
        host,
      );
    });

    await keydown({ key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
