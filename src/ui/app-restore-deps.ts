import { resumeLookup } from "../host/resume-host";
import { defaultFileClient } from "../files/file-client";
import { defaultPtyClient } from "../terminal/pty-client";
import {
  clearWindowRecord,
  readWindowRecords,
  sessionRestoreMarker,
} from "../terminal/session-journal";
import { settings } from "../settings/settings-store";
import type { RestoreDeps } from "../terminal/session-restore";
import type { WindowRecord } from "../lib/session-schema";

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
