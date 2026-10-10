import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerDialogs } from "./register-dialogs";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload?: unknown) => Promise<unknown>>(),
  window: { id: "asking-window" },
  showMessageBox: vi.fn(),
  showOpenDialog: vi.fn(),
  grantWorkspaceRoot: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: () => mocks.window },
  dialog: { showMessageBox: mocks.showMessageBox, showOpenDialog: mocks.showOpenDialog },
  ipcMain: {
    handle: (name: string, callback: (event: unknown, payload?: unknown) => Promise<unknown>) =>
      mocks.handlers.set(name, callback),
  },
}));

const EVENT = { sender: { id: 42 } };

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
  mocks.showOpenDialog.mockReset();
  mocks.grantWorkspaceRoot.mockReset();
  registerDialogs({ grantWorkspaceRoot: mocks.grantWorkspaceRoot });
});

describe("registerDialogs workspace grants", () => {
  it("grants a selected directory to the requesting window", async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-dialog-root-"));
    try {
      mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] });

      await expect(call("dialog_open", { directory: true })).resolves.toBe(root);
      expect(mocks.grantWorkspaceRoot).toHaveBeenCalledWith(42, realpathSync(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("waits for the main-process grant to persist before returning the selected path", async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-dialog-pending-grant-"));
    let finishGrant!: () => void;
    const grantPersisted = new Promise<void>((resolve) => {
      finishGrant = resolve;
    });
    try {
      mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] });
      mocks.grantWorkspaceRoot.mockReturnValueOnce(grantPersisted);

      const result = call("dialog_open", { directory: true });
      await vi.waitFor(() => expect(mocks.grantWorkspaceRoot).toHaveBeenCalled());
      let returned = false;
      void result.then(() => {
        returned = true;
      });
      await Promise.resolve();
      expect(returned).toBe(false);

      finishGrant();
      await expect(result).resolves.toBe(root);
    } finally {
      finishGrant();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not grant a workspace root when the picker is cancelled", async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });

    await expect(call("dialog_open", { directory: true })).resolves.toBeNull();
    expect(mocks.grantWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("does not grant a missing selected directory", async () => {
    const invalid = join(tmpdir(), "deck-dialog-missing-root");
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [invalid] });

    await expect(call("dialog_open", { directory: true })).resolves.toBe(invalid);
    expect(mocks.grantWorkspaceRoot).not.toHaveBeenCalled();
  });
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
