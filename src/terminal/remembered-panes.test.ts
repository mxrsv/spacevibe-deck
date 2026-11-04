import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forget,
  loadRememberedPanes,
  mergeFromRecord,
  remove,
  rememberedFromRecord,
  rememberedPanes,
  rememberedStoreWritable,
  resetRememberedPanes,
} from "./remembered-panes";
import {
  MAX_REMEMBERED_PER_WORKSPACE,
  type SessionPane,
  type SessionTab,
  type WindowRecord,
} from "../lib/session-schema";
import { persistError } from "../chrome/events";

const LEAF = { type: "leaf" } as const;

type StoreSeam = NonNullable<NonNullable<Parameters<typeof loadRememberedPanes>[0]>["store"]>;

/** The main-process store: a key/value map that survives a "reload" (a new load call). */
function createFakeStore(
  initial: Record<string, unknown> = {},
  state: "ready" | "unreadable" = "ready",
) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const store: StoreSeam = {
    loadState: { state, fresh: false },
    get: vi.fn(async (key: string) => data.get(key)) as StoreSeam["get"],
    set: vi.fn(async (key: string, value: unknown) => {
      if (state === "unreadable") {
        throw new Error("session.json is unreadable; write blocked");
      }
      data.set(key, value);
    }),
    save: vi.fn(async () => {}),
  };
  return { store, data };
}

function pane(over: Partial<SessionPane> = {}): SessionPane {
  return { cwd: "/w/a", agent: "claude", launchCommand: null, taskPrompt: null, ...over };
}

function tab(panes: readonly SessionPane[], over: Partial<SessionTab> = {}): SessionTab {
  return { workspacePath: "/w", layout: LEAF, panes, name: null, dotColor: null, ...over };
}

function record(tabs: readonly SessionTab[], savedAt = 100): WindowRecord {
  return {
    savedAt,
    activeTabIndex: 0,
    tabs,
    files: [],
    activeFileTab: null,
    agentBoardOpen: false,
    agentBoardSurfaceActive: false,
  };
}

beforeEach(() => {
  persistError.value = null;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetRememberedPanes();
  vi.restoreAllMocks();
});

describe("rememberedFromRecord", () => {
  it("turns each agent pane into an entry and skips shells, cwd-less panes and workspace-less tabs", () => {
    const entries = rememberedFromRecord(
      record([
        tab([
          pane({
            cwd: "/w/a",
            agent: "claude",
            launchCommand: "claude --model opus",
            sessionId: "s1",
          }),
          pane({ cwd: "/w/b", agent: null }),
          pane({ cwd: null, agent: "codex" }),
        ]),
        tab([pane({ cwd: "/x", agent: "codex" })], { workspacePath: null }),
      ]),
    );
    expect(entries).toEqual([
      {
        id: "claude:/w/a:s1",
        workspacePath: "/w",
        cwd: "/w/a",
        agent: "claude",
        launchCommand: "claude --model opus",
        title: null,
        branch: null,
        sessionId: "s1",
        savedAt: 100,
      },
    ]);
  });

  it("uses the tab's name as the title of a one-pane tab only", () => {
    const [solo] = rememberedFromRecord(record([tab([pane()], { name: "rail work" })]));
    expect(solo?.title).toBe("rail work");
    const pair = rememberedFromRecord(
      record([tab([pane(), pane({ cwd: "/w/b", agent: "codex" })], { name: "rail work" })]),
    );
    expect(pair.map((entry) => entry.title)).toEqual([null, null]);
  });
});

describe("mergeFromRecord", () => {
  it("merging the same record twice does not duplicate rows", async () => {
    const { store, data } = createFakeStore();
    await loadRememberedPanes({ store });
    const previous = record([tab([pane(), pane({ cwd: "/w/b", agent: "codex" })])]);
    await mergeFromRecord(previous);
    await mergeFromRecord(previous);
    expect(rememberedPanes.value).toHaveLength(2);
    expect(data.get("remembered")).toHaveLength(2);
  });

  it("keeps two panes of one agent in one checkout as two rows when their conversations differ", async () => {
    const { store, data } = createFakeStore();
    await loadRememberedPanes({ store });
    await mergeFromRecord(
      record([tab([pane({ sessionId: "conv-1" }), pane({ sessionId: "conv-2" })])]),
    );
    expect(rememberedPanes.value.map((entry) => entry.sessionId).sort()).toEqual([
      "conv-1",
      "conv-2",
    ]);
    expect(new Set(rememberedPanes.value.map((entry) => entry.id)).size).toBe(2);
    expect(data.get("remembered")).toHaveLength(2);
  });

  it("merging a record with sibling conversations twice adds nothing", async () => {
    const { store } = createFakeStore();
    await loadRememberedPanes({ store });
    const previous = record([tab([pane({ sessionId: "conv-1" }), pane({ sessionId: "conv-2" })])]);
    await mergeFromRecord(previous);
    const once = rememberedPanes.value;
    await mergeFromRecord(previous);
    expect(rememberedPanes.value).toEqual(once);
  });

  it("forgetting one sibling leaves the other", async () => {
    const { store } = createFakeStore();
    await loadRememberedPanes({ store });
    await mergeFromRecord(
      record([tab([pane({ sessionId: "conv-1" }), pane({ sessionId: "conv-2" })])]),
    );
    const first = rememberedPanes.value.find((entry) => entry.sessionId === "conv-1");
    await forget(first?.id ?? "");
    expect(rememberedPanes.value.map((entry) => entry.sessionId)).toEqual(["conv-2"]);
  });

  it("reads a row stored under the old agent:cwd id, and a sibling merged beside it survives", async () => {
    const legacy = {
      id: "claude:/w/a",
      workspacePath: "/w",
      cwd: "/w/a",
      agent: "claude",
      launchCommand: null,
      title: null,
      branch: null,
      sessionId: "conv-1",
      savedAt: 50,
    };
    const { store } = createFakeStore({ remembered: [legacy] });
    await loadRememberedPanes({ store });
    expect(rememberedPanes.value).toHaveLength(1);
    await mergeFromRecord(record([tab([pane({ sessionId: "conv-2" })])], 100));
    expect(rememberedPanes.value.map((entry) => entry.sessionId).sort()).toEqual([
      "conv-1",
      "conv-2",
    ]);
  });

  it("a newer pane for the same agent + cwd replaces the older row", async () => {
    const { store } = createFakeStore();
    await loadRememberedPanes({ store });
    await mergeFromRecord(record([tab([pane({ launchCommand: "claude --model opus" })])], 100));
    await mergeFromRecord(record([tab([pane({ launchCommand: "claude --model sonnet" })])], 200));
    expect(rememberedPanes.value).toHaveLength(1);
    expect(rememberedPanes.value[0]).toMatchObject({
      launchCommand: "claude --model sonnet",
      savedAt: 200,
    });
  });

  it("keeps rows from earlier sessions that the new record no longer has", async () => {
    const { store } = createFakeStore();
    await loadRememberedPanes({ store });
    await mergeFromRecord(record([tab([pane({ cwd: "/w/old" })])], 100));
    await mergeFromRecord(record([tab([pane({ cwd: "/w/new" })])], 200));
    expect(rememberedPanes.value.map((entry) => entry.cwd)).toEqual(["/w/new", "/w/old"]);
  });

  it("caps a workspace at the newest entries", async () => {
    const { store } = createFakeStore();
    await loadRememberedPanes({ store });
    const panes = Array.from({ length: MAX_REMEMBERED_PER_WORKSPACE + 3 }, (_, index) =>
      pane({ cwd: `/w/${index}` }),
    );
    await mergeFromRecord(record([tab(panes)], 100));
    await mergeFromRecord(record([tab([pane({ cwd: "/w/fresh" })])], 200));
    expect(rememberedPanes.value).toHaveLength(MAX_REMEMBERED_PER_WORKSPACE);
    expect(rememberedPanes.value[0]?.cwd).toBe("/w/fresh");
  });

  it("ignores a missing record", async () => {
    const { store } = createFakeStore();
    await loadRememberedPanes({ store });
    await mergeFromRecord(null);
    await mergeFromRecord(undefined);
    expect(store.set).not.toHaveBeenCalled();
  });
});

describe("remove and forget", () => {
  async function seedTwoInOneWorkspace() {
    const fake = createFakeStore();
    await loadRememberedPanes({ store: fake.store });
    await mergeFromRecord(
      record([tab([pane({ cwd: "/w/a" }), pane({ cwd: "/w/b", agent: "codex" })])]),
    );
    return fake;
  }

  it("resuming one of two rows of a workspace leaves the other after a reload", async () => {
    const { store } = await seedTwoInOneWorkspace();
    await remove("claude:/w/a");
    resetRememberedPanes();
    await loadRememberedPanes({ store });
    expect(rememberedPanes.value.map((entry) => entry.id)).toEqual(["codex:/w/b"]);
  });

  it("forgetting a row drops it from the signal and the store", async () => {
    const { store, data } = await seedTwoInOneWorkspace();
    await forget("codex:/w/b");
    expect(rememberedPanes.value.map((entry) => entry.id)).toEqual(["claude:/w/a"]);
    expect((data.get("remembered") as { id: string }[]).map((entry) => entry.id)).toEqual([
      "claude:/w/a",
    ]);
    expect(store.save).toHaveBeenCalled();
  });

  it("an unknown id writes nothing", async () => {
    const { store } = await seedTwoInOneWorkspace();
    vi.mocked(store.set).mockClear();
    await remove("nope");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("a row survives a later merge of a record that no longer has it", async () => {
    const { store } = await seedTwoInOneWorkspace();
    await remove("claude:/w/a");
    await mergeFromRecord(record([tab([pane({ cwd: "/w/c" })])], 300));
    resetRememberedPanes();
    await loadRememberedPanes({ store });
    expect(rememberedPanes.value.map((entry) => entry.id).sort()).toEqual([
      "claude:/w/c",
      "codex:/w/b",
    ]);
  });
});

describe("loadRememberedPanes", () => {
  it("drops invalid stored entries and keeps the valid ones", async () => {
    const good = {
      id: "claude:/w/a",
      workspacePath: "/w",
      cwd: "/w/a",
      agent: "claude",
      launchCommand: null,
      title: null,
      branch: null,
      sessionId: null,
      savedAt: 1,
    };
    const { store } = createFakeStore({ remembered: [good, { id: 1 }, null] });
    await loadRememberedPanes({ store });
    expect(rememberedPanes.value).toEqual([good]);
  });

  it("an unreadable store loads empty and is never written", async () => {
    const { store } = createFakeStore({}, "unreadable");
    await loadRememberedPanes({ store });
    expect(rememberedPanes.value).toEqual([]);
    await mergeFromRecord(record([tab([pane()])]));
    await remove("claude:/w/a");
    expect(store.set).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
    expect(rememberedPanes.value).toEqual([]);
  });

  it("a read that throws leaves the module write-locked rather than writing over unknown bytes", async () => {
    const { store } = createFakeStore();
    vi.mocked(store.get).mockRejectedValueOnce(new Error("boom"));
    await loadRememberedPanes({ store });
    await mergeFromRecord(record([tab([pane()])]));
    expect(store.set).not.toHaveBeenCalled();
    expect(persistError.value).not.toBeNull();
  });

  it("reports writable only after a load that trusted the store", async () => {
    expect(rememberedStoreWritable()).toBe(false);
    await loadRememberedPanes({ store: createFakeStore({}, "unreadable").store });
    expect(rememberedStoreWritable()).toBe(false);
    await loadRememberedPanes({ store: createFakeStore().store });
    expect(rememberedStoreWritable()).toBe(true);
    const throwing = createFakeStore().store;
    vi.mocked(throwing.get).mockRejectedValueOnce(new Error("boom"));
    await loadRememberedPanes({ store: throwing });
    expect(rememberedStoreWritable()).toBe(false);
  });

  it("a mutation before any load writes nothing", async () => {
    await mergeFromRecord(record([tab([pane()])]));
    expect(rememberedPanes.value).toEqual([]);
  });

  it("a failed write is reported but keeps the in-memory row change", async () => {
    const { store } = createFakeStore();
    await loadRememberedPanes({ store });
    vi.mocked(store.set).mockRejectedValueOnce(new Error("disk full"));
    await mergeFromRecord(record([tab([pane()])]));
    expect(rememberedPanes.value).toHaveLength(1);
    expect(persistError.value).not.toBeNull();
  });
});
