/**
 * Native menu, built from the action registry.
 *
 * R3 says menu code is generated from the registry and never hand-edited. On
 * Tauri that meant a codegen step producing `menu_registry.rs`, because Rust
 * could not import a TypeScript module. Electron's main process can, so the
 * menu is derived from `ACTION_REGISTRY` at RUNTIME instead — same single
 * source of truth, one fewer generated artifact to drift.
 *
 * Accelerator translation mirrors `scripts/generate-menu.ts` exactly: an
 * accelerator is declared by CHARACTER, never by physical position, which is
 * why an action carrying a menu item must use a character binding.
 */
import { Menu, app, type MenuItemConstructorOptions } from "electron";
import {
  ACTION_REGISTRY,
  MACOS_KEYMAP,
  type ActionDefinition,
  type KeyBinding,
  type MenuSubmenu,
} from "../src/terminal/action-registry";
import { EVENTS } from "./ipc/channels";
import type { WindowRegistry } from "./window-lifecycle";

/** `event.code` → the character an accelerator string expects. */
const CODE_TO_ACCEL: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
};

/**
 * `event.key` → Electron's accelerator token for keys that have a NAME rather
 * than a character.
 *
 * Without this, a rebind to an arrow or PageUp produced `Arrowup` / `Pageup`,
 * which Electron cannot parse — the accelerator was silently dropped and the
 * menu item lost its chord while the Shortcuts row went on displaying one.
 * Anything not in this table and not a single character or F-key is refused
 * outright by `acceleratorFor` rather than guessed at.
 */
const KEY_TO_ACCEL: Record<string, string> = {
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  pageup: "PageUp",
  pagedown: "PageDown",
  home: "Home",
  end: "End",
  insert: "Insert",
  delete: "Delete",
  backspace: "Backspace",
  enter: "Return",
  escape: "Esc",
  tab: "Tab",
  " ": "Space",
  "+": "Plus",
};

const FUNCTION_KEY = /^f([1-9]|1\d|2[0-4])$/;

function normalizeCode(code: string): string {
  if (CODE_TO_ACCEL[code] !== undefined) {
    return CODE_TO_ACCEL[code];
  }
  if (code.startsWith("Key")) {
    return code.slice(3);
  }
  if (code.startsWith("Digit")) {
    return code.slice(5);
  }
  return code;
}

/**
 * The accelerator token for a binding's key, or null when it cannot be
 * expressed — a chord Electron would reject, or a dead/compose key.
 *
 * Null means "install no accelerator", which leaves the menu item clickable
 * with no chord. That is the honest outcome: a wrong accelerator is worse than
 * a missing one, because Cocoa would then claim a chord the user never chose.
 */
function tokenFor(binding: KeyBinding): string | null {
  if ("code" in binding) {
    return normalizeCode(binding.code);
  }
  const key = binding.key.toLowerCase();
  if (KEY_TO_ACCEL[key] !== undefined) {
    return KEY_TO_ACCEL[key];
  }
  if (FUNCTION_KEY.test(key)) {
    return key.toUpperCase();
  }
  // A single character is what the user's layout produced; Electron takes it
  // verbatim. Anything longer is a named key this table does not know.
  return [...key].length === 1 ? key.toUpperCase() : null;
}

/**
 * The Cocoa accelerator for an action, built from the binding's OWN modifiers.
 *
 * `CmdOrCtrl` used to be hardcoded as the first part and `binding.meta` was
 * never read. That was safe only for as long as every macOS menu binding
 * shipped with `meta: true`; the moment a user could record a chord, it turned
 * ⇧D into `CmdOrCtrl+Shift+D` — ⌘⇧D, which is `split-column`'s shipped chord.
 * Edit precedes View in the template, so Cocoa ran Find and Split Horizontally
 * silently stopped working, with no conflict reported anywhere: the collision
 * existed only in the generated accelerator, never in the resolved keymap that
 * `chordConflicts` scans.
 *
 * `Command` rather than `CmdOrCtrl` because this menu is macOS-only
 * (`buildMenu` returns early elsewhere), so the ambiguous spelling bought
 * nothing and hid the meta-vs-ctrl distinction that now matters.
 */
function acceleratorFor(actionId: string, keymap: readonly KeyBinding[]): string | undefined {
  const binding = keymap.find((candidate) => candidate.action === actionId);
  if (binding === undefined) {
    return undefined;
  }
  const token = tokenFor(binding);
  if (token === null) {
    return undefined;
  }
  const parts: string[] = [];
  if (binding.meta) {
    parts.push("Command");
  }
  if (binding.ctrl) {
    parts.push("Control");
  }
  if (binding.alt) {
    parts.push("Alt");
  }
  if (binding.shift) {
    parts.push("Shift");
  }
  if (parts.length === 0) {
    // An unmodified accelerator would claim a bare key across the whole app
    // from the menu, which no keymap rule allows. `isAdmissibleChord` already
    // refuses these at capture; this is the backstop for the shipped bare-F3
    // Windows binding never reaching a macOS menu.
    return undefined;
  }
  parts.push(token);
  return parts.join("+");
}

export interface MenuDeps {
  readonly registry: WindowRegistry;
  readonly emitTo: (label: string, event: string, payload: unknown) => void;
  /** Label of the window an action should go to. */
  readonly focused: () => string | null;
  /**
   * The macOS keymap in force — shipped defaults with the user's rebinds
   * applied, resolved through `resolveKeymap` from the same settings the
   * renderer reads. Omitted means "no overrides stored yet".
   *
   * The accelerator and the webview binding MUST come from one keymap. Cocoa
   * consumes an accelerator before the webview sees the keydown, so a menu
   * still advertising the shipped chord after a rebind does not merely look
   * stale — it fires the old action and the new binding never runs.
   */
  readonly keymap?: readonly KeyBinding[];
  /**
   * Strip every accelerator while a Shortcuts row is recording a chord.
   *
   * Same Cocoa fact from the other side: while capturing, ⌘W must reach the
   * webview to BE the new chord. Leaving the accelerators installed means the
   * OS runs Close Pane instead, and every menu-bound action — most of the
   * interesting ones — becomes impossible to rebind. The items stay in place
   * so the menu bar does not visibly empty out; only their chords go.
   */
  readonly suspendAccelerators?: boolean;
}

/** Items for one submenu, with a separator wherever the group changes. */
function itemsFor(submenu: MenuSubmenu, deps: MenuDeps): MenuItemConstructorOptions[] {
  // `ACTION_REGISTRY` is a const tuple, so only the members that declare a
  // menu carry the field in their literal type. Read it through the shared
  // interface rather than narrowing each member.
  const actions = (ACTION_REGISTRY as readonly ActionDefinition[]).filter(
    (action) => action.menu?.submenu === submenu,
  );
  const keymap = deps.keymap ?? MACOS_KEYMAP;
  const items: MenuItemConstructorOptions[] = [];
  let lastGroup: string | undefined;
  for (const [index, action] of actions.entries()) {
    if (index > 0 && action.menu?.group !== lastGroup) {
      items.push({ type: "separator" });
    }
    lastGroup = action.menu?.group;
    items.push({
      id: action.id,
      label: action.label,
      accelerator:
        deps.suspendAccelerators === true ? undefined : acceleratorFor(action.id, keymap),
      click: () => {
        const target = deps.focused();
        if (target !== null) {
          // The BARE action id, not an object: the renderer does
          // `listen<string>("menu:action", …)` and both guards
          // (`isUpdateMenuAction`, `isShortcutAction`) are string comparisons,
          // so an object silently matches nothing. Rust emitted the string
          // (menu.rs:116).
          deps.emitTo(target, EVENTS.menuAction, action.id);
        }
      },
    });
  }
  return items;
}

/**
 * One Edit item that dispatches a registry action instead of a Cocoa role.
 *
 * The accelerator is written out rather than read from the keymap on purpose:
 * these three actions carry no `KeyBinding` at all. Giving them one would put
 * ⌘A / ⌘Z / ⌘⇧Z into the Shortcuts screen as rebindable rows and into
 * `handleShortcut`'s matcher, and neither buys anything — the chord users
 * expect here is fixed by the platform, and it is the MENU that owns it.
 *
 * `suspendAccelerators` is honoured for the same reason every other item
 * honours it: while a Shortcuts row is recording, ⌘A must reach the webview to
 * BE the captured chord.
 */
function editCommandItem(
  label: string,
  accelerator: string,
  action: string,
  deps: MenuDeps,
): MenuItemConstructorOptions {
  return {
    id: action,
    label,
    accelerator: deps.suspendAccelerators === true ? undefined : accelerator,
    click: () => {
      const target = deps.focused();
      if (target !== null) {
        deps.emitTo(target, EVENTS.menuAction, action);
      }
    },
  };
}

/**
 * Build and install the application menu.
 *
 * The move-pane submenu is rebuilt on every focus change, because it lists
 * peer windows most-recently-focused first — the contents change as the user
 * moves between windows.
 */
export function buildMenu(deps: MenuDeps): void {
  if (process.platform !== "darwin") {
    // Windows/Linux chrome carries its own menu, but "install nothing" is not
    // the same as "no menu". Electron installs a DEFAULT menu when the app
    // never calls `setApplicationMenu` itself, and `titleBarStyle:
    // "hiddenInset"` makes the window frameless on Windows — so the menu BAR
    // is skipped while its accelerators are already registered with the focus
    // manager. The shipped Windows preview therefore answers Ctrl+R with a
    // renderer reload and Ctrl+W by closing the window, neither of which Deck
    // asked for and neither of which `WINDOWS_KEYMAP` contests.
    //
    // Passing null is what actually removes them.
    Menu.setApplicationMenu(null);
    return;
  }
  const focused = deps.focused();
  const peers = deps.registry.order(focused ?? undefined);

  const movePaneSubmenu: MenuItemConstructorOptions[] =
    peers.length === 0
      ? [{ label: "No other window", enabled: false }]
      : peers.map((label) => ({
          label,
          click: () => {
            // `targetLabel`, not `label`: `moveToWindowTarget`
            // (transfer-client.ts) reads that key and returns null for anything
            // else — and it is the whole boundary check on where a running
            // agent's pane ends up. Also resolve the source window at CLICK
            // time, not build time: a menu built while window A was focused
            // would otherwise keep moving A's pane after the user switched to B.
            const source = deps.focused();
            if (source !== null && source !== label) {
              deps.emitTo(source, EVENTS.menuMovePaneToWindow, {
                targetLabel: label,
              });
            }
          },
        }));

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.getName(),
      submenu: [
        ...itemsFor("App", deps),
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { type: "separator" },
        // `role: "quit"` so the OS delivers it through `before-quit`, which is
        // where the busy census runs.
        { role: "quit" },
      ],
    },
    { label: "File", submenu: itemsFor("File", deps) },
    {
      label: "Edit",
      submenu: [
        // Undo/Redo/Select All are NOT `role:` items. A role runs a
        // document-level Chromium command, and Monaco is opaque to those:
        // with `editContext` on (its default since 0.52) the caret lives in a
        // `div.native-edit-context` that owns no DOM selection, so
        // `webContents.selectAll()` selects nothing and `webContents.undo()`
        // never reaches the editor's own undo stack. Routed to the renderer
        // instead, which hands the chord to the focused surface and otherwise
        // falls back to the same command the role ran (`runEditCommand`,
        // tab-manager.ts).
        editCommandItem("Undo", "Command+Z", "undo", deps),
        editCommandItem("Redo", "Command+Shift+Z", "redo", deps),
        { type: "separator" },
        // Cut/Copy/Paste STAY native: Chromium dispatches a real DOM
        // `cut`/`copy`/`paste` event for each, and Monaco's
        // `NativeEditContext` listens for all three — so these three roles
        // already reach the editor, the terminal and every chrome input.
        // Routing them through the renderer would only add a way to break
        // them.
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        editCommandItem("Select All", "Command+A", "select-all", deps),
        ...itemsFor("Edit", deps),
      ],
    },
    { label: "View", submenu: itemsFor("View", deps) },
    {
      label: "Window",
      submenu: [
        ...itemsFor("Window", deps),
        { type: "separator" },
        { label: "Move Pane to Window", submenu: movePaneSubmenu },
        { type: "separator" },
        { role: "minimize" },
        { role: "zoom" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
