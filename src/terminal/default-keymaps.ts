/**
 * Platform keyboard shortcuts — the physical/character key bindings that fire
 * each `ActionId` on macOS and Windows.
 *
 * Split out of `action-registry.ts`, which stays the SSOT for what actions
 * EXIST and their menu placement; this file only maps a keystroke to one of
 * those ids. The dependency is strictly one-way — `KeyBindingBase.action` is
 * typed `ActionId`, imported type-only from `./action-registry`, and nothing
 * here flows back into that file. `action-registry.ts` re-exports
 * `MACOS_KEYMAP`, `WINDOWS_KEYMAP`, `KeyBinding`, `CharKeyBinding` and
 * `PhysicalKeyBinding` so no consumer had to change its import path for this
 * split.
 */
import type { ActionId } from "./action-registry";

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
  // Sketch a new layout preset from scratch (Task 4, unified with the menu's
  // "New Layout Preset…" accelerator, already Cmd+Shift+N since 09f5c4d).
  { key: "n", meta: true, shift: true, action: "new-preset" },
  // Capture the live layout as a preset — also in the Window menu
  { key: "s", meta: true, shift: true, action: "save-preset" },
  // Save the active file surface (spec
  // docs/specs/2026-08-12-file-explorer-design.md §4.3). Bare ⌘S, distinct
  // from ⌘⇧S save-preset above. No Windows binding: bare Ctrl+S stays
  // PTY-reserved (terminal flow control) until an explicit binding decision
  // says otherwise — see WINDOWS_KEYMAP's own top-of-file comment on bare
  // Ctrl+ chords staying available to the PTY. Has a menu item, so
  // CharKeyBinding is mandatory, not a style choice (RULE above).
  { key: "s", meta: true, action: "save-file" },
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
  // alone here: the file-explorer design claims ⌘⇧B / Ctrl+Shift+B for its
  // own docked panel below (spec §3), and reusing it here would collide with
  // that decided chord. CharKeyBinding is mandatory, not a style choice: this
  // action has a macOS menu item, and a Cocoa accelerator is declared by
  // character (RULE above).
  { key: "i", meta: true, shift: true, action: "toggle-browser" },
  // File explorer panel (spec §3: docs/specs/2026-08-12-file-explorer-design.md).
  // `b` is verified unused in both keymaps — the browser panel above
  // deliberately left it alone for exactly this. CharKeyBinding is mandatory,
  // not a style choice: this action has a macOS menu item, and a Cocoa
  // accelerator is declared by character (RULE above).
  { key: "b", meta: true, shift: true, action: "toggle-explorer" },
  // Token usage screen. ⌘⇧U is free on both keymaps — `u` is bound nowhere at
  // any modifier combination, verified exhaustively. CharKeyBinding is
  // mandatory, not a style choice: this action has a macOS menu item, and a
  // Cocoa accelerator is declared by character (see the RULE above).
  { key: "u", meta: true, shift: true, action: "toggle-usage" },
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
  // Same chord as macOS, one modifier swapped — see the mac entry for why `i`
  // and not `b`.
  { key: "i", ctrl: true, shift: true, action: "toggle-browser" },
  // Same chord as macOS, one modifier swapped — see the mac entry above.
  { key: "b", ctrl: true, shift: true, action: "toggle-explorer" },
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
  { key: "u", ctrl: true, shift: true, action: "toggle-usage" },
  { key: "m", ctrl: true, shift: true, action: "move-pane-to-new-window" },
  { key: "pageup", shift: true, action: "scroll-page-up" },
  { key: "pagedown", shift: true, action: "scroll-page-down" },
  { key: "home", shift: true, action: "scroll-to-top" },
  { key: "end", shift: true, action: "scroll-to-bottom" },
];
