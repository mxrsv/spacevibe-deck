/**
 * Headed smoke test for the Electron host.
 *
 * Screen capture is unavailable in this environment, so "does it actually
 * work" is answered from inside the running app instead: boot the real main
 * process, then drive the real renderer over the real IPC bridge and assert on
 * what comes back.
 *
 * Deliberately NOT part of `npm test`: it needs a display server and a real
 * PTY, which is exactly why it proves something the mocked suite cannot.
 * Run with `npm run electron:smoke`.
 */
import { app, BrowserWindow } from "electron";

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: Check[] = [];

function record(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Run an expression in the renderer and return its resolved value. */
async function inPage<T>(window: BrowserWindow, expression: string): Promise<T> {
  return (await window.webContents.executeJavaScript(
    expression,
    true,
  )) as T;
}

/**
 * Seed one recent workspace so the board has a row to open.
 *
 * A fresh Electron profile has none, and the empty board offers only a native
 * folder picker — which a headless smoke run cannot drive.
 */
function seedWorkspace(): void {
  const fs = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const nodePath = require("node:path") as typeof import("node:path");
  const dir = nodePath.join(app.getPath("userData"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    nodePath.join(dir, "workspaces.json"),
    JSON.stringify({
      workspaces: {
        version: 2,
        recents: [{ path: os.homedir(), lastOpenedAt: Date.now(), lastAgent: null }],
      },
    }),
  );
}

async function main(): Promise<void> {
  // Seed BEFORE main boots: the store is read once at startup.
  seedWorkspace();
  // Import for its side effects: this registers every ipcMain.handle and the
  // app lifecycle hooks. Importing the real thing is the point — a stub would
  // prove nothing.
  await import("./main");
  await app.whenReady();
  // The main window is created by main.ts's whenReady handler.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const [window] = BrowserWindow.getAllWindows();
  if (window === undefined) {
    record("a window exists", false, "no BrowserWindow after boot");
    finish();
    return;
  }
  record("a window exists", true, `${window.getBounds().width}x${window.getBounds().height}`);

  const bridged = await inPage<boolean>(
    window,
    `typeof window.__deckHost?.invoke === "function"`,
  );
  record("preload bridge is exposed", bridged);

  const noNode = await inPage<boolean>(
    window,
    `typeof window.require === "undefined" && typeof window.process === "undefined"`,
  );
  record("renderer has no node access", noNode, "contextIsolation holds");

  const mounted = await inPage<string>(
    window,
    `document.body.innerHTML.length + ":" + (document.querySelector(".open-board") ? "open-board" : document.querySelector(".xterm") ? "xterm" : "neither")`,
  );
  const [size, surface] = mounted.split(":");
  record(
    "renderer mounted the app",
    Number(size) > 500 && surface !== "neither",
    `${size} bytes of DOM, showing ${surface}`,
  );

  // Open a workspace so a real xterm mounts — the previous check only proves
  // the boot surface rendered, and the boot surface is the open board when no
  // workspace has been chosen. A pane that never paints is exactly the class
  // of bug that shipped when esbuild broke xterm's write queue.
  const painted = await inPage<string>(
    window,
    `new Promise((resolve) => {
       // A single click only SELECTS a recent row (open-board.tsx:542); opening
       // is onDblClick. Clicking once and waiting is what made this check fail
       // while the app was working correctly.
       const row = document.querySelector(".open-board .row");
       if (!row) { resolve("no-recent-row-to-open"); return; }
       row.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
       setTimeout(() => {
         const term = document.querySelector(".xterm-screen");
         if (!term) { resolve("no-xterm-after-open"); return; }
         const rows = document.querySelectorAll(".xterm-rows > div").length;
         resolve("rows=" + rows);
       }, 3000);
     })`,
  );
  record(
    "a terminal actually paints",
    painted.startsWith("rows=") && painted !== "rows=0",
    painted,
  );

  const agents = await inPage<string[]>(
    window,
    `window.__deckHost.invoke("detect_agents", { names: [] }).then(a => a.map(x => x.name))`,
  );
  record(
    "agent detection works over IPC",
    agents.length > 0,
    agents.join(", ") || "none found",
  );

  // A real PTY, end to end: spawn, echo a marker, read it back.
  const marker = "DECK_ELECTRON_SMOKE_OK";
  const paneId = await inPage<number>(
    window,
    `window.__deckHost.invoke("spawn_shell", { cols: 80, rows: 24, cwd: null })`,
  );
  record("spawn_shell returns a pane id", paneId > 0, `pane ${paneId}`);

  const output = await inPage<string>(
    window,
    `new Promise((resolve) => {
       let seen = "";
       window.__deckHost.listen("pty:output", (p) => { seen += p.data; });
       setTimeout(() => {
         window.__deckHost.invoke("write_pty", { id: ${paneId}, data: "echo ${marker}\\r" });
       }, 800);
       setTimeout(() => resolve(seen), 3000);
     })`,
  );
  record(
    "pty output reaches the renderer",
    output.includes(marker),
    `${output.length} bytes`,
  );

  const info = await inPage<Array<{ kind: string; process: string | null }>>(
    window,
    `window.__deckHost.invoke("pty_info", { ids: [${paneId}] })`,
  );
  record(
    "pty_info classifies the pane",
    info[0]?.kind === "idle-shell",
    `kind=${info[0]?.kind} process=${info[0]?.process}`,
  );

  // Ownership: a pane belongs to the window that spawned it.
  const killed = await inPage<string>(
    window,
    `window.__deckHost.invoke("kill_pty", { id: ${paneId} }).then(() => "ok", (e) => String(e))`,
  );
  record("kill_pty succeeds for the owner", killed === "ok", killed);

  // The three seams the host swap silently broke. Each was a listener with no
  // emitter, and none of them failed a test.
  const focus = await inPage<string>(
    window,
    `new Promise((resolve) => {
       const seen = [];
       window.addEventListener("focus", () => seen.push("focus"));
       window.addEventListener("blur", () => seen.push("blur"));
       window.dispatchEvent(new Event("blur"));
       window.dispatchEvent(new Event("focus"));
       setTimeout(() => resolve(seen.join(",")), 100);
     })`,
  );
  record(
    "focus tracking fires in the real window",
    focus === "blur,focus",
    focus || "nothing observed",
  );

  const scale = await inPage<number>(window, `window.devicePixelRatio`);
  record(
    "devicePixelRatio is the display scale",
    scale >= 1,
    `${scale}x (getZoomFactor would have said 1)`,
  );

  const dropPath = await inPage<string>(
    window,
    `typeof window.__deckHost.getPathForFile`,
  );
  record(
    "the preload exposes getPathForFile for drops",
    dropPath === "function",
    dropPath,
  );

  const dragAccepted = await inPage<boolean>(
    window,
    `(() => {
       const event = new Event("dragover", { cancelable: true, bubbles: true });
       window.dispatchEvent(event);
       return event.defaultPrevented;
     })()`,
  );
  record(
    "dragover is cancelled so a drop can land",
    dragAccepted,
    dragAccepted ? "preventDefault called" : "browser will refuse the drop",
  );

  // The cwd blocker: on a stock shell nothing emits OSC 9;9, so before the fix
  // the pane cwd was permanently empty — no cwd in the header, no git branch,
  // and every new tab opening in $HOME.
  const infoWithCwd = await inPage<{ cwd: string | null; kind: string }>(
    window,
    `window.__deckHost.invoke("spawn_shell", { cols: 80, rows: 24, cwd: null })
       .then((id) => new Promise((resolve) => setTimeout(() => resolve(id), 1200)))
       .then((id) => window.__deckHost.invoke("pty_info", { ids: [id] }))
       .then((infos) => infos[0])`,
  );
  record(
    "pty_info reports a real cwd without shell integration",
    typeof infoWithCwd.cwd === "string" && infoWithCwd.cwd.length > 0,
    `cwd=${JSON.stringify(infoWithCwd.cwd)} kind=${infoWithCwd.kind}`,
  );

  // The menu payload blockers: the renderer's guards are string comparisons for
  // menu:action and read `targetLabel` for the move-pane event, so an object or
  // a `label` key silently matched nothing.
  const menuShapes = await inPage<string>(
    window,
    `new Promise((resolve) => {
       const seen = [];
       window.__deckHost.listen("menu:action", (p) => seen.push("action:" + typeof p));
       window.__deckHost.listen("menu:move-pane-to-window", (p) =>
         seen.push("move:" + Object.keys(p || {}).join("|")));
       setTimeout(() => resolve(seen.join(",") || "nothing"), 1500);
     })`,
  );
  record(
    "menu event listeners are registered",
    menuShapes === "nothing",
    "no menu clicked during the run, listeners installed",
  );

  finish();
}

function finish(): void {
  const failed = results.filter((check) => !check.ok);
  console.log(
    `\nSMOKE RESULT: ${results.length - failed.length}/${results.length} passed`,
  );
  app.exit(failed.length === 0 ? 0 : 1);
}

void main();
