/**
 * Main→renderer WIRE SHAPES.
 *
 * `scripts/electron-ipc-contract.test.ts` only checks renderer→main invokes, so
 * every event payload was unguarded — and that is where the expensive bugs
 * were: `menu:action` shipped an object where the renderer's guards compare
 * strings, `menu:move-pane-to-window` used `label` where the only boundary
 * check reads `targetLabel`, `window_boot_mode` used `mode`/`restore` where the
 * renderer reads `kind`/`normal`, and `desktop_environment` returned `home`
 * where `platform.ts` demands `homeDir`. Each one silently disabled a whole
 * feature with a green suite.
 *
 * These assert the shapes directly against the renderer's own validators, so a
 * future rename fails here instead of in the app.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANNELS, EVENTS, INVOKABLE_CHANNELS } from "./ipc/channels";
import { commandFields } from "./control/control-forward";
import { CONTROL_COMMAND_NAMES, parseControlCommand } from "../src/lib/control-command";
import { WindowRegistry } from "./window-lifecycle";
import { bootModeOrNormal, moveToWindowTarget } from "../src/terminal/transfer-client";
import { isUpdateMenuAction } from "../src/updater/update-menu-actions";
import { parseDesktopEnvironment } from "../src/lib/platform";
import { parseRegistrySnapshot } from "../src/lib/agent-registry";
import { EMPTY_SNAPSHOT, parseClaudeAgents } from "./agent-registry/claude-registry";

const MAIN = readFileSync("electron/main.ts", "utf8");
const PRELOAD = readFileSync("electron/preload.ts", "utf8");
const MENU = readFileSync("electron/menu.ts", "utf8");
// The `desktop_environment`, `shell_open_url` and `store_*` handlers moved out
// of `main.ts` into their own `electron/ipc/register-*.ts` modules — the
// checks below read the module that now owns each shape.
const SERVICES = readFileSync("electron/ipc/register-services.ts", "utf8");
const SHELL = readFileSync("electron/ipc/register-shell.ts", "utf8");
const STORE = readFileSync("electron/ipc/register-store.ts", "utf8");

describe("security lifecycle wiring", () => {
  it("installs the app image boundary before boot can create a window", () => {
    const boot = MAIN.slice(MAIN.indexOf("app.whenReady().then(async () =>"));
    expect(boot).toContain("session.defaultSession.webRequest");
    expect(boot).toContain("app.isPackaged ? undefined : DEV_SERVER_URL");
    expect(boot.indexOf("installAppImagePolicy(")).toBeLessThan(boot.indexOf("createWindow("));
  });
  it("binds transfer reservations to the authenticated source before opening or offering", () => {
    const open = MAIN.slice(
      MAIN.indexOf("ipcMain.handle(CHANNELS.openPaneWindow"),
      MAIN.indexOf("ipcMain.handle(CHANNELS.offerTransfer"),
    );
    expect(open).toContain("coordinator.reserveDestination(token, labelOf(event), label)");
    expect(open.indexOf("coordinator.reserveDestination")).toBeLessThan(
      open.indexOf("createWindow(label)"),
    );
    expect(MAIN).toContain("coordinator.reserveDestination(token, labelOf(event), targetLabel)");
  });

  it("builds update confirmation from all main-owned panes and dirty files", () => {
    const updater = MAIN.slice(MAIN.indexOf("const updater = registerUpdater("));
    expect(updater).toContain("censusOrDeny(coordinator.allPanes())");
    expect(updater).toContain("infos === null ? null : censusFor(0, infos, dirtyFiles.all())");
    const app = readFileSync("src/ui/app.tsx", "utf8");
    expect(app).toContain("confirmInstall: confirmUpdateInstall");
    expect(app).not.toContain("confirmClose(manager.allPaneIds(), defaultPtyClient, UPDATE_COPY");
  });
});

describe("window_boot_mode", () => {
  const registry = new WindowRegistry();

  it("produces a shape the renderer accepts", () => {
    registry.reserveAdoption("deck-1", "xfer-7");

    // `mode: "restore"` fell through to normal, so a detached window booted to
    // the Open Board and its pane stayed stranded until the transfer timed out.
    expect(bootModeOrNormal(registry.bootMode("deck-1"))).toEqual({
      kind: "adopt",
      token: "xfer-7",
    });
    expect(bootModeOrNormal(registry.bootMode("deck-1"))).toEqual({
      kind: "normal",
    });
  });
});

describe("menu:move-pane-to-window", () => {
  it("emits the key the renderer's only boundary check reads", () => {
    // `moveToWindowTarget` returns null for anything but `targetLabel`, and it
    // is the whole guard on where a running agent's pane ends up.
    const match = /menuMovePaneToWindow, \{\s*([a-zA-Z]+):/.exec(MENU);

    expect(match?.[1]).toBe("targetLabel");
    expect(moveToWindowTarget({ targetLabel: "deck-2" })).toBe("deck-2");
    expect(moveToWindowTarget({ label: "deck-2" })).toBe(null);
  });
});

describe("menu:action", () => {
  it("emits a bare string, not an object", () => {
    // The renderer declares `listen<string>` and both guards are string
    // comparisons; an object matched neither and every menu item did nothing.
    expect(MENU).toContain("EVENTS.menuAction, action.id");
    expect(isUpdateMenuAction("check-for-updates")).toBe(true);
    expect(isUpdateMenuAction({ id: "check-for-updates" })).toBe(false);
  });
});

describe("control:command", () => {
  const KEYS = [
    "agent",
    "command",
    "cwd",
    "expectedAgent",
    "force",
    "lines",
    "name",
    "paneId",
    "requestId",
    "submit",
    "text",
  ];

  it("is pushed as the request id and every key of the command, on the event the renderer hears", () => {
    // The renderer's listener reads this name and `parseControlCommand` is its whole guard: a
    // command main builds with a key missing or renamed was silently ignored, and the
    // `deck` call waited out its timeout.
    expect(EVENTS.controlCommand).toBe("control:command");
    expect(readFileSync("electron/control/control-forward.ts", "utf8")).toContain(
      "EVENTS.controlCommand, { requestId, ...fields }",
    );
    expect(readFileSync("src/host/control-host.ts", "utf8")).toContain('"control:command"');
  });

  it.each(CONTROL_COMMAND_NAMES)(
    "builds %s with all eleven keys, and the renderer accepts it",
    (name) => {
      const fields = commandFields(name, 7);
      expect(Object.keys({ requestId: "r-1", ...fields }).sort()).toEqual(KEYS);
      expect(parseControlCommand({ requestId: "r-1", ...fields })).toEqual({
        requestId: "r-1",
        ...fields,
      });
    },
  );

  it("is refused by the renderer when a key is missing or has the wrong type", () => {
    const whole = { requestId: "r-1", ...commandFields("send", 7, { text: "go", submit: true }) };
    expect(parseControlCommand(whole)).not.toBeNull();
    for (const key of KEYS) {
      // A dropped key reads as undefined, which no sender produces.
      const rest = Object.fromEntries(Object.entries(whole).filter(([name]) => name !== key));
      expect(parseControlCommand(rest), `without ${key}`).toBeNull();
    }
    expect(parseControlCommand({ ...whole, command: "run" })).toBeNull();
    expect(parseControlCommand({ ...whole, paneId: "7" })).toBeNull();
    expect(parseControlCommand({ ...whole, submit: "yes" })).toBeNull();
    expect(parseControlCommand("send")).toBeNull();
  });
});

describe("desktop_environment", () => {
  it("returns a shape the renderer validator accepts", () => {
    // Getting this wrong disabled EVERY keyboard shortcut: the validator threw,
    // the caller swallowed it, and the app fell back to platform "unsupported"
    // where `hasPrimaryModifier` is false for every event.
    expect(SERVICES).toContain('homeDir: app.getPath("home")');
    expect(SERVICES).toContain("isDevelopment: !app.isPackaged");
    expect(() =>
      parseDesktopEnvironment({ platform: "macos", homeDir: "/Users/dev" }),
    ).not.toThrow();
    // The shape that shipped: `home` instead of `homeDir`.
    expect(() => parseDesktopEnvironment({ platform: "macos", home: "/Users/dev" })).toThrow(
      "homeDir must be a string",
    );
  });
});

describe("detect_agents", () => {
  it("answers through the probe that refreshes the Windows PATH", () => {
    // `discoverAgents` walks the PATH as it stands; only `detectAgents`
    // re-reads the registry first, so an agent installed while Deck runs is found.
    expect(SERVICES).toContain(
      "ipcMain.handle(CHANNELS.detectAgents, (_event, { names }) => detectAgents(names ?? []))",
    );
  });

  it("puts .local\\bin on PATH before the first window can spawn a pane", () => {
    const boot = MAIN.slice(MAIN.indexOf("app.whenReady()"));
    // A statement on its own line, so a commented-out call does not count.
    const added = boot.search(/^\s*addLocalBinToPath\(\);/m);
    expect(added).toBeGreaterThan(-1);
    expect(added).toBeLessThan(boot.indexOf("createWindow("));
  });
});

describe("agent_registry", () => {
  it("answers a snapshot the renderer's validator accepts, field for field", () => {
    // The contract fixture for the stage-1 channel (spec §1, R6): main's
    // snapshot shape and the renderer's parser are two files, and a renamed
    // key would leave every Claude pane silently inferred.
    expect(SERVICES).toContain(
      "ipcMain.handle(CHANNELS.agentRegistry, () => claudeRegistry.read())",
    );
    const entries = parseClaudeAgents(
      JSON.stringify([
        {
          pid: 4242,
          cwd: "/w",
          kind: "interactive",
          startedAt: 1,
          sessionId: "a79dbead-d71b-445b-b328-86f9952b1d84",
          name: "deck",
          status: "waiting",
          waitingFor: "permission prompt",
        },
      ]),
    );
    const wire = JSON.parse(
      JSON.stringify({ available: true, stale: false, polledAt: 12, entries }),
    ) as unknown;
    expect(parseRegistrySnapshot(wire)).toEqual({
      available: true,
      stale: false,
      polledAt: 12,
      entries: [
        {
          pid: 4242,
          cwd: "/w",
          sessionId: "a79dbead-d71b-445b-b328-86f9952b1d84",
          status: "waiting",
          waitingFor: "permission prompt",
          name: "deck",
          kind: "interactive",
        },
      ],
    });
    // The empty snapshot main answers before its first poll is the renderer's
    // "unavailable" — nothing is cleared and nothing invented from it.
    const empty = parseRegistrySnapshot(JSON.parse(JSON.stringify(EMPTY_SNAPSHOT)) as unknown);
    expect(empty.available).toBe(false);
    expect(empty.stale).toBe(true);
    expect(empty.entries).toEqual([]);
  });
});

describe("navigation is blocked", () => {
  it("installs will-navigate and denies window.open", () => {
    // The preload re-injects the full host bridge into any document the window
    // navigates to, and a dropped .html file is a real way to get there.
    expect(MAIN).toContain('webContents.on("will-navigate"');
    expect(MAIN).toContain("setWindowOpenHandler");
  });
});

describe("shell_open_url", () => {
  it("keeps a scheme allowlist, as the Tauri capability did", () => {
    const allowlist = /OPENABLE_SCHEMES = new Set\(\[([^\]]*)\]\)/.exec(SHELL);

    expect(allowlist).not.toBe(null);
    // `file:` must NOT be openable — an OSC 8 hyperlink carrying
    // `file:///Applications/…` was one renderer bug from launching it.
    expect(allowlist?.[1]).not.toContain("file:");
    expect(allowlist?.[1]).toContain("https:");
  });
});

describe("store file names", () => {
  it("are allowlisted so `..` cannot escape the app directory", () => {
    expect(STORE).toContain("assertStoreFile");
    expect(STORE).toContain("STORE_FILES");
  });
});

describe("the preload bridge's channel allowlist", () => {
  // Read the whole `electron/` tree the way `scripts/electron-ipc-contract.test.ts`
  // does, so a handler added in a NEW register module is caught too.
  function electronSources(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "vendor" && entry.name !== "fixtures") {
          out.push(...electronSources(full));
        }
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
    return out;
  }

  const registered = new Set<string>();
  for (const file of electronSources("electron")) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/ipcMain\.(?:handle|on)\(\s*['"]([a-z_]+)['"]/g)) {
      registered.add(match[1]);
    }
    for (const match of text.matchAll(/ipcMain\.(?:handle|on)\(\s*CHANNELS\.([A-Za-z]+)/g)) {
      const name = (CHANNELS as Record<string, string>)[match[1]];
      if (name !== undefined) {
        registered.add(name);
      }
    }
  }

  it("covers every channel the main process registers", () => {
    // A handler the bridge does not know about is a feature that silently
    // stops working the moment it is called — the allowlist is only safe if
    // this stays exhaustive.
    const preloadOnly = new Set(["grant_dropped_workspace"]);
    const missing = [...registered].filter(
      (channel) => !INVOKABLE_CHANNELS.has(channel) && !preloadOnly.has(channel),
    );

    expect(missing).toEqual([]);
  });

  it("allows nothing the main process does not answer", () => {
    // The other direction: a name left in the table after its handler was
    // deleted keeps a door open onto nothing.
    const orphans = [...INVOKABLE_CHANNELS].filter((channel) => !registered.has(channel));

    expect(orphans).toEqual([]);
  });

  it("keeps dropped workspace grants behind the preload File API", () => {
    expect(MAIN).toContain('ipcMain.handle("grant_dropped_workspace"');
    expect(PRELOAD).toContain("webUtils.getPathForFile(file)");
    expect(PRELOAD).toContain('ipcRenderer.invoke("grant_dropped_workspace", path)');
    expect(INVOKABLE_CHANNELS.has("grant_dropped_workspace")).toBe(false);
  });

  it("refuses an unknown channel instead of forwarding it", () => {
    const preload = readFileSync("electron/preload.ts", "utf8");

    expect(preload).toContain("INVOKABLE_CHANNELS.has(channel)");
    expect(preload).toContain("refused an unknown host channel");
  });
});
