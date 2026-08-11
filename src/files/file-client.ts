/**
 * The renderer's facade over the filesystem channels (plan T14).
 *
 * Shaped like `src/host/*`: the UI never calls `invoke` directly, so the pure
 * modules in this folder stay host-free and unit-testable, and every payload
 * key is written in exactly one place — which is what
 * `scripts/electron-ipc-contract.test.ts` parses.
 */
import { invoke, listen, type UnlistenFn } from "../host/bridge";
import type { DirEntry } from "./file-tree";
import type { Eol } from "./file-content";

export interface FileStatResult {
  readonly path: string;
  readonly exists: boolean;
  readonly mtimeMs: number | null;
  readonly size: number | null;
}

export type ReadFileResponse =
  | {
      readonly kind: "ok";
      readonly content: string;
      readonly eol: Eol;
      readonly encoding: "utf-8" | "invalid-utf-8";
      readonly bytes: number;
      readonly mixedEol: boolean;
      readonly readOnly: boolean;
      readonly reason: string | null;
      readonly mtimeMs: number;
      readonly size: number;
      readonly writable: boolean;
    }
  | { readonly kind: "refused"; readonly reason: string };

export interface WriteFileResponse {
  readonly path: string;
  readonly mtimeMs: number;
  readonly size: number;
}

/** Payload of the `fs:changed` event. */
export interface FileChangedPayload {
  readonly path: string;
  readonly kind: "changed" | "deleted";
  readonly mtimeMs: number | null;
  readonly size: number | null;
}

export interface FileClient {
  listDir(root: string, directory: string): Promise<DirEntry[]>;
  readFile(root: string, path: string): Promise<ReadFileResponse>;
  writeFile(
    root: string,
    path: string,
    text: string,
    eol: Eol,
  ): Promise<WriteFileResponse>;
  statFiles(root: string, paths: readonly string[]): Promise<FileStatResult[]>;
  /** Replace this window's whole watch set — never adds to it. */
  watchPaths(
    root: string,
    directories: readonly string[],
    files: readonly string[],
  ): Promise<void>;
  /** Push this window's COMPLETE set of unsaved paths (plan T15.1). */
  setDirtyFiles(paths: readonly string[]): Promise<void>;
  listenFileChanged(
    handler: (event: FileChangedPayload) => void,
  ): Promise<UnlistenFn>;
}

export const defaultFileClient: FileClient = {
  listDir(root, directory) {
    return invoke<DirEntry[]>("list_dir", { root, directory });
  },
  readFile(root, path) {
    return invoke<ReadFileResponse>("read_file", { root, path });
  },
  writeFile(root, path, text, eol) {
    return invoke<WriteFileResponse>("write_file", { root, path, text, eol });
  },
  statFiles(root, paths) {
    return invoke<FileStatResult[]>("stat_files", { root, paths });
  },
  watchPaths(root, directories, files) {
    return invoke<void>("watch_paths", { root, directories, files });
  },
  setDirtyFiles(paths) {
    return invoke<void>("set_dirty_files", { paths });
  },
  listenFileChanged(handler) {
    return listen<FileChangedPayload>("fs:changed", (event) =>
      handler(event.payload),
    );
  },
};
