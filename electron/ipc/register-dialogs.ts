/**
 * `dialog_*` IPC handlers: message boxes and the native open dialog, scoped
 * to the window that asked.
 */
import { BrowserWindow, dialog, ipcMain } from "electron";

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

export function registerDialogs(): void {
  ipcMain.handle("dialog_ask", async (event, payload) => {
    const { message, title, kind, okLabel, cancelLabel } =
      payload as DialogPayload;
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(window!, {
      type: kind ?? "info",
      message: title ?? message,
      detail: title === undefined ? undefined : message,
      buttons: [okLabel ?? "OK", cancelLabel ?? "Cancel"],
      defaultId: 0,
      cancelId: 1,
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
    });
  });
  ipcMain.handle("dialog_open", async (event, payload) => {
    const { directory, multiple, title, filters } =
      payload as OpenDialogPayload;
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(window!, {
      title,
      filters,
      properties: [
        directory === true ? "openDirectory" : "openFile",
        ...(multiple === true ? (["multiSelections"] as const) : []),
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
