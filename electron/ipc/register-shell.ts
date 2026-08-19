/**
 * Small renderer facades with no shared main-process state: window chrome
 * (close/maximize), external links, clipboard, notifications and app
 * lifecycle.
 */
import { app, BrowserWindow, clipboard, ipcMain, Notification, shell } from "electron";

/**
 * Schemes Deck will hand to the OS.
 *
 * Tauri enforced this in the HOST via the `opener:default` permission set;
 * dropping it left `shell.openExternal` open to anything the renderer passed,
 * and the renderer is not the trust boundary — an OSC 8 hyperlink carrying
 * `file:///Applications/…` was one renderer bug away from launching it.
 */
const OPENABLE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export function registerShell(): void {
  // No `window_is_focused` / `window_scale_factor` handlers: both are answered
  // in the renderer from `document.hasFocus()` and `devicePixelRatio`. The
  // main-process versions were worse — `getZoomFactor()` returns the user's ZOOM
  // level, which is 1 on a 2x display at default zoom, so it silently turned the
  // physical-to-logical drop conversion into a no-op.
  ipcMain.handle("window_close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle("window_toggle_maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) {
      return;
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle("shell_open_url", (_event, { url }) => {
    let parsed: URL;
    try {
      parsed = new URL(String(url));
    } catch {
      throw new Error("That link is not a valid URL.");
    }
    if (!OPENABLE_SCHEMES.has(parsed.protocol)) {
      throw new Error(`Deck will not open ${parsed.protocol} links.`);
    }
    return shell.openExternal(parsed.href);
  });
  ipcMain.handle("clipboard_read_text", () => clipboard.readText());
  ipcMain.handle("clipboard_write_text", (_event, { text }) => clipboard.writeText(text));
  // Electron needs no permission grant for notifications; answering true keeps
  // the renderer's request/grant flow unchanged.
  ipcMain.handle("notification_permission_granted", () => Notification.isSupported());
  ipcMain.handle("notification_request_permission", () =>
    Notification.isSupported() ? "granted" : "denied",
  );
  ipcMain.handle("notification_send", (_event, payload) => {
    const { title, body } = payload as { title: string; body?: string };
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });
  ipcMain.handle("app_relaunch", () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("app_version", () => app.getVersion());
}
