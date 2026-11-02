import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "./channels";
import { registerBrowser } from "./register-browser";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  fromWebContents: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => unknown) =>
      mocks.handlers.set(name, callback),
  },
}));

const EVENT = { sender: {} };
const refreshBounds = vi.fn();

function fakeWindow(initial = 1, destroyed = false) {
  let factor = initial;
  return {
    isDestroyed: () => destroyed,
    webContents: {
      setZoomFactor: vi.fn((next: number) => {
        factor = next;
      }),
      getZoomFactor: () => factor,
    },
  };
}

function setGuiZoom(payload: unknown): unknown {
  const handler = mocks.handlers.get(CHANNELS.windowSetGuiZoom);
  if (handler === undefined) {
    throw new Error("window_set_gui_zoom was not registered");
  }
  return handler(EVENT, payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  registerBrowser({
    labelOf: () => "main",
    browserPanels: { refreshBounds } as never,
  });
});

describe("window_set_gui_zoom", () => {
  it.each([0.85, 0.9, 1, 1.1, 1.25])(
    "zooms the sender's page to %f and re-places that window's browser view",
    (factor) => {
      const window = fakeWindow();
      mocks.fromWebContents.mockReturnValue(window);

      expect(setGuiZoom({ factor })).toBe(factor);

      expect(window.webContents.setZoomFactor).toHaveBeenCalledWith(factor);
      expect(refreshBounds).toHaveBeenCalledWith("main");
    },
  );

  it.each([0, -1, 0.95, 5, Number.NaN, "1.25", null, undefined])(
    "ignores the untrusted factor %s and reports the zoom in force",
    (factor) => {
      const window = fakeWindow(1.1);
      mocks.fromWebContents.mockReturnValue(window);

      expect(setGuiZoom({ factor })).toBe(1.1);

      expect(window.webContents.setZoomFactor).not.toHaveBeenCalled();
      expect(refreshBounds).not.toHaveBeenCalled();
    },
  );

  it("answers null for a window that is gone", () => {
    mocks.fromWebContents.mockReturnValue(fakeWindow(1, true));
    expect(setGuiZoom({ factor: 1.25 })).toBeNull();
    mocks.fromWebContents.mockReturnValue(null);
    expect(setGuiZoom({ factor: 1.25 })).toBeNull();
    expect(refreshBounds).not.toHaveBeenCalled();
  });
});
