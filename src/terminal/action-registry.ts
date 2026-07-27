/**
 * Single source of truth for every keyboard shortcut / macOS menu action.
 * Pure data — no Preact, no Tauri, no DOM. `keymap.ts` derives event matching
 * from `DEFAULT_KEYMAP`/`ActionId`; `tab-manager.ts`'s `overlayBlocksAction`
 * reads `scope`. See docs/plans/2026-07-27-action-registry.md.
 */

export type OverlayTier = "pane" | "settings" | "board" | "modal";

/**
 * Logical stacking rank behind `overlayBlocksAction` (tab-manager.ts): an
 * action is blocked while ANY currently open overlay's rank is >= its own
 * target tier's rank (see `ActionDefinition.scope` below). Mirrors the real
 * z-index in src/styles.css — `.panel` (Settings) 20, `.open-board` 30,
 * `.modal-scrim` (PresetEditor + SavePresetDialog, deliberately the SAME
 * rank — see below) 40; `"pane"` has no z-index of its own, it is the base
 * layer the terminal grid sits on (rank 0).
 *
 * `>=`, not `>`, is deliberate: two actions tiered `"modal"` automatically
 * block each other while either is open (PresetEditor vs SavePresetDialog)
 * with no separate "family"/"sibling" concept needed — see the regression
 * test in tab-manager.test.ts that locks this property in.
 *
 * `"settings"` has no action tiered at it today (see `toggle-settings`'s own
 * `scope` comment for why it stays `"always"` instead). It still needs to
 * exist in the ranking: it is what lets `"board"`/`"modal"`-tiered actions
 * stay UNBLOCKED while only Settings is open — Settings holds no draft, and
 * being z-20 it never visually hides a z-30+ surface, so nothing is lost by
 * letting board/modal-tier actions run over it. Remove this rank and that
 * relationship silently breaks for any future settings-tiered action.
 */
export const TIER_RANK: Record<OverlayTier, number> = {
  pane: 0,
  settings: 20,
  board: 30,
  modal: 40,
};

export type ActionScope = OverlayTier | "always";

export type MenuSubmenu = "App" | "File" | "Edit" | "View" | "Window";

export interface ActionDefinition {
  /** Stable string — also the id sent over Tauri IPC (`menu:action` payload). */
  readonly id: string;
  /** Display name — today's macOS menu label; reserved for a future cheat sheet/command palette. */
  readonly label: string;
  /**
   * Decides whether `overlayBlocksAction` (tab-manager.ts) lets this action
   * run while an overlay (Open board / Settings / PresetEditor /
   * SavePresetDialog) is up.
   *
   * An `OverlayTier` (`"pane" | "settings" | "board" | "modal"`, see
   * `TIER_RANK` above) blocks the action while any currently open overlay's
   * rank is >= this tier's rank — most actions are `"pane"` (rank 0, the
   * default: blocked by literally any open overlay, since every open
   * overlay's rank is >= 0).
   *
   * `"always"` skips the tier comparison entirely — only for an action with
   * its own overlay preflight (`focus-next-attention`), or an action that
   * opens/closes the very overlay that would otherwise block it
   * (`toggle-settings`).
   *
   * "Switch tabs" actions (`select-tab-N`, `select-last-tab`, `next-tab`,
   * `prev-tab`) are exempted through a SEPARATE mechanism (`isTabSwitchAction`
   * in `tab-manager.ts`) — not modeled here, so this field only ever
   * reflects a genuine product decision, never the tab-family mechanism.
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
  /**
   * Set (only ever `true`) when this action destroys live state with no
   * confirmation step of its own — killing a pane/tab's running process, or
   * wiping scrollback with no undo (`clear-buffer`, per CONTEXT.md's own
   * "Buffer" entry). Absent (the default) for everything else.
   *
   * Read by `runAction` (tab-manager.ts, F-B1/F-B2, 2026-07-27 code review)
   * to decide whether a chrome text field (tab rename input, search bar,
   * a settings field) holding the caret should suppress this specific
   * action. The guard cannot key off HOW the action arrived instead: a
   * macOS menu accelerator is consumed by the OS before the webview ever
   * sees the keydown, and Tauri's `MenuEvent` (confirmed against the 2.9.3
   * docs — the struct is just `{ id: MenuId }`) carries nothing that would
   * distinguish that from a deliberate mouse click on the very same item.
   * So a blanket "block every action while a chrome text field is focused"
   * silently ate genuine clicks on non-destructive items (F-B2 — e.g.
   * "Save Layout as Preset…" while the search bar's input still held focus)
   * and, symmetrically, blocked `find-next`/`find-previous` from ever
   * reaching the pane while typed into the very search-bar input they are
   * meant to act on (F-B1) — neither of those two is destructive, so
   * neither carries this field.
   *
   * Known, accepted trade-off, not an oversight: a genuine mouse click on
   * `close-pane`/`close-tab`/`clear-buffer` while some OTHER, unrelated
   * text field still holds focus is also wrongly suppressed (the same
   * "can't tell click from accelerator" limitation cuts both ways). That
   * false positive is rare and costs nothing but a second click; the
   * alternative — an accelerator the OS ate mid-rename silently killing a
   * pane that might be running an agent, or wiping scrollback nobody meant
   * to lose — is not an acceptable trade the other way. Do not remove this
   * field from these three actions to "fix" the false positive without
   * re-reading this comment.
   */
  readonly destructive?: true;
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
    // Tiered "board", not "always" (2026-07-27 code review, F2): only sets
    // boardOpen.value = true, so it is harmless while the board is ALREADY
    // open — but "always" used to bypass the guard unconditionally,
    // including while a PresetEditor/SavePresetDialog draft (rank "modal",
    // above the board) was up. That mounted the board underneath the modal
    // scrim, where its own mount-focus effect could steal focus away from
    // the live draft. "board" blocks it exactly there while still letting
    // it run over Settings (rank below "board" — see TIER_RANK's doc
    // comment above).
    scope: "board",
    menu: { submenu: "File", group: "primary" },
  },
  {
    id: "reopen-tab",
    label: "Reopen Closed Tab",
    scope: "pane",
    menu: { submenu: "File", group: "primary" },
  },
  {
    id: "new-preset",
    label: "New Layout Preset…",
    // Moved from the Window menu to File (HIG: File owns create/save
    // operations; Window is left holding only native window-management
    // items — minimize/maximize/fullscreen).
    //
    // Tiered "modal" (2026-07-27 code review, F4): it used to inherit the
    // default "terminal"/"pane" gating, which blocked Cmd+Shift+N on the
    // Open board — the app's own default landing screen, since there is no
    // session restore. Sketching a preset from scratch is independent of
    // any tab/workspace, so there is nothing for the board to protect.
    // Not blocked by Settings either, for the same reason as "board": no
    // draft, and PresetEditor (z-40) renders fully visible above it (z-20).
    // Still blocked while ANOTHER modal-family overlay (SavePresetDialog)
    // is already open — TIER_RANK's `>=` comparison gives that for free,
    // no extra "sibling" concept needed. Contrast with `save-preset` below,
    // deliberately tiered "board" instead: it captures the ACTIVE tab's
    // LIVE layout, which the board hides.
    scope: "modal",
    menu: { submenu: "File", group: "preset" },
  },
  {
    id: "save-preset",
    label: "Save Layout as Preset…",
    // Tiered "board" (decision 2 of the 2026-07-27 code review's design
    // proposal) — NOT "pane" (its old, blanket "terminal" gating) and NOT
    // "modal" like its sibling `new-preset` above. Not blocked by Settings
    // for the same reason as new-preset: no draft, and SavePresetDialog
    // (z-40) renders fully visible above it (z-20). STILL blocked by the
    // board, unlike new-preset: this action CAPTURES THE ACTIVE TAB'S LIVE
    // LAYOUT, and while the board covers the screen "the active tab" is
    // invisible — capturing it blind and silently overwriting a preset is
    // exactly the class of bug this whole guard exists to prevent. The
    // `tabs.length > 0` check in this action's `commands` closure below is
    // separate business logic ("is there anything to save"), not overlay
    // gating.
    scope: "board",
    menu: { submenu: "File", group: "preset" },
  },
  {
    id: "close-pane",
    label: "Close Pane",
    scope: "pane",
    // Kills the pane's running process; confirmClose (close-guard.ts) only
    // prompts when a NON-shell process is detected — an idle shell closes
    // instantly with no dialog at all. See ActionDefinition.destructive.
    destructive: true,
    menu: { submenu: "File", group: "close" },
  },
  {
    id: "close-tab",
    label: "Close Tab",
    scope: "pane",
    // Same reasoning as close-pane, worse blast radius (every pane in the
    // tab). See ActionDefinition.destructive.
    destructive: true,
    menu: { submenu: "File", group: "close" },
  },
  { id: "find", label: "Find…", scope: "pane", menu: { submenu: "Edit" } },
  {
    id: "find-next",
    label: "Find Next",
    scope: "pane",
    menu: { submenu: "Edit" },
  },
  {
    id: "find-previous",
    label: "Find Previous",
    scope: "pane",
    menu: { submenu: "Edit" },
  },
  {
    id: "clear-buffer",
    label: "Clear Buffer",
    scope: "pane",
    // Drops scrollback with no undo (CONTEXT.md "Buffer") — always, no
    // confirmation step of its own. See ActionDefinition.destructive.
    destructive: true,
    menu: { submenu: "Edit" },
  },
  {
    id: "split-row",
    label: "Split Vertically",
    scope: "pane",
    menu: { submenu: "View", group: "split" },
  },
  {
    id: "split-column",
    label: "Split Horizontally",
    scope: "pane",
    menu: { submenu: "View", group: "split" },
  },
  {
    id: "toggle-zoom-pane",
    label: "Zoom Pane",
    scope: "pane",
    menu: { submenu: "View", group: "zoom-pane" },
  },
  {
    id: "toggle-expand",
    label: "Focus Expand",
    scope: "pane",
    menu: { submenu: "View", group: "zoom-pane" },
  },
  {
    id: "zoom-in",
    label: "Increase Font Size",
    scope: "pane",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "zoom-out",
    label: "Decrease Font Size",
    scope: "pane",
    menu: { submenu: "View", group: "font" },
  },
  {
    id: "zoom-reset",
    label: "Actual Size",
    scope: "pane",
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
  { id: "focus-next", label: "Focus Next Pane", scope: "pane" },
  { id: "focus-prev", label: "Focus Previous Pane", scope: "pane" },
  { id: "focus-left", label: "Focus Pane Left", scope: "pane" },
  { id: "focus-right", label: "Focus Pane Right", scope: "pane" },
  { id: "focus-up", label: "Focus Pane Up", scope: "pane" },
  { id: "focus-down", label: "Focus Pane Down", scope: "pane" },
  {
    id: "next-tab",
    label: "Next Tab",
    // "pane" is a placeholder, pre-empted by isTabSwitchAction
    // (tab-manager.ts, decision 3, 2026-07-27 code review) — same mechanism
    // as select-tab-N/select-last-tab below, NOT through scope "always".
    scope: "pane",
  },
  {
    id: "prev-tab",
    label: "Previous Tab",
    // See next-tab above — same isTabSwitchAction exemption.
    scope: "pane",
  },
  {
    id: "select-last-tab",
    label: "Select Last Tab",
    // Exempt from the overlay guard through isTabSwitchAction
    // (tab-manager.ts) — the same mechanism as select-tab-N/next-tab/
    // prev-tab, NOT through scope "always".
    scope: "pane",
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
  // Capture the live layout as a preset — also in the Window menu
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
