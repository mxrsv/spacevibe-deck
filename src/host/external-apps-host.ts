/**
 * The three channels the "open a path an agent printed" work added, over the
 * host bridge (design §6).
 *
 * Fail-soft by contract, like `sessions-host.ts`: a host with no handler —
 * Tauri, or a browser `npm run dev` preview — answers null or an empty list
 * rather than throwing, and the caller reads that as "this host cannot do
 * that". On Tauri the consequences are exactly the design's: no workspace ever
 * claims a path, so ⌘+click keeps going out through `open_editor`, and the
 * split-button is not rendered at all.
 *
 * Flat payload keys per R6 — `scripts/electron-ipc-contract.test.ts` reads the
 * object literals below, so the keys have to be written here rather than
 * spread in from an `args` identifier.
 */
import { invoke } from "./bridge";
import {
  isExternalAppId,
  type ExternalAppGroup,
  type ExternalAppId,
} from "../lib/external-app-catalog";

/**
 * Whether THIS host can answer these three channels at all.
 *
 * Read off `window.__deckHost` directly rather than by trying a call, exactly
 * as `worktree-host.ts` does and for the same reason: `invoke` throws when the
 * bridge is missing, and an empty answer is indistinguishable from "nothing is
 * installed". The distinction is load-bearing here — on Tauri a ⌘+click must
 * keep going out through `open_editor` (design §5), and reading an empty
 * installed list as "no app can open this" would turn a working click into an
 * error bar on the host users are still running.
 */
export const available: boolean =
  typeof globalThis !== "undefined" &&
  (globalThis as { __deckHost?: unknown }).__deckHost !== undefined;

/** One installed app, as the main process reports it. */
export interface InstalledExternalApp {
  readonly id: ExternalAppId;
  readonly label: string;
  readonly group: ExternalAppGroup;
  /** The real icon of the installed version, or null when it could not be
   * read — the menu then shows the label alone rather than hiding the app. */
  readonly iconDataUrl: string | null;
}

/**
 * The open workspace root that holds `path`, or null.
 *
 * `roots` is ordered: the clicked pane's own workspace first, then the
 * window's others, and the first match wins.
 */
export async function workspaceForPath(
  path: string,
  roots: readonly string[],
): Promise<string | null> {
  try {
    const answer = await invoke<unknown>("workspace_for_path", {
      path,
      roots: [...roots],
    });
    return typeof answer === "string" && answer.length > 0 ? answer : null;
  } catch {
    return null;
  }
}

function asInstalledApp(raw: unknown): InstalledExternalApp | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const source = raw as Record<string, unknown>;
  // The id is validated against the renderer's own catalog rather than trusted:
  // the two halves are mirrored by hand, and an id only main knows would put a
  // row in the menu that no renderer rule can route.
  if (!isExternalAppId(source.id)) {
    return null;
  }
  return {
    id: source.id,
    label: typeof source.label === "string" ? source.label : source.id,
    group: source.group as ExternalAppGroup,
    iconDataUrl: typeof source.iconDataUrl === "string" ? source.iconDataUrl : null,
  };
}

/** Every app installed on this machine, in catalog order. Empty on Tauri. */
export async function listExternalApps(): Promise<InstalledExternalApp[]> {
  try {
    const raw = await invoke<unknown>("external_apps", {});
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map(asInstalledApp).filter((app): app is InstalledExternalApp => app !== null);
  } catch {
    return [];
  }
}

export interface OpenInAppArgs {
  readonly appId: ExternalAppId;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly line: number;
  readonly column: number;
}

/**
 * Hand a path to an app. Rejects with a user-facing message — an app that is
 * not installed, or a file no repository holds.
 *
 * `line`/`column` ride along even though only an editor could use them: the
 * channel's shape is the same question every time, and the app's own rule
 * (declared in the catalog) decides what it is worth.
 */
export function openInApp({
  appId,
  path,
  isDirectory,
  line,
  column,
}: OpenInAppArgs): Promise<void> {
  return invoke<void>("open_in_app", {
    appId,
    path,
    isDirectory,
    line,
    column,
  });
}
