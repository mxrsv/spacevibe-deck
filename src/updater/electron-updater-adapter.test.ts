import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  electronRelaunch: vi.fn(async () => undefined),
  tauriCheck: vi.fn(),
  tauriRelaunch: vi.fn(async () => undefined),
}));

vi.mock("../host/bridge", () => ({
  invoke: mocks.invoke,
}));
vi.mock("../host/shell-host", () => ({
  relaunch: mocks.electronRelaunch,
}));
// Left real, not stubbed: the delegation is only worth anything if it reaches
// the Tauri plugin, which is the path the migration-notice build depends on.
vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mocks.tauriCheck,
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mocks.tauriRelaunch,
}));

import { checkForUpdate, relaunchDeck } from "./electron-updater-adapter";
import { UPDATE_UNSUPPORTED } from "./update-controller";

describe("checkForUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("__deckHost", undefined);
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves to null with no host bridge at all", async () => {
    // Browser `npm run dev`. The shared renderer paints there, and an update
    // error thrown at a preview shell helps nobody.
    await expect(checkForUpdate()).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("says unsupported rather than up to date when the host has no updater", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({ status: "unsupported" });

    await expect(checkForUpdate()).resolves.toBe(UPDATE_UNSUPPORTED);
    expect(mocks.invoke).toHaveBeenCalledWith("update_check");
  });

  it("resolves to null when the host is already current", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({
      status: "current",
      currentVersion: "0.12.3",
    });

    await expect(checkForUpdate()).resolves.toBeNull();
  });

  it("wires an available update to the download and install channels", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({
      status: "available",
      currentVersion: "0.12.3",
      version: "0.13.0",
      notes: "Fixes the thing.",
    });

    const update = await checkForUpdate();

    expect(update).toMatchObject({
      currentVersion: "0.12.3",
      version: "0.13.0",
      notes: "Fixes the thing.",
    });
    if (update === null || update === UPDATE_UNSUPPORTED) {
      throw new Error("expected a pending update");
    }
    await update.download();
    expect(mocks.invoke).toHaveBeenCalledWith("update_download");
    void update.install();
    expect(mocks.invoke).toHaveBeenCalledWith("update_install");
  });

  it("throws on a reply it cannot read instead of inventing 'up to date'", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });
    mocks.invoke.mockResolvedValue({ status: "available", version: "0.13.0" });

    await expect(checkForUpdate()).rejects.toThrow("missing a version");

    mocks.invoke.mockResolvedValue("nope");
    await expect(checkForUpdate()).rejects.toThrow("not an object");

    mocks.invoke.mockResolvedValue({ status: "shrug" });
    await expect(checkForUpdate()).rejects.toThrow("unknown status");
  });

  it("delegates to the Tauri updater while that host still ships", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});
    mocks.tauriCheck.mockResolvedValue({
      currentVersion: "0.12.3",
      version: "0.12.4",
      body: "Security fixes",
      download: vi.fn(async () => undefined),
      install: vi.fn(async () => undefined),
    });

    await expect(checkForUpdate()).resolves.toMatchObject({
      version: "0.12.4",
      notes: "Security fixes",
    });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe("relaunchDeck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("__deckHost", undefined);
    vi.stubGlobal("__TAURI_INTERNALS__", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes through the Tauri process plugin under Tauri", async () => {
    vi.stubGlobal("__TAURI_INTERNALS__", {});

    await relaunchDeck();

    expect(mocks.tauriRelaunch).toHaveBeenCalledOnce();
    expect(mocks.electronRelaunch).not.toHaveBeenCalled();
  });

  it("routes through app_relaunch everywhere else", async () => {
    vi.stubGlobal("__deckHost", { invoke: vi.fn(), listen: vi.fn() });

    await relaunchDeck();

    expect(mocks.electronRelaunch).toHaveBeenCalledOnce();
    expect(mocks.tauriRelaunch).not.toHaveBeenCalled();
  });
});
