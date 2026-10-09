/**
 * The Changes list's channels. `root` travels with every call, as in
 * `register-explorer.ts`, and is checked by `readChanges` through the path
 * guard before git is spawned.
 */
import { ipcMain } from "electron";
import { CHANNELS } from "./channels";
import { readChanges } from "../git/changes";

export function registerChanges(): void {
  // Never rejects: every failure is a typed reply for the status line.
  ipcMain.handle(CHANNELS.gitChanges, (_event, { root }) => readChanges(root));
}
