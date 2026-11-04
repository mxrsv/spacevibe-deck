// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../host/bridge", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("../host/workspace-create-host", () => ({
  available: true,
  createWorkspace: vi.fn(async (parent: string, name: string) => ({ path: `${parent}/${name}` })),
}));
vi.mock("../ui/rail-add-folder", () => ({ rememberOnRail: vi.fn(), addFolderToRail: vi.fn() }));
// The list is seeded below; a real scan would replace it.
vi.mock("../sessions/sessions-store", async (original) => ({
  ...(await original<object>()),
  refreshSessions: vi.fn(async () => {}),
}));

import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../lib/platform";
import type { SessionEntry } from "../lib/session-history";
import { resetCloneSession } from "../open-board/clone-session";
import { refreshSessions, sessionEntries, sessionsLoadState } from "../sessions/sessions-store";
import { rememberOnRail } from "../ui/rail-add-folder";
import { StageLauncherForm, type StageLauncherFormProps } from "./stage-launcher-form";

let host: HTMLDivElement;

function mount(kind: StageLauncherFormProps["form"]["kind"], repoPath: string | null = null) {
  const onLeave = vi.fn();
  const onResumeSession = vi.fn(async (_entry: SessionEntry) => true);
  act(() =>
    render(
      <StageLauncherForm
        form={{ kind, repoPath }}
        recents={[{ path: "/w/api", lastOpenedAt: 1 }]}
        onLeave={onLeave}
        onResumeSession={onResumeSession}
      />,
      host,
    ),
  );
  return { onLeave, onResumeSession };
}

const slot = () => host.querySelector(".stage-launcher");
const press = (key: string, target: Element = host.querySelector(".stage-launcher-form")!) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment: true });
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  resetCloneSession();
  resetDesktopEnvironmentForTests();
  vi.clearAllMocks();
});

describe("StageLauncherForm", () => {
  it("shows the Clone form in the launcher's slot and leaves without a workspace on Back", () => {
    const { onLeave } = mount("clone");

    expect(slot()?.querySelector("[data-stage-form='clone']")).not.toBeNull();
    expect(slot()?.textContent).toContain("Clone repository");
    expect(slot()?.querySelector(".open-board")).toBeNull();

    act(() => slot()?.querySelector<HTMLElement>(".nt-icon-action[aria-label='Back']")?.click());
    expect(onLeave).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("creates a workspace, puts it on the rail and hands it to the launcher", async () => {
    const { onLeave } = mount("create");
    expect(slot()?.textContent).toContain("Create workspace");

    const name = host.querySelector<HTMLInputElement>('[aria-label="Folder name"]')!;
    act(() => {
      name.value = "fresh";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-action="create-workspace"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rememberOnRail).toHaveBeenCalledExactlyOnceWith("/home/test/fresh");
    expect(onLeave).toHaveBeenCalledExactlyOnceWith("/home/test/fresh");
  });

  it("closes on Esc, which the form's own fields have not taken", () => {
    const { onLeave } = mount("create");

    press("Escape", host.querySelector('[aria-label="Folder name"]')!);

    expect(onLeave).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("starts the worktree form on the repository the bar is aimed at, even one history lacks", () => {
    mount("worktree", "/live/repo");

    const select = host.querySelector<HTMLSelectElement>("#wtf-repo")!;
    expect(select.value).toBe("/live/repo");
    expect([...select.options].map((option) => option.value)).toEqual(["", "/live/repo", "/w/api"]);
  });

  it("lists past sessions and returns to the launcher once one resumes", async () => {
    sessionEntries.value = [
      {
        agent: "claude",
        sessionId: "s1",
        cwd: "/w/api",
        lastActivityMs: Date.now() - 60_000,
        title: "fix the login",
        sourcePath: "/p",
      },
    ];
    sessionsLoadState.value = { status: "ready" };
    const { onLeave, onResumeSession } = mount("sessions");
    expect(slot()?.textContent).toContain("Resume a session");
    expect(refreshSessions).toHaveBeenCalledOnce();

    const resume = host.querySelector<HTMLElement>(".sessions-body--dock .session-row button");
    expect(resume).not.toBeNull();
    await act(async () => {
      resume?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onResumeSession).toHaveBeenCalledOnce();
    expect(onLeave).toHaveBeenCalledExactlyOnceWith(null);
  });
});
