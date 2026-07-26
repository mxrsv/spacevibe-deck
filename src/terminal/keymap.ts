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
  | `select-tab-${number}`;

export interface KeyBinding {
  readonly key: string; // event.key, lowercased
  readonly meta?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  readonly ctrl?: boolean;
  readonly action: ShortcutAction;
}

const TAB_SELECT_BINDINGS: readonly KeyBinding[] = Array.from(
  { length: 9 },
  (_, index): KeyBinding => ({
    key: String(index + 1),
    meta: true,
    action: `select-tab-${index + 1}`,
  }),
);

export const DEFAULT_KEYMAP: readonly KeyBinding[] = [
  { key: "d", meta: true, action: "split-row" },
  { key: "d", meta: true, shift: true, action: "split-column" },
  // iTerm2 convention: Cmd+W closes the pane, Cmd+Shift+W the whole tab
  { key: "w", meta: true, action: "close-pane" },
  { key: "w", meta: true, shift: true, action: "close-tab" },
  { key: "]", meta: true, action: "focus-next" },
  { key: "[", meta: true, action: "focus-prev" },
  { key: "e", meta: true, action: "toggle-expand" },
  { key: "t", meta: true, action: "new-tab" },
  // On a US layout Shift+] produces "}" and Shift+[ produces "{",
  // so the bindings match the produced key, not the physical one.
  { key: "}", meta: true, shift: true, action: "next-tab" },
  { key: "{", meta: true, shift: true, action: "prev-tab" },
  // Font zoom, matching the standard macOS terminal shortcuts. Cmd+= counts
  // as zoom-in so users don't have to hold Shift for the "+" key.
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
  // event.key for arrows is "ArrowLeft" etc. — lowercased by matchBinding
  { key: "arrowleft", meta: true, alt: true, action: "focus-left" },
  { key: "arrowright", meta: true, alt: true, action: "focus-right" },
  { key: "arrowup", meta: true, alt: true, action: "focus-up" },
  { key: "arrowdown", meta: true, alt: true, action: "focus-down" },
  ...TAB_SELECT_BINDINGS,
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

/** Exact match on the key and all four modifiers; null when nothing matches. */
export function matchBinding(
  event: KeyboardEvent,
  keymap: readonly KeyBinding[] = DEFAULT_KEYMAP,
): ShortcutAction | null {
  const key = event.key.toLowerCase();
  for (const binding of keymap) {
    if (
      binding.key === key &&
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

/** 0-based tab index for a `select-tab-N` action, null for any other action. */
export function selectTabIndex(action: ShortcutAction): number | null {
  const match = /^select-tab-(\d+)$/.exec(action);
  return match ? Number(match[1]) - 1 : null;
}
