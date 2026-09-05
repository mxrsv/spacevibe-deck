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
import {
  detectedAgents,
  resetAgentDetectionForTests,
} from "../terminal/agent-detection-store";
import { settings } from "../settings/settings-store";

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

describe("OpenBoard home view", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    // The probe is cached in a module store now, so a list one test detected
    // would otherwise answer for the next one.
    resetAgentDetectionForTests();
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
    settings.value = { ...settings.value, disabledAgents: [], customAgents: [] };
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
    props: {
      canCancel?: boolean;
      canBrowseSessions?: boolean;
      openWorkspacePaths?: ReadonlySet<string>;
      onManageAgents?: () => void;
    } = {},
  ): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          canCancel={props.canCancel ?? false}
          canBrowseSessions={props.canBrowseSessions ?? false}
          openWorkspacePaths={props.openWorkspacePaths ?? new Set()}
          onCancel={() => {}}
          onOpen={onOpen}
          onManageAgents={props.onManageAgents ?? (() => {})}
          onResumeSession={async () => true}
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

  it("home view renders the logo, Start action, and grouped recents — Create worktree stays hidden while its capability gate resolves false", async () => {
    seed(["/w/alpha", "/w/ghost"]);
    missingPaths.add("/w/ghost");
    await mount();

    expect(host.querySelector(".board-home")).not.toBeNull();
    expect(
      host.querySelector(".board-home img[alt='SpaceVibe Deck']"),
    ).not.toBeNull();
    expect(host.querySelector(".home-action")?.textContent).toContain(
      "Open workspace",
    );
    expect(
      [...host.querySelectorAll(".home-action")].some((el) =>
        el.textContent?.includes("Create worktree"),
      ),
    ).toBe(false);
    expect(
      [...host.querySelectorAll(".row .row__name")].map((el) => el.textContent),
    ).toEqual(["alpha"]);
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

    const row = host.querySelector<HTMLButtonElement>(".row__open");
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

  it("states the substitution instead of quietly running the wrong agent", async () => {
    // The bug this covers: the row printed a remembered agent unconditionally
    // and then opened whatever stood first on `$PATH` if that agent was gone.
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    // Said on the row, before anything is clicked.
    expect(host.querySelector(".row__stale")?.textContent).toContain(
      "Not installed",
    );

    const row = host.querySelector<HTMLButtonElement>(".row__open");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(onOpen).not.toHaveBeenCalled();
    const decision = host.querySelector(".board-home__decision");
    expect(decision?.getAttribute("role")).toBe("alert");
    // Both halves: what cannot run, and what would run instead.
    expect(decision?.textContent).toContain("Claude Code is not installed");
    expect(decision?.textContent).toContain("Codex");

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".board-home__decision-go")?.click();
    });
    await settle();

    expect(onOpen).toHaveBeenCalledWith(
      "/w/beta",
      expect.anything(),
      "codex",
    );
  });

  it("offers the agent catalog instead of the substitute, and drops the question", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    const onManageAgents = vi.fn();
    await mount(onOpen, { onManageAgents });

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".board-home__decision-fix")
        ?.click();
    });

    expect(onManageAgents).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    // The answer it was built from is exactly what the user left to change.
    expect(host.querySelector(".board-home__decision")).toBeNull();
  });

  it("says the plain shell before opening one on a machine with no agent CLI", async () => {
    seed(["/w/alpha"]);
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".board-home__decision")?.textContent).toContain(
      "No agent CLI was found",
    );

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".board-home__decision-go")?.click();
    });
    await settle();

    expect(onOpen).toHaveBeenCalledWith("/w/alpha", expect.anything(), null);
  });

  it("a remembered Shell-only open is not a substitution and never asks", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: null }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    expect(host.querySelector(".row__stale")).toBeNull();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(host.querySelector(".board-home__decision")).toBeNull();
    expect(onOpen).toHaveBeenCalledWith("/w/beta", expect.anything(), null);
  });

  it("an agent switched off in Settings is a substitution too", async () => {
    detected = [
      { name: "claude", path: "/usr/local/bin/claude" },
      { name: "codex", path: "/usr/local/bin/codex" },
    ];
    settings.value = { ...settings.value, disabledAgents: ["claude"] };
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(onOpen).not.toHaveBeenCalled();
    // Not "is not installed": the binary IS there, and the two are fixed by
    // different controls on the screen `Manage agents…` opens.
    expect(host.querySelector(".board-home__decision")?.textContent).toContain(
      "Claude Code is switched off in Settings",
    );
    expect(host.querySelector(".row__stale")?.textContent).toContain("Turned off");
  });

  it("a declared agent whose binary is gone is not runnable either", async () => {
    // `agentOptions` DROPS an undetected built-in but KEEPS a declared agent,
    // flagging it `missing` — a display rule AgentQuickPicker needs. Read as a
    // launch rule it would resolve `chosen` and open `command not found`.
    settings.value = {
      ...settings.value,
      customAgents: [{ id: "custom:mine", label: "My Agent", command: "myagent --go" }],
    };
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "custom:mine" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    expect(host.querySelector(".row__stale")?.textContent).toContain("Not installed");

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".board-home__decision")?.textContent).toContain(
      "My Agent is not installed",
    );
  });

  it("a declared agent whose binary IS there still runs", async () => {
    settings.value = {
      ...settings.value,
      customAgents: [{ id: "custom:mine", label: "My Agent", command: "myagent --go" }],
    };
    detected = [{ name: "myagent", path: "/usr/local/bin/myagent" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "custom:mine" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    expect(host.querySelector(".row__stale")).toBeNull();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(host.querySelector(".board-home__decision")).toBeNull();
    expect(onOpen).toHaveBeenCalledWith("/w/beta", expect.anything(), "custom:mine");
  });

  it("probes the folder again when the question is answered, not just at mount", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.querySelector(".board-home__decision")).not.toBeNull();

    // The folder goes away while the question stands. `missing` is keyed on
    // the recents list and nothing changed it, so only a FRESH probe can see
    // this — which is the whole point: this question outlives its answer.
    missingPaths.add("/w/beta");

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".board-home__decision-go")?.click();
    });
    await settle();

    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".board-home__notice")?.textContent).toContain(
      "beta is missing",
    );
  });

  it("re-reads discovery on each click, so fixing it in Settings takes effect", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();
    expect(host.querySelector(".row__stale")).not.toBeNull();

    // What Settings' own Refresh does: the shared store is the board's source,
    // and this board is still mounted underneath Settings.
    act(() => {
      detectedAgents.value = [
        { name: "claude", path: "/usr/local/bin/claude" },
        { name: "codex", path: "/usr/local/bin/codex" },
      ];
    });
    expect(host.querySelector(".row__stale")).toBeNull();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // No question at all now — the remembered agent runs.
    expect(host.querySelector(".board-home__decision")).toBeNull();
    expect(onOpen).toHaveBeenCalledWith("/w/beta", expect.anything(), "claude");
  });

  it("a missing folder replaces the question rather than standing beside it", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    missingPaths.add("/w/ghost");
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" },
        { path: "/w/ghost", lastOpenedAt: NOW - 1 },
      ],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.querySelector(".board-home__decision")).not.toBeNull();

    act(() => {
      host
        .querySelector<HTMLButtonElement>(".board-home__missing-toggle")
        ?.click();
    });
    const rows = host.querySelectorAll<HTMLButtonElement>(".row__open");
    await act(async () => {
      rows[rows.length - 1]?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    await settle();

    // One message slot: the held launch is gone, not sitting under the notice
    // where `Open anyway` would open a workspace nothing on screen names.
    expect(host.querySelector(".board-home__decision")).toBeNull();
    expect(host.querySelector(".board-home__notice")?.textContent).toContain(
      "ghost is missing",
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("removing the row the question is about drops the question", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.querySelector(".board-home__decision")).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".row__x")?.click();
    });

    expect(host.querySelector(".board-home__decision")).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("a confirmed open re-checks the folder it was asked about", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.querySelector(".board-home__decision")).not.toBeNull();

    // The folder goes away while the question stands — the recents effect
    // keeps refreshing `missing` underneath it.
    missingPaths.add("/w/beta");
    await act(async () => {
      workspacesData.value = {
        version: WORKSPACES_VERSION,
        recents: [
          { path: "/w/beta", lastOpenedAt: NOW + 1, lastAgent: "claude" },
        ],
      };
    });
    await settle();

    await act(async () => {
      host.querySelector<HTMLButtonElement>(".board-home__decision-go")?.click();
    });
    await settle();

    expect(onOpen).not.toHaveBeenCalled();
    expect(host.querySelector(".board-home__notice")?.textContent).toContain(
      "beta is missing",
    );
  });

  it("clicking another row replaces the question rather than stacking one", async () => {
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" },
        { path: "/w/gamma", lastOpenedAt: NOW - 1, lastAgent: "codex" },
      ],
    };
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);
    await settle();

    const rows = host.querySelectorAll<HTMLButtonElement>(".row__open");
    await act(async () => {
      rows[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(host.querySelector(".board-home__decision")).not.toBeNull();

    await act(async () => {
      rows[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // The second row runs its own remembered agent and the held launch for
    // the first one is gone with it — a stale `Open anyway` must never be
    // able to open a workspace nobody is looking at.
    expect(host.querySelector(".board-home__decision")).toBeNull();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("/w/gamma", expect.anything(), "codex");
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

    const row = host.querySelector<HTMLButtonElement>(".row__open");
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

    const disclosure = host.querySelector<HTMLButtonElement>(
      ".board-home__missing-toggle",
    );
    act(() => disclosure?.click());
    const row = host.querySelector<HTMLButtonElement>(".row__open");
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
    // An agent the probe finds, so this click reaches the spawn: a board with
    // nothing on `$PATH` now states the plain-shell fallback and waits, which
    // is a different message with its own test below.
    detected = [{ name: "claude", path: "/usr/bin/claude" }];
    const onOpen = vi.fn(async () => false);
    await mount(onOpen);

    const row = host.querySelector<HTMLButtonElement>(".row__open");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const notice = host.querySelector(".board-home__notice");
    expect(notice?.getAttribute("role")).toBe("status");
    expect(notice?.textContent).toContain("Couldn't start a shell here");
  });

  it("opens session history as a dedicated subview and Escape returns Home", async () => {
    await mount(undefined, { canBrowseSessions: true });

    act(() => {
      host.querySelector<HTMLButtonElement>(".board-home__resume")?.click();
    });
    expect(host.querySelector(".board-sessions")).not.toBeNull();
    expect(host.querySelector(".board-home")).toBeNull();

    await keydown({ key: "Escape" });
    expect(host.querySelector(".board-sessions")).toBeNull();
    expect(host.querySelector(".board-home")).not.toBeNull();
  });

  it("Escape cancels the board from home", async () => {
    seed(["/w/alpha"]);
    const onCancel = vi.fn();
    await act(async () => {
      render(
        <OpenBoard
          canCancel={true}
          canBrowseSessions={false}
          openWorkspacePaths={new Set()}
          onCancel={onCancel}
          onOpen={async () => true}
          onManageAgents={() => {}}
          onResumeSession={async () => true}
        />,
        host,
      );
    });

    await keydown({ key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
