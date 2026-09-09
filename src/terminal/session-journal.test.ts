import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushSessionJournal,
  initSessionJournal,
  readWindowRecords,
  resetSessionJournal,
  resumeSessionJournal,
  sessionArchive,
  sessionRestoreMarker,
  suspendSessionJournal,
  clearWindowRecord,
  type SessionJournalDeps,
} from "./session-journal";
import { MAX_JOURNAL_TABS, type SessionTab } from "../lib/session-schema";
import { tabViews, activeTabIndex, type TabView } from "./tabs-store";
import {
  fileSurfaces,
  activeFileTab,
  EMPTY_SURFACE,
  type FileSurfaceState,
} from "../files/file-surface-store";
import { persistError } from "../chrome/events";
import {
  agentBoardOpen,
  openAgentBoard,
  resetAgentBoardStore,
  stepAgentBoardBack,
  activateAgentBoard,
} from "../ui/agent-board-store";
import { noteTaskPrompt, paneTaskPrompts, resetTaskPrompts } from "./board-task-prompts";

const LEAF = { type: "leaf" } as const;
const DEBOUNCE_MS = 1000;

function tab(workspacePath: string | null): SessionTab {
  return {
    workspacePath,
    layout: LEAF,
    panes: [{ cwd: "/w/a", agent: "claude", launchCommand: null, taskPrompt: null }],
    name: null,
    dotColor: null,
  };
}

/** Poking `tabViews` is what the effect reacts to; its content is irrelevant
 * here since the journal reads the actual snapshot from `capture()`. */
function pokeTabViews(): void {
  tabViews.value = [...tabViews.value, {} as TabView].slice(0, 0);
}

type StoreSeam = NonNullable<SessionJournalDeps["store"]>;

interface FakeStore {
  readonly store: StoreSeam;
  readonly data: Map<string, unknown>;
}

function createFakeStore(): FakeStore {
  const data = new Map<string, unknown>();
  const store: StoreSeam = {
    get: vi.fn(async (key: string) => data.get(key)) as StoreSeam["get"],
    set: vi.fn(async (key: string, value: unknown) => {
      data.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      data.delete(key);
    }),
    save: vi.fn(async () => {}),
  };
  return { store, data };
}

function deps(overrides: Partial<SessionJournalDeps> = {}): SessionJournalDeps {
  return {
    capture: () => [],
    windowLabel: "main",
    isMain: true,
    debounceMs: DEBOUNCE_MS,
    ...overrides,
  };
}

describe("session journal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSessionJournal();
    tabViews.value = [];
    activeTabIndex.value = 0;
    fileSurfaces.value = new Map();
    activeFileTab.value = null;
    persistError.value = null;
  });

  afterEach(() => {
    resetSessionJournal();
    // The Board store is a window-scoped singleton, so a case that opened it
    // would leave every later `toMatchObject` in this file reading `true`.
    resetAgentBoardStore();
    resetTaskPrompts();
    vi.useRealTimers();
  });

  it("1. schedules one debounced write of window:<label> from capture() + activeTabIndex + main-only files", async () => {
    const { store, data } = createFakeStore();
    const surfaces = new Map<string, FileSurfaceState>([
      [
        "/w",
        {
          ...EMPTY_SURFACE,
          tabs: [{ path: "/w/a.ts", preview: false, openedAt: 1 }],
          activePath: "/w/a.ts",
        },
      ],
    ]);
    fileSurfaces.value = surfaces;
    activeFileTab.value = "/w/a.ts";
    activeTabIndex.value = 2;
    const capture = vi.fn(() => [tab("/w")]);

    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    expect(store.set).not.toHaveBeenCalledWith("window:main", expect.anything());

    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const record = data.get("window:main") as Record<string, unknown>;
    expect(record).toMatchObject({
      activeTabIndex: 2,
      tabs: [tab("/w")],
      files: [
        {
          workspacePath: "/w",
          // The journal persists identity and the preview flag, not the
          // window's open-order key: that clock is per window and per run, so
          // a restored tab is re-sequenced by whatever reopens it.
          tabs: [{ path: "/w/a.ts", preview: false }],
          activePath: "/w/a.ts",
        },
      ],
      activeFileTab: "/w/a.ts",
    });
    expect(typeof record.savedAt).toBe("number");
  });

  it("2. does not write twice for identical consecutive snapshots", async () => {
    const { store } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    vi.mocked(store.set).mockClear();
    vi.mocked(store.save).mockClear();

    // New array identity, same content — this is what the 2s poll produces.
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(store.set).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("3. persists an empty tabs array when the last tab closes", async () => {
    const { store, data } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main", isMain: false }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect((data.get("window:main") as { tabs: unknown[] }).tabs).toHaveLength(1);

    capture.mockReturnValue([]);
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect((data.get("window:main") as { tabs: unknown[] }).tabs).toEqual([]);
  });

  it("4. folds live tabs into the archive per workspace, keeping absent workspaces' old entries", async () => {
    const { store } = createFakeStore();
    const capture = vi.fn(() => [tab("/a")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(Object.keys(sessionArchive.value)).toEqual(["/a"]);
    const archivedA = sessionArchive.value["/a"];

    capture.mockReturnValue([tab("/b")]);
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(Object.keys(sessionArchive.value).sort()).toEqual(["/a", "/b"]);
    // "/a" is absent from the current snapshot — it keeps its old entry.
    expect(sessionArchive.value["/a"]).toEqual(archivedA);
    expect(sessionArchive.value["/b"].tabs).toEqual([tab("/b")]);
  });

  it("5a. suspendSessionJournal makes scheduled writes no-ops until resumed", async () => {
    const { store } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    vi.mocked(store.set).mockClear();

    suspendSessionJournal();
    capture.mockReturnValue([tab("/other")]);
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);
    expect(store.set).not.toHaveBeenCalled();

    resumeSessionJournal();
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(store.set).toHaveBeenCalledWith(
      "window:main",
      expect.objectContaining({ tabs: [tab("/other")] }),
    );
  });

  it("5a2. suspendSessionJournal cancels an already-armed timer, not just future schedules (M1)", async () => {
    const { store } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    vi.mocked(store.set).mockClear();

    capture.mockReturnValue([tab("/other")]);
    pokeTabViews(); // arms the debounce timer
    suspendSessionJournal(); // must cancel the now-pending write, not just gate future ones
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 5);

    expect(store.set).not.toHaveBeenCalled();

    resumeSessionJournal();
  });

  it("5a3. keeps nested lifecycle and restore suspensions independent", async () => {
    const { store } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    vi.mocked(store.set).mockClear();

    suspendSessionJournal();
    suspendSessionJournal();
    capture.mockReturnValue([tab("/restored")]);

    resumeSessionJournal();
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(store.set).not.toHaveBeenCalled();

    resumeSessionJournal();
    pokeTabViews();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(store.set).toHaveBeenCalledWith(
      "window:main",
      expect.objectContaining({ tabs: [tab("/restored")] }),
    );
  });

  it("5b. flushSessionJournal cancels the pending timer and writes immediately", async () => {
    const { store, data } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    capture.mockReturnValue([tab("/flushed")]);
    pokeTabViews();

    // Flush before the debounce would have fired.
    await flushSessionJournal();

    expect((data.get("window:main") as { tabs: SessionTab[] }).tabs).toEqual([tab("/flushed")]);
  });

  it("5c. flushSessionJournal still respects suspension — no write while suspended", async () => {
    const { store } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    vi.mocked(store.set).mockClear();

    suspendSessionJournal();
    capture.mockReturnValue([tab("/other")]);
    await flushSessionJournal();

    expect(store.set).not.toHaveBeenCalled();
  });

  it("6. degrades on a store failure with console.warn + reportPersistError, never throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: StoreSeam = {
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {
        throw new Error("disk full");
      }),
      delete: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    };
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));

    await expect(vi.advanceTimersByTimeAsync(DEBOUNCE_MS)).resolves.not.toThrow();

    expect(warn).toHaveBeenCalled();
    expect(persistError.value).not.toBeNull();
    warn.mockRestore();
  });

  it("7. capture() returning more than MAX_JOURNAL_TABS tabs writes only the cap, with a warning (M4)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { store, data } = createFakeStore();
    const overflowTabs = Array.from({ length: MAX_JOURNAL_TABS + 1 }, (_, i) => tab(`/w${i}`));
    const capture = vi.fn(() => overflowTabs);
    await initSessionJournal(deps({ capture, store, windowLabel: "main" }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    const record = data.get("window:main") as { tabs: SessionTab[] };
    expect(record.tabs).toHaveLength(MAX_JOURNAL_TABS);
    expect(record.tabs).toEqual(overflowTabs.slice(0, MAX_JOURNAL_TABS));
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("a key removed via clearWindowRecord does not appear in a later readWindowRecords()", async () => {
    const { store } = createFakeStore();
    const capture = vi.fn(() => [tab("/w")]);
    await initSessionJournal(deps({ capture, store, windowLabel: "secondary", isMain: false }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    let records = await readWindowRecords();
    expect(records.has("secondary")).toBe(true);

    await clearWindowRecord("secondary");
    records = await readWindowRecords();
    expect(records.has("secondary")).toBe(false);
  });

  describe("agentBoardOpen", () => {
    it("writes the board's open state while the window holds tabs", async () => {
      const { store, data } = createFakeStore();
      await initSessionJournal(deps({ isMain: true, store, capture: () => [tab("/w")] }));
      openAgentBoard();
      await flushSessionJournal();
      expect((data.get("window:main") as { agentBoardOpen: boolean }).agentBoardOpen).toBe(true);
      expect(data.get("window:main")).toMatchObject({ agentBoardSurfaceActive: true });
    });

    it("rewrites it false with no tabs", async () => {
      const { store, data } = createFakeStore();
      await initSessionJournal(deps({ isMain: true, store, capture: () => [] }));
      openAgentBoard();
      await flushSessionJournal();
      // Zero tabs = no Board: the chip cannot render and the action is scope
      // "pane", so a remembered `true` would restore a surface with no way out.
      expect((data.get("window:main") as { agentBoardOpen: boolean }).agentBoardOpen).toBe(false);
      expect(data.get("window:main")).toMatchObject({ agentBoardSurfaceActive: false });
    });

    it("re-runs the write effect when only the board's state moved", async () => {
      const { store, data } = createFakeStore();
      await initSessionJournal(deps({ isMain: true, store, capture: () => [tab("/w")] }));
      // The first debounced write lands with the board closed...
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect((data.get("window:main") as { agentBoardOpen: boolean }).agentBoardOpen).toBe(false);
      // ...and opening the chip is the ONLY signal that moves before the next
      // one, so this fails unless the effect reads `agentBoardOpen`.
      openAgentBoard();
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect((data.get("window:main") as { agentBoardOpen: boolean }).agentBoardOpen).toBe(true);
      expect(agentBoardOpen.value).toBe(true);
    });
  });

  it("persists switching away from and back to an already-open Board", async () => {
    const { store, data } = createFakeStore();
    await initSessionJournal(deps({ store, capture: () => [tab("/w")] }));
    openAgentBoard();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    stepAgentBoardBack();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(data.get("window:main")).toMatchObject({
      agentBoardOpen: true,
      agentBoardSurfaceActive: false,
    });
    activateAgentBoard();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(data.get("window:main")).toMatchObject({
      agentBoardOpen: true,
      agentBoardSurfaceActive: true,
    });
  });

  it("re-runs the write effect when only a pane's task prompt was noted", async () => {
    // `TASK_PROMPT_AUTOSEND` is false, so the prompt is normally recorded
    // AFTER the agent appeared and `tabViews` already moved: nothing else
    // changes while it sits unsent in the composer, and without this
    // dependency a crash in that window loses the one field the Board's card
    // is for.
    const { store, data } = createFakeStore();
    const capture = (): SessionTab[] => [
      {
        workspacePath: "/w",
        layout: LEAF,
        panes: [
          {
            cwd: "/w/a",
            agent: "claude",
            launchCommand: null,
            taskPrompt: paneTaskPrompts.value.get(1) ?? null,
          },
        ],
        name: null,
        dotColor: null,
      },
    ];
    await initSessionJournal(deps({ isMain: true, store, capture }));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const written = () =>
      (data.get("window:main") as { tabs: SessionTab[] }).tabs[0].panes[0].taskPrompt;
    expect(written()).toBeNull();

    noteTaskPrompt(1, "Ship the rail");
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(written()).toBe("Ship the rail");
  });

  describe("sessionRestoreMarker", () => {
    it("take() is false with no marker; set() leaves it set (take does not clear); clear() removes it", async () => {
      const { store } = createFakeStore();
      await initSessionJournal(deps({ store }));

      expect(await sessionRestoreMarker.take()).toBe(false);

      await sessionRestoreMarker.set();
      expect(await sessionRestoreMarker.take()).toBe(true);
      expect(await sessionRestoreMarker.take()).toBe(true);

      await sessionRestoreMarker.clear();
      expect(await sessionRestoreMarker.take()).toBe(false);
    });
  });
});
