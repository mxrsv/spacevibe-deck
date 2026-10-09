import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  windows: [] as Array<Record<string, boolean>>,
  app: null as unknown as import("node:events").EventEmitter,
  power: null as unknown as import("node:events").EventEmitter,
}));
vi.mock("electron", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  mocks.app = new Emitter();
  mocks.power = new Emitter();
  return {
    app: mocks.app,
    powerMonitor: mocks.power,
    BrowserWindow: {
      getAllWindows: () =>
        mocks.windows.map((state) => ({
          isDestroyed: () => state.destroyed ?? false,
          isVisible: () => state.visible ?? true,
          isMinimized: () => state.minimized ?? false,
          isFocused: () => state.focused ?? false,
        })),
    },
  };
});

import { createElectronActivity } from "./electron-activity";

beforeEach(() => {
  mocks.windows.length = 0;
  mocks.app.removeAllListeners();
  mocks.power.removeAllListeners();
});

describe("createElectronActivity", () => {
  it("is active only while a visible, restored window has focus", () => {
    const activity = createElectronActivity();
    expect(activity.isActive()).toBe(false);
    mocks.windows.push({ focused: false });
    expect(activity.isActive()).toBe(false);
    mocks.windows.push({ focused: true, minimized: true });
    expect(activity.isActive()).toBe(false);
    mocks.windows.push({ focused: true, visible: false });
    expect(activity.isActive()).toBe(false);
    mocks.windows.push({ focused: true });
    expect(activity.isActive()).toBe(true);
  });

  it("notifies on focus, blur and power resume, and detaches cleanly", () => {
    const listener = vi.fn();
    const stop = createElectronActivity().subscribe(listener);
    mocks.app.emit("browser-window-focus");
    mocks.app.emit("browser-window-blur");
    mocks.power.emit("resume");
    mocks.power.emit("unlock-screen");
    expect(listener).toHaveBeenCalledTimes(4);
    stop();
    mocks.app.emit("browser-window-focus");
    mocks.power.emit("resume");
    expect(listener).toHaveBeenCalledTimes(4);
    expect(mocks.app.listenerCount("browser-window-focus")).toBe(0);
  });
});
