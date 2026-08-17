/**
 * Persistent key/value files — the replacement for `@tauri-apps/plugin-store`.
 *
 * The renderer loads a fixed allowlist of these by name. Existing files keep
 * their Tauri-era JSON shape, while renderer-only features add their own
 * narrowly named stores (for example `sidebar-banner.json`). The cutover is a
 * clean install by decision, but keeping each shape stable means the renderer
 * code and its tests do not have to fork by host.
 *
 * Writes are atomic, and an unreadable store is write-locked: a failed read
 * must never become permission to replace the user's recoverable bytes with
 * defaults.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { writeFileAtomically } from "./fs/write";

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

export interface StoreLoadState {
  readonly state: "ready" | "unreadable";
  readonly fresh: boolean;
}

export class JsonStore {
  private data: Record<string, unknown> = {};
  private loaded = false;
  /**
   * The file EXISTS but could not be turned into an object.
   *
   * Distinct from "no file": a missing store is a fresh install and writing
   * over nothing is correct. An unreadable one holds the user's real
   * configuration, and the caller above treats it as `{}` — which used to end
   * with the defaults being seeded and autosaved straight over it.
   */
  private currentLoadState: StoreLoadState = {
    state: "ready",
    fresh: true,
  };
  private pendingWrite: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private reloading: Promise<StoreLoadState> | null = null;

  private onError: ((error: unknown) => void) | undefined;

  constructor(
    private readonly filePath: string,
    private readonly options: StoreOptions = {},
  ) {
    this.onError = options.onError;
  }

  /** Replace the failure reporter — see `StoreRegistry.setErrorReporter`. */
  setErrorReporter(onError: (error: unknown) => void): void {
    this.onError = onError;
  }

  async load(): Promise<StoreLoadState> {
    if (this.loaded) {
      return this.currentLoadState;
    }
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      // A store file that is not an object is corrupt, not empty. Treat it as
      // empty here but keep the file — overwriting it would destroy whatever a
      // user might still recover by hand.
      const usable =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
      this.data = usable ? (parsed as Record<string, unknown>) : {};
      this.currentLoadState = {
        state: usable ? "ready" : "unreadable",
        fresh: false,
      };
    } catch (error: unknown) {
      this.data = {};
      // ENOENT is the only benign case — every other reason (bad JSON, a
      // truncated file from a power loss, a cloud-sync conflict copy, EACCES)
      // means real data is sitting there unread.
      const fresh = (error as NodeJS.ErrnoException).code === "ENOENT";
      this.currentLoadState = {
        state: fresh ? "ready" : "unreadable",
        fresh,
      };
      if (!fresh) {
        console.error(`Deck: could not read ${this.filePath}`, error);
      }
    }
    this.loaded = true;
    return this.currentLoadState;
  }

  get loadState(): StoreLoadState {
    return this.currentLoadState;
  }

  /**
   * Require one key to be an object when present.
   *
   * The root JSON can be valid while a domain value is not (`settings: null`).
   * Marking that state unreadable gives the domain the same write lock and
   * repair/retry path as malformed JSON without teaching this generic store
   * which keys each caller owns. An absent value remains healthy so defaults
   * can seed a fresh or older store.
   */
  requireObjectValue(key: string): boolean {
    if (!this.loaded) {
      throw new Error(`${path.basename(this.filePath)} has not been loaded`);
    }
    if (this.currentLoadState.state === "unreadable") {
      return false;
    }
    const value = this.data[key];
    const usable =
      value === undefined ||
      (typeof value === "object" && value !== null && !Array.isArray(value));
    if (!usable) {
      this.currentLoadState = { state: "unreadable", fresh: false };
    }
    return usable;
  }

  /**
   * Re-read only a write-locked store, so Settings' Retry can recover after
   * the user repairs the file without risking an unsaved healthy snapshot.
   */
  retryUnreadable(): Promise<StoreLoadState> {
    if (this.currentLoadState.state === "ready") {
      return Promise.resolve(this.currentLoadState);
    }
    if (this.reloading !== null) {
      return this.reloading;
    }
    this.loaded = false;
    const attempt = this.load().finally(() => {
      this.reloading = null;
    });
    this.reloading = attempt;
    return attempt;
  }

  private assertWritable(): void {
    if (!this.loaded) {
      throw new Error(`${path.basename(this.filePath)} has not been loaded`);
    }
    if (this.currentLoadState.state === "unreadable") {
      throw new Error(
        `${path.basename(this.filePath)} is unreadable; write blocked`,
      );
    }
  }

  get<T>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  entries(): Record<string, unknown> {
    return { ...this.data };
  }

  set(key: string, value: unknown): void {
    this.assertWritable();
    this.data = { ...this.data, [key]: value };
    this.scheduleSave();
  }

  delete(key: string): void {
    this.assertWritable();
    const { [key]: _removed, ...rest } = this.data;
    this.data = rest;
    this.scheduleSave();
  }

  clear(): void {
    this.assertWritable();
    this.data = {};
    this.scheduleSave();
  }

  /** Flush now and wait — used on quit, where a debounce would lose the write. */
  async save(): Promise<void> {
    this.assertWritable();
    if (this.pendingWrite !== null) {
      clearTimeout(this.pendingWrite);
      this.pendingWrite = null;
    }
    const snapshot = JSON.stringify(this.data, null, 2);
    // `.then(() => …)` on a REJECTED chain skips its callback and re-rejects
    // with the stale reason, so one transient failure (a full disk) would stop
    // this store writing for the rest of the run while the disk was fine.
    // Serialise on settlement instead, and surface only this attempt's outcome.
    const attempt = this.writing
      .catch(() => undefined)
      .then(() => this.writeAtomic(snapshot));
    // Swallow on the CHAIN so the next write starts clean; the caller still
    // sees this attempt's rejection through `attempt`.
    this.writing = attempt.catch(() => undefined);
    await attempt;
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
      console.error(`Deck: failed to write ${this.filePath}`, error);
      this.onError?.(error);
    });
  }

  /**
   * Write to a sibling temp file and rename over the target.
   *
   * The implementation moved to `fs/write.ts` when the file explorer needed the
   * same guarantee for source files (plan T12). It is CALLED from here rather
   * than duplicated there: two atomic writers would drift, and this one's
   * existing tests are the regression gate on the extraction.
   */
  private async writeAtomic(contents: string): Promise<void> {
    await writeFileAtomically(this.filePath, contents);
  }
}

/** Open (and load) a store by file name, one instance per name per process. */
export class StoreRegistry {
  /**
   * Keyed by file name and holding the PROMISE, not the store.
   *
   * Recording the promise before awaiting is what makes concurrent opens
   * return the same instance. Awaiting first and then recording let two
   * callers each build their own `JsonStore` for one file: two in-memory
   * copies diverging silently, and both writing the same `.tmp` path, where
   * the second rename hits ENOENT because the first already consumed it.
   */
  private readonly stores = new Map<string, Promise<JsonStore>>();

  constructor(private readonly baseDirectory: string) {}

  open(fileName: string, options?: StoreOptions): Promise<JsonStore> {
    const existing = this.stores.get(fileName);
    if (existing !== undefined) {
      return existing.then(async (store) => {
        await store.retryUnreadable();
        return store;
      });
    }
    const store = new JsonStore(
      path.join(this.baseDirectory, fileName),
      options,
    );
    const opening = store.load().then(() => store);
    this.stores.set(fileName, opening);
    return opening;
  }

  /**
   * Install or replace the failure reporter for an already-open store.
   *
   * `open` cannot do it: the first caller wins and every later caller's
   * options are dropped, so whichever code path happened to open the file
   * first would own error reporting for the rest of the run — and if that was
   * a background patch with no reporter, write failures would go unseen.
   */
  async setErrorReporter(
    fileName: string,
    onError: (error: unknown) => void,
  ): Promise<void> {
    const store = await this.stores.get(fileName);
    store?.setErrorReporter(onError);
  }

  /**
   * Flush every open store — called once on quit.
   *
   * `allSettled`, not `all`: fail-fast would let one rejecting store fire the
   * app exit while the healthy ones were still mid-write.
   */
  async saveAll(): Promise<void> {
    const stores = await Promise.all([...this.stores.values()]);
    const results = await Promise.allSettled(
      stores.map((store) => store.save()),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Deck: a store failed to flush on quit", result.reason);
      }
    }
  }
}
