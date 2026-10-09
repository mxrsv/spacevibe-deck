/**
 * Main's own view of "is anyone looking at Deck", for scan cadence. The renderer never
 * supplies it. `powerMonitor` is unusable before `ready`, so it is touched only inside
 * `subscribe`, which runs when observation starts, long after a window exists.
 */
import { app, BrowserWindow, powerMonitor } from "electron";
import type { DevServerActivity } from "./service";

export function createElectronActivity(): DevServerActivity {
  return {
    isActive: () =>
      BrowserWindow.getAllWindows().some(
        (window) =>
          !window.isDestroyed() &&
          window.isVisible() &&
          !window.isMinimized() &&
          window.isFocused(),
      ),
    subscribe: (listener) => {
      app.on("browser-window-focus", listener);
      app.on("browser-window-blur", listener);
      powerMonitor.on("resume", listener);
      powerMonitor.on("unlock-screen", listener);
      return () => {
        app.off("browser-window-focus", listener);
        app.off("browser-window-blur", listener);
        powerMonitor.off("resume", listener);
        powerMonitor.off("unlock-screen", listener);
      };
    },
  };
}
