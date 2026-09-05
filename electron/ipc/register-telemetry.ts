/**
 * Usage-analytics IPC handlers: the three flat channels over the main-owned
 * service in `../telemetry/service.ts`.
 *
 * Main is the sender because three windows are one machine and must be one
 * stored install-day row — the shape `begin_update_check`'s process-wide
 * single flight already solved. `telemetry.json` is opened through the same
 * `StoreRegistry` as every other userData file, but it is deliberately NOT in
 * `register-store.ts`'s allowlist: consent and the daily id must never be one
 * renderer `store_get` away. The consent policy is stated once, in
 * `src/telemetry/usage-notice.ts` and docs/internals/telemetry.md.
 */
import crypto from "node:crypto";
import { app, ipcMain, type BrowserWindow } from "electron";
import type { StoreRegistry } from "../store";
import { CHANNELS, EVENTS } from "./channels";
import {
  POST_TIMEOUT_MS,
  TELEMETRY_ENDPOINT,
  TELEMETRY_FILE,
  type TelemetryStateReply,
  type UsagePayloadLike,
} from "../telemetry/model";
import { createTelemetryService, type TelemetryService } from "../telemetry/service";

export interface TelemetryRegisterDeps {
  readonly stores: StoreRegistry;
  readonly windows: ReadonlyMap<string, BrowserWindow>;
  readonly emitTo: (label: string, event: string, payload: unknown) => boolean;
}

export interface TelemetryHandle {
  /** Best-effort final snapshot on orderly quit. Never throws. */
  flushOnQuit(): Promise<void>;
}

/** The one key the state lives under inside `telemetry.json`. */
const STATE_KEY = "telemetry";

/** Debounce for counter folds; consent changes flush explicitly instead. */
const SAVE_DEBOUNCE_MS = 1000;

/**
 * The real network edge, injected into the service the way `loadUpdater` is
 * injected into the update lifecycle: resolves the HTTP status, rejects on
 * network failure or the 5-second timeout.
 */
async function post(payload: UsagePayloadLike): Promise<number> {
  const response = await fetch(TELEMETRY_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  });
  // Only the status matters; drop the body without reading it.
  await response.body?.cancel().catch(() => undefined);
  return response.status;
}

/** The client's LOCAL calendar day — deliberately not UTC. */
function localDay(nowMs: number): string {
  const date = new Date(nowMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function registerTelemetry(deps: TelemetryRegisterDeps): TelemetryHandle {
  const servicePromise: Promise<TelemetryService> = deps.stores
    .open(TELEMETRY_FILE, { autoSaveMs: SAVE_DEBOUNCE_MS })
    .then((store) => {
      // A root that parses but holds a non-object state is corrupt, not
      // empty — the same write-lock `settings.json` takes (fail closed).
      store.requireObjectValue(STATE_KEY);
      return createTelemetryService({
        now: () => Date.now(),
        localDay,
        randomUUID: () => crypto.randomUUID(),
        post,
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        store: {
          unreadable: () => store.loadState.state === "unreadable",
          read: () => store.get(STATE_KEY),
          write: (state) => {
            store.set(STATE_KEY, state);
          },
          flush: async (state) => {
            store.set(STATE_KEY, state);
            await store.save();
          },
        },
        report: (message, error) => console.error(`Deck: ${message}`, error),
        onStateChanged: (state: TelemetryStateReply) => {
          for (const [label] of deps.windows) {
            deps.emitTo(label, EVENTS.telemetryState, {
              consent: state.consent,
              consentVersion: state.consentVersion,
            });
          }
        },
      });
    });

  // Fire and forget by contract: the renderer never awaits this, and a count
  // that arrives before the store finished loading still lands in order.
  ipcMain.handle(CHANNELS.telemetryCount, (_event, { kind, key, value }) => {
    servicePromise
      .then((service) => service.count(String(kind), String(key), Number(value)))
      .catch((error: unknown) => console.error("Deck: telemetry count failed", error));
  });

  // The state read doubles as "a window is ready": every window asks at boot,
  // and the first answer triggers the enabled run's initial snapshot.
  ipcMain.handle(CHANNELS.telemetryState, async () => {
    const service = await servicePromise;
    service.noteWindowReady();
    return service.state();
  });

  ipcMain.handle(CHANNELS.telemetrySetEnabled, async (_event, { enabled }) => {
    const service = await servicePromise;
    await service.setEnabled(enabled === true);
    return service.state();
  });

  return {
    flushOnQuit: async () => {
      try {
        const service = await servicePromise;
        await service.flushOnQuit();
      } catch {
        // Quit is never held hostage by analytics.
      }
    },
  };
}
