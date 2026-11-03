import { readFileSync } from "node:fs";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { installQuitGuard, type QuitFlowDeps, type QuitPreparationDeps } from "../lib/quit-guard";
import {
  clearWindowRecord,
  flushSessionJournal,
  initSessionJournal,
  resetSessionJournal,
  resumeSessionJournal,
  suspendSessionJournal,
  type SessionJournalDeps,
} from "../terminal/session-journal";
import { lastSession } from "../terminal/last-session-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Execute the shipping App composition rather than copying its callbacks.
function runAppComposition(bindings: Record<string, unknown>): void {
  const source = readFileSync("src/ui/app.tsx", "utf8");
  const start = source.indexOf("    let closeSuspended");
  const end = source.indexOf("    return () => unlisten?.();", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const body = transpileModule(`let unlisten; ${source.slice(start, end)}`, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None },
  }).outputText;
  new Function(...Object.keys(bindings), body)(...Object.values(bindings));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetSessionJournal();
  lastSession.value = null;
});
afterEach(() => {
  resetSessionJournal();
  vi.clearAllTimers();
  vi.useRealTimers();
});

it.each(["during-write", "after-ACK", "after-cancel"])(
  "a close awaiting its window label cannot clear the quit snapshot (%s)",
  async (timing) => {
    const label = deferred<string>();
    const writeStarted = deferred<void>();
    const releaseWrite = deferred<void>();
    const closeCanceled = deferred<void>();
    const acknowledged = deferred<void>();
    let records = new Map<string, unknown>();
    const store: NonNullable<SessionJournalDeps["store"]> = {
      get: async <T>(key: string) => records.get(key) as T | undefined,
      set: async (key, value) => {
        records = new Map(records).set(key, value);
      },
      delete: async (key) => {
        const next = new Map(records);
        next.delete(key);
        records = next;
      },
      save: async () => {},
      patch: async (values, deleted = []) => {
        writeStarted.resolve();
        await releaseWrite.promise;
        const next = new Map(records);
        for (const key of deleted) next.delete(key);
        for (const [key, value] of Object.entries(values)) next.set(key, value);
        records = next;
      },
    };
    await initSessionJournal({
      windowLabel: "main",
      isMain: false,
      store,
      capture: () => [
        {
          workspacePath: "/w",
          name: null,
          dotColor: null,
          layout: { type: "leaf" },
          panes: [{ cwd: "/w", agent: null, launchCommand: null, taskPrompt: null }],
        },
      ],
    });

    const listeners = new Map<string, (payload: unknown) => void>();
    const host = globalThis as typeof globalThis & { __deckHost?: unknown };
    const previousHost = host.__deckHost;
    host.__deckHost = {
      listen: (event: string, handler: (payload: unknown) => void) => {
        listeners.set(event, handler);
        return () => {
          listeners.delete(event);
        };
      },
    };
    let installed!: Promise<() => void>;
    const bindings = {
      installQuitGuard: (deps: {
        quit: QuitFlowDeps;
        close: QuitFlowDeps;
        preparation: QuitPreparationDeps;
      }) => {
        installed = installQuitGuard(deps);
        return installed;
      },
      answering: () => ({ ask: async () => true }),
      QUIT_COPY: {},
      WINDOW_CLOSE_COPY: {},
      suspendSessionJournal,
      resumeSessionJournal,
      flushSessionJournal,
      clearWindowRecord,
      flushSettingsSave: async () => {},
      currentWindowLabel: () => label.promise,
      lastSession,
      invoke: async (_channel: string, payload: { ok: boolean }) => {
        expect(payload.ok).toBe(true);
        acknowledged.resolve();
      },
      reportPersistError: vi.fn(),
      defaultPtyClient: {
        confirmQuit: vi.fn(),
        cancelQuit: vi.fn(),
        confirmCloseWindow: vi.fn(),
        cancelCloseWindow: async () => {
          closeCanceled.resolve();
        },
      },
    };
    try {
      runAppComposition(bindings);
      const unlisten = await installed;
      listeners.get("window:close-requested")!({
        requestId: 1,
        busyProcesses: [],
        busyPanes: 0,
        fullyNamed: true,
        dirtyFiles: [],
      });
      listeners.get("quit:prepare")!({ requestId: 2 });
      await writeStarted.promise;
      // Main can broadcast prepare before this earlier window_label invocation
      // replies. Its late continuation must not enqueue a delete behind the write.
      if (timing === "after-ACK") {
        releaseWrite.resolve();
        await acknowledged.promise;
      }
      if (timing === "after-cancel") listeners.get("quit:resume")!({ requestId: 2 });
      label.resolve("main");
      await Promise.resolve();
      releaseWrite.resolve();
      if (timing !== "after-cancel") await acknowledged.promise;
      await closeCanceled.promise;
      expect(records.get("window:main")).toMatchObject({ tabs: [{ panes: [{ cwd: "/w" }] }] });
      unlisten();
    } finally {
      host.__deckHost = previousHost;
    }
  },
);

it("a canceled old close cannot release a newer close's journal suspension", async () => {
  const oldLabel = deferred<string>();
  const newLabel = deferred<string>();
  let flows!: { close: QuitFlowDeps; preparation: QuitPreparationDeps };
  const resume = vi.fn();
  const clear = vi.fn(async () => {});
  const bindings = {
    installQuitGuard: (deps: typeof flows) => {
      flows = deps;
      return Promise.resolve(() => {});
    },
    answering: () => ({ ask: async () => true }),
    QUIT_COPY: {},
    WINDOW_CLOSE_COPY: {},
    suspendSessionJournal: vi.fn(),
    resumeSessionJournal: resume,
    flushSessionJournal: async () => {},
    clearWindowRecord: clear,
    flushSettingsSave: async () => {},
    currentWindowLabel: vi
      .fn()
      .mockReturnValueOnce(oldLabel.promise)
      .mockReturnValueOnce(newLabel.promise),
    lastSession,
    invoke: async () => {},
    reportPersistError: vi.fn(),
    defaultPtyClient: { cancelCloseWindow: async () => {} },
  };
  runAppComposition(bindings);
  const oldClose = flows.close.flush!(1);
  flows.preparation.suspend();
  flows.preparation.resume();
  const newClose = flows.close.flush!(2);
  oldLabel.resolve("main");
  await oldClose;
  await flows.close.cancel(1);
  expect(clear).not.toHaveBeenCalled();
  expect(resume).toHaveBeenCalledTimes(2);
  newLabel.resolve("main");
  await newClose;
  expect(clear).toHaveBeenCalledExactlyOnceWith("main");
  await flows.close.cancel(2);
  expect(resume).toHaveBeenCalledTimes(3);
});
