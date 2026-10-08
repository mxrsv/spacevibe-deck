import { invoke } from "../host/bridge";
import { open } from "../host/dialog-host";
import { workspaceLabel } from "../lib/workspace-label";
import { recordWorkspaceOpen } from "../open-board/workspaces-store";
import { ensureRepositoriesScanned } from "../repositories/repositories-store";

/**
 * The create row's `Folder` (DL-27.14, amended 2026-10-08): pick a folder, check it
 * is still there, and put it on the rail as a remembered project. Nothing launches.
 *
 * Resolves to a notice for the rail to print, or `null` when nothing needs saying
 * (added, or the picker was cancelled).
 */
export async function addFolderToRail(): Promise<string | null> {
  let picked: string | null;
  try {
    picked = await open({ directory: true, multiple: false });
  } catch (err: unknown) {
    console.warn("Folder picker failed:", err);
    return "Couldn't open the folder picker — try again";
  }
  if (typeof picked !== "string") {
    return null;
  }
  // An unanswerable probe goes ahead, as the Open board's does: refusing on it would
  // strand a folder the user just picked from a dialog that showed it.
  const gone = await invoke<boolean[]>("dirs_exist", { paths: [picked] })
    .then((flags) => flags[0] === false)
    .catch((err: unknown) => {
      console.warn("dirs_exist failed:", err);
      return false;
    });
  if (gone) {
    return `${workspaceLabel(picked)} is missing — pick another folder`;
  }
  rememberOnRail(picked);
  return null;
}

/** Add a path to the rail without opening it: history is what the rail's remembered tier reads. */
export function rememberOnRail(path: string): void {
  recordWorkspaceOpen(path);
  ensureRepositoriesScanned([path]);
}
