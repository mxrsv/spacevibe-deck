import { beforeEach, describe, expect, it, vi } from "vitest";

const setMock = vi.hoisted(() => vi.fn(async () => {}));
const saveMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async (): Promise<unknown> => undefined),
      set: setMock,
      save: saveMock,
    })),
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
} from "./settings-store";
import { createMemorySettingsSync } from "./settings-sync";
import { DEFAULT_SETTINGS } from "./settings-schema";
import { persistError } from "../chrome/events";

describe("settings persistence", () => {
  beforeEach(async () => {
    setMock.mockClear();
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
    setMock.mockRejectedValueOnce(new Error("disk full"));
    updateSettings({ fontSize: 15 });
    await vi.waitFor(() => {
      expect(persistError.value).not.toBeNull();
    });
  });

  it("flushSettingsSave forces the autosaved store to disk", async () => {
    await flushSettingsSave();
    expect(saveMock).toHaveBeenCalled();
  });
});

describe("settings patch sync", () => {
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
