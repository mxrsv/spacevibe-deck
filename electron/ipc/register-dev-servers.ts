/**
 * Dev server discovery IPC: four flat commands over one main-owned service.
 *
 * The renderer names roots and never trusts or supplies process facts. Interest is per
 * sender (`webContents.id`): `dev_servers_set_roots` replaces this sender's roots,
 * `dev_servers_snapshot` only reads what the service already has, `dev_servers_release`
 * drops the interest, and `dev_servers_resolve` revalidates one row. A sender that
 * crashes, reloads or is destroyed is released here, because its renderer never will.
 *
 * Structural mistakes (wrong types, NUL, relative paths, too many or too long) reject the
 * whole call and leave the previous roots in place. A directory that is merely missing or
 * unreadable is a per-root diagnostic in the reply, never a silent empty success.
 *
 * Quit: the service is disposed at `will-quit`, which only fires once the quit is
 * committed. `before-quit` is cancelable (unsaved files, busy panes) and observation must
 * survive a cancelled one.
 */
import path from "node:path";
import { app, ipcMain, type WebContents } from "electron";
import { CHANNELS } from "./channels";
import { createElectronActivity } from "../dev-servers/electron-activity";
import { MAX_ROOT_LENGTH, MAX_ROOTS } from "../dev-servers/roots";
import {
  createDevServerService,
  type DevServerActivity,
  type DevServerService,
} from "../dev-servers/service";

const MAX_TOKEN_LENGTH = 128;

export interface RegisterDevServersDeps {
  /** Test seam; production builds one over the real native collector and prober. */
  readonly service?: DevServerService;
  /** Test seam; production reads Electron's window focus and power events. */
  readonly activity?: DevServerActivity;
}

export interface DevServersRegistration {
  /** Terminal; `will-quit` calls it. Exposed for tests. */
  dispose(): void;
}

/** The roots a call may carry, or a TypeError naming the first offender. */
export function assertRootList(roots: unknown): readonly string[] {
  if (!Array.isArray(roots)) {
    throw new TypeError("dev_servers_set_roots requires an array of roots");
  }
  if (roots.length > MAX_ROOTS) {
    throw new RangeError(`dev_servers_set_roots accepts at most ${MAX_ROOTS} roots`);
  }
  roots.forEach((root: unknown, index) => {
    if (typeof root !== "string") {
      throw new TypeError(`Root ${index} must be a string`);
    }
    if (root.length === 0 || root.length > MAX_ROOT_LENGTH) {
      throw new RangeError(`Root ${index} must be 1 to ${MAX_ROOT_LENGTH} characters`);
    }
    if (root.includes("\0")) {
      throw new TypeError(`Root ${index} must not contain NUL`);
    }
    if (!path.isAbsolute(root)) {
      throw new TypeError(`Root ${index} must be an absolute path`);
    }
  });
  return roots as readonly string[];
}

function assertToken(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TOKEN_LENGTH) {
    throw new TypeError(`dev_servers_resolve requires a non-empty string ${name}`);
  }
  return value;
}

export function registerDevServers(deps: RegisterDevServersDeps = {}): DevServersRegistration {
  const service =
    deps.service ?? createDevServerService({ activity: deps.activity ?? createElectronActivity() });
  const tracked = new Set<number>();

  /** Attach teardown once per webContents; repeated calls must not stack listeners. */
  const track = (sender: WebContents): string => {
    const key = String(sender.id);
    if (!tracked.has(sender.id)) {
      tracked.add(sender.id);
      const release = () => service.release(key);
      sender.on("render-process-gone", release);
      sender.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) {
          release();
        }
      });
      sender.once("destroyed", () => {
        release();
        tracked.delete(sender.id);
      });
    }
    return key;
  };

  ipcMain.handle(CHANNELS.devServersSetRoots, async (event, { roots }) => {
    const valid = assertRootList(roots);
    return service.setRoots(track(event.sender), valid);
  });
  ipcMain.handle(CHANNELS.devServersSnapshot, (event) => service.snapshot(track(event.sender)));
  ipcMain.handle(CHANNELS.devServersRelease, (event) => {
    service.release(track(event.sender));
  });
  ipcMain.handle(CHANNELS.devServersResolve, (event, { id, instanceToken }) =>
    service.resolve(
      track(event.sender),
      assertToken(id, "id"),
      assertToken(instanceToken, "instanceToken"),
    ),
  );

  const dispose = () => service.dispose();
  app.once("will-quit", dispose);
  return { dispose };
}
