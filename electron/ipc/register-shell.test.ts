import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "./channels";
import { registerShell } from "./register-shell";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  fromWebContents: vi.fn(),
  setTitleBarOverlay: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {},
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  clipboard: {},
  Notification: {},
  shell: {},
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => unknown) =>
      mocks.handlers.set(name, callback),
  },
}));

const EVENT = { sender: {} };
const VALID = { color: "#0a0a0a", symbolColor: "#cbcbcb" };

function setOverlay(payload: unknown): unknown {
  const handler = mocks.handlers.get(CHANNELS.windowSetTitleBarOverlay);
  if (handler === undefined) {
    throw new Error("window_set_title_bar_overlay was not registered");
  }
  return handler(EVENT, payload);
}

function liveWindow(overrides: Record<string, unknown> = {}) {
  return { isDestroyed: () => false, setTitleBarOverlay: mocks.setTitleBarOverlay, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.fromWebContents.mockReturnValue(liveWindow());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("window_set_title_bar_overlay", () => {
  // Only a Windows renderer calls it, but a stray call from any other host
  // has to answer without touching the window at all.
  it.each(["darwin", "linux"] as const)("is a no-op on %s", (platform) => {
    registerShell(platform);

    expect(setOverlay(VALID)).toBeUndefined();

    expect(mocks.setTitleBarOverlay).not.toHaveBeenCalled();
  });

  it("applies valid colours at the frame height on win32", () => {
    registerShell("win32");

    setOverlay(VALID);

    expect(mocks.setTitleBarOverlay).toHaveBeenCalledExactlyOnceWith({
      color: "#0a0a0a",
      symbolColor: "#cbcbcb",
      height: 34,
    });
  });

  it.each([
    ["a colour the OS cannot parse", { ...VALID, color: "color-mix(in srgb, red, blue)" }],
    ["an rgb() colour", { ...VALID, color: "rgb(10, 10, 10)" }],
    ["short hex", { ...VALID, symbolColor: "#fff" }],
    ["8-digit hex", { ...VALID, color: "#0a0a0aff" }],
    ["a bad symbol colour", { ...VALID, symbolColor: "url(x)" }],
    ["a missing key", { color: VALID.color }],
    ["a non-string", { color: 1, symbolColor: 2 }],
    ["a null payload", null],
    ["no payload", undefined],
    ["a string payload", "#fff"],
  ])("rejects %s without applying it or throwing", (_label, payload) => {
    registerShell("win32");

    expect(() => setOverlay(payload)).not.toThrow();
    expect(mocks.setTitleBarOverlay).not.toHaveBeenCalled();
  });

  it("logs a rejection once, not once per theme change", () => {
    registerShell("win32");

    setOverlay({ color: "red", symbolColor: "red" });
    setOverlay({ color: "red", symbolColor: "red" });

    expect(console.warn).toHaveBeenCalledOnce();
  });

  it.each([
    ["no window", () => null],
    ["a destroyed window", () => liveWindow({ isDestroyed: () => true })],
    ["a window without setTitleBarOverlay", () => liveWindow({ setTitleBarOverlay: undefined })],
  ])("does not throw for %s", (_label, windowFor) => {
    registerShell("win32");
    mocks.fromWebContents.mockReturnValue(windowFor());

    expect(() => setOverlay(VALID)).not.toThrow();
    expect(mocks.setTitleBarOverlay).not.toHaveBeenCalled();
  });
});
