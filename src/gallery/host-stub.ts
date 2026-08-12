import { signal } from "@preact/signals";

/**
 * Canned host IPC so real app components mount in a plain browser.
 *
 * The renderer never calls a host directly; it goes through one hook, and
 * outside a desktop shell that hook does not exist, so the first call throws
 * before any chrome paints. Installing a stub is therefore the whole reason
 * the gallery can render the real settings screen, the real popovers and the
 * real bars instead of a second hand-drawn copy of them.
 *
 * **Both hooks are installed, on purpose.** The Tauri build reaches for
 * `window.__TAURI_INTERNALS__`; the Electron host reaches for
 * `globalThis.__deckHost` (see `src/host/bridge.ts` on `electron-migration`,
 * which throws "Deck host bridge is unavailable" when it is absent). The
 * gallery is meant to carry over to Electron unchanged and the Tauri branch
 * still takes hotfixes, so a stub that installed only one of them would be
 * dead on the other branch the moment either merged — and dead in a
 * particularly bad way, because `unhandledCommands` only sees calls that
 * reach it. Zero calls arriving would read on screen as "everything was
 * answered".
 *
 * Unknown commands resolve to `null` instead of rejecting: a component missing
 * data should still paint its rows, hairlines and spacing, which is what the
 * gallery exists to show. But failing *silently* would let it display a state
 * the app can never reach, so every unanswered command is collected in
 * `unhandledCommands` and printed at the shell's foot — on screen, not only in
 * the console.
 */

type InvokeArgs = Readonly<Record<string, unknown>>;
type CannedHandler = (args: InvokeArgs) => unknown;

/** Commands the gallery could not answer, in first-seen order. */
export const unhandledCommands = signal<readonly string[]>([]);

/** Label the stubbed `getCurrentWindow()` reports. */
const WINDOW_LABEL = "main";

/**
 * One in-memory persisted store per key, standing in for whichever store the
 * host provides. Writes are kept so a value the user changes in the gallery
 * survives a re-render, and dropped on reload — a gallery has no business
 * writing to the real `settings.json` under the user's app-data directory.
 *
 * The key is a resource id under Tauri and a file name under Electron; the
 * two hosts are never live at the same time, so one map serves both.
 */
const stores = new Map<string, Map<string, unknown>>();
let nextStoreRid = 1;

function readString(args: InvokeArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

function storeFor(key: string): Map<string, unknown> {
  const existing = stores.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<string, unknown>();
  stores.set(key, created);
  return created;
}

/**
 * Commands both hosts answer under the same name — `bridge.ts` kept the Tauri
 * channel names precisely so the renderer's call sites did not have to change.
 */
const SHARED: Readonly<Record<string, CannedHandler>> = {
  desktop_environment: () => ({ platform: "macos", homeDir: "/Users/deck" }),
  window_boot_mode: () => ({ kind: "normal" }),

  // Two of the five built-ins "missing" is deliberate: the agents section
  // renders a found agent and a not-found one side by side only if the
  // catalog answers unevenly.
  detect_agents: () => ["claude", "codex", "agy"],
  git_branch: () => "main",
  dirs_exist: (args) => {
    const paths = Array.isArray(args.paths) ? args.paths : [];
    return paths.map(() => true);
  },
  resolve_paths: (args) => (Array.isArray(args.paths) ? args.paths : []),
  list_prompt_assets: () => ({
    skills: [
      {
        kind: "skill",
        name: "superpowers:brainstorming",
        description: "Turn an idea into a design before writing code.",
        source: "plugin",
      },
      {
        kind: "skill",
        name: "log-wiki",
        description: "",
        source: "global",
      },
    ],
    subagents: [
      {
        kind: "subagent",
        name: "code-reviewer",
        description: "Findings-first review of a change.",
        source: "project",
      },
    ],
  }),
  scan_workspace_favicon: () => null,
  read_image_as_data_url: () => null,
  pty_info: () => null,
};

/** Tauri's plugin channels, which the Electron host replaced wholesale. */
const TAURI_ONLY: Readonly<Record<string, CannedHandler>> = {
  // A retina factor, because that is what the machines this is designed on use.
  "plugin:window|scale_factor": () => 2,

  // plugin-store addresses a loaded file by resource id.
  "plugin:store|load": () => {
    const rid = nextStoreRid;
    nextStoreRid += 1;
    storeFor(`rid:${rid}`);
    return rid;
  },
  "plugin:store|get": (args) => {
    const store = stores.get(`rid:${String(args.rid)}`);
    const key = readString(args, "key");
    if (store === undefined || !store.has(key)) {
      return [null, false];
    }
    return [store.get(key), true];
  },
  "plugin:store|set": (args) => {
    stores
      .get(`rid:${String(args.rid)}`)
      ?.set(readString(args, "key"), args.value);
    return null;
  },
  "plugin:store|has": (args) =>
    stores.get(`rid:${String(args.rid)}`)?.has(readString(args, "key")) ??
    false,
  "plugin:store|delete": (args) =>
    stores.get(`rid:${String(args.rid)}`)?.delete(readString(args, "key")) ??
    false,
  "plugin:store|keys": (args) => [
    ...(stores.get(`rid:${String(args.rid)}`)?.keys() ?? []),
  ],
  "plugin:store|entries": (args) => [
    ...(stores.get(`rid:${String(args.rid)}`)?.entries() ?? []),
  ],
  "plugin:store|save": () => null,
  "plugin:store|reload": () => null,

  "plugin:event|listen": () => 0,
  "plugin:event|unlisten": () => null,
  "plugin:event|emit": () => null,
  "plugin:event|emit_to": () => null,

  // The gallery must never open a real OS dialog.
  "plugin:dialog|open": () => null,
  "plugin:dialog|save": () => null,
  "plugin:dialog|message": () => null,
  "plugin:dialog|ask": () => true,
};

/**
 * The Electron host's own channels.
 *
 * Deliberately absent: scale factor, focus and drag-drop. `window-host.ts`
 * answers those from `devicePixelRatio`, `document.hasFocus()` and the DOM's
 * own drag events without an IPC hop, so there is nothing here to stub — and
 * adding a channel for them would invent a contract the host does not have.
 */
const ELECTRON_ONLY: Readonly<Record<string, CannedHandler>> = {
  // The store addresses a file by name rather than by resource id.
  store_load: (args) => {
    const store = storeFor(readString(args, "file"));
    const defaults = args.defaults;
    if (typeof defaults === "object" && defaults !== null) {
      for (const [key, value] of Object.entries(defaults)) {
        if (!store.has(key)) {
          store.set(key, value);
        }
      }
    }
    return null;
  },
  // `undefined`, not `[value, found]`: `Store.get` hands its result straight
  // back to the caller, so a tuple would be read as the value itself.
  store_get: (args) =>
    stores.get(readString(args, "file"))?.get(readString(args, "key")),
  store_set: (args) => {
    storeFor(readString(args, "file")).set(readString(args, "key"), args.value);
    return null;
  },
  store_delete: (args) => {
    stores.get(readString(args, "file"))?.delete(readString(args, "key"));
    return null;
  },
  store_save: () => null,

  window_close: () => null,
  window_toggle_maximize: () => null,

  dialog_open: () => null,
  dialog_message: () => null,
  dialog_ask: () => true,

  app_version: () => "0.0.0-gallery",
  app_relaunch: () => null,
  clipboard_read_text: () => "",
  clipboard_write_text: () => null,
  // Denied, so a specimen can never raise a real OS notification.
  notification_permission_granted: () => false,
  notification_request_permission: () => "denied",
  notification_send: () => null,
  shell_open_url: () => null,
  suspend_menu_accelerators: () => null,
};

const CANNED: Readonly<Record<string, CannedHandler>> = {
  ...SHARED,
  ...TAURI_ONLY,
  ...ELECTRON_ONLY,
};

function invokeStub(command: string, args: InvokeArgs): Promise<unknown> {
  const handler = CANNED[command];
  if (handler !== undefined) {
    return Promise.resolve(handler(args));
  }
  if (!unhandledCommands.value.includes(command)) {
    unhandledCommands.value = [...unhandledCommands.value, command];
  }
  return Promise.resolve(null);
}

function asArgs(payload: unknown): InvokeArgs {
  return typeof payload === "object" && payload !== null
    ? (payload as InvokeArgs)
    : {};
}

interface CallbackHost {
  [key: string]: unknown;
}

/** Tauri's hook: `@tauri-apps/api/core` reads `window.__TAURI_INTERNALS__`. */
function installTauriHook(): void {
  let nextCallbackId = 1;
  const host = window as unknown as CallbackHost;

  const internals = {
    invoke: (command: string, args?: InvokeArgs): Promise<unknown> =>
      invokeStub(command, args ?? {}),
    transformCallback: (
      callback?: (payload: unknown) => void,
      once = false,
    ): number => {
      const id = nextCallbackId;
      nextCallbackId += 1;
      const key = `_${id}`;
      host[key] = (payload: unknown): void => {
        if (once) {
          delete host[key];
        }
        callback?.(payload);
      };
      return id;
    },
    unregisterCallback: (id: number): void => {
      delete host[`_${id}`];
    },
    convertFileSrc: (path: string): string => path,
    metadata: { currentWindow: { label: WINDOW_LABEL } },
  };

  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: internals,
    configurable: true,
  });
}

/**
 * The Electron host's hook: `preload.ts` puts exactly two functions on
 * `globalThis.__deckHost`, plus `getPathForFile` for dropped files.
 *
 * `listen` returns an unsubscribe that does nothing because nothing in the
 * gallery emits: every specimen is driven by seeded signals, not by a main
 * process. A handler that never fires is the honest answer here — inventing
 * events would make the gallery show states the app cannot reach.
 */
function installDeckHostHook(): void {
  const bridge = {
    invoke: (channel: string, payload?: unknown): Promise<unknown> =>
      invokeStub(channel, asArgs(payload)),
    listen: (): (() => void) => () => {},
    getPathForFile: (file: File): string => file.name,
  };

  Object.defineProperty(globalThis, "__deckHost", {
    value: bridge,
    configurable: true,
  });
}

/**
 * Installed as a side effect of importing this module, and `main.tsx` imports
 * it FIRST. That ordering is the whole reason it is a side effect rather than a
 * function the entry calls: ES imports are hoisted, so a call written at the
 * top of `main.tsx` would still run after every module below it had already
 * evaluated. Importing first is the only way to guarantee the hooks exist
 * before anything can reach for them.
 */
installTauriHook();
installDeckHostHook();
