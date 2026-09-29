import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerDialogs } from "./register-dialogs";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  window: { id: "asking-window" },
  showMessageBox: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => mocks.window },
  dialog: { showMessageBox: mocks.showMessageBox },
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => Promise<unknown>) =>
      mocks.handlers.set(name, callback),
  },
}));

const EVENT = { sender: {} };

function call(channel: string, payload: unknown): Promise<unknown> {
  const handler = mocks.handlers.get(channel);
  if (handler === undefined) {
    throw new Error(`${channel} was not registered`);
  }
  return handler(EVENT, payload);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.showMessageBox.mockResolvedValue({ response: 0 });
  registerDialogs();
});

describe("registerDialogs message boxes", () => {
  // Windows turns a multi-button box into command links unless noLink is set;
  // Electron ignores the flag on macOS, so the two-button shape is the same
  // everywhere.
  it("keeps the confirm dialog a plain two-button box", async () => {
    await expect(call("dialog_ask", { message: "Quit?", okLabel: "Quit" })).resolves.toBe(true);

    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      mocks.window,
      expect.objectContaining({ buttons: ["Quit", "Cancel"], noLink: true }),
    );
  });

  it("keeps the notice dialog a plain box", async () => {
    await call("dialog_message", { message: "Saved" });

    expect(mocks.showMessageBox).toHaveBeenCalledWith(
      mocks.window,
      expect.objectContaining({ buttons: ["OK"], noLink: true }),
    );
  });
});
