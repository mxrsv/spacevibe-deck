import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNELS } from "./channels";
import { registerShell } from "./register-shell";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
  fromWebContents: vi.fn(),
  setTitleBarOverlay: vi.fn(),
  setBadgeCount: vi.fn(),
  openExternal: vi.fn(),
  isSupported: vi.fn(),
  alerts: [] as (EventEmitter & {
    options: unknown;
    show: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  })[],
}));
vi.mock("electron", async () => ({
  app: { setBadgeCount: mocks.setBadgeCount },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  clipboard: {},
  Notification: class extends (await import("node:events")).EventEmitter {
    static isSupported = mocks.isSupported;
    show = vi.fn();
    close = vi.fn();
    constructor(readonly options: unknown) {
      super();
      mocks.alerts.push(this);
    }
  },
  shell: { openExternal: mocks.openExternal },
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
  mocks.alerts.length = 0;
  mocks.isSupported.mockReturnValue(true);
  mocks.fromWebContents.mockReturnValue(liveWindow());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

function sender(id: number) {
  return Object.assign(new EventEmitter(), { id, isDestroyed: vi.fn(() => false), send: vi.fn() });
}

function invoke(channel: string, from: ReturnType<typeof sender>, payload?: unknown): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return handler({ sender: from }, payload);
}

describe("agent notifications", () => {
  it.each([
    undefined,
    null,
    {},
    { title: 1 },
    { title: "Done", body: 1 },
    { title: "Done", paneId: -1 },
    { title: "Done", paneId: 1.5 },
    { title: "Done", paneId: "1" },
    { title: "Done", paneId: Infinity },
  ])("rejects malformed payload %j without creating an alert", (payload) => {
    registerShell("darwin");
    expect(() => invoke("notification_send", sender(1), payload)).toThrow(
      payload == null ? TypeError : "Invalid notification payload",
    );
    expect(mocks.alerts).toHaveLength(0);
  });

  it.each(["darwin", "win32"] as const)(
    "click restores and focuses only the posting window on %s",
    (platform) => {
      const from = sender(1);
      const calls: string[] = [];
      const window = liveWindow({
        isMinimized: () => true,
        restore: () => calls.push("restore"),
        show: () => calls.push("show"),
        focus: () => calls.push("focus"),
      });
      mocks.fromWebContents.mockReturnValue(window);
      registerShell(platform);
      invoke("notification_send", from, { title: "Deck", body: "Claude finished", paneId: 42 });
      expect(mocks.alerts[0].options).toEqual({
        title: "Deck",
        body: "Claude finished",
        id: "pane-42",
      });
      mocks.alerts[0].emit("click");
      expect(calls).toEqual(["restore", "show", "focus"]);
      expect(from.send).toHaveBeenCalledExactlyOnceWith("notification:activated", { paneId: 42 });
    },
  );

  it("replaces a pane's alert without late close events forgetting its replacement", () => {
    const from = sender(1);
    mocks.fromWebContents.mockReturnValue(
      liveWindow({
        isMinimized: () => false,
        show: vi.fn(),
        focus: vi.fn(),
      }),
    );
    registerShell();
    invoke("notification_send", from, { title: "First", paneId: 7 });
    const old = mocks.alerts[0];
    invoke("notification_send", from, { title: "Second", paneId: 7 });
    expect(old.close).toHaveBeenCalledOnce();
    old.emit("close");
    old.emit("click");
    expect(from.send).not.toHaveBeenCalled();
    mocks.alerts[1].emit("click");
    expect(from.send).toHaveBeenCalledExactlyOnceWith("notification:activated", { paneId: 7 });
  });

  it.each(["close", "failed"] as const)("drops the retained alert on %s", (event) => {
    const from = sender(1);
    registerShell();
    invoke("notification_send", from, { title: "Done", paneId: 7 });
    mocks.alerts[0].emit(event);
    invoke("notification_send", from, { title: "Again", paneId: 7 });
    expect(mocks.alerts[0].close).not.toHaveBeenCalled();
  });

  it("keeps a timed-out Windows toast clickable from Action Center", () => {
    const from = sender(1);
    const window = liveWindow({
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    });
    mocks.fromWebContents.mockReturnValue(window);
    registerShell("win32");
    invoke("notification_send", from, { title: "Done", paneId: 7 });
    mocks.alerts[0].emit("close", { reason: "timedOut" });
    mocks.alerts[0].emit("click");
    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
    expect(from.send).toHaveBeenCalledExactlyOnceWith("notification:activated", { paneId: 7 });
    mocks.alerts[0].emit("close", { reason: "userCanceled" });
    from.send.mockClear();
    mocks.alerts[0].emit("click");
    expect(from.send).not.toHaveBeenCalled();
  });

  it("does not route a delivered alert after its sender is destroyed", () => {
    const from = sender(1);
    registerShell();
    invoke("notification_send", from, { title: "Done", paneId: 7 });
    from.isDestroyed.mockReturnValue(true);
    from.emit("destroyed");
    mocks.alerts[0].emit("click");
    expect(from.send).not.toHaveBeenCalled();
  });

  it("keeps identical pane ids in different windows independent", () => {
    registerShell();
    invoke("notification_send", sender(1), { title: "A", paneId: 7 });
    invoke("notification_send", sender(2), { title: "B", paneId: 7 });
    expect(mocks.alerts[0].close).not.toHaveBeenCalled();
  });
});

describe("attention badge", () => {
  it("sums windows, replaces a window's count and removes destroyed senders", () => {
    registerShell("darwin");
    const a = sender(1),
      b = sender(2);
    invoke(CHANNELS.attentionBadgeSet, a, { count: 2 });
    invoke(CHANNELS.attentionBadgeSet, b, { count: 3 });
    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(5);
    invoke(CHANNELS.attentionBadgeSet, a, { count: 1 });
    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(4);
    expect(a.listenerCount("destroyed")).toBe(1);
    b.emit("destroyed");
    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(1);
    invoke(CHANNELS.attentionBadgeSet, a, { count: 0 });
    expect(mocks.setBadgeCount).toHaveBeenLastCalledWith(0);
  });

  it("reapplies the latest sum after posting and after OS permission allows show", () => {
    registerShell("darwin");
    const from = sender(1);
    invoke(CHANNELS.attentionBadgeSet, from, { count: 2 });
    mocks.setBadgeCount.mockClear();
    invoke("notification_send", from, { title: "Done", paneId: 7 });
    expect(mocks.setBadgeCount).toHaveBeenCalledExactlyOnceWith(2);
    invoke(CHANNELS.attentionBadgeSet, from, { count: 3 });
    mocks.setBadgeCount.mockClear();
    mocks.alerts[0].emit("show");
    expect(mocks.setBadgeCount).toHaveBeenCalledExactlyOnceWith(3);
  });

  it.each([-1, 0.5, "2", Infinity, NaN, undefined])("rejects invalid count %j", (count) => {
    registerShell("darwin");
    expect(() => invoke(CHANNELS.attentionBadgeSet, sender(1), { count })).toThrow(
      "Invalid attention count",
    );
    expect(mocks.setBadgeCount).not.toHaveBeenCalled();
  });

  it("never calls setBadgeCount on Windows, including after an alert", () => {
    registerShell("win32");
    const from = sender(1);
    invoke(CHANNELS.attentionBadgeSet, from, { count: 2 });
    invoke("notification_send", from, { title: "Done", paneId: 7 });
    mocks.alerts[0].emit("show");
    from.emit("destroyed");
    expect(mocks.setBadgeCount).not.toHaveBeenCalled();
  });
});

describe("notification settings", () => {
  it.each([
    ["darwin", "x-apple.systempreferences:com.apple.Notifications-Settings.extension"],
    ["win32", "ms-settings:notifications"],
  ] as const)("opens only the fixed URL on %s", async (platform, url) => {
    registerShell(platform);
    await expect(
      invoke(CHANNELS.notificationOpenSettings, sender(1), { url: "file:///tmp/evil" }),
    ).resolves.toBe(true);
    expect(mocks.openExternal).toHaveBeenCalledExactlyOnceWith(url);
  });

  it("returns false on unsupported platforms", async () => {
    registerShell("linux");
    await expect(invoke(CHANNELS.notificationOpenSettings, sender(1))).resolves.toBe(false);
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
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
