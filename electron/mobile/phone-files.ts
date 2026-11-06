/**
 * The phone's read-only view of a project's files and changes (MOB21). Every call names a root,
 * and a root counts only if some window reported it as a project or checkout (`isKnownRoot`);
 * every path inside it then goes through `electron/fs/path-guard.ts`, so a phone can never read
 * outside a workspace. Text only: a file with a NUL byte is reported as binary and not sent.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAX_READ_BYTES } from "../../mobile/protocol/src/limits";
import { PhoneError } from "./phone-error";
import { readChanges, runnerFor } from "../git/changes";
import { assertInsideRoot, PathOutsideWorkspaceError } from "../fs/path-guard";

/** Entries one listing returns; the phone's parser accepts more, a directory this big is not browsable on a phone anyway. */
export const MAX_LIST_ENTRIES = 2_000;
const BINARY_SNIFF_BYTES = 8_000;

export interface PhoneFilesDeps {
  readonly isKnownRoot: (root: string) => Promise<boolean>;
}

export interface PhoneFiles {
  list(
    root: string,
    relative: string,
  ): Promise<{ name: string; kind: "file" | "dir"; size: number }[]>;
  read(
    root: string,
    relative: string,
  ): Promise<{ text: string; truncated: boolean; binary: boolean }>;
  changes(
    root: string,
  ): Promise<{ path: string; status: string; added: number; removed: number }[]>;
  diff(root: string, relative: string): Promise<{ diff: string; truncated: boolean }>;
}

export function createPhoneFiles(deps: PhoneFilesDeps): PhoneFiles {
  async function guarded(root: string, relative: string): Promise<string> {
    if (!(await deps.isKnownRoot(root))) throw new PhoneError("outside-root");
    // The phone sends root-relative paths; anything that climbs or is absolute is refused outright.
    const normal = path.normalize(relative);
    if (path.isAbsolute(relative) || normal === ".." || normal.startsWith(`..${path.sep}`)) {
      throw new PhoneError("outside-root");
    }
    const target = relative === "" ? root : path.join(root, relative);
    try {
      return assertInsideRoot(root, target);
    } catch (error) {
      if (!(error instanceof PathOutsideWorkspaceError)) throw new PhoneError("not-found");
      // The guard answers the same for "outside" and "does not exist"; tell them apart here.
      const exists = await fs.lstat(target).then(
        () => true,
        () => false,
      );
      throw new PhoneError(exists ? "outside-root" : "not-found");
    }
  }

  return {
    async list(root, relative) {
      const directory = await guarded(root, relative);
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        throw new PhoneError("not-found");
      }
      const rows: { name: string; kind: "file" | "dir"; size: number }[] = [];
      for (const entry of entries) {
        if (entry.name === ".git") continue;
        if (rows.length >= MAX_LIST_ENTRIES) break;
        const full = path.join(directory, entry.name);
        let kind: "file" | "dir";
        let size = 0;
        try {
          // `stat` follows a symlink; one that leaves the root is dropped, not listed.
          assertInsideRoot(root, full);
          const stats = await fs.stat(full);
          kind = stats.isDirectory() ? "dir" : "file";
          size = kind === "dir" ? 0 : stats.size;
        } catch {
          continue;
        }
        rows.push({ name: entry.name, kind, size });
      }
      return rows.sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
      );
    },

    async read(root, relative) {
      const file = await guarded(root, relative);
      let handle: import("node:fs/promises").FileHandle;
      try {
        handle = await fs.open(file, "r");
      } catch {
        throw new PhoneError("not-found");
      }
      try {
        const stats = await handle.stat();
        if (!stats.isFile()) throw new PhoneError("not-found");
        const buffer = Buffer.alloc(Math.min(stats.size, MAX_READ_BYTES));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        const bytes = buffer.subarray(0, bytesRead);
        if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
          return { text: "", truncated: false, binary: true };
        }
        return {
          text: new TextDecoder("utf-8").decode(bytes),
          truncated: stats.size > MAX_READ_BYTES,
          binary: false,
        };
      } finally {
        await handle.close();
      }
    },

    async changes(root) {
      if (!(await deps.isKnownRoot(root))) throw new PhoneError("outside-root");
      const reply = await readChanges(root);
      if (reply.kind !== "changes") {
        throw new PhoneError(reply.kind === "not-repository" ? "not-found" : "unavailable");
      }
      return reply.entries.map((entry) => ({
        path: entry.path,
        status: entry.status,
        added: entry.added,
        removed: entry.removed,
      }));
    },

    async diff(root, relative) {
      const file = await guarded(root, relative);
      const run = runnerFor(root);
      // After `--` git reads the argument as a path whatever it starts with.
      const tracked = await run(["diff", "HEAD", "--", relative]);
      let diff = tracked.ok ? tracked.stdout : "";
      if (diff === "") {
        // An untracked file has no diff against HEAD: show it as all added.
        const untracked = await run(["ls-files", "--others", "--exclude-standard", "--", relative]);
        if (untracked.ok && untracked.stdout.trim() !== "") {
          const body = await fs.readFile(file, "utf8").catch(() => "");
          diff =
            body === ""
              ? ""
              : `+++ ${relative}\n${body
                  .split("\n")
                  .map((line) => `+${line}`)
                  .join("\n")}\n`;
        }
      }
      if (diff.length <= MAX_READ_BYTES) return { diff, truncated: false };
      return { diff: diff.slice(0, MAX_READ_BYTES), truncated: true };
    },
  };
}
