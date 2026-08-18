/**
 * File explorer IPC handlers: directory listing, read/write/stat, the
 * per-window filesystem watch scope and the dirty-file registry that backs
 * the quit/close census for unsaved editor buffers.
 *
 * Every path is bounded to the workspace root by `fs/path-guard.ts`. `root`
 * travels with each call rather than being remembered per window: a tab fixes
 * its workspace at Open and a second window may hold a different one, so a
 * cached root would authorize the wrong tree.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { CHANNELS } from './channels';
import { listDir, readFile, statFiles } from '../fs/read';
import { writeTextFile } from '../fs/write';
import type { WatchRegistry } from '../fs/watch';
import type { MainDirtyRegistry } from '../dirty-registry';

export interface RegisterExplorerDeps {
  readonly labelOf: (event: IpcMainInvokeEvent) => string;
  readonly watchers: WatchRegistry;
  readonly dirtyFiles: MainDirtyRegistry;
}

export function registerExplorer(deps: RegisterExplorerDeps): void {
  ipcMain.handle(CHANNELS.listDir, (_event, { root, directory }) => listDir(root, directory));
  ipcMain.handle(CHANNELS.readFile, (_event, { root, path: target }) => readFile(root, target));
  ipcMain.handle(CHANNELS.writeFile, (_event, { root, path: target, text, eol }) =>
    writeTextFile(root, target, text, eol),
  );
  ipcMain.handle(CHANNELS.statFiles, (_event, { root, paths }) => statFiles(root, paths));
  ipcMain.handle(CHANNELS.watchPaths, (event, { root, directories, files }) => {
    // A REPLACE. Adding would let a collapsed directory leak a watcher for the
    // rest of the window's life.
    deps.watchers.replace(deps.labelOf(event), { root, directories, files });
  });
  ipcMain.handle(CHANNELS.setDirtyFiles, (event, { paths }) => {
    deps.dirtyFiles.replace(deps.labelOf(event), Array.isArray(paths) ? paths : []);
  });
}
