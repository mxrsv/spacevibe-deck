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

function normalizeKey(key: string): string {
  if (/^[a-z]$/.test(key)) {
    return key.toUpperCase();
  }
  if (key.length > 1) {
    return key[0].toUpperCase() + key.slice(1);
  }
  return key;
}

function tokenFor(binding: KeyBinding): string {
  return "code" in binding
    ? normalizeCode(binding.code)
    : normalizeKey(binding.key);
}

function acceleratorFor(
  actionId: string,
  keymap: readonly KeyBinding[],
): string | undefined {
  const binding = keymap.find((candidate) => candidate.action === actionId);
  if (binding === undefined) {
    return undefined;
  }
  const parts = ["CmdOrCtrl"];
  if (binding.shift) {
    parts.push("Shift");
  }
  if (binding.alt) {
    parts.push("Alt");
  }
  if (binding.ctrl) {
    parts.push("Ctrl");
  }
  parts.push(tokenFor(binding));
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
function itemsFor(
  submenu: MenuSubmenu,
  deps: MenuDeps,
): MenuItemConstructorOptions[] {
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
        deps.suspendAccelerators === true
          ? undefined
          : acceleratorFor(action.id, keymap),
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
 * Build and install the application menu.
 *
 * The move-pane submenu is rebuilt on every focus change, because it lists
 * peer windows most-recently-focused first — the contents change as the user
 * moves between windows.
 */
export function buildMenu(deps: MenuDeps): void {
  if (process.platform !== "darwin") {
    // Windows/Linux chrome carries its own menu; no native bar to install.
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
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
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
