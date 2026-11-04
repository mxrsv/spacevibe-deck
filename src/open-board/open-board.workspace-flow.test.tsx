// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let pickedFolder: string | null = null;
const createWorkspaceMock = vi.fn();

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
vi.mock("../host/bridge", () => ({
  invoke: vi.fn(async (command: string, args?: { paths?: readonly string[] }) =>
    command === "dirs_exist" ? (args?.paths ?? []).map(() => true) : null,
  ),
}));
vi.mock("../host/worktree-host", () => ({ available: false }));
vi.mock("../host/workspace-create-host", () => ({
  available: true,
  createWorkspace: (...args: unknown[]) => createWorkspaceMock(...args),
}));
vi.mock("../terminal/pty-client", () => ({
  defaultPtyClient: { detectAgents: vi.fn(async () => []) },
}));

import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import { resetLauncherStore, newTaskDraft } from "../launcher/launcher-store";
import { resetAgentDetectionForTests } from "../terminal/agent-detection-store";
import { OpenBoard } from "./open-board";
import { workspacesData } from "./workspaces-store";
import {
  pushRecent,
  WORKSPACES_VERSION,
  MAX_RECENTS,
  type RecentWorkspace,
} from "../lib/workspace-recents";

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("OpenBoard create-workspace flow", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    resetAgentDetectionForTests();
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" });
    resetLauncherStore();
    pickedFolder = null;
    createWorkspaceMock.mockReset();
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    act(() => render(null, host));
    resetDesktopEnvironmentForTests();
  });

  /** The row's buttons plus the folder menu's rows (opened first): where every workspace action lives. */
  const pickerButtons = async (): Promise<HTMLButtonElement[]> => {
    if (host.querySelector(".nt-workspace-picker__menu") === null) {
      await act(async () => {
        host.querySelector<HTMLButtonElement>(".nt-workspace-picker__trigger")?.click();
      });
    }
    return [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".nt-agent-launcher__action, .nt-workspace-picker__menu button",
      ),
    ];
  };

  const mount = async (): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          contextWorkspacePath={null}
          canCancel
          canBrowseSessions={false}
          openWorkspacePaths={new Set()}
          onCancel={() => {}}
          onStartTask={async () => "sent"}
          onOpenAgent={async () => "started"}
          canRetryDelivery={false}
          canFocusOpenedAgent={false}
          hasUserDraftContent={false}
          onRetryDelivery={async () => "prompt-not-sent"}
          onFocusOpenedAgent={() => {}}
          onClearDraft={() => {}}
          onManageAgents={() => {}}
          onResumeSession={async () => true}
        />,
        host,
      );
    });
  };

  it("opens the create-workspace subview from the composer", async () => {
    await mount();

    const trigger = (await pickerButtons()).find((button) =>
      button.textContent?.includes("Create workspace"),
    );
    await act(async () => trigger?.click());

    expect(host.querySelector(".nt-create-workspace")).not.toBeNull();
    expect(host.querySelector("[data-parent-path]")?.textContent).toBe("/Users/dev");
  });

  it("creates, selects the folder, and returns to the composer", async () => {
    createWorkspaceMock.mockResolvedValue({ path: "/Users/dev/sandbox" });
    await mount();
    const trigger = (await pickerButtons()).find((button) =>
      button.textContent?.includes("Create workspace"),
    );
    await act(async () => trigger?.click());

    const name = host.querySelector<HTMLInputElement>('input[aria-label="Folder name"]');
    await act(async () => {
      name!.value = "sandbox";
      name!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="create-workspace"]')?.click();
    });
    await settle();

    expect(createWorkspaceMock).toHaveBeenCalledWith("/Users/dev", "sandbox");
    expect(newTaskDraft.value.workspacePath).toBe("/Users/dev/sandbox");
    expect(host.querySelector(".nt-create-workspace")).toBeNull();
    expect(host.querySelector(".nt-board__head")).not.toBeNull();
  });

  it("lists the newest few folders even though the store keeps the whole history", async () => {
    let recents: readonly RecentWorkspace[] = [];
    for (let i = 0; i < 23; i += 1) recents = pushRecent(recents, `/Users/dev/p${i}`, 1_000 + i);
    workspacesData.value = { version: WORKSPACES_VERSION, recents };
    await mount();

    await pickerButtons();
    const listed = [
      ...host.querySelectorAll<HTMLElement>('.nt-workspace-picker__menu [role="menuitemradio"]'),
    ].map((row) => row.title);

    expect(workspacesData.value.recents).toHaveLength(23);
    expect(listed).toHaveLength(MAX_RECENTS);
    expect(listed[0]).toBe("/Users/dev/p22");
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  });
});
