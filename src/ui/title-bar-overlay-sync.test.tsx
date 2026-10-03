// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeDesktopEnvironment,
  resetDesktopEnvironmentForTests,
  type DesktopPlatform,
} from "../lib/platform";
import { DEFAULT_SETTINGS } from "../settings/settings-schema";
import { DECK_DARK_ID, DECK_LIGHT_ID } from "../settings/themes";
import { useTitleBarOverlaySync, type TitleBarOverlaySyncInput } from "./title-bar-overlay-sync";

/**
 * The hook runs through the REAL window facade down to the host bridge, so the
 * assertions below are on what would cross IPC, not on a mock of our own call.
 * It is an ordinary effect keyed on strings (App re-renders on every signal
 * these inputs come from), so `act()` is enough and no animation frame passes.
 */
const CHANNEL = "window_set_title_bar_overlay";

const DARK: TitleBarOverlaySyncInput = {
  settings: { ...DEFAULT_SETTINGS, themeId: DECK_DARK_ID },
  sidebar: true,
  dockPainted: false,
  settingsOpen: false,
};
const LIGHT: TitleBarOverlaySyncInput = {
  ...DARK,
  settings: { ...DEFAULT_SETTINGS, themeId: DECK_LIGHT_ID },
};

function Probe(props: TitleBarOverlaySyncInput) {
  useTitleBarOverlaySync(props);
  return null;
}

let host: HTMLDivElement;
let invoke: ReturnType<typeof vi.fn>;

function installElectronHost(): void {
  invoke = vi.fn(async () => null);
  vi.stubGlobal("__deckHost", { invoke, listen: vi.fn() });
}

function usePlatform(platform: DesktopPlatform): void {
  initializeDesktopEnvironment({
    platform,
    homeDir: { macos: "/Users/deck", windows: "C:\\Users\\Deck", unsupported: "" }[platform],
  });
}

function mount(input: TitleBarOverlaySyncInput): void {
  act(() => render(<Probe {...input} />, host));
}

const overlayCalls = (): unknown[] =>
  invoke.mock.calls.filter(([channel]) => channel === CHANNEL).map(([, payload]) => payload);

beforeEach(() => {
  resetDesktopEnvironmentForTests();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  resetDesktopEnvironmentForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useTitleBarOverlaySync off Windows", () => {
  // The macOS pin: no new IPC at boot, on a theme change, or when the layout
  // changes what is under the corner. Written before the hook did anything.
  it.each(["macos", "unsupported"] as const)("%s issues no host call at all", (platform) => {
    usePlatform(platform);
    installElectronHost();

    mount(DARK);
    mount(LIGHT);
    mount({ ...LIGHT, sidebar: false });
    mount({ ...LIGHT, sidebar: false, dockPainted: true });
    mount({ ...LIGHT, settingsOpen: true });

    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("useTitleBarOverlaySync on Windows under Electron", () => {
  beforeEach(() => {
    usePlatform("windows");
    installElectronHost();
  });

  // Each state with the colour its occupant paints, in a dark and a light
  // theme. The literals come from `title-bar-overlay-colors.test.ts`, which
  // ties them to the published stylesheet tokens.
  const THEMES = {
    dark: { input: DARK, symbolColor: "#e7e7e7" },
    light: { input: LIGHT, symbolColor: "#272727" },
  } as const;

  it.each([
    ["dark", "sidebar layout", {}, "#0a0a0a"],
    ["dark", "sidebar layout, dock open", { dockPainted: true }, "#141414"],
    ["dark", "top-tab layout", { sidebar: false }, "#1b1b1b"],
    ["dark", "Settings open", { settingsOpen: true }, "#222222"],
    ["light", "sidebar layout", {}, "#f5f6f8"],
    ["light", "sidebar layout, dock open", { dockPainted: true }, "#e9eaec"],
    ["light", "top-tab layout", { sidebar: false }, "#e9eaec"],
    ["light", "Settings open", { settingsOpen: true }, "#dfe0e2"],
  ] as const)("%s theme, %s: sends the corner's colour at boot", (mode, _state, patch, color) => {
    const { input, symbolColor } = THEMES[mode];

    mount({ ...input, ...patch });

    expect(overlayCalls()).toEqual([{ color, symbolColor }]);
  });

  it("sends again when the theme changes, and when the layout changes the corner", () => {
    mount(DARK);
    mount(LIGHT);
    mount({ ...LIGHT, sidebar: false });
    mount({ ...LIGHT, sidebar: false, settingsOpen: true });

    expect(overlayCalls()).toEqual([
      { color: "#0a0a0a", symbolColor: "#e7e7e7" },
      { color: "#f5f6f8", symbolColor: "#272727" },
      { color: "#e9eaec", symbolColor: "#272727" },
      { color: "#dfe0e2", symbolColor: "#272727" },
    ]);
  });

  it("does not repeat a send when nothing under the corner changed", () => {
    mount(DARK);
    // Same colours three ways: an identical render, a fresh but equal settings
    // object, and a dock toggle in the top-tab layout, where the dock sits
    // below the tab bar and never reaches the corner.
    mount(DARK);
    mount({ ...DARK, settings: { ...DARK.settings } });
    mount({ ...DARK, sidebar: false });
    mount({ ...DARK, sidebar: false, dockPainted: true });

    expect(overlayCalls()).toEqual([
      { color: "#0a0a0a", symbolColor: "#e7e7e7" },
      { color: "#1b1b1b", symbolColor: "#e7e7e7" },
    ]);
  });
});

describe("useTitleBarOverlaySync on Windows without an Electron host", () => {
  it("does nothing under the browser preview and says nothing", () => {
    usePlatform("windows");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mount(DARK);
    mount(LIGHT);

    expect(warn).not.toHaveBeenCalled();
  });

  it("does nothing under Tauri, whose Windows build keeps its native title bar", () => {
    usePlatform("windows");
    vi.stubGlobal("__TAURI_INTERNALS__", { invoke: vi.fn() });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    mount(DARK);
    mount(LIGHT);

    expect(warn).not.toHaveBeenCalled();
    expect((globalThis as { __deckHost?: unknown }).__deckHost).toBeUndefined();
  });
});
