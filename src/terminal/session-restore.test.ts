import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSession, resumeWorkspace, type RestoreDeps } from "./session-restore";
import type { ArchiveEntry, SessionTab, WindowRecord } from "../lib/session-schema";
import type { CustomAgent } from "../lib/agent-catalog";
import type { ResumeRef, ResumeRequest } from "../lib/agent-resume";
import type { FileStatResult } from "../files/file-client";
import type { MaterializeIntent } from "./tab-materialize";

/**
 * The rail's tail store is a window-scoped signal module; restore only ever
 * tells it which panes reopened a conversation, so the whole module stands in
 * as that one spy. Hoisted for the same reason the tail store's own test does
 * it: the factory runs while this file's imports are evaluated.
 */
const tailStore = vi.hoisted(() => ({
  noteResumedPane: vi.fn<(workspacePath: string | null, agent: string) => void>(),
}));

vi.mock("./session-tail-store", () => ({
  noteResumedPane: tailStore.noteResumedPane,
}));

const LEAF = { type: "leaf" } as const;

function tab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    workspacePath: "/w",
    layout: LEAF,
    panes: [{ cwd: "/w", agent: "claude", launchCommand: null }],
    name: null,
    dotColor: null,
    ...overrides,
  };
}

function record(overrides: Partial<WindowRecord> = {}): WindowRecord {
  return {
    savedAt: 1,
    activeTabIndex: 0,
    tabs: [tab()],
    files: [],
    activeFileTab: null,
    ...overrides,
  };
}

interface FakeMocks {
  readonly materialize: ReturnType<typeof vi.fn<(intent: MaterializeIntent) => Promise<boolean>>>;
  readonly selectTab: ReturnType<typeof vi.fn<(index: number) => void>>;
  readonly openFile: ReturnType<
    typeof vi.fn<(workspacePath: string, path: string, keep: boolean) => Promise<void>>
  >;
  readonly activateFile: ReturnType<typeof vi.fn<(workspacePath: string, path: string) => void>>;
  readonly dirsExist: RestoreDeps["dirsExist"];
  readonly statFiles: RestoreDeps["statFiles"];
  readonly lookup: ReturnType<
    typeof vi.fn<(requests: readonly ResumeRequest[]) => Promise<readonly ResumeRef[]>>
  >;
  readonly readWindowRecords: ReturnType<
    typeof vi.fn<() => Promise<ReadonlyMap<string, WindowRecord>>>
  >;
  readonly clearWindowRecord: ReturnType<typeof vi.fn<(label: string) => Promise<void>>>;
  readonly take: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  readonly set: ReturnType<typeof vi.fn<() => Promise<void>>>;
  readonly clear: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

interface FakeSetup {
  readonly deps: RestoreDeps;
  readonly mocks: FakeMocks;
  readonly log: string[];
}

function createFakeDeps(
  overrides: {
    readonly records?: ReadonlyMap<string, WindowRecord>;
    readonly dirsExist?: RestoreDeps["dirsExist"];
    readonly statFiles?: RestoreDeps["statFiles"];
    readonly lookup?: FakeMocks["lookup"];
    readonly customAgents?: readonly CustomAgent[];
    readonly markerTaken?: boolean;
    readonly materializeResults?: readonly (boolean | Error)[];
  } = {},
): FakeSetup {
  const log: string[] = [];
  let materializeCall = 0;

  const materialize = vi.fn(async (intent: MaterializeIntent) => {
    log.push(`materialize:${JSON.stringify(intent)}`);
    const outcome = overrides.materializeResults?.[materializeCall];
    materializeCall += 1;
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome ?? true;
  });
  const selectTab = vi.fn((index: number) => {
    log.push(`selectTab:${index}`);
  });
  const openFile = vi.fn(async (workspacePath: string, path: string, keep: boolean) => {
    log.push(`openFile:${workspacePath}:${path}:${keep}`);
  });
  const activateFile = vi.fn((workspacePath: string, path: string) => {
    log.push(`activateFile:${workspacePath}:${path}`);
  });
  const dirsExist =
    overrides.dirsExist ?? vi.fn(async (paths: readonly string[]) => paths.map(() => true));
  const statFiles =
    overrides.statFiles ??
    vi.fn(async (_root: string, paths: readonly string[]): Promise<FileStatResult[]> =>
      paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
    );
  const lookup =
    overrides.lookup ??
    vi.fn(async (requests: readonly ResumeRequest[]): Promise<readonly ResumeRef[]> =>
      requests.map(() => null),
    );
  const readWindowRecords = vi.fn(async () => overrides.records ?? new Map<string, WindowRecord>());
  const clearWindowRecord = vi.fn(async (label: string) => {
    log.push(`clearWindowRecord:${label}`);
  });
  const take = vi.fn(async () => overrides.markerTaken ?? false);
  const set = vi.fn(async () => {
    log.push("marker:set");
  });
  const clear = vi.fn(async () => {
    log.push("marker:clear");
  });

  const mocks: FakeMocks = {
    materialize,
    selectTab,
    openFile,
    activateFile,
    dirsExist,
    statFiles,
    lookup,
    readWindowRecords,
    clearWindowRecord,
    take,
    set,
    clear,
  };

  const deps: RestoreDeps = {
    manager: { materialize, selectTab },
    files: { openFile, activateFile },
    dirsExist,
    statFiles,
    lookup,
    customAgents: () => overrides.customAgents ?? [],
    journal: { readWindowRecords, clearWindowRecord },
    marker: { take, set, clear },
  };

  return { deps, mocks, log };
}

describe("restoreSession", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("point 1: marker.take() true skips restore and clears the marker", async () => {
    const { deps, mocks } = createFakeDeps({ markerTaken: true });
    const result = await restoreSession(deps, "main");
    expect(result).toBe(false);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.readWindowRecords).not.toHaveBeenCalled();
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("point 2: no records at all returns false and clears the marker without further work", async () => {
    const { deps, mocks } = createFakeDeps({ records: new Map() });
    const result = await restoreSession(deps, "main");
    expect(result).toBe(false);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.dirsExist).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.clearWindowRecord).not.toHaveBeenCalled();
  });

  it("point 2: all-empty records return false", async () => {
    const { deps } = createFakeDeps({
      records: new Map([["main", record({ tabs: [] })]]),
    });
    const result = await restoreSession(deps, "main");
    expect(result).toBe(false);
  });

  it("point 2: merges main first, then other windows newest-savedAt-first", async () => {
    const mainTab = tab({ workspacePath: "/main", name: "main-tab" });
    const bTab = tab({ workspacePath: "/b", name: "b-tab" });
    const cTab = tab({ workspacePath: "/c", name: "c-tab" });
    const records = new Map<string, WindowRecord>([
      ["main", record({ savedAt: 100, tabs: [mainTab] })],
      ["b", record({ savedAt: 50, tabs: [bTab] })],
      ["c", record({ savedAt: 200, tabs: [cTab] })],
    ]);
    const { deps, mocks } = createFakeDeps({ records });
    await restoreSession(deps, "main");
    const names = mocks.materialize.mock.calls.map(([intent]) => intent.chrome?.name);
    expect(names).toEqual(["main-tab", "c-tab", "b-tab"]);
  });

  it("point 3: a dead workspace drops only its own tab", async () => {
    const aliveTab = tab({ workspacePath: "/alive", name: "alive-tab" });
    const deadTab = tab({ workspacePath: "/dead", name: "dead-tab" });
    const records = new Map<string, WindowRecord>([
      ["main", record({ tabs: [aliveTab, deadTab] })],
    ]);
    const dirsExist = vi.fn(async (paths: readonly string[]) =>
      paths.map((path) => path !== "/dead"),
    );
    const { deps, mocks } = createFakeDeps({ records, dirsExist });
    await restoreSession(deps, "main");
    expect(mocks.dirsExist).toHaveBeenCalledTimes(1);
    const names = mocks.materialize.mock.calls.map(([intent]) => intent.chrome?.name);
    expect(names).toEqual(["alive-tab"]);
  });

  it("point 3: a dead pane cwd survives with cwd null and no resume request for it", async () => {
    const oneTab = tab({
      workspacePath: "/w",
      panes: [{ cwd: "/w/dead", agent: "claude", launchCommand: null }],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [oneTab] })]]);
    const dirsExist = vi.fn(async (paths: readonly string[]) =>
      paths.map((path) => path !== "/w/dead"),
    );
    const { deps, mocks } = createFakeDeps({ records, dirsExist });
    await restoreSession(deps, "main");
    expect(mocks.lookup).toHaveBeenCalledWith([]);
    const [intent] = mocks.materialize.mock.calls[0];
    expect(intent.cwds).toEqual([null]);
  });

  it("point 4: two same-cwd claude panes get distinct scripted ids in pane order", async () => {
    const twoPaneTab = tab({
      workspacePath: "/w",
      panes: [
        { cwd: "/w", agent: "claude", launchCommand: null },
        { cwd: "/w", agent: "claude", launchCommand: null },
      ],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [twoPaneTab] })]]);
    const lookup = vi.fn(
      async (_requests: readonly ResumeRequest[]): Promise<readonly ResumeRef[]> => [
        { kind: "id", id: "aaa" },
        { kind: "id", id: "bbb" },
      ],
    );
    const { deps, mocks } = createFakeDeps({ records, lookup });
    await restoreSession(deps, "main");
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    const [requests] = mocks.lookup.mock.calls[0];
    expect(requests).toEqual([
      { agent: "claude", cwd: "/w", lastSeenAt: 1 },
      { agent: "claude", cwd: "/w", lastSeenAt: 1 },
    ]);
    const [intent] = mocks.materialize.mock.calls[0];
    expect(intent.paneCommands).toEqual(["claude --resume aaa", "claude --resume bbb"]);
  });

  it("puts a claude pane's mode back on its resume command", async () => {
    const modeTab = tab({
      workspacePath: "/w",
      panes: [
        {
          cwd: "/w",
          agent: "claude",
          launchCommand: "claude --permission-mode plan",
        },
      ],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [modeTab] })]]);
    const lookup = vi.fn(
      async (_requests: readonly ResumeRequest[]): Promise<readonly ResumeRef[]> => [
        { kind: "id", id: "abc123" },
      ],
    );
    const { deps, mocks } = createFakeDeps({ records, lookup });
    await restoreSession(deps, "main");
    const [intent] = mocks.materialize.mock.calls[0];
    expect(intent.paneCommands).toEqual(["claude --resume abc123 --permission-mode plan"]);
  });

  // codex takes its flags in positions `launch-command.ts` does not model, so
  // its resume command is returned untouched rather than guessed at.
  it("leaves a codex pane's resume command alone", async () => {
    const codexTab = tab({
      workspacePath: "/w",
      panes: [
        {
          cwd: "/w",
          agent: "codex",
          launchCommand: "codex --sandbox workspace-write",
        },
      ],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [codexTab] })]]);
    const lookup = vi.fn(
      async (_requests: readonly ResumeRequest[]): Promise<readonly ResumeRef[]> => [
        { kind: "id", id: "abc123" },
      ],
    );
    const { deps, mocks } = createFakeDeps({ records, lookup });
    await restoreSession(deps, "main");
    const [intent] = mocks.materialize.mock.calls[0];
    expect(intent.paneCommands).toEqual(["codex resume abc123"]);
  });

  it("restores a pane with no recorded options exactly as before", async () => {
    const plainTab = tab({
      workspacePath: "/w",
      panes: [{ cwd: "/w", agent: "claude", launchCommand: null }],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [plainTab] })]]);
    const lookup = vi.fn(
      async (_requests: readonly ResumeRequest[]): Promise<readonly ResumeRef[]> => [
        { kind: "id", id: "abc123" },
      ],
    );
    const { deps, mocks } = createFakeDeps({ records, lookup });
    await restoreSession(deps, "main");
    const [intent] = mocks.materialize.mock.calls[0];
    expect(intent.paneCommands).toEqual(["claude --resume abc123"]);
  });

  it("point 4: a custom-agent-label pane skips the lookup and uses its declared command", async () => {
    const customTab = tab({
      workspacePath: "/w",
      panes: [{ cwd: "/w", agent: "MyBot", launchCommand: null }],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [customTab] })]]);
    const customAgents: readonly CustomAgent[] = [
      { id: "custom:mybot", label: "MyBot", command: "mybot --flag" },
    ];
    const { deps, mocks } = createFakeDeps({ records, customAgents });
    await restoreSession(deps, "main");
    expect(mocks.lookup).toHaveBeenCalledWith([]);
    const [intent] = mocks.materialize.mock.calls[0];
    expect(intent.paneCommands).toEqual(["mybot --flag"]);
  });

  it("point 4: a null-agent pane gets a null command and no lookup request", async () => {
    const plainTab = tab({
      workspacePath: "/w",
      panes: [{ cwd: "/w", agent: null, launchCommand: null }],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [plainTab] })]]);
    const { deps, mocks } = createFakeDeps({ records });
    await restoreSession(deps, "main");
    expect(mocks.lookup).toHaveBeenCalledWith([]);
    const [intent] = mocks.materialize.mock.calls[0];
    expect(intent.paneCommands).toEqual([null]);
  });

  it("point 5: a failed materialize (throws) skips that tab and continues", async () => {
    const first = tab({ workspacePath: "/first", name: "first" });
    const second = tab({ workspacePath: "/second", name: "second" });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [first, second] })]]);
    const { deps, mocks } = createFakeDeps({
      records,
      materializeResults: [new Error("boom"), true],
    });
    const result = await restoreSession(deps, "main");
    expect(mocks.materialize).toHaveBeenCalledTimes(2);
    expect(result).toBe(true);
  });

  it("point 5: a failed materialize (returns false) does not count as restored", async () => {
    const only = tab({ workspacePath: "/w" });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [only] })]]);
    const { deps } = createFakeDeps({ records, materializeResults: [false] });
    const result = await restoreSession(deps, "main");
    expect(result).toBe(false);
  });

  it("marks each resumed pane for the rail, once per matched session", async () => {
    tailStore.noteResumedPane.mockClear();
    const twoPaneTab = tab({
      workspacePath: "/w",
      panes: [
        { cwd: "/w", agent: "claude", launchCommand: null },
        { cwd: "/w", agent: "claude", launchCommand: null },
      ],
    });
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [twoPaneTab] })]]);
    const lookup = vi.fn(
      async (_requests: readonly ResumeRequest[]): Promise<readonly ResumeRef[]> => [
        { kind: "id", id: "aaa" },
        { kind: "id", id: "bbb" },
      ],
    );
    const { deps } = createFakeDeps({ records, lookup });
    await restoreSession(deps, "main");
    expect(tailStore.noteResumedPane.mock.calls).toEqual([
      ["/w", "claude"],
      ["/w", "claude"],
    ]);
  });

  it("marks nothing when the lookup matched no session — that pane starts fresh", async () => {
    tailStore.noteResumedPane.mockClear();
    const records = new Map<string, WindowRecord>([
      ["main", record({ tabs: [tab({ workspacePath: "/w" })] })],
    ]);
    // `createFakeDeps`'s default lookup answers `null` for every request, which
    // is the bare-command case: a new conversation, not a resumed one.
    const { deps } = createFakeDeps({ records });
    await restoreSession(deps, "main");
    expect(tailStore.noteResumedPane).not.toHaveBeenCalled();
  });

  it("marks nothing for a tab whose materialize failed", async () => {
    tailStore.noteResumedPane.mockClear();
    const records = new Map<string, WindowRecord>([
      ["main", record({ tabs: [tab({ workspacePath: "/w" })] })],
    ]);
    const lookup = vi.fn(
      async (_requests: readonly ResumeRequest[]): Promise<readonly ResumeRef[]> => [
        { kind: "id", id: "aaa" },
      ],
    );
    const { deps } = createFakeDeps({
      records,
      lookup,
      materializeResults: [false],
    });
    await restoreSession(deps, "main");
    expect(tailStore.noteResumedPane).not.toHaveBeenCalled();
  });

  it("point 6: opens surviving file tabs (filtered by statFiles) and activates the survived active path last", async () => {
    const records = new Map<string, WindowRecord>([
      [
        "main",
        record({
          tabs: [tab()],
          files: [
            {
              workspacePath: "/w",
              tabs: [
                { path: "/w/a.ts", preview: false },
                { path: "/w/gone.ts", preview: true },
              ],
              activePath: "/w/a.ts",
            },
          ],
          activeFileTab: "/w/a.ts",
        }),
      ],
    ]);
    const statFiles = vi.fn(
      async (_root: string, paths: readonly string[]): Promise<FileStatResult[]> =>
        paths.map((path) => ({
          path,
          exists: path !== "/w/gone.ts",
          mtimeMs: 1,
          size: 1,
        })),
    );
    const { deps, mocks, log } = createFakeDeps({ records, statFiles });
    await restoreSession(deps, "main");
    expect(mocks.openFile).toHaveBeenCalledTimes(1);
    expect(mocks.openFile).toHaveBeenCalledWith("/w", "/w/a.ts", true);
    expect(mocks.activateFile).toHaveBeenCalledWith("/w", "/w/a.ts");
    // activateFile happens after selectTab in the call order.
    const selectIndex = log.findIndex((entry) => entry.startsWith("selectTab:"));
    const activateIndex = log.findIndex((entry) => entry.startsWith("activateFile:"));
    expect(selectIndex).toBeGreaterThanOrEqual(0);
    expect(activateIndex).toBeGreaterThan(selectIndex);
  });

  it("point 6: skips a whole file surface whose workspace dir is dead", async () => {
    const records = new Map<string, WindowRecord>([
      [
        "main",
        record({
          tabs: [tab()],
          files: [
            {
              workspacePath: "/dead",
              tabs: [{ path: "/dead/a.ts", preview: false }],
              activePath: "/dead/a.ts",
            },
          ],
        }),
      ],
    ]);
    const dirsExist = vi.fn(async (paths: readonly string[]) =>
      paths.map((path) => path !== "/dead"),
    );
    const statFiles = vi.fn(async (): Promise<FileStatResult[]> => []);
    const { deps, mocks } = createFakeDeps({ records, dirsExist, statFiles });
    await restoreSession(deps, "main");
    expect(statFiles).not.toHaveBeenCalled();
    expect(mocks.openFile).not.toHaveBeenCalled();
  });

  it("point 7: clamps activeTabIndex to the materialized count", async () => {
    const first = tab({ workspacePath: "/a" });
    const second = tab({ workspacePath: "/b" });
    const records = new Map<string, WindowRecord>([
      ["main", record({ tabs: [first, second], activeTabIndex: 99 })],
    ]);
    const { deps, mocks } = createFakeDeps({ records });
    await restoreSession(deps, "main");
    expect(mocks.selectTab).toHaveBeenCalledWith(1);
  });

  it("point 8: clears every secondary window record but leaves the main record alone", async () => {
    const records = new Map<string, WindowRecord>([
      ["main", record({ tabs: [tab()] })],
      ["b", record({ tabs: [tab({ workspacePath: "/b" })] })],
      ["c", record({ tabs: [tab({ workspacePath: "/c" })] })],
    ]);
    const { deps, mocks } = createFakeDeps({ records });
    await restoreSession(deps, "main");
    expect(mocks.clearWindowRecord).toHaveBeenCalledWith("b");
    expect(mocks.clearWindowRecord).toHaveBeenCalledWith("c");
    expect(mocks.clearWindowRecord).not.toHaveBeenCalledWith("main");
  });

  it("point 8b: a failed clear for one secondary label does not skip the others (H2)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const records = new Map<string, WindowRecord>([
      ["main", record({ tabs: [tab()] })],
      ["b", record({ tabs: [tab({ workspacePath: "/b" })] })],
      ["c", record({ tabs: [tab({ workspacePath: "/c" })] })],
    ]);
    const { deps, mocks } = createFakeDeps({ records });
    mocks.clearWindowRecord.mockImplementation(async (label: string) => {
      if (label === "b") {
        throw new Error("clear failed");
      }
    });
    const result = await restoreSession(deps, "main");
    expect(result).toBe(true);
    expect(mocks.clearWindowRecord).toHaveBeenCalledWith("b");
    expect(mocks.clearWindowRecord).toHaveBeenCalledWith("c");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("point 8c: secondary records are cleared right after restoreTabs, BEFORE a throw inside restoreFiles (H2)", async () => {
    const records = new Map<string, WindowRecord>([
      [
        "main",
        record({
          tabs: [tab({ workspacePath: "/w" })],
          files: [
            {
              workspacePath: "/w",
              tabs: [{ path: "/w/a.ts", preview: false }],
              activePath: null,
            },
          ],
        }),
      ],
      ["b", record({ tabs: [tab({ workspacePath: "/b" })] })],
      ["c", record({ tabs: [tab({ workspacePath: "/c" })] })],
    ]);
    const statFiles = vi.fn(async (): Promise<FileStatResult[]> => {
      throw new Error("stat failed");
    });
    const { deps, mocks } = createFakeDeps({ records, statFiles });
    const result = await restoreSession(deps, "main");
    // materializes for main/b/c all succeeded before restoreFiles threw.
    expect(result).toBe(true);
    expect(mocks.clearWindowRecord).toHaveBeenCalledWith("b");
    expect(mocks.clearWindowRecord).toHaveBeenCalledWith("c");
  });

  it("point 9: marker set→clear bracketing, including clear-on-throw when the lookup rejects", async () => {
    const records = new Map<string, WindowRecord>([["main", record({ tabs: [tab()] })]]);
    const lookup = vi.fn(async (): Promise<readonly ResumeRef[]> => {
      throw new Error("scanner exploded");
    });
    const { deps, mocks } = createFakeDeps({ records, lookup });
    const result = await restoreSession(deps, "main");
    expect(result).toBe(false);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.materialize).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith("session restore failed:", expect.any(Error));
  });

  it("point 9: returns partial progress when a later step throws after some materializes succeeded", async () => {
    const records = new Map<string, WindowRecord>([
      ["main", record({ tabs: [tab({ workspacePath: "/w" })] })],
      ["b", record({ tabs: [tab({ workspacePath: "/b" })] })],
    ]);
    const { deps, mocks } = createFakeDeps({ records });
    mocks.clearWindowRecord.mockImplementation(async () => {
      throw new Error("clear failed");
    });
    const result = await restoreSession(deps, "main");
    expect(result).toBe(true);
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });
});

describe("resumeWorkspace", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("materializes the archive entry's tabs and reports success", async () => {
    const entry: ArchiveEntry = {
      savedAt: 5,
      tabs: [tab({ workspacePath: "/w" })],
    };
    const { deps, mocks } = createFakeDeps({});
    const result = await resumeWorkspace(deps, entry, "/w");
    expect(result).toBe(true);
    expect(mocks.materialize).toHaveBeenCalledTimes(1);
    expect(mocks.take).not.toHaveBeenCalled();
    expect(mocks.readWindowRecords).not.toHaveBeenCalled();
  });

  it("drops tabs from a dead workspace and reports failure when none survive", async () => {
    const entry: ArchiveEntry = {
      savedAt: 5,
      tabs: [tab({ workspacePath: "/dead" })],
    };
    const dirsExist = vi.fn(async () => [false]);
    const { deps, mocks } = createFakeDeps({ dirsExist });
    const result = await resumeWorkspace(deps, entry, "/dead");
    expect(result).toBe(false);
    expect(mocks.materialize).not.toHaveBeenCalled();
  });

  it("scopes the resume lookup to the entry's savedAt", async () => {
    const entry: ArchiveEntry = {
      savedAt: 42,
      tabs: [
        tab({ workspacePath: "/w", panes: [{ cwd: "/w", agent: "claude", launchCommand: null }] }),
      ],
    };
    const { deps, mocks } = createFakeDeps({});
    await resumeWorkspace(deps, entry, "/w");
    expect(mocks.lookup).toHaveBeenCalledWith([{ agent: "claude", cwd: "/w", lastSeenAt: 42 }]);
  });
});
