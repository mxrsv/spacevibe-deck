/**
 * Persistent key/value store — the replacement for `@tauri-apps/plugin-store`.
 *
 * Same class shape and the same six file names, so every existing call site
 * (`Store.load(FILE, …)`, `get`, `set`, `delete`, `save`) is unchanged. The
 * data itself lives in the main process; this is only the door to it.
 */
import { invoke } from "./bridge";

export interface StoreOptions {
  readonly defaults?: Record<string, unknown>;
  /** Milliseconds to debounce, or false for explicit saves only. */
  readonly autoSave?: number | boolean;
}

export interface StoreLoadState {
  readonly state: "ready" | "unreadable";
  readonly fresh: boolean;
}

export class Store {
  private constructor(
    private readonly file: string,
    readonly loadState: StoreLoadState,
  ) {}

  static async load(file: string, options?: StoreOptions): Promise<Store> {
    const loadState = await invoke<StoreLoadState>("store_load", {
      file,
      defaults: options?.defaults ?? {},
      autoSave: typeof options?.autoSave === "number" ? options.autoSave : 0,
    });
    return new Store(file, loadState);
  }

  get<T>(key: string): Promise<T | undefined> {
    return invoke<T | undefined>("store_get", { file: this.file, key });
  }

  set(key: string, value: unknown): Promise<void> {
    return invoke("store_set", { file: this.file, key, value });
  }

  delete(key: string): Promise<void> {
    return invoke("store_delete", { file: this.file, key });
  }

  save(): Promise<void> {
    return invoke("store_save", { file: this.file });
  }
}
