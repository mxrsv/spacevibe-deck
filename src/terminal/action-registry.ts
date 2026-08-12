/**
 * Single source of truth for every keyboard shortcut / macOS menu action.
 * Pure data — no Preact, no Tauri, no DOM. `keymap.ts` derives event matching
 * from the platform keymaps/`ActionId`; `tab-manager.ts`'s `overlayBlocksAction`
 * reads `scope`. See docs/plans/2026-07-27-action-registry.md.
 */

export type OverlayTier = "pane" | "settings" | "board" | "modal";

/**
 * Logical stacking rank behind `overlayBlocksAction` (tab-manager.ts): an
 * action is blocked while ANY currently open overlay's rank is >= its own
 * target tier's rank (see `ActionDefinition.scope` below). Broadly mirrors the
 * real z-index in src/styles.css — `.open-board` 30,
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
 * stay UNBLOCKED while only Settings is open — `new-tab` and `save-preset`
 * both depend on it, and both have tests locking that in. Remove this rank
 * and that relationship silently breaks for any future settings-tiered action.
 *
 * NOTE — this rank (20) deliberately no longer matches Settings' CSS z-index
 * (35, raised when Settings became a full-window surface so it covers the
 * board instead of hiding under it). The two numbers answer different
 * questions: z-index decides what is drawn on top, this rank decides what may
 * still be invoked. Raising the rank to match would block `new-tab` and
 * `save-preset` while Settings is open — `save-preset`'s dialog is z-40 and
 * would render ABOVE Settings perfectly well, so blocking it buys nothing and
 * costs a silently dead shortcut.
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
// current macOS keymap — this lift includes both, for 27 rows total.
export const ACTION_REGISTRY = [
  {
    id: "check-for-updates",
    label: "Check for Updates…",
    scope: "always",
    menu: { submenu: "App" },
  },
  {
    id: "open-release-notes",
    label: "Release Notes…",
    scope: "always",
    menu: { submenu: "App" },
  },
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
    id: "open-tab-options",
    label: "Rename Tab / Dot Color…",
    // Opens the same TabPopover a tab click already opens — no menu item
    // (same "already has a mouse path" reasoning as focus-*/swap-* above).
    //
    // Tiered "always" (Task 2, docs/plans/2026-07-27-keyboard-parity.md),
    // deliberately NOT a new OverlayTier: TabPopover renders at z-index 100
    // (src/styles.css) — above `.modal-scrim` (40), `.open-board` (30), and
    // `.settings-screen` (35), i.e. above every overlay this registry models — and
    // TabBar/WorkspaceSidebar sit outside `.stage`, so they stay visible and
    // clickable no matter which overlay is open (the same reason
    // select-tab-N/next-tab/prev-tab are click-parity-exempt via
    // isTabSwitchAction, not this field). There is no "action runs on a
    // hidden surface" risk here for the tier model to guard against — this
    // is a UI-layer fact (where TabPopover paints, where TabBar lives in the
    // DOM), not an overlay this registry needs to know about.
    //
    // Verified before shipping (would otherwise reproduce F3's "steal focus
    // from a draft" bug in a new spot): TabPopover mount-focuses its rename
    // input (tab-popover.tsx), and its own Escape handler does not
    // stopPropagation. But PresetEditor/SavePresetDialog's Escape handling
    // is an element-scoped `onKeyDown` on their own `.preset-editor`/
    // `.save-preset` div (not a `window` listener), and TabPopover lives in
    // TabBar/WorkspaceSidebar — a completely separate DOM subtree from
    // `<main class="stage">` where those modals render — so an Escape
    // bubbling from TabPopover's input can never reach their handler; the
    // draft cannot be discarded this way. Settings' Escape listener IS
    // global (`window`, settings/settings-screen.tsx) and would also fire if Settings
    // happened to be open at the same time, but `toggleSettingsPanel`
    // already guarantees Settings can only be open when both the board AND
    // a modal draft are closed — so that cascade can only ever call
    // focusActive() on a pane that is not hidden behind anything.
    scope: "always",
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
    id: "copy-cwd",
    label: "Copy Working Directory",
    scope: "pane",
    // The one action in this task with a menu item (Task 3,
    // docs/plans/2026-07-27-keyboard-parity.md) — before this it was the
    // only new action with NO mouse path at all (unlike swap-*/
    // open-tab-options, which already have drag-dock/click-tab). Per the
    // RULE above, having a menu item means the webview binding MUST be
    // CharKeyBinding (key: "c"), not code.
    menu: { submenu: "Edit" },
  },
  {
    id: "copy-selection",
    label: "Copy Selection",
    scope: "pane",
  },
  {
    id: "paste",
    label: "Paste",
    scope: "pane",
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
  {
    id: "toggle-prompts",
    label: "Prompts…",
    // Tier "pane": the popover targets the FOCUSED pane, which every overlay
    // hides — the same reason `save-preset` refuses to capture a layout it
    // cannot show. The chrome button carries its own disabled state, because
    // a direct onClick never passes through `overlayBlocksAction`.
    scope: "pane",
    menu: { submenu: "View", group: "prompts" },
  },
  {
    id: "toggle-browser",
    label: "Browser",
    // Tier "pane": the panel is a column of the stage, and every overlay
    // covers the stage. Opening it under Settings would position a native
    // view on top of the overlay — the one stacking order the renderer
    // cannot fix from CSS.
    scope: "pane",
    menu: { submenu: "View", group: "browser" },
  },
  {
    id: "move-pane-to-new-window",
    label: "Move Pane to New Window",
    // Tier "pane": it acts on the FOCUSED pane, which every overlay hides —
    // same reasoning as toggle-prompts above.
    scope: "pane",
    // The Window submenu is native window management, and moving a pane into
    // its own window is exactly that. `menu.rs` already loops over
    // `WINDOW_MENU_ITEMS` for this case and says so in its own comment, so
    // this needs no hand-written menu code.
    menu: { submenu: "Window", group: "move-pane" },
  },
  { id: "focus-next", label: "Focus Next Pane", scope: "pane" },
  { id: "focus-prev", label: "Focus Previous Pane", scope: "pane" },
  { id: "focus-left", label: "Focus Pane Left", scope: "pane" },
  { id: "focus-right", label: "Focus Pane Right", scope: "pane" },
  { id: "focus-up", label: "Focus Pane Up", scope: "pane" },
  { id: "focus-down", label: "Focus Pane Down", scope: "pane" },
  // FR-032 (docs/plans/2026-07-27-keyboard-parity.md Task 1) — swap the
  // active pane with its neighbor. Same "no menu item" reasoning as
  // focus-left/right/up/down above: swap already has a mouse path
  // (drag-dock), so a menu item is unnecessary for capability, only for a
  // second discoverability route this sibling group already forgoes.
  { id: "swap-left", label: "Swap Pane Left", scope: "pane" },
  { id: "swap-right", label: "Swap Pane Right", scope: "pane" },
  { id: "swap-up", label: "Swap Pane Up", scope: "pane" },
  { id: "swap-down", label: "Swap Pane Down", scope: "pane" },
  // Scrollback navigation (docs/plans/2026-07-27-keyboard-parity.md Task 4) —
  // same "already has a mouse path" reasoning as swap-*/focus-* above
  // (trackpad/scrollbar), so no menu item. Tier "pane": acts on the active
  // pane's viewport, same as clear-buffer/find above.
  {
    id: "scroll-page-up",
    label: "Scroll Up a Page",
    scope: "pane",
  },
  {
    id: "scroll-page-down",
    label: "Scroll Down a Page",
    scope: "pane",
  },
  { id: "scroll-to-top", label: "Scroll to Top", scope: "pane" },
  {
    id: "scroll-to-bottom",
    label: "Scroll to Bottom (Latest Output)",
    scope: "pane",
  },
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
 * platform-keymap entry, is still a valid id).
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

/**
 * Physical key position (event.code), not the layout-produced character
 * (F-C1, 2026-07-27 code review) — select-tab-N has no menu item, so per
 * the RULE above this is exactly the case PhysicalKeyBinding exists for.
 * Was `key: String(index + 1)` until this fix: on AZERTY, Digit1..Digit9
 * unshifted produce "&", "é", '"', "'", "(", "-", "è", "_", "ç" (never
 * "1".."9", which need Shift on that layout), so Cmd+1..Cmd+9 matched
 * nothing at all — switching tabs by number was completely dead on that
 * layout, the exact class of bug a6ac532 fixed for the bracket keys.
 */
const MACOS_TAB_SELECT_BINDINGS: readonly KeyBinding[] = Array.from(
  { length: 8 },
  (_, index): KeyBinding => ({
    code: `Digit${index + 1}`,
    meta: true,
    action: `select-tab-${index + 1}`,
  }),
);

/**
 * ⌘9: macOS convention (Safari, Chrome, iTerm2, Terminal.app) — always jumps
 * to the LAST tab, whatever the tab count, never "tab index 9". Deliberately
 * separate from `TAB_SELECT_BINDINGS` above, which only ever covers a FIXED
 * index (⌘1–⌘8); the concrete index for this action is resolved against the
 * live tab count in tab-manager.ts, not here. Physical key position, same
 * F-C1 reasoning as TAB_SELECT_BINDINGS above.
 */
const MACOS_SELECT_LAST_TAB_BINDING: KeyBinding = {
  code: "Digit9",
  meta: true,
  action: "select-last-tab",
};

export const MACOS_KEYMAP: readonly KeyBinding[] = [
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
  //
  // Known, accepted trade-off (F-C2, 2026-07-27 code review — analyzed, not
  // fixed): binding by `code` means the Cmd+ physical-position combo belongs
  // to THIS action on every layout; the cost is that on a layout where that
  // position produces a different character, Cmd+ that character fires the
  // position-based action instead of whatever character-based action the
  // user expects there. Concretely: on a German QWERTZ keyboard, the key at
  // the BracketRight position produces "+" unshifted. Cmd+(that key) now
  // matches `focus-next` here — not `zoom-in`, even though the user sees
  // "+" on their keycap. This was NOT a working zoom shortcut that got
  // stolen: zoom-in's own bindings are `{key:"=", shift:false}` and
  // `{key:"+", shift:true}` (below), and neither matches `{key:"+",
  // shift:false}` — that combination was already a no-op on this layout
  // before `code` bindings existed. The regression is real but narrower
  // than it sounds: a no-op became a wrong action firing (worse than a
  // no-op, since focus-next also acknowledges the target pane's attention
  // badge), not a working shortcut becoming broken. Only the Cmd+ chord is
  // claimed, never the bare key — typing a literal "+" into a pane is
  // unaffected on any layout.
  //
  // Not fixable by rebinding: zoom-in cannot move to `code` (it has a menu
  // item; the key-vs-code RULE above requires CharKeyBinding whenever a
  // menu accelerator must stay in sync). Moving focus-next/next-tab back to
  // `key` reintroduces the exact bug a6ac532 fixed (dead on AZERTY/QWERTZ).
  // No static test can detect this class of collision in general: a
  // CharKeyBinding matches whatever character the ACTIVE OS layout reports,
  // with no code of its own to compare against — answering "does this
  // collide" requires a code-to-character table for a SPECIFIC keyboard
  // layout, data that lives in the OS's keyboard driver, not this repo (see
  // action-registry.test.ts's existing same-kind-only disclaimer for the
  // identical reasoning). The real fix is a user-facing rebind UI
  // (docs/plans/2026-07-27-keyboard-parity.md, not yet built) — until then
  // this is a documented limitation, not a bug queued for a code fix.
  { code: "BracketRight", meta: true, action: "focus-next" },
  { code: "BracketLeft", meta: true, action: "focus-prev" },
  { key: "e", meta: true, action: "toggle-expand" },
  { key: "t", meta: true, action: "new-tab" },
  // Same physical-key reasoning as focus-next/prev above: Shift+BracketRight
  // only produces "}" (and Shift+BracketLeft only "{") on a US layout. Same
  // F-C2 trade-off too — see the comment above focus-next/focus-prev.
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
  // "Copy" family cousin of ⌘C (bare Cmd+C stays the macOS Copy role) — same
  // pattern as ⌘D split-row vs ⌘⇧D split-column: Shift makes it the
  // pane-scoped variant instead of the text-selection one. Has a menu item,
  // so CharKeyBinding is mandatory here, not a style choice (RULE above).
  { key: "c", meta: true, shift: true, action: "copy-cwd" },
  { key: "t", meta: true, shift: true, action: "reopen-tab" },
  // Opens the rename/dot-color popover for the active tab (Task 2,
  // docs/plans/2026-07-27-keyboard-parity.md) — no menu item, "r" is a
  // letter mnemonic (RULE above: CharKeyBinding, not code).
  { key: "r", meta: true, shift: true, action: "open-tab-options" },
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
  // Prompt Board. ⌘⇧P is free on both keymaps (no `p` binding existed) and
  // matches the "palette" chord people already reach for. CharKeyBinding is
  // mandatory, not a style choice: this action has a macOS menu item, and a
  // Cocoa accelerator is declared by character (see the RULE above).
  { key: "p", meta: true, shift: true, action: "toggle-prompts" },
  // Browser panel. `i` is the Inspect mnemonic and matches the chord every
  // browser already trains people on for element inspection; it is free on
  // BOTH keymaps. `b` — the obvious "browser" letter — is deliberately left
  // alone: the file-explorer design reserves ⌘⇧B / Ctrl+Shift+B for its own
  // docked panel, and taking it here would silently break a decided spec.
  // CharKeyBinding is mandatory, not a style choice: this action has a macOS
  // menu item, and a Cocoa accelerator is declared by character (RULE above).
  { key: "i", meta: true, shift: true, action: "toggle-browser" },
  // Move the focused pane into its own window. Cmd+Shift+M is free on both
  // keymaps (no `m`/`KeyM` binding existed on either) and `m` is the "move"
  // mnemonic; macOS's Cmd+M Minimize is a Cocoa builtin and does not claim
  // the Shift variant. CharKeyBinding is mandatory, not a style choice: this
  // action has a macOS menu item, and a Cocoa accelerator is declared by
  // character (see the RULE above).
  { key: "m", meta: true, shift: true, action: "move-pane-to-new-window" },
  // event.key for arrows is "ArrowLeft" etc. — lowercased by matchBinding
  { key: "arrowleft", meta: true, alt: true, action: "focus-left" },
  { key: "arrowright", meta: true, alt: true, action: "focus-right" },
  { key: "arrowup", meta: true, alt: true, action: "focus-up" },
  { key: "arrowdown", meta: true, alt: true, action: "focus-down" },
  // Swap the focused pane with its neighbor — same direction keys as focus
  // (⌘⌥), plus Shift for the "stronger" operation (same pattern as split-row
  // ⌘D vs split-column ⌘⇧D). CharKeyBinding, same as focus-left/right/up/down
  // above: no menu item, and event.key for arrows ("ArrowLeft" etc.) is
  // stable across layout/Shift, so `code` buys nothing here (RULE above).
  { key: "arrowleft", meta: true, alt: true, shift: true, action: "swap-left" },
  {
    key: "arrowright",
    meta: true,
    alt: true,
    shift: true,
    action: "swap-right",
  },
  { key: "arrowup", meta: true, alt: true, shift: true, action: "swap-up" },
  {
    key: "arrowdown",
    meta: true,
    alt: true,
    shift: true,
    action: "swap-down",
  },
  // Scrollback navigation — idiomatic terminal-app convention (iTerm2, VS
  // Code integrated terminal both use Shift+Page*/Home/End for this). Plain
  // PageUp/PageDown/Home/End are left untouched — they still reach the PTY
  // for the shell/readline's own cursor handling. CharKeyBinding: no menu
  // item, and event.key for these named keys ("PageUp" etc.) is stable
  // across layout/Shift — the same reasoning as "enter"/arrows above, not a
  // Shift-dependent punctuation char like the bracket keys (RULE above).
  { key: "pageup", shift: true, action: "scroll-page-up" },
  { key: "pagedown", shift: true, action: "scroll-page-down" },
  { key: "home", shift: true, action: "scroll-to-top" },
  { key: "end", shift: true, action: "scroll-to-bottom" },
  ...MACOS_TAB_SELECT_BINDINGS,
  MACOS_SELECT_LAST_TAB_BINDING,
];

const WINDOWS_TAB_SELECT_BINDINGS: readonly KeyBinding[] = Array.from(
  { length: 8 },
  (_, index): KeyBinding => ({
    code: `Digit${index + 1}`,
    ctrl: true,
    action: `select-tab-${index + 1}`,
  }),
);

const WINDOWS_SELECT_LAST_TAB_BINDING: KeyBinding = {
  code: "Digit9",
  ctrl: true,
  action: "select-last-tab",
};

/**
 * Windows Terminal-style chords keep conventional bare Ctrl sequences
 * available to the PTY, except Ctrl+V: Deck owns standard text paste through
 * Ctrl+V, Ctrl+Shift+V, and physical Shift+Insert. Alt+V remains unbound so
 * the active agent can handle it if that CLI supports the chord.
 *
 * Clipboard actions dispatch through the shared path every other chord uses —
 * this keymap, then the `commands` table in tab-manager.ts, then
 * `TerminalManager.copyActiveSelection()`/`pasteIntoActive()`, then
 * `Pane.copySelection()`/`paste()`. They were once handled pane-locally by a
 * handler on the xterm textarea, which could never fire: `handleShortcut` is a
 * capture-phase window listener that stopPropagation()s first. That is why the
 * chords silently did nothing for two releases.
 */
export const WINDOWS_KEYMAP: readonly KeyBinding[] = [
  { key: "c", ctrl: true, shift: true, action: "copy-selection" },
  { key: "v", ctrl: true, action: "paste" },
  { key: "v", ctrl: true, shift: true, action: "paste" },
  { code: "Insert", shift: true, action: "paste" },
  { key: "c", ctrl: true, alt: true, shift: true, action: "copy-cwd" },
  { key: "d", ctrl: true, shift: true, action: "split-row" },
  { key: "d", ctrl: true, alt: true, shift: true, action: "split-column" },
  { key: "w", ctrl: true, shift: true, action: "close-pane" },
  { key: "w", ctrl: true, alt: true, shift: true, action: "close-tab" },
  { code: "BracketRight", ctrl: true, alt: true, action: "focus-next" },
  { code: "BracketLeft", ctrl: true, alt: true, action: "focus-prev" },
  { key: "arrowleft", ctrl: true, alt: true, action: "focus-left" },
  { key: "arrowright", ctrl: true, alt: true, action: "focus-right" },
  { key: "arrowup", ctrl: true, alt: true, action: "focus-up" },
  { key: "arrowdown", ctrl: true, alt: true, action: "focus-down" },
  { key: "arrowleft", ctrl: true, alt: true, shift: true, action: "swap-left" },
  {
    key: "arrowright",
    ctrl: true,
    alt: true,
    shift: true,
    action: "swap-right",
  },
  { key: "arrowup", ctrl: true, alt: true, shift: true, action: "swap-up" },
  {
    key: "arrowdown",
    ctrl: true,
    alt: true,
    shift: true,
    action: "swap-down",
  },
  { key: "e", ctrl: true, shift: true, action: "toggle-expand" },
  { key: "enter", ctrl: true, shift: true, action: "toggle-zoom-pane" },
  { key: "t", ctrl: true, shift: true, action: "new-tab" },
  { key: "t", ctrl: true, alt: true, shift: true, action: "reopen-tab" },
  {
    key: "r",
    ctrl: true,
    alt: true,
    shift: true,
    action: "open-tab-options",
  },
  // Same chord as macOS, one modifier swapped — see the mac entry for why `i`
  // and not `b`.
  { key: "i", ctrl: true, shift: true, action: "toggle-browser" },
  { key: "tab", ctrl: true, action: "next-tab" },
  { key: "tab", ctrl: true, shift: true, action: "prev-tab" },
  ...WINDOWS_TAB_SELECT_BINDINGS,
  WINDOWS_SELECT_LAST_TAB_BINDING,
  { key: "=", ctrl: true, action: "zoom-in" },
  { key: "+", ctrl: true, shift: true, action: "zoom-in" },
  { key: "-", ctrl: true, action: "zoom-out" },
  { key: "0", ctrl: true, action: "zoom-reset" },
  { key: "f", ctrl: true, shift: true, action: "find" },
  { key: "f3", action: "find-next" },
  { key: "f3", shift: true, action: "find-previous" },
  { key: "k", ctrl: true, shift: true, action: "clear-buffer" },
  { key: "n", ctrl: true, alt: true, shift: true, action: "new-preset" },
  { key: "s", ctrl: true, alt: true, shift: true, action: "save-preset" },
  {
    key: "a",
    ctrl: true,
    shift: true,
    action: "focus-next-attention",
  },
  { key: ",", ctrl: true, action: "toggle-settings" },
  { key: "p", ctrl: true, shift: true, action: "toggle-prompts" },
  { key: "m", ctrl: true, shift: true, action: "move-pane-to-new-window" },
  { key: "pageup", shift: true, action: "scroll-page-up" },
  { key: "pagedown", shift: true, action: "scroll-page-down" },
  { key: "home", shift: true, action: "scroll-to-top" },
  { key: "end", shift: true, action: "scroll-to-bottom" },
];
