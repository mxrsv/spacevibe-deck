/**
 * The Electron-facing assembly of the mobile service: `safeStorage`, the userData file, the power
 * blocker, the window registry. Kept out of `main.ts` (already over-length) and out of
 * `service.ts` (which stays testable without Electron). Returns null while the `mobileCompanion`
 * switch is off, so nothing below ever runs in a release that has not turned it on.
 */
import {
  app,
  BrowserWindow,
  powerSaveBlocker,
  safeStorage,
  type BrowserWindow as BrowserWindowType,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createNodeCrypto } from "../../mobile/protocol/src/crypto-node";
import { isReleaseSwitchEnabled, resolveReleaseSwitches } from "../../src/lib/release-switches";
import type { SessionFileIo } from "../account/session-store";
import type { PaneMirror } from "../control/pane-mirror";
import type { WindowCoordinator } from "../coordinator";
import { writeFileAtomically } from "../fs/write";
import { sharedUsageService } from "../ipc/register-services";
import { createPairingStore, guardedCipher } from "./pairing-store";
import { resolveRelayUrl } from "./relay-config";
import { createMobileService, type MobileService, type MobileUsageKind } from "./service";

export const PAIRINGS_FILE = "mobile-pairings.json";

export function mobileCompanionEnabled(): boolean {
  return isReleaseSwitchEnabled("mobileCompanion", resolveReleaseSwitches(!app.isPackaged));
}

function fileIo(file: string): SessionFileIo {
  return {
    read: () =>
      fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      }),
    // Holds every pairing's long-term keys: owner-only, and encrypted before it gets here.
    write: (contents) => writeFileAtomically(file, contents, { mode: 0o600 }),
    remove: () => fs.rm(file, { force: true }),
  };
}

export function createMobileForMain(deps: {
  readonly windows: ReadonlyMap<string, BrowserWindowType>;
  readonly coordinator: WindowCoordinator;
  readonly mirror: PaneMirror;
  readonly emitTo: (label: string, event: string, payload: unknown) => boolean;
  readonly mostRecentlyFocused: () => string | null;
  readonly mainLabel: string;
  readonly broadcastChanged: () => void;
  /** Usage analytics (MOB27): counts only, never an id or a name. */
  readonly onUsage: (kind: MobileUsageKind) => void;
  readonly onPairedPhones: (count: number) => void;
}): MobileService | null {
  if (!mobileCompanionEnabled()) return null;
  const service = createMobileService({
    crypto: createNodeCrypto(),
    store: createPairingStore({
      io: fileIo(path.join(app.getPath("userData"), PAIRINGS_FILE)),
      cipher: guardedCipher(safeStorage, process.platform, () =>
        // Linux only; absent on other platforms and older Electron.
        (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.(),
      ),
      report: (message) => console.warn(message),
    }),
    relayUrl: () => resolveRelayUrl(app.isPackaged),
    fetch: (url, init) => fetch(url, init),
    appVersion: app.getVersion(),
    platform: process.platform,
    mirror: deps.mirror,
    windows: {
      ownerOf: (paneId) => deps.coordinator.owner(paneId),
      deliver: (paneId, event, payload) => deps.coordinator.deliver(paneId, event, payload),
      emitTo: deps.emitTo,
      labels: () => [...deps.windows.keys()],
      focused: deps.mostRecentlyFocused,
      main: () => (deps.windows.has(deps.mainLabel) ? deps.mainLabel : null),
      anyFocused: () => BrowserWindow.getFocusedWindow() !== null,
    },
    usage: () => sharedUsageService().snapshot(),
    blocker: powerSaveBlocker,
    // Every change may be a pairing or a revoke, so the gauge is re-read with each one.
    broadcastChanged: () => {
      deps.broadcastChanged();
      deps.onPairedPhones(service.state().phones.length);
    },
    onUsage: deps.onUsage,
    // The LAN path (MOB9): defaults, private interfaces only; it still waits for a paired phone.
    lan: {},
    log: (message) => console.warn(message),
  });
  void app
    .whenReady()
    .then(() => service.start())
    .then(() => deps.onPairedPhones(service.state().phones.length));
  app.once("will-quit", () => service.dispose());
  return service;
}
