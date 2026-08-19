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
 * test in tab-manager.preset-actions.test.ts that locks this property in.
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
   * run while an overlay (Settings / Usage / Session history / Open board /
   * PresetEditor / SavePresetDialog / AgentQuickPicker) is up.
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
    // Tiered "board", not "always" (2026-07-27 code review, F2). Originally
    // only set boardOpen.value = true; since 2026-08-14 it opens
    // AgentQuickPicker (rank "modal") instead, but the reasoning still holds
    // unchanged: "always" used to bypass the guard unconditionally,
    // including while a PresetEditor/SavePresetDialog/AgentQuickPicker draft
    // (rank "modal", above "board") was up, mounting a fresh overlay
    // underneath the live modal scrim where its own mount-focus effect could
    // steal focus away from the draft. "board" (rank 30) blocks it there —
    // every modal-tier overlay ranks >= 30 — and also while the Open board
    // itself is already up, while still letting it run over Settings (rank
    // below "board" — see TIER_RANK's doc comment above).
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
    id: "save-file",
    label: "Save",
    // Tier "pane" (spec docs/specs/2026-08-12-file-explorer-design.md §4.3):
    // it saves whichever file surface is currently visible, and every
    // overlay hides that surface the same way it hides the focused pane —
    // same reasoning as close-pane/close-tab below.
    //
    // "No-op when no file surface is active" (§4.3) is NOT this field: it is
    // runtime dispatch behavior, resolved against `SurfaceStrip.save()`
    // (tab-manager.ts's own doc comment: "Save the active surface; a no-op
    // when it has nothing to save"). That table lives in tab-manager.ts,
    // owned by a concurrent task at the time this row landed — see
    // dispatch-coverage.test.ts / shortcut-groups.test.ts for the two tests
    // that stay red until `"save-file"` joins `COMMAND_ACTIONS` there.
    scope: "pane",
    // Own group ("save"), between the layout-preset group and Close: saving
    // the open file is neither a preset operation nor a close operation, and
    // sits naturally between "create/capture" and "close" in the File menu's
    // top-to-bottom flow.
    menu: { submenu: "File", group: "save" },
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
    // only new action with NO mouse path at all (unlike swap-*, which
    // already has drag-dock). Per the
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
  // The three Edit-menu commands the native Cocoa roles used to own. They are
  // registry actions rather than `role: "selectAll" | "undo" | "redo"` because
  // a role runs a DOCUMENT-level Chromium command, and Monaco 0.56 is opaque
  // to those: with `editContext` on (its default) the caret lives in a
  // `div.native-edit-context`, so there is no DOM selection to select and no
  // editable region to undo. Measured 2026-08-19 — `webContents.selectAll()`
  // followed by a copy returned one line, while the same chord delivered to
  // the renderer returned the whole file.
  //
  // `scope: "always"` is a third case beyond the two `ActionScope` names —
  // neither has its own overlay preflight nor opens the overlay that would
  // block it. They act on whatever holds the caret and never on the pane, so
  // the `"pane"` tier (which `overlayBlocksAction` blocks the moment a file
  // surface takes the stage) would block them exactly where they are needed.
  //
  // Deliberately NO `menu` field: the Electron template hand-writes these
  // three so they can keep the Cocoa position and label users expect, and
  // omitting the field keeps `scripts/generate-menu.ts` — and with it Tauri's
  // hand-written `menu.rs`, which still carries the Cocoa builtins — untouched.
  {
    id: "select-all",
    label: "Select All",
    scope: "always",
  },
  {
    id: "undo",
    label: "Undo",
    scope: "always",
  },
  {
    id: "redo",
    label: "Redo",
    scope: "always",
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
    // Tier "pane": the browser is a surface ON the stage, and every overlay
    // covers the stage. Opening it under Settings would position a native
    // view on top of the overlay — the one stacking order the renderer
    // cannot fix from CSS. A file surface does NOT block it: the command is
    // in tab-manager's `isSurfaceRoutedAction` set, because toggling the
    // browser IS a surface transition.
    scope: "pane",
    menu: { submenu: "View", group: "browser" },
  },
  {
    id: "toggle-dock",
    label: "Side Panel",
    // Tier "pane", same overlay reasoning as toggle-browser above: the dock is
    // a column of the stage, and every overlay covers the stage. A file
    // surface does NOT block it: the command is in tab-manager's
    // `isChromeScopedAction` set, because the column stands BESIDE the stage
    // and this is the only way to put it away (2026-08-17).
    scope: "pane",
    // Shares the panel group with the tabs it opens onto — the column and the
    // three surfaces it can show are one cluster in the View menu, not four
    // unrelated items.
    menu: { submenu: "View", group: "explorer" },
  },
  {
    id: "toggle-explorer",
    label: "Explorer",
    // Tier "pane", same overlay reasoning as toggle-browser above: the
    // explorer is a tab of the dock, and every overlay covers the stage. In
    // `isChromeScopedAction` alongside `toggle-dock`, for the same reason.
    scope: "pane",
    menu: { submenu: "View", group: "explorer" },
  },
  {
    id: "toggle-usage",
    label: "Token Usage",
    // `"pane"` since 2026-08-16, and the trailing ellipsis went with it. This
    // was `"always"` because `usageOpen` pushed rank 20 in `openOverlayRanks()`
    // and a `"pane"`-tiered action would have blocked itself, stranding a
    // full-window screen open with nothing able to close it. Usage is a tab of
    // the dock now: it opens no overlay, pushes no rank, and displaces the
    // terminal grid instead of covering it — so it takes the ordinary tier its
    // sibling tabs take, and "…" no longer belongs on a label that opens no
    // dialog (menu grammar, DL-23.2's registry half). In
    // `isChromeScopedAction` alongside `toggle-dock`, for the same reason.
    scope: "pane",
    menu: { submenu: "View", group: "explorer" },
  },
  {
    id: "toggle-sessions",
    label: "Session History",
    // Tier "pane", same overlay reasoning as its two sibling tabs above: the
    // session list is a tab of the dock, and every overlay covers the stage.
    // In `isChromeScopedAction` alongside `toggle-dock`, for the same reason.
    //
    // It did not exist until 2026-08-19 — the file-explorer spec §3.1 shipped
    // the sessions tab as "toolbar control only, no shortcut, no menu item",
    // which left the dock's third tab the only one a tooltip could not print
    // a chord for. The owner asked for the chord when the dock header grew
    // tooltips; one chord per surface is what the other two already promise.
    scope: "pane",
    menu: { submenu: "View", group: "explorer" },
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
export type ActionId = (typeof ACTION_REGISTRY)[number]["id"] | `select-tab-${number}`;

const ACTION_IDS: ReadonlySet<string> = new Set(ACTION_REGISTRY.map((a) => a.id));

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

// Platform keymaps (KeyBinding, CharKeyBinding, PhysicalKeyBinding,
// MACOS_KEYMAP, WINDOWS_KEYMAP) live in `default-keymaps.ts`; re-exported
// below so no consumer of this module had to change its import path.
export type { KeyBinding, CharKeyBinding, PhysicalKeyBinding } from "./default-keymaps";
export { MACOS_KEYMAP, WINDOWS_KEYMAP } from "./default-keymaps";
