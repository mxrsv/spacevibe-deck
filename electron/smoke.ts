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

  // The shortcut blocker: `desktop_environment` returning `home` instead of
  // `homeDir` made the renderer fall back to platform "unsupported", where
  // `hasPrimaryModifier` is false for every event and NO shortcut works.
  const env = await inPage<{ platform: string; homeDir: string }>(
    window,
    `window.__deckHost.invoke("desktop_environment")`,
  );
  record(
    "desktop_environment carries homeDir",
    env.platform === "macos" && typeof env.homeDir === "string" && env.homeDir.length > 0,
    `platform=${env.platform} homeDir=${JSON.stringify(env.homeDir)}`,
  );

  // Window dragging: the Tauri attribute means nothing to Electron, so the
  // drag surfaces need `-webkit-app-region` from CSS.
  const draggable = await inPage<string>(
    window,
    `(() => {
       const el = document.querySelector("[data-tauri-drag-region]");
       if (!el) return "no drag region in the DOM";
       return getComputedStyle(el).webkitAppRegion || "none";
     })()`,
  );
  record(
    "the title bar is draggable",
    draggable === "drag",
    `-webkit-app-region: ${draggable}`,
  );

  await checkBrowserPanel(window);

  finish();
}


/**
 * A local page to point the browser panel at.
 *
 * It has to be served over http: the panel refuses `file:` and `data:` (see
 * `browser/url.ts`), and the injected bootstrap has to run in a real document
 * with a real origin for any of this to mean anything.
 */
function servePage(): Promise<{ url: string; stop: () => void }> {
  const http = require("node:http") as typeof import("node:http");
  const body = `<!doctype html><title>Grab target</title>
    <button id="target">Save</button>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        stop: () => server.close(),
      });
    });
  });
}

/**
 * Everything about the browser panel that only a running app can answer.
 *
 * The unit tests mock the host, so they cannot see any of this: whether the
 * bundle reaches the page's MAIN world (where React's fiber expandos live and
 * an isolated world would find nothing), whether a `CustomEvent` detail
 * survives the crossing into the preload's world, or whether react-grab phones
 * home despite the telemetry flag.
 */
async function checkBrowserPanel(window: BrowserWindow): Promise<void> {
  const { session } = require("electron") as typeof import("electron");
  const page = await servePage();

  // Record every outbound request the panel's session makes, so "telemetry is
  // off" is observed rather than assumed from a config line.
  const requested: string[] = [];
  session
    .fromPartition("persist:deck-browser")
    .webRequest.onBeforeRequest((details, callback) => {
      requested.push(details.url);
      callback({});
    });

  await inPage(
    window,
    `window.__deckHost.invoke("browser_open", { url: ${JSON.stringify(page.url)} })`,
  );
  await inPage(
    window,
    `window.__deckHost.invoke("browser_set_bounds", { x: 700, y: 100, width: 380, height: 500 })`,
  );
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const view = window.contentView.children.at(-1) as
    | { webContents?: Electron.WebContents }
    | undefined;
  const contents = view?.webContents;
  record(
    "the panel attaches a web view to the window",
    contents !== undefined && contents.getURL().startsWith(page.url),
    contents === undefined ? "no child view" : `url=${contents.getURL()}`,
  );
  if (contents === undefined) {
    page.stop();
    return;
  }

  const armed = await contents.executeJavaScript(
    `[typeof window.__deckGrab, typeof window.__REACT_GRAB__, typeof globalThis.__REACT_GRAB_MODULE__].join(",")`,
  );
  record(
    "react-grab is initialised in the page's main world",
    armed === "object,object,object",
    `typeof __deckGrab,__REACT_GRAB__,__REACT_GRAB_MODULE__ = ${armed}`,
  );

  // A forged grab: dispatched by page script with no user gesture behind it,
  // which is exactly what a hostile page in the panel can do. The preload's
  // `isTrusted` gate is the only thing standing between that and a paste into
  // a live agent session, and it cannot be tested anywhere but here — the
  // trusted flag is set by the browser and cannot be faked in a unit test.
  await inPage(
    window,
    `(window.__deckSmokeGrab = null,
      window.__deckHost.listen("browser:grab", (payload) => {
        window.__deckSmokeGrab = JSON.stringify(payload);
      }), true)`,
  );
  await contents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent("deck:browser-grab", {
       detail: JSON.stringify({ text: "forged", url: location.href, count: 1 }),
     })), true`,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  const forged = await inPage<string | null>(window, `window.__deckSmokeGrab`);
  record(
    "a grab with no user gesture behind it is dropped",
    forged === null || forged === undefined,
    forged === null || forged === undefined ? "blocked" : `delivered: ${forged}`,
  );

  // The real chain: react-grab's own copy path → the plugin's copy hooks →
  // main world CustomEvent → preload (isolated world) → ipc → host → renderer.
  // `copyElement` is what ⌘C calls, so this exercises the hooks that decide a
  // grab happened, the structured clone across worlds, and the gesture gate —
  // none of which any unit test can reach.
  await inPage(window, `(window.__deckSmokeGrab = null, true)`);

  // A REAL input event, not a synthesised one. `dispatchEvent` produces
  // `isTrusted: false`, which the preload's gate rejects by design — and
  // `executeJavaScript(..., true)` marks user ACTIVATION, a different thing
  // that does not make an event trusted. Only `sendInputEvent` does, and only
  // into a focused view.
  await contents.executeJavaScript(
    `(window.__deckTrusted = 0,
      window.addEventListener("pointerdown", (e) => { if (e.isTrusted) window.__deckTrusted++; }, true),
      window.addEventListener("keydown", (e) => { if (e.isTrusted) window.__deckTrusted++; }, true),
      true)`,
  );
  contents.focus();
  const bounds = { x: 40, y: 30 };
  contents.sendInputEvent({
    type: "mouseDown",
    x: bounds.x,
    y: bounds.y,
    button: "left",
    clickCount: 1,
  });
  contents.sendInputEvent({
    type: "mouseUp",
    x: bounds.x,
    y: bounds.y,
    button: "left",
    clickCount: 1,
  });
  contents.sendInputEvent({ type: "keyDown", keyCode: "c", modifiers: ["cmd"] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const trusted = await contents.executeJavaScript(`window.__deckTrusted`);
  record(
    "the page receives real, trusted input",
    typeof trusted === "number" && trusted > 0,
    // Diagnostic for the check below: with no trusted gesture the preload is
    // CORRECT to drop the grab, so this separates "the gate works" from "the
    // harness never pressed anything".
    `${String(trusted)} trusted event(s)`,
  );

  await contents.executeJavaScript(
    `(window.__REACT_GRAB__.copyElement(document.getElementById("target")), true)`,
    true,
  );
  let delivered = "timeout";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const seen = await inPage<string | null>(window, `window.__deckSmokeGrab`);
    if (seen !== null && seen !== undefined) {
      delivered = seen;
      break;
    }
  }
  record(
    "a real copy reaches the renderer as a grab",
    delivered.includes("button") || delivered.includes("target"),
    delivered.slice(0, 140),
  );

  const inspect = await inPage<boolean>(
    window,
    `window.__deckHost.invoke("browser_set_inspect", { active: true }).then(() => true)`,
  );
  const active = await contents.executeJavaScript(`window.__deckGrab.isActive()`);
  record(
    "Inspect arms react-grab in the page",
    inspect === true && active === true,
    `isActive=${String(active)}`,
  );

  const phonedHome = requested.filter((url) => url.includes("react-grab.com"));
  record(
    "react-grab sends no telemetry",
    phonedHome.length === 0,
    phonedHome.length === 0
      ? `${requested.length} request(s), none to react-grab.com`
      : phonedHome.join(", "),
  );

  await inPage(window, `window.__deckHost.invoke("browser_close")`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  record(
    "closing the panel destroys the page",
    contents.isDestroyed(),
    contents.isDestroyed() ? "web contents gone" : "web contents still alive",
  );
  page.stop();
}

function finish(): void {
  const failed = results.filter((check) => !check.ok);
  console.log(
    `\nSMOKE RESULT: ${results.length - failed.length}/${results.length} passed`,
  );
  app.exit(failed.length === 0 ? 0 : 1);
}

void main();
