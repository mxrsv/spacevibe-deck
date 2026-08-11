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

async function main(): Promise<void> {
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
    `document.body.innerHTML.length + ":" + (document.querySelector(".xterm") ? "xterm" : "no-xterm")`,
  );
  const [size, terminal] = mounted.split(":");
  record(
    "renderer mounted the app",
    Number(size) > 500,
    `${size} bytes of DOM, ${terminal}`,
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
