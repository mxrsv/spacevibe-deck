import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { IpcMainInvokeEvent } from "electron";
import { CHANNELS } from "./channels";
import {
  CloseFlight,
  QuitFlight,
  QUIT_PREPARATION_TIMEOUT_MS,
  type QuitWindow,
} from "../quit-flow";
import { installQuitGuard, type QuitFlowDeps } from "../../src/lib/quit-guard";
import { registerQuit } from "./register-quit";

const handlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => unknown>(),
);
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown) =>
      handlers.set(name, handler),
  },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const flight = new QuitFlight();
  const windows: QuitWindow[] = [
    { label: "main", senderId: 1 },
    { label: "deck-2", senderId: 2 },
  ];
  const order: string[] = [];
  const killAll = vi.fn(async () => {
    order.push("kill");
  });
  const telemetry = vi.fn(async () => {
    order.push("telemetry");
  });
  const saveAll = vi.fn(async () => {
    order.push("save");
  });
  const exit = vi.fn(() => {
    order.push("exit");
  });
  const send = vi.fn((_label: string, _event: string, _payload: { requestId: number }) => true);
  const preparation = registerQuit(flight, {
    windows: () => [...windows],
    send,
    labelOf: (event) => {
      const window = windows.find((candidate) => candidate.senderId === event.sender.id);
      if (window === undefined) throw new Error("Unknown sender");
      return window.label;
    },
    teardown: () =>
      killAll()
        .then(() => telemetry())
        .then(() => saveAll())
        .finally(exit),
  });
  const call = (channel: string, senderId: number, payload: unknown) =>
    handlers.get(channel)!({ sender: { id: senderId } } as IpcMainInvokeEvent, payload);
  const begin = () => flight.tryBegin("main", 1)!;
  const ack = (senderId: number, requestId: number, ok: unknown = true) =>
    call(CHANNELS.quitPrepared, senderId, { requestId, ok });
  return {
    flight,
    windows,
    order,
    killAll,
    telemetry,
    saveAll,
    exit,
    send,
    preparation,
    call,
    begin,
    ack,
  };
}

beforeEach(() => {
  handlers.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("authenticated app-wide quit preparation", () => {
  it("waits for a slow peer and holds one flight through telemetry and store flush", async () => {
    const f = fixture();
    const telemetry = deferred();
    f.telemetry.mockImplementation(async () => {
      f.order.push("telemetry");
      await telemetry.promise;
    });
    const requestId = f.begin();
    f.call(CHANNELS.confirmQuit, 1, { requestId });
    expect(f.send.mock.calls).toEqual([
      ["main", "quit:prepare", { requestId }],
      ["deck-2", "quit:prepare", { requestId }],
    ]);
    f.ack(1, requestId);
    expect(f.killAll).not.toHaveBeenCalled();
    expect(f.preparation.blocksClose()).toBe(true);
    expect(f.flight.tryBegin("deck-2", 2)).toBeNull();
    f.ack(2, requestId);
    await Promise.resolve();
    f.call(CHANNELS.cancelQuit, 1, { requestId });
    f.call(CHANNELS.confirmQuit, 1, { requestId });
    f.ack(2, requestId);
    expect(f.killAll).toHaveBeenCalledTimes(1);
    expect(f.flight.tryBegin("deck-2", 2)).toBeNull();
    expect(f.exit).not.toHaveBeenCalled();
    telemetry.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.order).toEqual(["kill", "telemetry", "save", "exit"]);
  });

  it("rejects foreign, malformed and stale confirm/cancel replies without unlocking the dialog", () => {
    const f = fixture();
    const requestId = f.begin();
    for (const channel of [CHANNELS.confirmQuit, CHANNELS.cancelQuit]) {
      for (const sender of [2, 99]) f.call(channel, sender, { requestId });
      for (const payload of [
        null,
        {},
        { requestId: "1" },
        { requestId: NaN },
        { requestId: 0 },
        { requestId: requestId + 1 },
      ])
        f.call(channel, 1, payload);
    }
    expect(f.send).not.toHaveBeenCalled();
    expect(f.flight.tryBegin("main", 1)).toBeNull();
    f.call(CHANNELS.cancelQuit, 1, { requestId });
    expect(f.begin()).toBe(requestId + 1);
  });

  it("never counts stale, foreign, duplicate or nonboolean acknowledgments", () => {
    const f = fixture();
    const requestId = f.begin();
    f.call(CHANNELS.confirmQuit, 1, { requestId });
    f.ack(99, requestId);
    f.ack(2, requestId + 1);
    f.ack(2, requestId, "true");
    f.ack(1, requestId);
    f.ack(1, requestId, false);
    expect(f.killAll).not.toHaveBeenCalled();
    expect(f.preparation.blocksClose()).toBe(true);
    f.ack(2, requestId);
    expect(f.killAll).toHaveBeenCalledTimes(1);
  });

  it.each(["failed flush", "timeout", "renderer death", "new window", "replaced sender"])(
    "cancels %s without killing panes, resumes both renderers, and allows retry",
    async (reason) => {
      const f = fixture();
      const requestId = f.begin();
      f.call(CHANNELS.confirmQuit, 1, { requestId });
      f.ack(1, requestId);
      if (reason === "failed flush") f.ack(2, requestId, false);
      if (reason === "timeout") await vi.advanceTimersByTimeAsync(QUIT_PREPARATION_TIMEOUT_MS);
      if (reason === "renderer death") f.preparation.windowChanged();
      if (reason === "new window") {
        f.windows.push({ label: "deck-3", senderId: 3 });
        f.preparation.windowChanged();
      }
      if (reason === "replaced sender") {
        f.windows[0] = { label: "main", senderId: 9 };
        f.ack(2, requestId);
      }
      expect(f.killAll).not.toHaveBeenCalled();
      expect(f.preparation.blocksClose()).toBe(false);
      expect(f.send.mock.calls.filter((call) => call[1] === "quit:resume")).toEqual([
        ["main", "quit:resume", { requestId }],
        ["deck-2", "quit:resume", { requestId }],
      ]);
      f.windows.splice(
        0,
        f.windows.length,
        { label: "main", senderId: 1 },
        { label: "deck-2", senderId: 2 },
      );
      const retry = f.begin();
      f.call(CHANNELS.confirmQuit, 1, { requestId: retry });
      f.ack(1, requestId);
      f.ack(2, requestId);
      expect(f.killAll).not.toHaveBeenCalled();
      f.ack(1, retry);
      f.ack(2, retry);
      expect(f.killAll).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, "throw"])(
    "cancels a failed event send (%s) and resumes windows already preparing",
    (failure) => {
      const f = fixture();
      f.send.mockImplementation((label, event) => {
        if (label === "deck-2" && event === "quit:prepare") {
          if (failure === "throw") throw new Error("Destroyed webContents");
          return false;
        }
        return true;
      });
      const requestId = f.begin();
      f.call(CHANNELS.confirmQuit, 1, { requestId });
      expect(f.killAll).not.toHaveBeenCalled();
      expect(f.preparation.blocksClose()).toBe(false);
      expect(f.begin()).toBe(requestId + 1);
      expect(f.send).toHaveBeenCalledWith("main", "quit:resume", { requestId });
    },
  );
});

it("preserves both real renderer journals through the real prepare/ACK events and delayed teardown", async () => {
  const f = fixture();
  const journals: Array<typeof import("../../src/terminal/session-journal")> = [];
  let records = new Map<string, unknown>();
  const exits: Array<() => void> = [];
  const listeners = new Map<string, Map<string, (payload: unknown) => void>>();
  const unlisten: Array<() => void> = [];
  const peerSave = deferred();
  const telemetry = deferred();
  const host = globalThis as typeof globalThis & { __deckHost?: unknown };
  const previousHost = host.__deckHost;
  try {
    for (const { label, senderId } of f.windows) {
      vi.resetModules();
      const journal = await import("../../src/terminal/session-journal");
      const tabsStore = await import("../../src/terminal/tabs-store");
      journals.push(journal);
      let count = 1;
      let delaySave = false;
      await journal.initSessionJournal({
        windowLabel: label,
        isMain: false,
        capture: () => [
          {
            workspacePath: "/w",
            name: null,
            dotColor: null,
            layout:
              count === 2
                ? {
                    type: "split",
                    direction: "horizontal",
                    ratio: 0.5,
                    first: { type: "leaf" },
                    second: { type: "leaf" },
                  }
                : { type: "leaf" },
            panes: Array.from({ length: count }, () => ({
              cwd: "/w",
              agent: null,
              launchCommand: null,
              taskPrompt: null,
            })),
          },
        ],
        store: {
          get: async <T>(key: string) => records.get(key) as T | undefined,
          set: async (key, value) => {
            records.set(key, value);
          },
          delete: async (key) => records.delete(key),
          save: async () => {
            if (delaySave) await peerSave.promise;
          },
          patch: async (values, deleted = []) => {
            const next = new Map(records);
            for (const key of deleted) next.delete(key);
            for (const [key, value] of Object.entries(values)) next.set(key, value);
            records = next;
            if (delaySave) await peerSave.promise;
          },
        },
      });
      await journal.flushSessionJournal();
      // Make the final snapshot differ so the strict flush must actually save.
      count = 2;
      delaySave = label === "deck-2";
      const events = new Map<string, (payload: unknown) => void>();
      listeners.set(label, events);
      host.__deckHost = {
        listen: (event: string, handler: (payload: unknown) => void) => {
          events.set(event, handler);
          return () => {
            events.delete(event);
          };
        },
      };
      const flow: QuitFlowDeps = {
        ask: async () => true,
        confirm: async (requestId) => {
          f.call(CHANNELS.confirmQuit, senderId, { requestId });
        },
        cancel: async (requestId) => {
          f.call(CHANNELS.cancelQuit, senderId, { requestId });
        },
      };
      unlisten.push(
        await installQuitGuard({
          quit: flow,
          close: flow,
          preparation: {
            suspend: journal.suspendSessionJournal,
            flush: () => journal.flushSessionJournal({ force: true, strict: true }),
            resume: journal.resumeSessionJournal,
            acknowledge: async (requestId, ok) => {
              f.ack(senderId, requestId, ok);
            },
            failed: vi.fn(),
          },
        }),
      );
      exits.push(() => {
        count = 1;
        tabsStore.tabViews.value = [];
      });
    }
    f.send.mockImplementation((label, event, payload) => {
      listeners.get(label)?.get(event)?.(payload);
      return true;
    });
    f.killAll.mockImplementation(async () => {
      f.order.push("kill");
      exits.forEach((exit) => exit());
    });
    f.telemetry.mockImplementation(async () => {
      f.order.push("telemetry");
      await telemetry.promise;
    });
    const requestId = f.begin();
    listeners.get("main")!.get("quit-requested")!({
      requestId,
      busyProcesses: [],
      busyPanes: 0,
      fullyNamed: true,
      dirtyFiles: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.killAll).not.toHaveBeenCalled();
    peerSave.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.killAll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    for (const label of ["main", "deck-2"]) {
      expect(records.get(`window:${label}`)).toMatchObject({
        tabs: [{ panes: [{ cwd: "/w" }, { cwd: "/w" }] }],
      });
    }
    expect(f.exit).not.toHaveBeenCalled();
    telemetry.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.order).toEqual(["kill", "telemetry", "save", "exit"]);
  } finally {
    host.__deckHost = previousHost;
    unlisten.forEach((dispose) => dispose());
    journals.forEach((journal) => journal.resetSessionJournal());
  }
});

function installMainCloseHandler(f: ReturnType<typeof fixture>, closeFlight: CloseFlight) {
  const source = readFileSync("electron/main.ts", "utf8");
  const start = source.indexOf("ipcMain.handle(CHANNELS.confirmCloseWindow");
  const end = source.indexOf("ipcMain.handle(CHANNELS.cancelCloseWindow", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const terminate = vi.fn();
  const destroy = vi.fn();
  const bindings = {
    ipcMain: {
      handle: (
        channel: string,
        handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown,
      ) => handlers.set(channel, handler),
    },
    CHANNELS,
    closeFlight,
    quitPreparation: f.preparation,
    labelOf: (event: IpcMainInvokeEvent) => {
      const window = f.windows.find((candidate) => candidate.senderId === event.sender.id);
      if (window === undefined) throw new Error("Unknown sender");
      return window.label;
    },
    coordinator: { panesForWindow: () => [17] },
    pty: { terminate },
    windows: new Map(f.windows.map(({ label }) => [label, { destroy }])),
  };
  // Run the actual main registration so moving the guard back before take()
  // reproduces the lost close flight instead of passing an unrelated helper.
  new Function(...Object.keys(bindings), source.slice(start, end))(...Object.values(bindings));
  return { terminate, destroy };
}

it("releases a queued close confirmation blocked by preparation so close works after quit cancels", () => {
  const f = fixture();
  const close = new CloseFlight();
  const closing = close.tryBegin("main")!;
  const { terminate, destroy } = installMainCloseHandler(f, close);
  const quitting = f.flight.tryBegin("deck-2", 2)!;
  f.call(CHANNELS.confirmQuit, 2, { requestId: quitting });
  f.call(CHANNELS.confirmCloseWindow, 1, { requestId: closing });
  expect(terminate).not.toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
  f.preparation.windowChanged();
  expect(close.tryBegin("main")).not.toBeNull();
});

it.each(["foreign", "stale"])(
  "a %s close confirmation cannot consume another pending close during preparation",
  (reply) => {
    const f = fixture();
    const close = new CloseFlight();
    const old = close.tryBegin("main")!;
    close.take("main", old);
    const main = close.tryBegin("main")!;
    const peer = close.tryBegin("deck-2")!;
    const { terminate, destroy } = installMainCloseHandler(f, close);
    const quitting = f.begin();
    f.call(CHANNELS.confirmQuit, 1, { requestId: quitting });
    f.call(CHANNELS.confirmCloseWindow, reply === "foreign" ? 2 : 1, {
      requestId: reply === "foreign" ? main : old,
    });
    f.preparation.windowChanged();
    expect(close.take("main", main)).toBe(true);
    expect(close.take("deck-2", peer)).toBe(true);
    expect(terminate).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  },
);
