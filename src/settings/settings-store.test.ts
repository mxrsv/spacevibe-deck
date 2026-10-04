import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.hoisted(() => vi.fn(async (_key: string, _value: unknown) => {}));
const saveMock = vi.hoisted(() => vi.fn(async () => {}));
const getMock = vi.hoisted(() => vi.fn(async (): Promise<unknown> => undefined));
const loadMock = vi.hoisted(() =>
  vi.fn(async () => ({ get: getMock, set: setMock, save: saveMock })),
);
vi.mock("../host/store-host", () => ({
  Store: {
    load: loadMock,
  },
}));

import {
  configureSettingsSync,
  flushSettingsSave,
  initSettings,
  settings,
  updateSettings,
  openDockTab,
  revealDockTab,
  settingsLoadState,
} from "./settings-store";
import { createMemorySettingsSync, type SettingsSyncClient } from "./settings-sync";
import { DEFAULT_SETTINGS } from "./settings-schema";
import { persistError } from "../chrome/events";
import { mergeSettings } from "../../electron/settings-merge";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

describe("settings persistence", () => {
  beforeEach(async () => {
    loadMock.mockClear();
    loadMock.mockImplementation(async () => ({
      get: getMock,
      set: setMock,
      save: saveMock,
      loadState: { state: "ready", fresh: false },
    }));
    getMock.mockReset();
    getMock.mockResolvedValue(undefined);
    setMock.mockReset();
    saveMock.mockClear();
    persistError.value = null;
    // Install the in-memory sync BEFORE initSettings, which otherwise falls
    // back to the real host client. On Tauri that client was harmless in a
    // test; the Electron facade throws when no bridge is present, which is
    // deliberate — a silent no-op would look like a hung PTY in production.
    configureSettingsSync(createMemorySettingsSync());
    await initSettings();
  });

  it("surfaces a failed settings write to the user", async () => {
    configureSettingsSync({
      sendPatch: vi.fn().mockRejectedValueOnce(new Error("disk full")),
      listenMerged: async () => () => {},
    });
    await initSettings();
    updateSettings({ fontSize: 15 });
    await vi.waitFor(() => {
      expect(persistError.value).not.toBeNull();
    });
  });

  it("flushSettingsSave forces the autosaved store to disk", async () => {
    await flushSettingsSave();
    expect(saveMock).toHaveBeenCalled();
  });

  it("keeps disjoint edits from windows holding the same older snapshot", async () => {
    const snapshot = { ...DEFAULT_SETTINGS, fontSize: 13, scrollback: 10_000 };
    let saved: unknown = snapshot;
    setMock.mockImplementationOnce(async (_key, value) => {
      saved = value;
    });
    setMock.mockImplementationOnce(async (_key, value) => {
      saved = value;
    });
    const sendPatch = vi.fn(async (patch) => {
      saved = mergeSettings(saved, patch);
      return saved;
    });
    configureSettingsSync({ sendPatch, listenMerged: async () => () => {} });
    await initSettings();

    settings.value = snapshot;
    updateSettings({ fontSize: 14 });
    await Promise.resolve();
    // The second window edits before receiving the first window's broadcast.
    settings.value = snapshot;
    updateSettings({ scrollback: 50_000 });
    await Promise.resolve();

    expect(saved).toMatchObject({ fontSize: 14, scrollback: 50_000 });
    expect(setMock).not.toHaveBeenCalled();
    expect(sendPatch.mock.calls.map(([patch]) => patch)).toEqual([
      { fontSize: 14 },
      { scrollback: 50_000 },
    ]);
  });

  it("waits for in-flight patches before flushing the host store", async () => {
    const patch = deferred<unknown>();
    configureSettingsSync({ sendPatch: () => patch.promise, listenMerged: async () => () => {} });
    await initSettings();
    saveMock.mockClear();
    updateSettings({ fontSize: 14 });
    saveMock.mockClear();
    const flushing = flushSettingsSave();
    try {
      await Promise.resolve();
      expect(saveMock).not.toHaveBeenCalled();
    } finally {
      patch.resolve({ ...DEFAULT_SETTINGS, fontSize: 14 });
      await flushing;
    }
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("waits for every pending patch before saving", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const sendPatch = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    configureSettingsSync({ sendPatch, listenMerged: async () => () => {} });
    await initSettings();
    updateSettings({ fontSize: 14 });
    updateSettings({ scrollback: 50_000 });
    const flushing = flushSettingsSave();
    first.resolve({});
    await Promise.resolve();
    await Promise.resolve();
    expect(saveMock).not.toHaveBeenCalled();
    second.resolve({});
    await flushing;
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a flush when a pending patch fails and keeps the error visible", async () => {
    const patch = deferred<unknown>();
    configureSettingsSync({ sendPatch: () => patch.promise, listenMerged: async () => () => {} });
    await initSettings();
    updateSettings({ fontSize: 14 });
    const flushing = flushSettingsSave();
    patch.reject(new Error("disk full"));
    await expect(flushing).rejects.toThrow("disk full");
    expect(persistError.value).toContain("Couldn't save settings");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("persists checkout colors and reloads them through the settings schema", async () => {
    const colors = { "/repo/main": "purple", "/other/main": "cyan" } as const;
    let saved: unknown = DEFAULT_SETTINGS;
    const sendPatch = vi.fn(async (patch) => {
      saved = mergeSettings(saved, patch);
      return saved;
    });
    configureSettingsSync({ sendPatch, listenMerged: async () => () => {} });
    await initSettings();
    updateSettings({ worktreeColors: colors });
    await flushSettingsSave();
    expect(sendPatch).toHaveBeenCalledWith({ worktreeColors: colors });
    expect(setMock).not.toHaveBeenCalled();
    settings.value = DEFAULT_SETTINGS;
    getMock.mockResolvedValueOnce(saved);
    await initSettings();
    expect(settings.value.worktreeColors).toEqual(colors);
  });

  it("reports a load failure and blocks writes until a retry succeeds", async () => {
    const before = settings.value;
    const sendPatch = vi.fn(async () => ({}));
    configureSettingsSync({ sendPatch, listenMerged: async () => () => {} });
    setMock.mockClear();
    loadMock.mockRejectedValueOnce(new Error("permission denied"));

    await initSettings();
    updateSettings({ fontSize: before.fontSize + 1 });

    expect(settingsLoadState.value).toEqual({
      status: "error",
      message: "Couldn't load settings. Defaults are temporary and won't overwrite settings.json.",
    });
    expect(settings.value.fontSize).toBe(before.fontSize + 1);
    expect(sendPatch).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
    await initSettings();
    updateSettings({ fontSize: 17 });
    expect(sendPatch).toHaveBeenCalledWith({ fontSize: 17 });
  });

  it("blocks patches while the settings snapshot is still loading", async () => {
    const loading = deferred<unknown>();
    const sendPatch = vi.fn(async () => ({}));
    configureSettingsSync({ sendPatch, listenMerged: async () => () => {} });
    loadMock.mockImplementationOnce(async () => {
      await loading.promise;
      return {
        get: getMock,
        set: setMock,
        save: saveMock,
        loadState: { state: "ready", fresh: false },
      };
    });
    const initializing = initSettings();
    updateSettings({ fontSize: 17 });
    expect(sendPatch).not.toHaveBeenCalled();
    loading.resolve(undefined);
    await initializing;
    updateSettings({ fontSize: 18 });
    expect(sendPatch).toHaveBeenCalledWith({ fontSize: 18 });
  });

  it("treats a null settings payload as unreadable rather than as fresh defaults", async () => {
    getMock.mockResolvedValueOnce(null);

    await initSettings();

    expect(settingsLoadState.value.status).toBe("error");
  });

  it("ignores an older load failure after a retry succeeds", async () => {
    const oldLoad = deferred<never>();
    loadMock
      .mockImplementationOnce(() => oldLoad.promise)
      .mockImplementationOnce(async () => ({
        get: getMock,
        set: setMock,
        save: saveMock,
        loadState: { state: "ready", fresh: false },
      }));

    const first = initSettings();
    const retry = initSettings();
    await retry;
    oldLoad.reject(new Error("stale permission failure"));
    await first;

    expect(settingsLoadState.value).toEqual({ status: "ready" });
  });
});

describe("settings patch sync", () => {
  it("re-registers the merged listener after a transient subscription failure", async () => {
    const listenMerged = vi
      .fn<SettingsSyncClient["listenMerged"]>()
      .mockRejectedValueOnce(new Error("bridge not ready"))
      .mockResolvedValueOnce(() => {});
    configureSettingsSync({
      sendPatch: vi.fn(async () => ({})),
      listenMerged,
    });

    await initSettings();
    expect(settingsLoadState.value.status).toBe("error");

    await initSettings();

    expect(settingsLoadState.value.status).toBe("ready");
    expect(listenMerged).toHaveBeenCalledTimes(2);
  });

  it("keeps a merged broadcast delivered while subscribing newer than disk", async () => {
    getMock.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, fontSize: 15 });
    const client: SettingsSyncClient = {
      async sendPatch() {
        return {};
      },
      async listenMerged(handler) {
        handler({ ...DEFAULT_SETTINGS, fontSize: 20 });
        return () => {};
      },
    };
    configureSettingsSync(client);

    await initSettings();

    expect(settings.value.fontSize).toBe(20);
  });

  it("sends only the patch, not the whole object, and updates the signal at once", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();

    updateSettings({ fontSize: 17 });

    expect(settings.value.fontSize).toBe(17);
    expect(sync.patches).toEqual([{ fontSize: 17 }]);
  });

  it("adopts a merged broadcast from another window", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();

    sync.broadcast({ ...settings.value, fontSize: 19 });

    expect(settings.value.fontSize).toBe(19);
  });

  // Both halves of the boundary rule. They are NOT the same case, and the
  // difference is the whole point: a structurally broken message is a bug in
  // the sender and must change nothing, while a well-shaped message with one
  // junk field goes through this repo's existing coercion.
  it("ignores a structurally invalid broadcast and keeps live settings untouched", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();
    updateSettings({ fontSize: 17 });
    const before = settings.value;

    sync.broadcast(null);
    sync.broadcast("not settings");
    sync.broadcast(42);
    sync.broadcast([]);

    // Not merely "still 17" — the exact object, proving nothing was rebuilt
    // from DEFAULT_SETTINGS, which is what validateSettings would have
    // returned for any of these three (settings-schema.ts:199-201).
    expect(settings.value).toBe(before);
    expect(settings.value.fontSize).toBe(17);
  });

  it("coerces a single bad field in an otherwise well-formed broadcast", async () => {
    const sync = createMemorySettingsSync();
    configureSettingsSync(sync);
    await initSettings();

    sync.broadcast({ ...DEFAULT_SETTINGS, fontSize: "huge" });

    // Coercion, not rejection: the message was understandable, so the rest
    // of it applies and this one field falls back.
    expect(settings.value.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
  });
});

describe("revealDockTab", () => {
  beforeEach(() => {
    settings.value = { ...DEFAULT_SETTINGS };
  });

  it("opens the dock on the asked-for tab when it is closed", () => {
    expect(revealDockTab("usage")).toBe(false);
    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("usage");
  });

  it("switches tabs without closing when another one is showing", () => {
    settings.value = { ...DEFAULT_SETTINGS, dockOpen: true, dockTab: "usage" };

    expect(revealDockTab("explorer")).toBe(false);
    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("explorer");
  });

  // Press it again to put it away — and say so, because only this branch hands
  // focus back to the pane.
  it("closes, and reports closing, when the asked-for tab is already showing", () => {
    settings.value = { ...DEFAULT_SETTINGS, dockOpen: true, dockTab: "usage" };

    expect(revealDockTab("usage")).toBe(true);
    expect(settings.value.dockOpen).toBe(false);
    // The tab is remembered, so reopening lands where the user left off.
    expect(settings.value.dockTab).toBe("usage");
  });
});

describe("openDockTab", () => {
  beforeEach(() => {
    settings.value = { ...DEFAULT_SETTINGS };
  });

  it("opens the dock on the asked-for tab", () => {
    openDockTab("sessions");

    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("sessions");
  });

  // The whole difference from `revealDockTab`: the rail's rows are shortcuts
  // that open, so pressing the row of the tab already on screen must not be
  // the thing that puts the column away.
  it("leaves the dock open when its tab is already showing", () => {
    settings.value = { ...DEFAULT_SETTINGS, dockOpen: true, dockTab: "usage" };

    openDockTab("usage");

    expect(settings.value.dockOpen).toBe(true);
    expect(settings.value.dockTab).toBe("usage");
  });
});
