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
import { newTaskDraft, resetLauncherStore } from "../launcher/launcher-store";
import { EMPTY_DRAFT, withWorkspace, type NewTaskDraft } from "../launcher/new-task-draft";
import type { LaunchTaskOutcome } from "../terminal/task-prompt-send";
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { resetAgentDetectionForTests } from "../terminal/agent-detection-store";
import { settings } from "../settings/settings-store";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";

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
    resetLauncherStore();
    missingPaths.clear();
    pickedFolder = null;
    detected = [];
    detectGate = null;
    settings.value = DEFAULT_SETTINGS;
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
    onStartTask: (draft: NewTaskDraft) => Promise<LaunchTaskOutcome> = async () => "sent",
    props: {
      canCancel?: boolean;
      canBrowseSessions?: boolean;
      openWorkspacePaths?: ReadonlySet<string>;
      contextWorkspacePath?: string | null;
    } = {},
  ): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          contextWorkspacePath={props.contextWorkspacePath ?? null}
          canCancel={props.canCancel ?? false}
          canBrowseSessions={props.canBrowseSessions ?? false}
          openWorkspacePaths={props.openWorkspacePaths ?? new Set()}
          onCancel={() => {}}
          onStartTask={onStartTask}
          onOpenAgent={onStartTask}
          onManageAgents={() => {}}
          onResumeSession={async () => true}
        />,
        host,
      );
    });
  };

  const keydown = async (init: KeyboardEventInit): Promise<void> => {
    const board = host.querySelector<HTMLDivElement>(".open-board");
    await act(async () => {
      board?.dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
    });
  };

  it("home view leads with the composer and groups recents — Create worktree stays hidden while its capability gate resolves false", async () => {
    seed(["/w/alpha", "/w/ghost"]);
    missingPaths.add("/w/ghost");
    await mount();

    expect(host.querySelector(".nt-board")).not.toBeNull();
    // The logo hero went with the old home view: the composer is the focal
    // artifact now (design §4.1), and its header is what names the surface.
    expect(host.querySelector("img[alt='SpaceVibe Deck']")).toBeNull();
    expect(host.querySelector(".nt-board__head h2")?.textContent).toContain("Start something new");
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(host.querySelector(".nt-board__shortcuts button")?.textContent).toContain("Open folder");
    expect(
      [...host.querySelectorAll(".nt-board__shortcuts button")].some((el) =>
        el.textContent?.includes("Create worktree"),
      ),
    ).toBe(false);
    expect([...host.querySelectorAll(".row .row__name")].map((el) => el.textContent)).toEqual([
      "alpha",
    ]);
    expect(host.querySelector(".gsep")).not.toBeNull();
    // The retired config view (2026-08-16) has no mount left anywhere.
    expect(host.querySelector(".board-config")).toBeNull();
    expect(host.querySelector(".achip")).toBeNull();
    expect(host.querySelector(".lgrid")).toBeNull();
  });

  it("empty recents renders no list — composer and shortcuts only", async () => {
    await mount();

    expect(host.querySelector(".nt-board")).not.toBeNull();
    expect(host.querySelector(".nt-board__shortcuts button")).not.toBeNull();
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
    const onStartTask = vi.fn(async () => "sent" as LaunchTaskOutcome);
    await mount(onStartTask);

    const row = host.querySelector<HTMLButtonElement>(".row__open");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // The seed resolution is two awaits deep (liveness, then the agent probe),
    // which is what `settle` exists for.
    await settle();

    // Reversed on purpose (design §4.1): the row fills the Workspace field and
    // nothing else. A remembered Shell-only open no longer starts anything,
    // because selecting a workspace is not a launch any more.
    expect(onStartTask).not.toHaveBeenCalled();
    expect(newTaskDraft.value.workspacePath).toBe("/w/beta");
  });

  it("seeds the remembered agent once the probe answers", async () => {
    let release!: () => void;
    detectGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" }],
    };
    await mount();

    const row = host.querySelector<HTMLButtonElement>(".row__open");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The probe still gates the answer, for the same reason it always did: an
    // empty agent list would resolve the seed to nothing.
    expect(newTaskDraft.value.agentId).toBeNull();

    await act(async () => {
      release();
      await detectGate;
    });
    await settle();

    expect(newTaskDraft.value.agentId).toBe("claude");
    expect(newTaskDraft.value.workspacePath).toBe("/w/beta");
  });

  it("puts the caret in the prompt, not on the board shell", async () => {
    // Quick Launch has always focused its textarea, and the two surfaces share
    // one draft: a board that asks "describe the outcome" and then drops every
    // keystroke was the odd one out (DL-32.1).
    seed(["/w/alpha"]);
    await mount();

    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("opens on the newest live workspace with its agent already chosen", async () => {
    // Spec §5 and §7. Before this the board opened with every field empty and
    // a red "Pick a folder to work in" over an untouched composer, while the
    // answer was sitting in the first row of its own recents list.
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [
        { path: "/w/beta", lastOpenedAt: NOW, lastAgent: "claude" },
        { path: "/w/alpha", lastOpenedAt: NOW - 1 },
      ],
    };
    await mount();
    await settle();

    expect(newTaskDraft.value.workspacePath).toBe("/w/beta");
    expect(newTaskDraft.value.agentId).toBe("claude");
    // Filling a field is not an event: the board says nothing about it.
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("does not seed a starred agent that is not on PATH", async () => {
    // Star an agent, uninstall it, open the board: seeding it anyway would
    // paint "That agent is not on your PATH" over an untouched composer —
    // the resting alarm this whole change exists to remove. Spec §7 falls to
    // the first runnable agent instead.
    detected = [{ name: "codex", path: "/usr/local/bin/codex" }];
    settings.value = { ...DEFAULT_SETTINGS, defaultAgent: "claude" };
    seed(["/w/alpha"]);
    await mount();
    await settle();

    expect(newTaskDraft.value.agentId).toBe("codex");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("passes over a workspace that is gone, and says nothing about it", async () => {
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
    seed(["/w/ghost", "/w/alpha"]);
    missingPaths.add("/w/ghost");
    await mount();
    await settle();

    expect(newTaskDraft.value.workspacePath).toBe("/w/alpha");
    // The missing-folder notice belongs to a folder the user PRESSED.
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("prefers the active tab's workspace over the newest recent", async () => {
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
    seed(["/w/alpha"]);
    await mount(undefined, { contextWorkspacePath: "/w/live" });
    await settle();

    expect(newTaskDraft.value.workspacePath).toBe("/w/live");
  });

  it("never overwrites a workspace the draft already names", async () => {
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
    seed(["/w/alpha"]);
    // A draft carried in from Quick Launch, or left from an abandoned attempt.
    newTaskDraft.value = withWorkspace(EMPTY_DRAFT, "/w/kept");
    await mount();
    await settle();

    expect(newTaskDraft.value.workspacePath).toBe("/w/kept");
  });

  it("a missing folder says so instead of selecting it", async () => {
    seed(["/w/ghost"]);
    missingPaths.add("/w/ghost");
    await mount();

    const disclosure = host.querySelector<HTMLButtonElement>(".board-home__missing-toggle");
    act(() => disclosure?.click());
    const row = host.querySelector<HTMLButtonElement>(".row__open");
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(newTaskDraft.value.workspacePath).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("ghost is missing");
  });

  it("a failed launch is said on the composer — its only place to say it", async () => {
    seed(["/w/alpha"]);
    // A launch needs a runnable agent, or the primary action is correctly
    // disabled and there is nothing to fail.
    detected = [{ name: "claude", path: "/usr/local/bin/claude" }];
    const onStartTask = vi.fn(async () => "spawn-failed" as LaunchTaskOutcome);
    await mount(onStartTask);

    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(".row__open")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    // `Open agent first` ignores the prompt, so this exercises the launch
    // path without also having to fill the composer.
    await act(async () => {
      host.querySelector<HTMLButtonElement>(".nt-secondary-action")?.click();
    });
    await settle();

    const notice = host.querySelector('[role="status"]');
    expect(notice?.textContent).toContain("Couldn't start a session here");
  });

  it("opens session history as a dedicated subview and Escape returns Home", async () => {
    await mount(undefined, { canBrowseSessions: true });

    act(() => {
      host.querySelector<HTMLButtonElement>(".nt-board__shortcuts button:last-child")?.click();
    });
    expect(host.querySelector(".board-sessions")).not.toBeNull();
    expect(host.querySelector(".nt-board")).toBeNull();

    await keydown({ key: "Escape" });
    expect(host.querySelector(".board-sessions")).toBeNull();
    expect(host.querySelector(".nt-board")).not.toBeNull();
  });

  it("Escape cancels the board from home", async () => {
    seed(["/w/alpha"]);
    const onCancel = vi.fn();
    await act(async () => {
      render(
        <OpenBoard
          contextWorkspacePath={null}
          canCancel={true}
          canBrowseSessions={false}
          openWorkspacePaths={new Set()}
          onCancel={onCancel}
          onStartTask={async () => "sent"}
          onOpenAgent={async () => "started"}
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
