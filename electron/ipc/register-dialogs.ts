/**
 * `dialog_*` IPC handlers: message boxes and the native open dialog, scoped
 * to the window that asked.
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import { resolveRoot } from "../fs/path-guard";

interface DialogPayload {
  readonly message: string;
  readonly title?: string;
  readonly kind?: "info" | "warning" | "error";
  readonly okLabel?: string;
  readonly cancelLabel?: string;
}

interface OpenDialogPayload {
  readonly directory?: boolean;
  readonly multiple?: boolean;
  readonly title?: string;
  readonly filters?: Array<{ name: string; extensions: string[] }>;
}

/**
 * Both message boxes set `noLink: true`. On Windows, Electron shows any button
 * that is not a stock one (Cancel, Yes, ...) as a command link, so a custom
 * "Quit" / "Discard" label would turn the confirm into a link list instead of
 * the plain button pair macOS draws. Electron documents the flag as
 * Windows-only, so macOS is unaffected.
 */
export function registerDialogs(deps: {
  readonly grantWorkspaceRoot: (senderId: number, root: string) => void | Promise<void>;
}): void {
  ipcMain.handle("dialog_ask", async (event, payload) => {
    const { message, title, kind, okLabel, cancelLabel } = payload as DialogPayload;
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(window!, {
      type: kind ?? "info",
      message: title ?? message,
      detail: title === undefined ? undefined : message,
      buttons: [okLabel ?? "OK", cancelLabel ?? "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    return result.response === 0;
  });
  ipcMain.handle("dialog_message", async (event, payload) => {
    const { message, title, kind } = payload as DialogPayload;
    const window = BrowserWindow.fromWebContents(event.sender);
    await dialog.showMessageBox(window!, {
      type: kind ?? "info",
      message: title ?? message,
      detail: title === undefined ? undefined : message,
      buttons: ["OK"],
      noLink: true,
    });
  });
  ipcMain.handle("dialog_open", async (event, payload) => {
    const { directory, multiple, title, filters } = payload as OpenDialogPayload;
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title,
      filters,
      properties: [
        directory === true ? "openDirectory" : "openFile",
        ...(multiple === true ? (["multiSelections"] as const) : []),
      ],
    });
    if (!result.canceled && directory === true) {
      const root = result.filePaths[0];
      if (root !== undefined) {
        try {
          const canonical = resolveRoot(root);
          if (canonical !== null && (await fs.stat(canonical)).isDirectory()) {
            await deps.grantWorkspaceRoot(event.sender.id, canonical);
          }
        } catch {
          // An unreadable selection is not an authorization grant.
        }
      }
    }
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
