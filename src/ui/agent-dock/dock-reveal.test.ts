// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The settings store reaches the host: stub it as the dock's other suites do.
vi.mock("../../host/store-host", () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock("../../host/dialog-host", () => ({ open: vi.fn(async () => null) }));
vi.mock("../../host/bridge", () => ({ invoke: vi.fn(async () => null) }));

import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from "../../lib/platform";
import { DEFAULT_SETTINGS } from "../../settings/settings-schema";
import { settings } from "../../settings/settings-store";
import { dockSheetOpen, dockView, resetAgentDockState, setDockView } from "./agent-dock-state";
import { dockShows, openDockTab, revealDockTab } from "./dock-reveal";

function pinHost(isDevelopment: boolean): void {
  resetDesktopEnvironmentForTests();
  vi.stubGlobal("__deckHost", {});
  initializeDesktopEnvironment({ platform: "macos", homeDir: "/home/test", isDevelopment });
}

function resizeTo(width: number): void {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

beforeEach(() => {
  pinHost(true);
  resizeTo(1440);
  settings.value = { ...DEFAULT_SETTINGS, dockOpen: true, dockTab: "explorer" };
  resetAgentDockState();
});

afterEach(() => {
  resizeTo(1024);
  vi.unstubAllGlobals();
  resetDesktopEnvironmentForTests();
  resetAgentDockState();
});

describe("a dock chord with the tabbed dock", () => {
  it("selects another view instead of hiding the dock, even when its tab is already current", () => {
    expect(dockView.value).toBe("changes");
    expect(revealDockTab("explorer")).toBe(false);
    expect(settings.value.dockOpen).toBe(true);
    expect(dockView.value).toBe("files");
  });

  it("hides the dock on a second press, as the tabbed dock does", () => {
    revealDockTab("explorer");
    expect(revealDockTab("explorer")).toBe(true);
    expect(settings.value.dockOpen).toBe(false);
  });

  it("hides the dock for the view on screen even when dockTab lags the icon press", () => {
    setDockView("usage");
    expect(settings.value.dockTab).toBe("explorer");
    expect(revealDockTab("usage")).toBe(true);
    expect(settings.value.dockOpen).toBe(false);
  });

  it("opens a closed dock on the view", () => {
    settings.value = { ...settings.value, dockOpen: false };
    expect(revealDockTab("usage")).toBe(false);
    expect(settings.value.dockOpen).toBe(true);
    expect(dockView.value).toBe("usage");
  });

  it("selects the view for each chord's tab", () => {
    revealDockTab("sessions");
    expect(dockView.value).toBe("history");
    revealDockTab("usage");
    expect(dockView.value).toBe("usage");
  });

  it("is the shipped reveal with the switch off", () => {
    pinHost(false);
    // Dock open on the Files tab, the chord for Files again: the tabbed dock hides.
    expect(revealDockTab("explorer")).toBe(true);
    expect(dockView.value).toBe("changes");
  });
});

describe("a Tools row with the tabbed dock", () => {
  it("selects its view when the dock is already on that tab, and never closes", () => {
    openDockTab("explorer");
    expect(settings.value.dockOpen).toBe(true);
    expect(dockView.value).toBe("files");
    openDockTab("explorer");
    expect(settings.value.dockOpen).toBe(true);
  });
});

describe("what the dock shows", () => {
  it("is the selected view with the switch on, not the stored tab", () => {
    expect(dockShows("explorer", "explorer")).toBe(false);
    revealDockTab("explorer");
    expect(dockShows("explorer", "usage")).toBe(true);
    expect(dockShows("usage", "usage")).toBe(false);
  });

  it("needs the sheet open under 1360px", () => {
    revealDockTab("explorer");
    resizeTo(1000);
    expect(dockShows("explorer", "explorer")).toBe(false);
    dockSheetOpen.value = true;
    expect(dockShows("explorer", "explorer")).toBe(true);
  });

  it("is the stored tab with the switch off", () => {
    pinHost(false);
    expect(dockShows("explorer", "explorer")).toBe(true);
    expect(dockShows("usage", "explorer")).toBe(false);
  });
});
