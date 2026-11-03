import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { discardLastSession, reopenLastSession } from "./last-session-actions";
import { lastSession, summarizeLastSession } from "../terminal/last-session-store";
import {
  flushSessionJournal,
  initSessionJournal,
  readWindowRecords,
  resetSessionJournal,
  resumeSessionJournal,
  sessionArchive,
  suspendSessionJournal,
  type SessionJournalDeps,
} from "../terminal/session-journal";
import type { SessionTab, WindowRecord } from "../lib/session-schema";
import type { RestoreDeps } from "../terminal/session-restore";
import { persistError } from "../chrome/events";
import { defaultPtyClient } from "../terminal/pty-client";

vi.mock("../terminal/pty-client", () => ({
  defaultPtyClient: { dirsExist: vi.fn(async (paths: readonly string[]) => paths.map(() => true)) },
}));
vi.mock("../host/resume-host", () => ({ resumeLookup: vi.fn(async () => []) }));
vi.mock("../files/file-client", () => ({
  defaultFileClient: { statFiles: vi.fn(async () => []) },
}));
vi.mock("../terminal/session-tail-store", () => ({ noteResumedPane: vi.fn() }));

function tab(name: string): SessionTab {
  return {
    name,
    workspacePath: "/project",
    layout: { type: "leaf" },
    panes: [
      {
        cwd: "/project",
        agent: "claude",
        launchCommand: "claude",
        taskPrompt: name,
        sessionId: name,
      },
    ],
    dotColor: null,
  };
}
function record(tabs: readonly SessionTab[]): WindowRecord {
  return {
    tabs,
    savedAt: 123,
    activeTabIndex: 0,
    files: [],
    activeFileTab: null,
    agentBoardOpen: false,
    agentBoardSurfaceActive: false,
  };
}

function setup(records: ReadonlyMap<string, WindowRecord>) {
  const data = new Map<string, unknown>(
    [...records].map(([label, value]) => [`window:${label}`, value]),
  );
  let persisted = structuredClone(data);
  const store: NonNullable<SessionJournalDeps["store"]> = {
    get: vi.fn(async (key: string) =>
      key === "windowLabels"
        ? [...data.keys()].filter((k) => k.startsWith("window:")).map((k) => k.slice(7))
        : data.get(key),
    ) as NonNullable<SessionJournalDeps["store"]>["get"],
    set: vi.fn(async (key, value) => {
      data.set(key, structuredClone(value));
    }),
    delete: vi.fn(async (key) => {
      data.delete(key);
    }),
    save: vi.fn(async () => {
      persisted = structuredClone(data);
    }),
    patch: vi.fn(async (values, deleteKeys = []) => {
      const next = new Map([...data, ...Object.entries(structuredClone(values))]);
      for (const key of deleteKeys) next.delete(key);
      data.clear();
      for (const [key, value] of next) data.set(key, value);
      await store.save();
    }),
  };
  let live: readonly SessionTab[] = [];
  let failures = new Set(["failed"]);
  const manager: RestoreDeps["manager"] = {
    materialize: vi.fn(async (intent) => {
      const name = intent.chrome?.name ?? "";
      if (failures.has(name)) return false;
      live = [...live, tab(name)];
      return true;
    }),
    selectTab: vi.fn(),
    notifySurfacesChanged: vi.fn(),
  };
  const files: RestoreDeps["files"] = { openFile: vi.fn(async () => {}), activateFile: vi.fn() };
  const init = () =>
    initSessionJournal({
      capture: () => live,
      windowLabel: "main",
      isMain: true,
      holdEmpty: () => lastSession.value !== null,
      store,
    });
  return {
    data,
    store,
    manager,
    files,
    init,
    persisted: () => persisted,
    restart: async () => {
      resetSessionJournal();
      live = [];
      lastSession.value = null;
      data.clear();
      for (const [key, value] of structuredClone(persisted)) data.set(key, value);
      await init();
      lastSession.value = summarizeLastSession(await readWindowRecords(), "main");
    },
    live: () => live,
    fail: (names: readonly string[]) => {
      failures = new Set(names);
    },
    changeLive: (tabs: readonly SessionTab[]) => {
      live = tabs;
    },
  };
}

beforeEach(() => {
  resetSessionJournal();
  lastSession.value = null;
  persistError.value = null;
});
afterEach(() => {
  resetSessionJournal();
  lastSession.value = null;
  vi.restoreAllMocks();
});

it("refuses a quit flush while restore still owns a partial materialization", async () => {
  const records = new Map([["main", record([tab("restored"), tab("failed")])]]);
  const state = setup(records);
  lastSession.value = summarizeLastSession(records, "main");
  await state.init();
  let release!: (value: boolean) => void;
  const pending = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  let secondStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  vi.mocked(state.manager.materialize)
    .mockImplementationOnce(async () => {
      state.changeLive([tab("restored")]);
      return true;
    })
    .mockImplementationOnce(() => {
      secondStarted();
      return pending;
    });
  const restoring = reopenLastSession(state);
  await started;
  // Every real Quit participant adds its own suspension before strict flushing.
  suspendSessionJournal();
  try {
    const error = await flushSessionJournal({ force: true, strict: true }).then(
      () => null,
      (failure: unknown) => failure,
    );
    expect.soft(error).toBeInstanceOf(Error);
    const durable = state.persisted().get("window:main") as WindowRecord;
    expect.soft(durable.tabs.map((entry) => entry.name)).toEqual(["restored", "failed"]);
  } finally {
    resumeSessionJournal();
    release(false);
    await restoring;
  }
  await state.restart();
  expect(lastSession.value?.tabCount).toBe(2);
});

it.each(["main", "secondary"])(
  "preserves failed %s tabs through writes, restart and retry without duplicating successful siblings",
  async (label) => {
    const records = new Map([[label, record([tab("restored"), tab("failed")])]]);
    const state = setup(records);
    lastSession.value = summarizeLastSession(records, "main");
    await state.init();

    expect.soft(await reopenLastSession(state)).toBe(false);
    expect.soft(lastSession.value?.tabCount).toBe(1);
    expect.soft(persistError.value).not.toBeNull();
    expect.soft(sessionArchive.value["/project"].tabs.map((t) => t.name)).toContain("failed");
    state.changeLive([...state.live(), tab("new")]);
    await flushSessionJournal();
    expect.soft(sessionArchive.value["/project"].tabs.map((t) => t.name)).toContain("failed");

    // Same-launch retry offers only the failed sibling.
    state.fail([]);
    expect(await reopenLastSession(state)).toBe(true);
    expect(state.live().map((t) => t.name)).toEqual(["restored", "new", "failed"]);
    expect(lastSession.value).toBeNull();
    expect(
      [...(await readWindowRecords())].flatMap(([, r]) => r.tabs.map((t) => t.name)).sort(),
    ).toEqual(["failed", "new", "restored"]);
    await state.restart();
    expect(lastSession.value?.tabCount).toBe(3);
    expect(await reopenLastSession(state)).toBe(true);
    expect(
      state
        .live()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["failed", "new", "restored"]);
  },
);

it("keeps an all-failed attempt available after a journal flush and restart", async () => {
  const records = new Map([["main", record([tab("failed")])]]);
  const state = setup(records);
  lastSession.value = summarizeLastSession(records, "main");
  await state.init();
  expect.soft(await reopenLastSession(state)).toBe(false);
  expect.soft(lastSession.value?.tabCount).toBe(1);
  await flushSessionJournal({ force: true });
  await state.restart();
  expect([...(await readWindowRecords())].flatMap(([, r]) => r.tabs.map((t) => t.name))).toEqual([
    "failed",
  ]);
});

it("preserves both new and pending records with their original timestamps when another launch fails", async () => {
  const original = { ...record([tab("restored"), tab("failed")]), savedAt: 12 };
  const state = setup(new Map([["main", original]]));
  lastSession.value = summarizeLastSession(new Map([["main", original]]), "main");
  await state.init();
  await reopenLastSession(state);
  await state.restart();
  state.fail(["restored", "failed"]);
  expect(await reopenLastSession(state)).toBe(false);
  await state.restart();
  const records = [...(await readWindowRecords()).values()];
  expect(records.flatMap((r) => r.tabs.map((t) => t.name)).sort()).toEqual(["failed", "restored"]);
  expect(records.find((r) => r.tabs.some((t) => t.name === "failed"))?.savedAt).toBe(12);
});

it("keeps every pending record across the per-window cap", async () => {
  const first = Array.from({ length: 32 }, (_, index) => tab(`first-${index}`));
  const second = Array.from({ length: 32 }, (_, index) => tab(`second-${index}`));
  const records = new Map([
    ["main", record(first)],
    ["secondary", record(second)],
  ]);
  const state = setup(records);
  state.fail([...first, ...second].map((t) => t.name!));
  lastSession.value = summarizeLastSession(records, "main");
  await state.init();
  expect(await reopenLastSession(state)).toBe(false);
  await state.restart();
  expect(lastSession.value?.tabCount).toBe(64);
});

it("retains the last durable originals when the checkpoint save fails, then retries the save", async () => {
  const records = new Map([
    ["main", record([tab("restored")])],
    ["secondary", record([tab("failed")])],
  ]);
  const state = setup(records);
  lastSession.value = summarizeLastSession(records, "main");
  await state.init();
  const save = vi.mocked(state.store.save).getMockImplementation()!;
  vi.mocked(state.store.save)
    .mockImplementationOnce(save)
    .mockImplementationOnce(save)
    .mockRejectedValueOnce(new Error("disk full"));
  expect(await reopenLastSession(state)).toBe(false);
  expect(state.persisted().get("window:main")).toEqual(records.get("main"));
  expect(state.persisted().get("window:secondary")).toEqual(records.get("secondary"));
  expect(lastSession.value?.tabCount).toBe(1);
  await flushSessionJournal({ force: true, strict: true });
  await state.restart();
  expect(lastSession.value?.tabCount).toBe(2);
});

it("does not retain deliberately skipped missing workspaces", async () => {
  const missing = { ...tab("missing"), workspacePath: "/missing" };
  const records = new Map([["main", record([tab("restored"), missing])]]);
  const state = setup(records);
  vi.mocked(defaultPtyClient.dirsExist).mockImplementationOnce(async (paths) =>
    paths.map((path) => path !== "/missing"),
  );
  lastSession.value = summarizeLastSession(records, "main");
  await state.init();
  expect(await reopenLastSession(state)).toBe(true);
  expect(lastSession.value).toBeNull();
  await state.restart();
  expect(lastSession.value?.tabCount).toBe(1);
});

it("removes pending tabs only on explicit dismissal", async () => {
  const records = new Map([["main", record([tab("restored"), tab("failed")])]]);
  const state = setup(records);
  lastSession.value = summarizeLastSession(records, "main");
  await state.init();
  await reopenLastSession(state);
  discardLastSession();
  await flushSessionJournal({ force: true, strict: true });
  await state.restart();
  expect(lastSession.value?.tabCount).toBe(1);
  expect(
    [...lastSession.value!.records.values()].flatMap((r) => r.tabs.map((t) => t.name)),
  ).toEqual(["restored"]);
});

it("refuses to begin Reopen after Quit has already captured and suspended the journal", async () => {
  const records = new Map([["main", record([tab("restored")])]]);
  const state = setup(records);
  lastSession.value = summarizeLastSession(records, "main");
  await state.init();
  const offer = lastSession.value;
  suspendSessionJournal();
  await flushSessionJournal({ force: true, strict: true });
  expect(await reopenLastSession(state)).toBe(false);
  expect(state.manager.materialize).not.toHaveBeenCalled();
  expect(lastSession.value).toBe(offer);
  expect(state.data.has("restoreAttempt")).toBe(false);
  expect(state.persisted().get("window:main")).toEqual(records.get("main"));
  resumeSessionJournal();
  expect(await reopenLastSession(state)).toBe(true);
});

it.each(["retry", "dismiss"])(
  "a %s offer never consumes its original detached label twice",
  async (action) => {
    const records = new Map([["deck-1", record([tab("failed")])]]);
    const state = setup(records);
    lastSession.value = summarizeLastSession(records, "main");
    await state.init();
    await reopenLastSession(state);
    expect([...lastSession.value!.records.keys()]).toEqual(["pending-restore:0"]);
    const peer = record([tab("new-peer")]);
    await state.store.set("window:deck-1", peer);
    await state.store.save();
    if (action === "retry") {
      state.fail([]);
      await reopenLastSession(state);
    } else {
      discardLastSession();
      await flushSessionJournal({ strict: true });
    }
    expect(state.persisted().get("window:deck-1")).toEqual(peer);
  },
);
