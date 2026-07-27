export type ShortcutAction =
  | "split-row"
  | "split-column"
  | "close-pane"
  | "focus-next"
  | "focus-prev"
  | "toggle-expand"
  | "new-tab"
  | "close-tab"
  | "next-tab"
  | "prev-tab"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "toggle-zoom-pane"
  | "find"
  | "clear-buffer"
  | "focus-left"
  | "focus-right"
  | "focus-up"
  | "focus-down"
  | "reopen-tab"
  | "save-preset"
  | "focus-next-attention"
  | "toggle-settings"
  | "select-last-tab"
  | `select-tab-${number}`;

interface KeyBindingBase {
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: ShortcutAction;
}

/**
 * Matches on the character the active layout + modifiers actually produce
 * (`event.key`, lowercased). Right for shortcuts users think of by letter —
 * the same character regardless of physical key position (d, w, t, f, k, e,
 * s, a), plus named keys (arrows, Enter, comma).
 */
export interface CharKeyBinding extends KeyBindingBase {
  readonly key: string;
}

/**
 * Matches on physical key position (`event.code`), independent of the
 * active keyboard layout and of an IME rewriting `event.key`. Right for
 * punctuation-shaped shortcuts whose produced character only sits in that
 * position on a US layout — e.g. the bracket keys below, which sit under
 * entirely different characters on AZERTY/QWERTZ/Vietnamese layouts.
 */
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
  // the real production bug (that needs a menu.rs accelerator change, out of
  // this file's scope) and isn't worth the complexity for a path this cold.
  // focus-next/prev and next/prev-tab above have no such menu entry, so the
  // webview binding is their ONLY path in production — that's what makes
  // fixing those two, and not these three, the priority.
  { key: "=", meta: true, action: "zoom-in" },
  { key: "+", meta: true, shift: true, action: "zoom-in" },
  { key: "-", meta: true, action: "zoom-out" },
  { key: "0", meta: true, action: "zoom-reset" },
  // Maximize the active pane over the whole tab (tmux zoom), toggle to restore
  { key: "enter", meta: true, shift: true, action: "toggle-zoom-pane" },
  { key: "f", meta: true, action: "find" },
  { key: "k", meta: true, action: "clear-buffer" },
  { key: "t", meta: true, shift: true, action: "reopen-tab" },
  // Capture the live layout as a preset (UX §3) — also in the Window menu
  { key: "s", meta: true, shift: true, action: "save-preset" },
  // Jump to the highest-severity actionable Attention Rail candidate; routed
  // through an app-level seam so it can share the overlay preflight with a
  // status-dot click (Task 15) instead of focusing directly.
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

const BOUND_ACTIONS: ReadonlySet<string> = new Set(
  DEFAULT_KEYMAP.map((binding) => binding.action),
);

/**
 * Whether `value` names an action the default keymap actually binds.
 *
 * Guards the one place an action arrives as untrusted data rather than as a
 * matched key event: the macOS menu sends its item id across the Tauri IPC
 * boundary as a plain string.
 */
export function isShortcutAction(value: unknown): value is ShortcutAction {
  return typeof value === "string" && BOUND_ACTIONS.has(value);
}

/**
 * Exact match on the key/code and all four modifiers; null when nothing
 * matches. A `PhysicalKeyBinding` (has `code`) matches on `event.code`; a
 * `CharKeyBinding` (has `key`) matches on `event.key`, lowercased — so a
 * non-US layout or an IME rewriting `event.key` still resolves the physical
 * bindings correctly regardless of what character `event.key` carries.
 */
export function matchBinding(
  event: KeyboardEvent,
  keymap: readonly KeyBinding[] = DEFAULT_KEYMAP,
): ShortcutAction | null {
  const key = event.key.toLowerCase();
  for (const binding of keymap) {
    const keyMatches =
      "code" in binding ? binding.code === event.code : binding.key === key;
    if (
      keyMatches &&
      !!binding.meta === event.metaKey &&
      !!binding.shift === event.shiftKey &&
      !!binding.alt === event.altKey &&
      !!binding.ctrl === event.ctrlKey
    ) {
      return binding.action;
    }
  }
  return null;
}

/**
 * 0-based tab index for a `select-tab-N` action, null for any other action —
 * including `select-last-tab` (⌘9), which has no fixed index of its own: its
 * concrete index is resolved against the live tab count in tab-manager.ts.
 */
export function selectTabIndex(action: ShortcutAction): number | null {
  const match = /^select-tab-(\d+)$/.exec(action);
  return match ? Number(match[1]) - 1 : null;
}
