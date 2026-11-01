/**
 * Small renderer facades with no shared main-process state: window chrome
 * (close/maximize), external links, clipboard, notifications and app
 * lifecycle.
 */
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Notification,
  shell,
  type WebContents,
} from "electron";
import { FRAME_HEIGHT_PX, isOverlayColor } from "../window-options";
import { CHANNELS, EVENTS } from "./channels";

/**
 * Schemes Deck will hand to the OS.
 *
 * Tauri enforced this in the HOST via the `opener:default` permission set;
 * dropping it left `shell.openExternal` open to anything the renderer passed,
 * and the renderer is not the trust boundary — an OSC 8 hyperlink carrying
 * `file:///Applications/…` was one renderer bug away from launching it.
 */
const OPENABLE_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:"]);

export function registerShell(platform: NodeJS.Platform = process.platform): void {
  let rejectionLogged = false;
  const owners = new Map<
    WebContents,
    { count: number; alerts: Map<number | undefined, Notification> }
  >();
  const applyBadge = (): void => {
    if (platform === "darwin" || platform === "linux") {
      app.setBadgeCount([...owners.values()].reduce((sum, owner) => sum + owner.count, 0));
    }
  };
  const ownerFor = (sender: WebContents) => {
    let owner = owners.get(sender);
    if (owner === undefined) {
      owner = { count: 0, alerts: new Map() };
      owners.set(sender, owner);
      const alerts = owner.alerts;
      sender.once("destroyed", () => {
        owners.delete(sender);
        // Delivered alerts may stay in Notification Center, but cannot route
        // to a window that no longer exists.
        alerts.clear();
        applyBadge();
      });
    }
    return owner;
  };
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

  ipcMain.handle(CHANNELS.windowSetTitleBarOverlay, (event, payload: unknown) => {
    // Only a Windows renderer calls this, and only when the frame corner's
    // colour changes; any other host resolves without touching the window.
    if (platform !== "win32") {
      return;
    }
    // Untrusted: the payload is taken whole so a missing or non-object one is a
    // rejection like any bad colour, not a TypeError thrown into the renderer.
    const { color, symbolColor } = (payload ?? {}) as Record<string, unknown>;
    if (!isOverlayColor(color) || !isOverlayColor(symbolColor)) {
      // Once, not per colour change: the values are never echoed into the log.
      if (!rejectionLogged) {
        rejectionLogged = true;
        console.warn("Deck: ignored a title bar overlay that is not a #rrggbb colour pair");
      }
      return;
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed() || typeof window.setTitleBarOverlay !== "function") {
      return;
    }
    window.setTitleBarOverlay({ color, symbolColor, height: FRAME_HEIGHT_PX });
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
  // Electron exposes support, not macOS authorization. The OS owns the prompt
  // when the first alert is posted; Deck never draws a permission prompt.
  ipcMain.handle("notification_permission_granted", () => Notification.isSupported());
  ipcMain.handle("notification_request_permission", () =>
    Notification.isSupported() ? "granted" : "denied",
  );
  ipcMain.handle("notification_send", (event, { title, body, paneId }) => {
    if (
      typeof title !== "string" ||
      (body !== undefined && typeof body !== "string") ||
      (paneId !== undefined && (!Number.isSafeInteger(paneId) || paneId < 0))
    ) {
      throw new Error("Invalid notification payload");
    }
    const sender = event.sender;
    const window = BrowserWindow.fromWebContents(sender);
    if (!Notification.isSupported() || sender.isDestroyed() || !window || window.isDestroyed()) {
      return;
    }
    const owner = ownerFor(sender);
    const previous = owner.alerts.get(paneId);
    const alert = new Notification({
      title,
      body,
      ...(paneId === undefined ? {} : { id: `pane-${paneId}` }),
    });
    owner.alerts.set(paneId, alert);
    previous?.close();
    const forget = (): void => {
      if (owner.alerts.get(paneId) === alert) owner.alerts.delete(paneId);
    };
    alert.on("click", () => {
      if (sender.isDestroyed() || window.isDestroyed() || owner.alerts.get(paneId) !== alert)
        return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      if (paneId !== undefined) sender.send(EVENTS.notificationActivated, { paneId });
    });
    alert.on("close", (details) => {
      // Windows times out the banner while keeping the toast in Action Center.
      // Keep its click route alive until it is actually dismissed or replaced.
      if (platform !== "win32" || details?.reason !== "timedOut") forget();
    });
    alert.once("failed", forget);
    // "show" is asynchronous: the first alert may wait for OS authorization.
    alert.once("show", applyBadge);
    try {
      alert.show();
      applyBadge();
    } catch (error) {
      forget();
      throw error;
    }
  });
  ipcMain.handle(CHANNELS.attentionBadgeSet, (event, { count }) => {
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Invalid attention count");
    if (event.sender.isDestroyed()) return;
    owners.set(event.sender, { ...ownerFor(event.sender), count });
    applyBadge();
  });
  ipcMain.handle(CHANNELS.notificationOpenSettings, async () => {
    const url =
      platform === "darwin"
        ? "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        : platform === "win32"
          ? "ms-settings:notifications"
          : null;
    if (url === null) return false;
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle("app_relaunch", () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("app_version", () => app.getVersion());
}
