import { getDesktopEnvironment } from "../lib/platform";
import { resolveReleaseSwitches } from "../lib/release-switches";
import {
  ACTION_REGISTRY,
  isActionAvailable,
  isActionId,
  type ActionDefinition,
} from "./action-registry";

/** Read at invocation time, after desktop environment boot; never at import time. */
export function rendererReleaseSwitches() {
  const host = globalThis as { __deckHost?: unknown; __TAURI_INTERNALS?: unknown };
  const desktop = host.__deckHost !== undefined || host.__TAURI_INTERNALS !== undefined;
  // Vitest reports DEV too, so without a host a unit test would run every unfinished region;
  // a suite that wants one on pins the host identity (see action-availability.test.ts).
  const development = desktop
    ? getDesktopEnvironment().isDevelopment === true
    : import.meta.env.DEV && import.meta.env.MODE !== "test";
  return resolveReleaseSwitches(development);
}

export function isRegisteredActionAvailable(id: unknown): boolean {
  if (typeof id !== "string") return false;
  const action = (ACTION_REGISTRY as readonly ActionDefinition[]).find((entry) => entry.id === id);
  const electron = (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;
  // Parameterized select-tab-1..8 are validated IDs, intentionally not registry rows.
  if (action === undefined) return isActionId(id) && /^select-tab-[1-8]$/.test(id);
  return (
    action !== undefined &&
    isActionAvailable(action, rendererReleaseSwitches(), electron ? ["electron"] : [])
  );
}

/** The same guarded callback is installed by App and exercised by entrance tests. */
export function createMenuActionHandler(dispatch: (id: string) => void) {
  return (event: { readonly payload: unknown }): void => {
    if (typeof event.payload === "string" && isRegisteredActionAvailable(event.payload)) {
      dispatch(event.payload);
    }
  };
}
