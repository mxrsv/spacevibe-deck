/**
 * Browser tab IPC handlers, plus the vendored react-grab bundle loader that
 * feeds every panel's Inspect bootstrap.
 *
 * Every handler resolves the window from the sender and works on THAT
 * window's panel — panels are per window like everything else here, and a
 * label taken from the payload would let one window drive another's.
 */
import fs from "node:fs";
import path from "node:path";
import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { CHANNELS } from "./channels";
import type { BrowserPanels } from "../browser/view";
import { normalizeBrowserUrl } from "../browser/url";

/**
 * The vendored react-grab bundle, read once and kept.
 *
 * 386 kB of source is spliced into every page the panel loads, and a page
 * reload re-injects it; re-reading the file each time would put synchronous
 * disk I/O on the navigation path for bytes that cannot change while the app
 * runs. An unreadable file yields `""`, which the bootstrap turns into an
 * inert injection rather than a thrown navigation.
 */
let vendorCache: string | null = null;
export function reactGrabSource(): string {
  if (vendorCache === null) {
    // __dirname is `dist-electron/electron/ipc` here, one level deeper than
    // `dist-electron/electron` where `scripts/build-electron-main.mjs` copies
    // the vendored bundle — so the walk up is `..`, not the bare filename
    // main.ts used before this handler moved.
    const file = path.join(__dirname, "..", "vendor", "react-grab", "index.global.js");
    try {
      vendorCache = fs.readFileSync(file, "utf8");
    } catch (error) {
      console.error("Deck: react-grab bundle is missing; Inspect is disabled", error);
      vendorCache = "";
    }
  }
  return vendorCache;
}

export interface RegisterBrowserDeps {
  readonly labelOf: (event: IpcMainInvokeEvent) => string;
  readonly browserPanels: BrowserPanels;
}

export function registerBrowser(deps: RegisterBrowserDeps): void {
  ipcMain.handle(CHANNELS.browserOpen, (event, { url }: { url?: string }) => {
    // A stored URL that no longer normalizes (an old setting, a typo the user
    // saved) opens a blank panel instead of failing the whole open.
    const target = typeof url === "string" ? normalizeBrowserUrl(url) : null;
    return deps.browserPanels.open(deps.labelOf(event), target);
  });
  ipcMain.handle(CHANNELS.browserClose, (event) => {
    deps.browserPanels.close(deps.labelOf(event));
  });
  ipcMain.handle(CHANNELS.browserNavigate, (event, { url }: { url?: string }) => {
    const target = normalizeBrowserUrl(String(url ?? ""));
    if (target === null) {
      // Not an error the user needs a dialog for — the address bar keeps what
      // they typed and the caller reports the miss.
      return null;
    }
    deps.browserPanels.navigate(deps.labelOf(event), target);
    return target;
  });
  ipcMain.handle(CHANNELS.browserBack, (event) => deps.browserPanels.goBack(deps.labelOf(event)));
  ipcMain.handle(CHANNELS.browserForward, (event) =>
    deps.browserPanels.goForward(deps.labelOf(event)),
  );
  ipcMain.handle(CHANNELS.browserReload, (event) => deps.browserPanels.reload(deps.labelOf(event)));
  ipcMain.handle(
    CHANNELS.browserSetBounds,
    (event, bounds: { x: number; y: number; width: number; height: number }) => {
      deps.browserPanels.setBounds(deps.labelOf(event), bounds);
    },
  );
  ipcMain.handle(CHANNELS.browserSetVisible, (event, { visible }: { visible: boolean }) => {
    deps.browserPanels.setVisible(deps.labelOf(event), visible === true);
  });
  ipcMain.handle(CHANNELS.browserSetInspect, (event, { active }: { active: boolean }) => {
    deps.browserPanels.setInspect(deps.labelOf(event), active === true);
  });
}
