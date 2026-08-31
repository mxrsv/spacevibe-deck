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

    const trigger = [
      ...host.querySelectorAll<HTMLButtonElement>(".nt-board__shortcuts button"),
    ].find((button) => button.textContent?.includes("Create workspace"));
    await act(async () => trigger?.click());

    expect(host.querySelector(".nt-create-workspace")).not.toBeNull();
    expect(host.querySelector("[data-parent-path]")?.textContent).toBe("/Users/dev");
  });

  it("creates, selects the folder, and returns to the composer", async () => {
    createWorkspaceMock.mockResolvedValue({ path: "/Users/dev/sandbox" });
    await mount();
    const trigger = [
      ...host.querySelectorAll<HTMLButtonElement>(".nt-board__shortcuts button"),
    ].find((button) => button.textContent?.includes("Create workspace"));
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
});
