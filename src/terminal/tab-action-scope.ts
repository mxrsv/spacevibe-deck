import { ACTION_REGISTRY, type ActionDefinition, type OverlayTier } from './action-registry';
import { MACOS_KEYMAP, WINDOWS_KEYMAP, type ShortcutAction } from './keymap';

/**
 * `action.scope` per id, from the single source of truth
 * (`src/terminal/action-registry.ts`) instead of a hardcoded list — read by
 * `overlayBlocksAction` below. Module-level: the registry is static, so this
 * is computed once per module load, not once per `createTabManager` call.
 */
export const ACTION_SCOPE: ReadonlyMap<string, OverlayTier | 'always'> = new Map(
  ACTION_REGISTRY.map((action) => [action.id, action.scope] as const),
);

/**
 * Ids with `destructive: true` in the registry — read by `runAction` below.
 * See `ActionDefinition.destructive`'s doc comment (action-registry.ts) for
 * the full reasoning (F-B1/F-B2, 2026-07-27 code review).
 */
export const DESTRUCTIVE_ACTIONS: ReadonlySet<string> = new Set(
  ACTION_REGISTRY.filter((action: ActionDefinition) => action.destructive === true).map(
    (action) => action.id,
  ),
);

/**
 * The ids `commands` implements — 45 entries, verified against the live
 * `commands` table, Task 4's `copy-selection`/`paste` included, the Prompt
 * Board's `toggle-prompts`, the browser surface's `toggle-browser`, and the
 * dock's `toggle-dock`/`toggle-explorer`/`toggle-usage`/`save-file`
 * alongside them. (Line numbers are deliberately not cited:
 * they rotted within one feature of being written.)
 *
 * Declared at module scope so `dispatch-coverage.test.ts` can assert that no
 * keymap binding points at an action nothing dispatches — the defect behind
 * prior review H1 and pre-ship audit A4, which a keymap-only test cannot see.
 */
export const COMMAND_ACTIONS = [
  'clear-buffer',
  'close-pane',
  'close-tab',
  'copy-cwd',
  'copy-selection',
  'find',
  'find-next',
  'find-previous',
  'focus-down',
  'focus-left',
  'focus-next',
  'focus-next-attention',
  'focus-prev',
  'focus-right',
  'focus-up',
  'move-pane-to-new-window',
  'new-preset',
  'new-tab',
  'next-tab',
  'paste',
  'prev-tab',
  'reopen-tab',
  'save-file',
  'save-preset',
  'scroll-page-down',
  'scroll-page-up',
  'scroll-to-bottom',
  'scroll-to-top',
  'split-column',
  'split-row',
  'swap-down',
  'swap-left',
  'swap-right',
  'swap-up',
  'toggle-browser',
  'toggle-dock',
  'toggle-expand',
  'toggle-explorer',
  'toggle-prompts',
  'toggle-settings',
  'toggle-usage',
  'toggle-zoom-pane',
  'zoom-in',
  'zoom-out',
  'zoom-reset',
] as const satisfies readonly ShortcutAction[];

/**
 * Every action `dispatchAction` can actually run: `COMMAND_ACTIONS` plus the
 * ids it resolves inline, before consulting the table — `select-last-tab` and
 * the `select-tab-N` family, both handled by the `selectTabIndex` branch.
 *
 * `select-tab-N` membership is read straight off `MACOS_KEYMAP`/
 * `WINDOWS_KEYMAP`, not hand-listed 1..8: `ACTION_REGISTRY` deliberately
 * carries no `select-tab-N` rows at all (see its own doc comment, just above
 * `ActionId`), so mapping its ids can never produce one — confirmed by
 * `npx tsc --noEmit` rejecting that exact approach (the mapped id union never
 * includes the `select-tab-${number}` literal `ShortcutAction` allows) and by
 * the filter matching zero entries at runtime.
 *
 * IMPORTANT, read before trusting this set for that family: mirroring
 * `select-tab-N` off the SAME two keymaps `dispatch-coverage.test.ts` iterates
 * makes that test TAUTOLOGICAL for this family — "is this keymap action
 * dispatchable" is true by construction, regardless of what `dispatchAction`
 * actually does with it. If a future change removes or breaks the
 * `selectTabIndex(action) !== null` early-return in `dispatchAction` below,
 * every `select-tab-N` chord would silently stop switching tabs (H1/A4's
 * exact failure mode) and `dispatch-coverage.test.ts` would stay green
 * throughout, because its target set was copied from the same data under
 * test, not from `dispatchAction`'s real behavior. The direct test
 * "dispatches a select-tab-N chord to actually switch tabs" in
 * `tab-manager.materialize.test.ts` (not `dispatch-coverage.test.ts`) is what actually
 * covers this family — it drives a real chord through `handleShortcut` and
 * asserts the tab genuinely changed, so it fails if that early-return ever
 * breaks. `COMMAND_ACTIONS` above has no such gap: every one of its ids is
 * matched against the real `commands` table, an independent data source.
 *
 * Declared at module scope so `dispatch-coverage.test.ts` can assert that no
 * keymap binding points at an action nothing dispatches — the defect behind
 * prior review H1 and pre-ship audit A4, which a keymap-only test cannot see.
 */
export const DISPATCHABLE_ACTIONS: ReadonlySet<ShortcutAction> = new Set<ShortcutAction>([
  ...COMMAND_ACTIONS,
  'select-last-tab',
  ...[...MACOS_KEYMAP, ...WINDOWS_KEYMAP]
    .map((binding) => binding.action)
    .filter((action) => /^select-tab-\d+$/.test(action)),
]);
