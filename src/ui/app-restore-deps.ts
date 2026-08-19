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

/**
 * Bundles `restoreSession`'s dependencies from the app's real hosts —
 * `manager`/`files` are the only pieces that vary by call site (the boot
 * effect's own `manager`/`fileController`), everything else is a fixed
 * wiring of the existing clients and the session-journal module.
 */
export function restoreDeps(deps: {
  readonly manager: RestoreDeps["manager"];
  readonly files: RestoreDeps["files"];
}): RestoreDeps {
  return {
    manager: deps.manager,
    files: deps.files,
    dirsExist: (paths) => defaultPtyClient.dirsExist(paths),
    statFiles: (root, paths) => defaultFileClient.statFiles(root, paths),
    lookup: resumeLookup,
    customAgents: () => settings.value.customAgents,
    journal: {
      readWindowRecords,
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

/** Guards the rail's "resume" click against a double click/Enter firing two
 *  concurrent `resumeWorkspace` calls for the same workspace — each lookup
 *  is independent, so both would pick the same archived session id and
 *  materialize duplicate tabs (H3). Module-level: the rail row has no
 *  per-item component state to hang this off. */
export const resumingWorkspaces = new Set<string>();
