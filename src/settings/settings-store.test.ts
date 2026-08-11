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
