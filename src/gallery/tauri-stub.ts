import { signal } from "@preact/signals";

/**
 * Canned Tauri IPC so real app components mount in a plain browser.
 *
 * Every `invoke` in this repo goes through one hook — `window.__TAURI_INTERNALS__`
 * (see `@tauri-apps/api/core`) — and outside a Tauri webview that object does
 * not exist, so the first call throws before any chrome paints. Installing a
 * stub is therefore the whole reason the gallery can render the real settings
 * screen, the real popovers and the real bars instead of a second hand-drawn
 * copy of them.
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
 * One in-memory persisted store per path, standing in for `plugin-store`.
 * Writes are kept so a value the user changes in the gallery survives a
 * re-render, and dropped on reload — a gallery has no business writing to the
 * real `settings.json` under the user's app-data directory.
 */
const stores = new Map<number, Map<string, unknown>>();
let nextStoreRid = 1;

function readString(args: InvokeArgs, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

const CANNED: Readonly<Record<string, CannedHandler>> = {
  // ── platform + window ────────────────────────────────────────────────
  desktop_environment: () => ({ platform: "macos", homeDir: "/Users/deck" }),
  window_boot_mode: () => ({ kind: "normal" }),
  // A retina factor, because that is what the machines this is designed on use.
  "plugin:window|scale_factor": () => 2,

  // ── plugin-store: an in-memory Map per loaded path ───────────────────
  "plugin:store|load": () => {
    const rid = nextStoreRid;
    nextStoreRid += 1;
    stores.set(rid, new Map());
    return rid;
  },
  "plugin:store|get": (args) => {
    const store = stores.get(Number(args.rid));
    const key = readString(args, "key");
    if (store === undefined || !store.has(key)) {
      return [null, false];
    }
    return [store.get(key), true];
  },
  "plugin:store|set": (args) => {
    stores.get(Number(args.rid))?.set(readString(args, "key"), args.value);
    return null;
  },
  "plugin:store|has": (args) =>
    stores.get(Number(args.rid))?.has(readString(args, "key")) ?? false,
  "plugin:store|delete": (args) =>
    stores.get(Number(args.rid))?.delete(readString(args, "key")) ?? false,
  "plugin:store|keys": (args) => [
    ...(stores.get(Number(args.rid))?.keys() ?? []),
  ],
  "plugin:store|entries": (args) => [
    ...(stores.get(Number(args.rid))?.entries() ?? []),
  ],
  "plugin:store|save": () => null,
  "plugin:store|reload": () => null,

  // ── events: nothing emits in the gallery, so a listener id is enough ─
  "plugin:event|listen": () => 0,
  "plugin:event|unlisten": () => null,
  "plugin:event|emit": () => null,
  "plugin:event|emit_to": () => null,

  // ── dialogs: the gallery must never open a real OS dialog ────────────
  "plugin:dialog|open": () => null,
  "plugin:dialog|save": () => null,
  "plugin:dialog|message": () => null,
  "plugin:dialog|ask": () => true,

  // ── data reads chrome makes while painting ───────────────────────────
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

interface CallbackHost {
  [key: string]: unknown;
}

/**
 * Installed as a side effect of importing this module, and `main.tsx` imports
 * it FIRST. That ordering is the whole reason it is a side effect rather than a
 * function the entry calls: ES imports are hoisted, so a call written at the
 * top of `main.tsx` would still run after every module below it had already
 * evaluated. Importing first is the only way to guarantee the hook exists
 * before anything can reach for it.
 */
function installTauriStub(): void {
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

installTauriStub();
