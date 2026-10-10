import { resumeLookup } from "../host/resume-host";
import { defaultFileClient } from "../files/file-client";
import { defaultPtyClient } from "../terminal/pty-client";
import {
  clearWindowRecord,
  flushSessionJournal,
  readWindowRecords,
  resumeSessionJournal,
  sessionArchive,
  sessionRestoreMarker,
  suspendSessionJournal,
} from "../terminal/session-journal";
import { settings } from "../settings/settings-store";
import { resumeWorkspace, type RestoreDeps } from "../terminal/session-restore";
import type { WindowRecord } from "../lib/session-schema";
import { reportPersistError } from "../chrome/events";
import { worktreeForPath } from "../repositories/repository-model";
import { archivedWorkspaceResumeAvailable } from "./app-policy";

/**
 * Bundles `restoreSession`'s dependencies from the app's real hosts —
 * `manager`/`files` are the only pieces that vary by call site (the boot
 * effect's own `manager`/`fileController`), everything else is a fixed
 * wiring of the existing clients and the session-journal module.
 */
export function restoreDeps(deps: {
  readonly manager: RestoreDeps["manager"];
  readonly files: RestoreDeps["files"];
  /** Records already read at boot; the journal on disk is read otherwise. */
  readonly records?: ReadonlyMap<string, WindowRecord>;
}): RestoreDeps {
  const records = deps.records;
  return {
    manager: deps.manager,
    files: deps.files,
    dirsExist: (paths) => defaultPtyClient.dirsExist(paths),
    statFiles: (root, paths) => defaultFileClient.statFiles(root, paths),
    lookup: resumeLookup,
    customAgents: () => settings.value.customAgents,
    journal: {
      readWindowRecords: records === undefined ? readWindowRecords : async () => records,
      clearWindowRecord,
    },
    marker: sessionRestoreMarker,
  };
}

/**
 * Dependencies for the rail's "resume" click — the same fixed wiring
 * `restoreDeps` uses, narrowed to what `resumeWorkspace` needs: it rebuilds
 * one archived workspace's tabs on demand, so it has no file surfaces, no
 * journal and no crash-loop marker to bundle.
 */
export function railResumeDeps(
  manager: RestoreDeps["manager"],
): Pick<RestoreDeps, "manager" | "dirsExist" | "lookup" | "customAgents"> {
  return {
    manager,
    dirsExist: (paths) => defaultPtyClient.dirsExist(paths),
    lookup: resumeLookup,
    customAgents: () => settings.value.customAgents,
  };
}

/** Restore one archived worktree and recapture after the suspended journal resumes. */
export function resumeArchivedWorktree(
  path: string,
  deps: {
    readonly manager: RestoreDeps["manager"] | null;
    readonly resumingWorkspaces: ReadonlySet<string>;
    readonly setResumingWorkspaces: (paths: ReadonlySet<string>) => void;
  },
): void {
  const { manager, resumingWorkspaces, setResumingWorkspaces } = deps;
  if (manager === null || !archivedWorkspaceResumeAvailable(resumingWorkspaces)) {
    return;
  }
  const newestPrefixMatch = Object.entries(sessionArchive.value)
    .filter(([key]) => worktreeForPath([path], key) === path)
    .reduce<[string, (typeof sessionArchive.value)[string]] | undefined>(
      (best, current) =>
        best === undefined || current[1].savedAt > best[1].savedAt ? current : best,
      undefined,
    );
  const entry = sessionArchive.value[path] ?? newestPrefixMatch?.[1];
  if (entry === undefined) {
    reportPersistError("Couldn't find that archived workspace.");
    return;
  }

  setResumingWorkspaces(new Set([path]));
  suspendSessionJournal();
  void resumeWorkspace(railResumeDeps(manager), entry, path)
    .then((resumed) => {
      if (!resumed) {
        reportPersistError("Couldn't resume that workspace.");
      }
    })
    .catch((error: unknown) => {
      console.warn("Failed to resume archived workspace:", error);
      reportPersistError("Couldn't resume that workspace.");
    })
    .finally(() => {
      resumeSessionJournal();
      // The restore's signal changes were ignored while suspended. Capture the
      // complete result before another restore can start; concurrent shutdown
      // suspension still makes this a no-op through the journal's reference count.
      return flushSessionJournal()
        .catch((error: unknown) => {
          console.warn("Failed to capture restored workspace:", error);
          reportPersistError("Couldn't save that restored workspace.");
        })
        .finally(() => {
          setResumingWorkspaces(new Set());
        });
    });
}
