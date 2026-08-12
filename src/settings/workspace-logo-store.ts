import { signal } from "@preact/signals";
import { invoke } from "../host/bridge";
import { Store } from "../host/store-host";
import { normalizeWorkspacePath } from "../lib/workspace-label";
import { reportPersistError } from "../chrome/events";

const STORE_FILE = "workspace-logos.json";
const STORE_KEY = "logos";

/** Per-workspace custom logos, keyed by normalized path → image data URL. */
export const workspaceLogos = signal<Record<string, string>>({});

/**
 * Favicon scan results, keyed by normalized path. `string` = found data URL,
 * `null` = scanned, none found. Absent = not scanned yet. In-memory only —
 * the favicon lives in the repo, so it is re-scanned each session.
 */
export const workspaceFavicons = signal<Record<string, string | null>>({});

let store: Store | null = null;

/** Keep only string→(image data URL) pairs; drop anything malformed. */
export function validateLogoMap(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (
      key !== "" &&
      typeof value === "string" &&
      value.startsWith("data:image/")
    ) {
      result[key] = value;
    }
  }
  return result;
}

/** Load persisted per-workspace logos at startup — falls back to empty. */
export async function initWorkspaceLogos(): Promise<void> {
  try {
    store = await Store.load(STORE_FILE, { defaults: {}, autoSave: false });
    const raw = await store.get<unknown>(STORE_KEY);
    workspaceLogos.value = validateLogoMap(raw);
  } catch (err) {
    console.warn("Failed to load workspace logos, starting empty:", err);
  }
}

function persist(map: Record<string, string>): void {
  if (!store) {
    reportPersistError("Workspace logo wasn't saved (storage unavailable)");
    return;
  }
  store
    .set(STORE_KEY, map)
    .then(() => store?.save())
    .catch((err: unknown) => {
      console.warn("Failed to save workspace logos:", err);
      reportPersistError("Workspace logo wasn't saved to disk");
    });
}

/**
 * Swallow an image file and set it as `workspacePath`'s custom logo. Throws a
 * human-readable message (from Rust) on failure so the caller can surface it.
 */
export async function setWorkspaceLogoFromPath(
  workspacePath: string,
  imagePath: string,
): Promise<void> {
  const key = normalizeWorkspacePath(workspacePath);
  if (key === null) {
    return;
  }
  let dataUrl: string;
  try {
    dataUrl = await invoke<string>("read_image_as_data_url", {
      path: imagePath,
    });
  } catch (err: unknown) {
    throw new Error(typeof err === "string" ? err : "Couldn't read the image");
  }
  const next = { ...workspaceLogos.value, [key]: dataUrl };
  workspaceLogos.value = next;
  persist(next);
}

/** Remove a workspace's custom logo, reverting to favicon / letter avatar. */
export function clearWorkspaceLogo(workspacePath: string): void {
  const key = normalizeWorkspacePath(workspacePath);
  if (key === null || !(key in workspaceLogos.value)) {
    return;
  }
  const { [key]: _removed, ...rest } = workspaceLogos.value;
  workspaceLogos.value = rest;
  persist(rest);
}

/** True when the workspace has a user-set custom logo (not just a favicon). */
export function hasCustomWorkspaceLogo(workspacePath: string): boolean {
  const key = normalizeWorkspacePath(workspacePath);
  return key !== null && key in workspaceLogos.value;
}

/**
 * Scan a workspace folder for a favicon once and cache the result. Idempotent:
 * a path already scanned (found or not) is never scanned again this session.
 */
export function ensureFaviconScanned(workspacePath: string): void {
  const key = normalizeWorkspacePath(workspacePath);
  if (key === null || key in workspaceFavicons.value) {
    return;
  }
  // Mark as scanned (null) up front so concurrent renders don't re-trigger.
  workspaceFavicons.value = { ...workspaceFavicons.value, [key]: null };
  invoke<string | null>("scan_workspace_favicon", { dir: key })
    .then((dataUrl) => {
      if (dataUrl) {
        workspaceFavicons.value = {
          ...workspaceFavicons.value,
          [key]: dataUrl,
        };
      }
    })
    .catch((err: unknown) => {
      console.warn("scan_workspace_favicon failed:", err);
    });
}

/** The image logo to show for a workspace: custom first, then favicon; else null. */
export function resolveWorkspaceLogo(
  workspacePath: string | null,
): string | null {
  if (workspacePath === null) {
    return null;
  }
  const key = normalizeWorkspacePath(workspacePath);
  if (key === null) {
    return null;
  }
  return workspaceLogos.value[key] ?? workspaceFavicons.value[key] ?? null;
}
