/** Main-owned persistence for roots explicitly chosen in the native folder picker. */
import fs from "node:fs/promises";
import { resolveRoot } from "./fs/path-guard";
import type { JsonStore, StoreRegistry } from "./store";

const STORE_FILE = "image-workspace-grants.json";
const STORE_KEY = "roots";
const MAX_PERSISTED_IMAGE_ROOTS = 256;

export class ImageWorkspaceGrants {
  private roots: ReadonlySet<string>;
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly store: JsonStore,
    roots: ReadonlySet<string>,
  ) {
    this.roots = roots;
  }

  static async open(stores: StoreRegistry): Promise<ImageWorkspaceGrants> {
    const store = await stores.open(STORE_FILE, {
      onError: (error) => console.error("Deck: failed to persist image workspace grants", error),
    });
    const roots = await loadRoots(store);
    return new ImageWorkspaceGrants(store, roots);
  }

  has(root: string): boolean {
    return this.roots.has(root);
  }

  /** Persist before the caller grants this root to a window. */
  grant(root: string): Promise<boolean> {
    const task = this.writing.catch(() => undefined).then(() => this.persistGrant(root));
    this.writing = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async persistGrant(root: string): Promise<boolean> {
    const canonical = resolveRoot(root);
    if (canonical === null || canonical !== root) return false;
    try {
      if (!(await fs.stat(canonical)).isDirectory()) return false;
      const next = new Set(this.roots);
      next.delete(canonical);
      next.add(canonical);
      while (next.size > MAX_PERSISTED_IMAGE_ROOTS) {
        const oldest = next.values().next().value;
        if (oldest === undefined) break;
        next.delete(oldest);
      }
      this.store.set(STORE_KEY, [...next]);
      await this.store.save();
      this.roots = next;
      return true;
    } catch {
      return false;
    }
  }
}

async function loadRoots(store: JsonStore): Promise<ReadonlySet<string>> {
  if (store.loadState.state !== "ready") return new Set();
  const raw = store.get<unknown>(STORE_KEY);
  if (!Array.isArray(raw)) return new Set();
  const roots = await Promise.all(
    raw.slice(-MAX_PERSISTED_IMAGE_ROOTS).map(async (candidate) => {
      if (typeof candidate !== "string") return null;
      const canonical = resolveRoot(candidate);
      if (canonical === null) return null;
      try {
        return (await fs.stat(canonical)).isDirectory() ? canonical : null;
      } catch {
        // A folder that disappeared is no longer an image-read grant.
        return null;
      }
    }),
  );
  return new Set(roots.filter((root): root is string => root !== null));
}
