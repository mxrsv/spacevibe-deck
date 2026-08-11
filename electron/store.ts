/**
 * Persistent key/value files — the replacement for `@tauri-apps/plugin-store`.
 *
 * The renderer loads six of these by name (`settings.json`, `workspaces.json`,
 * `presets.json`, `logo.json`, `workspace-logos.json`,
 * `update-attempt.json`), so the file names and the JSON shape are kept
 * identical even though nothing migrates across from a Tauri install — the
 * cutover is a clean install by decision, but keeping the shape means the
 * renderer code and its tests do not have to change.
 *
 * Writes are atomic: a crash mid-write must not leave a truncated
 * `settings.json`, because the renderer treats an unreadable store as "no
 * settings" and would silently reset the user's configuration.
 */
import fs from "node:fs/promises";
import path from "node:path";

export interface StoreOptions {
  /** Milliseconds to coalesce writes; 0 disables autosave. */
  readonly autoSaveMs?: number;
  /**
   * Called when a background write fails.
   *
   * The Tauri store plugin DISCARDED its autosave error, "which is how a full
   * disk used to look like a successful write" (settings_merge.rs). Silently
   * dropping it here would reintroduce a bug this project already paid for.
   */
  readonly onError?: (error: unknown) => void;
}

export class JsonStore {
  private data: Record<string, unknown> = {};
  private loaded = false;
  private pendingWrite: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly options: StoreOptions = {},
  ) {}

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      // A store file that is not an object is corrupt, not empty. Treat it as
      // empty here but keep the file — overwriting it would destroy whatever a
      // user might still recover by hand.
      this.data =
        typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      this.data = {};
    }
    this.loaded = true;
  }

  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  entries(): Record<string, unknown> {
    return { ...this.data };
  }

  set(key: string, value: unknown): void {
    this.data = { ...this.data, [key]: value };
    this.scheduleSave();
  }

  delete(key: string): void {
    const { [key]: _removed, ...rest } = this.data;
    this.data = rest;
    this.scheduleSave();
  }

  clear(): void {
    this.data = {};
    this.scheduleSave();
  }

  /** Flush now and wait — used on quit, where a debounce would lose the write. */
  async save(): Promise<void> {
    if (this.pendingWrite !== null) {
      clearTimeout(this.pendingWrite);
      this.pendingWrite = null;
    }
    const snapshot = JSON.stringify(this.data, null, 2);
    this.writing = this.writing.then(() => this.writeAtomic(snapshot));
    await this.writing;
  }

  private scheduleSave(): void {
    const delay = this.options.autoSaveMs ?? 0;
    if (delay <= 0) {
      this.saveInBackground();
      return;
    }
    if (this.pendingWrite !== null) {
      clearTimeout(this.pendingWrite);
    }
    this.pendingWrite = setTimeout(() => {
      this.pendingWrite = null;
      this.saveInBackground();
    }, delay);
  }

  /** A background write whose failure is REPORTED rather than swallowed. */
  private saveInBackground(): void {
    this.save().catch((error: unknown) => {
      if (this.options.onError !== undefined) {
        this.options.onError(error);
        return;
      }
      console.error(`Deck: failed to write ${this.filePath}`, error);
    });
  }

  /**
   * Write to a sibling temp file and rename over the target.
   *
   * `rename` within a directory is atomic on both APFS and NTFS, so a reader
   * sees either the old file or the new one — never a half-written store.
   */
  private async writeAtomic(contents: string): Promise<void> {
    const directory = path.dirname(this.filePath);
    const temp = path.join(directory, `.${path.basename(this.filePath)}.tmp`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temp, contents, "utf8");
    await fs.rename(temp, this.filePath);
  }
}

/** Open (and load) a store by file name, one instance per name per process. */
export class StoreRegistry {
  private readonly stores = new Map<string, JsonStore>();

  constructor(private readonly baseDirectory: string) {}

  async open(fileName: string, options?: StoreOptions): Promise<JsonStore> {
    const existing = this.stores.get(fileName);
    if (existing !== undefined) {
      return existing;
    }
    const store = new JsonStore(
      path.join(this.baseDirectory, fileName),
      options,
    );
    await store.load();
    this.stores.set(fileName, store);
    return store;
  }

  /** Flush every open store — called once on quit. */
  async saveAll(): Promise<void> {
    await Promise.all([...this.stores.values()].map((store) => store.save()));
  }
}
