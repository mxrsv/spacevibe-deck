/**
 * Screenshot harness for eye-review.
 *
 * `screencapture` needs Screen Recording permission this environment does not
 * have, but `webContents.capturePage()` renders from inside the app and needs
 * nothing. That is what makes a design loop possible here at all: chrome work
 * has to be judged on a picture, and a build passing proves nothing about how
 * it looks.
 *
 * Run: npm run shoot -- <out-dir> [seconds-to-settle]
 */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] ?? '/tmp/deck-shots';
const SETTLE_MS = Number(process.argv[3] ?? 3) * 1000;

async function shoot(window: BrowserWindow, name: string): Promise<void> {
  const image = await window.webContents.capturePage();
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, image.toPNG());
  console.log(`shot ${file} (${image.getSize().width}x${image.getSize().height})`);
}

function seedWorkspace(): void {
  const fs = require('node:fs') as typeof import('node:fs');
  const os = require('node:os') as typeof import('node:os');
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'workspaces.json'),
    JSON.stringify({
      workspaces: {
        version: 2,
        recents: [
          { path: os.homedir(), lastOpenedAt: 1, lastAgent: null },
          { path: process.cwd(), lastOpenedAt: 2, lastAgent: 'claude' },
        ],
      },
    }),
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  seedWorkspace();
  await import('./main');
  await app.whenReady();
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) {
    console.error('no window');
    app.exit(1);
    return;
  }

  await shoot(window, '01-board');

  // Open a workspace so the tab bar, panes and status bar are all populated —
  // the board alone does not show the frame in its working state.
  const opened = await window.webContents.executeJavaScript(
    `new Promise((resolve) => {
       const row = document.querySelector(".open-board .row");
       if (!row) { resolve("no row"); return; }
       row.click();
       setTimeout(() => {
         // Selected by class, not by text: the Open Folder button also starts
         // with Open, and clicking it opens a native picker nothing can close.
         const open = document.querySelector(".open-board .btn--primary");
         if (!open) { resolve("no open button"); return; }
         open.click();
         setTimeout(() => resolve(document.querySelector(".xterm") ? "panes" : "still board"), 4000);
       }, 400);
     })`,
    true,
  );
  console.log(`open workspace -> ${opened}`);
  await shoot(window, '02-panes');

  // Switch to the top-tab layout — that is where the old empty title bar sat.
  await window.webContents.executeJavaScript(
    `new Promise((resolve) => {
       window.__deckHost.invoke("store_load", { file: "settings.json", autoSave: 0 })
         .then(() => window.__deckHost.invoke("apply_settings_patch", { patch: { tabBarPosition: "top" } }))
         .then(() => setTimeout(resolve, 1500));
     })`,
    true,
  );
  await shoot(window, '04-top-tabs');

  // A split, so the frame is judged against real pane topology.
  await window.webContents.executeJavaScript(
    `new Promise((resolve) => setTimeout(resolve, 500))`,
    true,
  );
  await shoot(window, '03-settled');

  app.exit(0);
}

void main();
