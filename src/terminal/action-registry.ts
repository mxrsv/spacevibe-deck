/**
 * Single source of truth for every keyboard shortcut / macOS menu action.
 * Pure data — no Preact, no Tauri, no DOM. `keymap.ts` derives event matching
 * from `DEFAULT_KEYMAP`/`ActionId`; `tab-manager.ts`'s `overlayBlocksAction`
 * reads `scope`. See docs/plans/2026-07-27-action-registry.md.
 */

export type ActionScope = "terminal" | "always";

export type MenuSubmenu = "App" | "File" | "Edit" | "View" | "Window";

export interface ActionDefinition {
  /** Stable string — also the id sent over Tauri IPC (`menu:action` payload). */
  readonly id: string;
  /** Display name — today's macOS menu label; reserved for a future cheat sheet/command palette. */
  readonly label: string;
  /**
   * "terminal": blocked by `overlayBlocksAction` while the Open board/
   * Settings/PresetEditor/SavePresetDialog is covering the terminal grid
   * (the default, most actions).
   * "always": skips the overlay guard — only for an action with its own
   * overlay preflight (`focus-next-attention`), an action harmless even if
   * the overlay is already open (`new-tab`), or an action that opens/closes
   * the very overlay that would otherwise block it (`toggle-settings`).
   * Tab-jump actions (`select-tab-N`, `select-last-tab`) are exempted through
   * a SEPARATE mechanism (`isTabSelectionAction` in `tab-manager.ts`) — not
   * modeled here, so this field only ever reflects a genuine product
   * decision, never the tab-family mechanism.
   */
  readonly scope: ActionScope;
  /**
   * Menu position. `group` only matters for a submenu generated entirely
   * from the registry (File, View — see scripts/generate-menu.ts, a later
   * task): items sharing a group render adjacent; a group change from the
   * previous item in the same submenu inserts a separator. App/Edit/Window
   * mix in native Cocoa builtins, so they stay hand-written in `menu.rs` —
   * `group` is ignored there.
   */
  readonly menu?: {
    readonly submenu: MenuSubmenu;
    readonly group?: string;
  };
}

// Declaration order = menu item order for a submenu generated entirely from
// the registry (File, View). App/Edit/Window mix in Cocoa builtins so they
// stay hand-written in menu.rs; `group` is ignored there.
//
// NOTE for future readers of docs/plans/2026-07-27-action-registry.md: Task
// 1's own example list there has 25 rows and is missing `find-next` /
// `find-previous` — those two landed in `3e68378` (Cmd+G / Cmd+Shift+G),
// after the plan's §1 preamble claims to account for that commit but before
// its Task 1 body was actually updated for it. Verified against the real
// `src-tauri/src/menu.rs` (Edit submenu: find, find-next, find-previous,
// clear-buffer, no separators between them) and `src/terminal/keymap.ts`'s
// current `DEFAULT_KEYMAP` — this lift includes both, for 27 rows total.
export const ACTION_REGISTRY = [
  {
    id: "toggle-settings",
    label: "Settings…",
    // Bypasses the overlay guard: gating it would strand Settings open with
    // no way to close it again, since settingsOpen=true blocks every other
    // action, toggle-settings included.
    scope: "always",
    menu: { submenu: "App" },
  },
  {
    id: "new-tab",
    label: "New Tab",
    // Only sets boardOpen.value = true — harmless if the board is already
    // open, nothing to gate.
    scope: "always",
    menu: { submenu: "File", group: "primary" },
  },
  {
    id: "reopen-tab",
    label: "Reopen Closed Tab",
    scope: "terminal",
    menu: { submenu: "File", group: "primary" },
  },
  {
    id: "close-pane",
    label: "Close Pane",
    scope: "terminal",
    menu: { submenu: "File", group: "close" },
  },
  {
    id: "close-tab",
    label: "Close Tab",
    scope: "terminal",
    menu: { submenu: "File", group: "close" },
  },
  { id: "find", label: "Find…", scope: "terminal", menu: { submenu: "Edit" } },
  {
    id: "find-next",
    label: "Find Next",
    scope: "terminal",
    menu: { submenu: "Edit" },
  },
  {
    id: "find-previous",
    label: "Find Previous",
    scope: "terminal",
    menu: { submenu: "Edit" },
  },
  {
    id: "clear-buffer",
    label: "Clear Buffer",
    scope: "terminal",
    menu: { submenu: "Edit" },
  },
  {
    id: "split-row",
    label: "Split Vertically",
    scope: "terminal",
    menu: { submenu: "View", group: "split" },
  },
  {
    id: "split-column",
    label: "Split Horizontally",
    scope: "terminal",
    menu: { submenu: "View", group: "split" },
  },
  {
    id: "toggle-zoom-pane",
    label: "Zoom Pane",
    scope: "terminal",
    menu: { submenu: "View", group: "zoom-pane" },
  },
  {
    id: "toggle-expand",
    label: "Focus Expand",
    scope: "terminal",
    menu: { submenu: "View", group: "zoom-pane" },
  },
  {
    id: "zoom-in",
    label: "Increase Font Size",
    scope: "terminal",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "zoom-out",
    label: "Decrease Font Size",
    scope: "terminal",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "zoom-reset",
    label: "Actual Size",
    scope: "terminal",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "focus-next-attention",
    label: "Next Agent Needing Attention",
    // Has its own overlay preflight (runAttentionFocus /
    // attention-focus-coordinator.ts) — dismisses board/settings then
    // focuses, self-blocks while PresetEditor/SavePresetDialog holds a
    // draft. Gating it here too would double-guard it.
    scope: "always",
    menu: { submenu: "View", group: "attention" },
  },
  {
    id: "new-preset",
    label: "New Layout Preset…",
    scope: "terminal",
    menu: { submenu: "Window" },
  },
  {
    id: "save-preset",
    label: "Save Layout as Preset…",
    scope: "terminal",
    menu: { submenu: "Window" },
  },
  { id: "focus-next", label: "Focus Next Pane", scope: "terminal" },
  { id: "focus-prev", label: "Focus Previous Pane", scope: "terminal" },
  { id: "focus-left", label: "Focus Pane Left", scope: "terminal" },
  { id: "focus-right", label: "Focus Pane Right", scope: "terminal" },
  { id: "focus-up", label: "Focus Pane Up", scope: "terminal" },
  { id: "focus-down", label: "Focus Pane Down", scope: "terminal" },
  { id: "next-tab", label: "Next Tab", scope: "terminal" },
  { id: "prev-tab", label: "Previous Tab", scope: "terminal" },
  {
    id: "select-last-tab",
    label: "Select Last Tab",
    // Exempt from the overlay guard through isTabSelectionAction
    // (tab-manager.ts) — the same mechanism as select-tab-N, NOT through
    // scope "always".
    scope: "terminal",
  },
] as const satisfies readonly ActionDefinition[];

/**
 * `select-tab-1`..`select-tab-8` are NOT rows in ACTION_REGISTRY — a
 * parameterized action family (no menu item, no fixed label), generated by a
 * loop as before. `select-last-tab` (⌘9) IS a normal row above — a single
 * action with a fixed label, distinct in kind from the parameterized family.
 */
export type ActionId =
  | (typeof ACTION_REGISTRY)[number]["id"]
  | `select-tab-${number}`;

const ACTION_IDS: ReadonlySet<string> = new Set(
  ACTION_REGISTRY.map((a) => a.id),
);

/**
 * Whether `value` names a real action — having a binding or not is
 * irrelevant (fixes the old limitation: a menu-only action, with no
 * `DEFAULT_KEYMAP` entry, is still a valid id).
 */
export function isActionId(
  value: unknown,
  registry: ReadonlySet<string> = ACTION_IDS,
): value is ActionId {
  if (typeof value !== "string") {
    return false;
  }
  if (registry.has(value)) {
    return true;
  }
  const match = /^select-tab-([1-8])$/.exec(value);
  return match !== null;
}

interface KeyBindingBase {
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: ActionId;
}

/**
 * RULE for any new binding, read before choosing a branch:
 *
 * Bind on WHATEVER THE MENU ACCELERATOR BINDS ON, if the action has a macOS
 * menu item (a `menu` field here and a real accelerator in
 * menu.rs/menu_registry.rs). A Tauri/Cocoa menu accelerator is declared by
 * character (e.g. "CmdOrCtrl+D"), never by physical position — so an action
 * with both a menu item and a webview binding MUST use `CharKeyBinding`.
 * Using `PhysicalKeyBinding` here instead means the two paths point at TWO
 * DIFFERENT PHYSICAL KEYS for the same action on a non-QWERTY layout (Dvorak
 * being the clearest case), breaking the invariant "menu item and shortcut
 * never drift apart" (src-tauri/src/menu.rs, top-of-file comment).
 *
 * `PhysicalKeyBinding` is only for an action with NO menu item — where the
 * webview is the only path and the produced character depends on Shift +
 * layout (e.g. the bracket keys: focus-next/prev, next-tab/prev-tab).
 */
/** Matches the character the active layout produces (`event.key`, lowercased). */
export interface CharKeyBinding extends KeyBindingBase {
  readonly key: string;
}

/** Matches physical key position (`event.code`) — independent of layout/IME. */
export interface PhysicalKeyBinding extends KeyBindingBase {
  readonly code: string;
}

export type KeyBinding = CharKeyBinding | PhysicalKeyBinding;

const TAB_SELECT_BINDINGS: readonly KeyBinding[] = Array.from(
  { length: 8 },
  (_, index): KeyBinding => ({
    key: String(index + 1),
    meta: true,
    action: `select-tab-${index + 1}`,
  }),
);

/**
 * ⌘9: macOS convention (Safari, Chrome, iTerm2, Terminal.app) — always jumps
 * to the LAST tab, whatever the tab count, never "tab index 9". Deliberately
 * separate from `TAB_SELECT_BINDINGS` above, which only ever covers a FIXED
 * index (⌘1–⌘8); the concrete index for this action is resolved against the
 * live tab count in tab-manager.ts, not here.
 */
const SELECT_LAST_TAB_BINDING: KeyBinding = {
  key: "9",
  meta: true,
  action: "select-last-tab",
};

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "d", meta: true, shift: true, action: "split-column" },
  // iTerm2 convention: Cmd+W closes the pane, Cmd+Shift+W the whole tab
  { key: "w", meta: true, action: "close-pane" },
  { key: "w", meta: true, shift: true, action: "close-tab" },
  // Physical key position (event.code), not the character it produces on a
  // US layout — the bracket keys sit under entirely different characters on
  // AZERTY/QWERTZ/Vietnamese layouts (and under an IME rewriting event.key),
  // so binding by event.key silently dropped this shortcut off a US layout.
  // No menu item for either action, so the webview binding is the only path
  // — the RULE above requires CharKeyBinding only when a menu accelerator
  // must stay in sync, which does not apply here.
  { code: "BracketRight", meta: true, action: "focus-next" },
  { code: "BracketLeft", meta: true, action: "focus-prev" },
  { key: "e", meta: true, action: "toggle-expand" },
  { key: "t", meta: true, action: "new-tab" },
  // Same physical-key reasoning as focus-next/prev above: Shift+BracketRight
  // only produces "}" (and Shift+BracketLeft only "{") on a US layout.
  { code: "BracketRight", meta: true, shift: true, action: "next-tab" },
  { code: "BracketLeft", meta: true, shift: true, action: "prev-tab" },
  // Font zoom, matching the standard macOS terminal shortcuts. Cmd+= counts
  // as zoom-in so users don't have to hold Shift for the "+" key. Kept as
  // event.key (not event.code) deliberately: on macOS these three chords are
  // already claimed by the native App menu's accelerators (src-tauri/src/
  // menu.rs) before the webview ever sees the keydown, so this binding is
  // only a fallback path — fixing its layout-robustness here would not fix
  // the real production bug (that needs a menu.rs accelerator change) and
  // isn't worth the complexity for a path this cold.
  { key: "=", meta: true, action: "zoom-in" },
  { key: "+", meta: true, shift: true, action: "zoom-in" },
  { key: "-", meta: true, action: "zoom-out" },
  { key: "0", meta: true, action: "zoom-reset" },
  // Maximize the active pane over the whole tab (tmux zoom), toggle to restore
  { key: "enter", meta: true, shift: true, action: "toggle-zoom-pane" },
  { key: "f", meta: true, action: "find" },
  // Standard macOS find-next/find-previous chord (Safari, Xcode, TextEdit…).
  // Works whether the search bar is open or already closed — see
  // `advanceSearch` in search-bar.ts for the closed-bar behavior.
  { key: "g", meta: true, action: "find-next" },
  { key: "g", meta: true, shift: true, action: "find-previous" },
  { key: "k", meta: true, action: "clear-buffer" },
  { key: "t", meta: true, shift: true, action: "reopen-tab" },
  // Sketch a new layout preset from scratch (Task 4, unified with the menu's
  // "New Layout Preset…" accelerator, already Cmd+Shift+N since 09f5c4d).
  { key: "n", meta: true, shift: true, action: "new-preset" },
  // Capture the live layout as a preset (UX §3) — also in the Window menu
  { key: "s", meta: true, shift: true, action: "save-preset" },
  // Jump to the highest-severity actionable Attention Rail candidate; routed
  // through an app-level seam so it can share the overlay preflight with a
  // status-dot click instead of focusing directly.
  { key: "a", meta: true, shift: true, action: "focus-next-attention" },
  // Standard macOS Settings/Preferences chord (HIG); matches the gear button.
  { key: ",", meta: true, action: "toggle-settings" },
  // event.key for arrows is "ArrowLeft" etc. — lowercased by matchBinding
  { key: "arrowleft", meta: true, alt: true, action: "focus-left" },
  { key: "arrowright", meta: true, alt: true, action: "focus-right" },
  { key: "arrowup", meta: true, alt: true, action: "focus-up" },
  { key: "arrowdown", meta: true, alt: true, action: "focus-down" },
  ...TAB_SELECT_BINDINGS,
  SELECT_LAST_TAB_BINDING,
];
