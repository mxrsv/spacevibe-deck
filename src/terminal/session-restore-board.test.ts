import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateWindowRecord } from "../lib/session-schema";
import { activeFileTab, activateTerminalSurface } from "../files/file-surface-store";
import {
  agentBoardOpen,
  agentBoardSurfaceActive,
  resetAgentBoardStore,
  stepAgentBoardBack,
} from "../ui/agent-board-store";
import { restoreSession, type RestoreDeps } from "./session-restore";

vi.mock("./session-tail-store", () => ({ noteResumedPane: vi.fn() }));

const FILE_PATH = "/w/task.md";
const SAVED_RECORD = {
  savedAt: 1,
  activeTabIndex: 0,
  tabs: [
    {
      workspacePath: "/w",
      layout: { type: "leaf" },
      panes: [{ cwd: "/w", agent: null, launchCommand: null, taskPrompt: null }],
      name: null,
      dotColor: null,
    },
  ],
  files: [
    { workspacePath: "/w", tabs: [{ path: FILE_PATH, preview: false }], activePath: FILE_PATH },
  ],
  activeFileTab: null,
  agentBoardOpen: true,
  agentBoardSurfaceActive: true,
};

function setup(overrides: Record<string, unknown> = {}, label = "main") {
  const record = validateWindowRecord({ ...SAVED_RECORD, ...overrides });
  if (record === null) throw new Error("Invalid restore fixture");
  const deps: RestoreDeps = {
    manager: {
      materialize: vi.fn(async () => true),
      selectTab: vi.fn(() => {
        // Real TabManager.selectTab deactivates the composed surface strip.
        stepAgentBoardBack();
        activateTerminalSurface();
      }),
      notifySurfacesChanged: vi.fn(),
    },
    files: {
      openFile: vi.fn(async (_workspace, path) => {
        activeFileTab.value = path;
      }),
      activateFile: vi.fn((_workspace, path) => {
        activeFileTab.value = path;
      }),
    },
    dirsExist: vi.fn(async (paths) => paths.map(() => true)),
    statFiles: vi.fn<RestoreDeps["statFiles"]>(async (_workspace, paths) =>
      paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
    ),
    lookup: vi.fn(async (requests) => requests.map(() => null)),
    customAgents: () => [],
    journal: {
      readWindowRecords: vi.fn(async () => new Map([[label, record]])),
      clearWindowRecord: vi.fn(async () => {}),
    },
    marker: {
      take: vi.fn(async () => false),
      set: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    },
  };
  return deps;
}

describe("Agent Board boot restore", () => {
  beforeEach(() => {
    resetAgentBoardStore();
    activateTerminalSurface();
  });
  afterEach(() => {
    resetAgentBoardStore();
    activateTerminalSurface();
    vi.restoreAllMocks();
  });

  it("keeps the Board on stage after restoring file tabs and selecting the terminal", async () => {
    const deps = setup();
    expect(await restoreSession(deps, "main")).toBe(true);
    expect(deps.files.openFile).toHaveBeenCalledWith("/w", FILE_PATH, true);
    expect(deps.manager.selectTab).toHaveBeenCalledWith(0);
    expect(agentBoardOpen.value).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(true);
    expect(activeFileTab.value).toBeNull();
    expect(deps.manager.notifySurfacesChanged).toHaveBeenCalled();
  });

  it.each([null, FILE_PATH])(
    "restores only the chip when the saved surface was %s",
    async (path) => {
      const deps = setup({ agentBoardSurfaceActive: false, activeFileTab: path });
      await restoreSession(deps, "main");
      expect(agentBoardOpen.value).toBe(true);
      expect(agentBoardSurfaceActive.value).toBe(false);
      expect(activeFileTab.value).toBe(path);
    },
  );

  it("keeps a legacy journal chip-only", async () => {
    await restoreSession(setup({ agentBoardSurfaceActive: undefined }), "main");
    expect(agentBoardOpen.value).toBe(true);
    expect(agentBoardSurfaceActive.value).toBe(false);
  });

  it("gives the saved Board priority over an inconsistent saved active file", async () => {
    const deps = setup({ activeFileTab: FILE_PATH });
    await restoreSession(deps, "main");
    expect(agentBoardSurfaceActive.value).toBe(true);
    expect(activeFileTab.value).toBeNull();
    expect(deps.files.activateFile).not.toHaveBeenCalled();
  });

  it("ignores the Board state in a secondary window record", async () => {
    await restoreSession(setup({}, "secondary"), "main");
    expect(agentBoardOpen.value).toBe(false);
    expect(agentBoardSurfaceActive.value).toBe(false);
  });

  it.each(["empty", "dead", "failed", "crash"])(
    "does not raise the Board on %s restore",
    async (reason) => {
      const deps = setup(reason === "empty" ? { tabs: [] } : {});
      if (reason === "dead") vi.mocked(deps.dirsExist).mockResolvedValue([false]);
      if (reason === "failed") vi.mocked(deps.manager.materialize).mockResolvedValue(false);
      if (reason === "crash") vi.mocked(deps.marker.take).mockResolvedValue(true);
      expect(await restoreSession(deps, "main")).toBe(false);
      expect(agentBoardOpen.value).toBe(false);
      expect(agentBoardSurfaceActive.value).toBe(false);
    },
  );
});
