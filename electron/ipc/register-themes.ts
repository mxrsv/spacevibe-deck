/**
 * Themes-folder IPC handlers: list, import through a native file picker, and
 * reveal `<userData>/themes` in the OS file manager.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { CHANNELS } from './channels';
import { importThemes, listThemes, revealThemes } from '../themes';

export function registerThemes(): void {
  // `<userData>/themes`, read as text and handed to the renderer to parse. The
  // renderer never names a path here — unlike the explorer block below, there is
  // nothing to guard because there is nothing to address.
  ipcMain.handle(CHANNELS.themesList, () => listThemes());
  ipcMain.handle(CHANNELS.themesImport, (event) =>
    // Modal to the window that asked, so a second window cannot inherit a sheet
    // opened from the first.
    importThemes(BrowserWindow.fromWebContents(event.sender)),
  );
  ipcMain.handle(CHANNELS.themesReveal, () => revealThemes());
}
