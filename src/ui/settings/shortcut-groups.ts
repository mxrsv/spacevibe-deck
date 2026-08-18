/**
 * How the Shortcuts section orders ~50 actions into readable groups.
 *
 * Rows are BUILT FROM `ACTION_REGISTRY`, never listed by hand: the registry is
 * the SSOT for what actions exist, and a hand-written list would silently drop
 * any action added after it was written — the failure this section exists to
 * prevent, since an unlisted action is an unrebindable one.
 *
 * Placement is a lookup, and anything the lookup does not answer lands in
 * `other` rather than vanishing. `shortcut-groups.test.ts` asserts `other` is
 * empty, so adding an action to the registry without placing it fails a test
 * instead of shipping a row under a meaningless heading.
 */
import {
  ACTION_REGISTRY,
  type ActionDefinition,
  type ActionId,
} from '../../terminal/action-registry';

export type ShortcutGroupId =
  'panes' | 'tabs' | 'presets' | 'files' | 'text' | 'scrollback' | 'display' | 'app' | 'other';

/** Display order of the groups, with the label each renders under (DL-11.4). */
export const SHORTCUT_GROUPS: readonly {
  readonly id: ShortcutGroupId;
  readonly label: string;
}[] = [
  { id: 'panes', label: 'Panes' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'presets', label: 'Layout presets' },
  { id: 'files', label: 'Files' },
  { id: 'text', label: 'Text & search' },
  { id: 'scrollback', label: 'Scrollback' },
  { id: 'display', label: 'Display' },
  { id: 'app', label: 'App' },
  { id: 'other', label: 'Other' },
];

const PLACEMENT: Readonly<Record<string, ShortcutGroupId>> = {
  'split-row': 'panes',
  'split-column': 'panes',
  'close-pane': 'panes',
  'toggle-zoom-pane': 'panes',
  'toggle-expand': 'panes',
  'move-pane-to-new-window': 'panes',
  'focus-next': 'panes',
  'focus-prev': 'panes',
  'focus-left': 'panes',
  'focus-right': 'panes',
  'focus-up': 'panes',
  'focus-down': 'panes',
  'swap-left': 'panes',
  'swap-right': 'panes',
  'swap-up': 'panes',
  'swap-down': 'panes',

  'new-tab': 'tabs',
  'reopen-tab': 'tabs',
  'close-tab': 'tabs',
  'next-tab': 'tabs',
  'prev-tab': 'tabs',
  'select-last-tab': 'tabs',

  'new-preset': 'presets',
  'save-preset': 'presets',

  // Own group, not "app": it acts on file-tab CONTENT (the open file), the
  // same kind of target "text" below has (the terminal buffer) — not a
  // window-surface toggle like the "app" group's toggle-explorer/
  // toggle-browser/toggle-usage rows.
  'save-file': 'files',

  find: 'text',
  'find-next': 'text',
  'find-previous': 'text',
  'clear-buffer': 'text',
  'copy-selection': 'text',
  'copy-cwd': 'text',
  paste: 'text',

  'scroll-page-up': 'scrollback',
  'scroll-page-down': 'scrollback',
  'scroll-to-top': 'scrollback',
  'scroll-to-bottom': 'scrollback',

  'zoom-in': 'display',
  'zoom-out': 'display',
  'zoom-reset': 'display',

  'toggle-settings': 'app',
  'toggle-prompts': 'app',
  // "app", not "panes": the panel is a surface of the window like Settings and
  // the Prompt Board, not something that acts on the focused pane.
  'toggle-browser': 'app',
  'toggle-dock': 'app',
  'toggle-explorer': 'app',
  'toggle-usage': 'app',
  'focus-next-attention': 'app',
};

/**
 * Registry actions that get NO row, because no keyboard chord could run them.
 *
 * `check-for-updates` and `open-release-notes` are handled by `app.tsx`'s
 * `menu:action` listener via `isUpdateMenuAction`, not by `dispatchAction`'s
 * command table — so a chord matched by `handleShortcut` reaches
 * `dispatchAction` and falls off the end as a silent no-op. Offering an
 * editable pill for them meant the row could display ⌘⇧U while ⌘⇧U did
 * nothing, forever.
 *
 * Removing the row loses nothing: both are still on the macOS App menu, and
 * both have their own button in the Settings about section.
 *
 * `shortcut-groups.test.ts` asserts this set is exactly the registry actions
 * `DISPATCHABLE_ACTIONS` does not contain, so an action that becomes
 * dispatchable later cannot stay silently excluded.
 */
export const NOT_REBINDABLE: ReadonlySet<string> = new Set([
  'check-for-updates',
  'open-release-notes',
]);

/**
 * `select-tab-1`..`select-tab-8` carry no registry row — they are a
 * parameterized family with no menu item and no fixed label (see
 * `ActionId`'s own comment). They are still rebindable, so the section
 * synthesizes their rows here, right after `select-last-tab` in the same
 * group.
 */
export const TAB_SELECT_COUNT = 8;

export interface ShortcutRow {
  readonly action: ActionId;
  /** Display name — the registry's label, or a synthesized one for the family. */
  readonly label: string;
}

export interface ShortcutGroup {
  readonly id: ShortcutGroupId;
  readonly label: string;
  readonly rows: readonly ShortcutRow[];
}

function tabSelectRows(): readonly ShortcutRow[] {
  return Array.from({ length: TAB_SELECT_COUNT }, (_, index) => ({
    action: `select-tab-${index + 1}` as ActionId,
    label: `Select Tab ${index + 1}`,
  }));
}

/** Groups in display order, each holding its rows in registry order. */
export function shortcutGroups(): readonly ShortcutGroup[] {
  const byGroup = new Map<ShortcutGroupId, ShortcutRow[]>();
  for (const group of SHORTCUT_GROUPS) {
    byGroup.set(group.id, []);
  }
  for (const action of ACTION_REGISTRY as readonly ActionDefinition[]) {
    if (NOT_REBINDABLE.has(action.id)) {
      continue;
    }
    const target = PLACEMENT[action.id] ?? 'other';
    byGroup.get(target)?.push({ action: action.id as ActionId, label: action.label });
    if (action.id === 'select-last-tab') {
      byGroup.get(target)?.push(...tabSelectRows());
    }
  }
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    rows: byGroup.get(group.id) ?? [],
  })).filter((group) => group.rows.length > 0);
}
