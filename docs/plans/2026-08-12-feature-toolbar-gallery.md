# Feature toolbar — gallery pass

Date: 2026-08-12 · Scope: the demo surface only, per
[design](../specs/2026-08-12-feature-toolbar-design.md) `building`.

## Boundary for this pass

The owner asked for the gallery preview first, and the design makes that preview a
precondition for changing shipping UI. So this pass builds the real toolbar components
and mounts them on `gallery.html`, and touches nothing that changes app behaviour:

- `ACTION_REGISTRY`, both keymaps and the generated native menu stay untouched. Adding
  `toggle-explorer` (and removing the Windows `toggle-expand` chord it collides with)
  would land a live shortcut in the feature-frozen Tauri app, which the design's own
  "Not done" list forbids.
- [`ChromeActions`](../../src/ui/chrome-actions.tsx) `current` keeps rendering the tab
  bar. The toolbar replaces it only after the preview is approved.
- Explorer, Browser and Usage therefore appear as **gallery fixtures**, which the design
  already allows: they demonstrate states and never drive the app.

## Steps

1. **`formatKeyChord`** in [`shortcut-label.ts`](../../src/lib/shortcut-label.ts):
   `formatShortcutBinding` currently needs a full `KeyBinding`, which carries an
   `ActionId`. Split the modifier/key formatting out so a fixture chord can be formatted
   through the same code path instead of a hardcoded `⌘⇧E` string.
2. **`src/ui/toolbar/toolbar-item.ts`** — presentation metadata only: group, icon,
   overflow order, state, shortcut string. No command behaviour, no product state.
3. **`src/ui/toolbar/toolbar-overflow.ts`** — pure `fitToolbarItems(items, width)`:
   drops overflow candidates in the design's order until the row fits, and reports which
   separators survive. Pure so it is unit-testable without a layout engine.
4. **`src/ui/controls/action-tooltip.tsx`** — hover **and** focus tooltip: label left,
   `kbd` chord right when the platform has one, reason text when unavailable. Fixed
   positioning off the trigger rect so a bar with clipping cannot eat it.
5. **`src/ui/toolbar/feature-toolbar.tsx`** — groups, hairlines, `More`, `ResizeObserver`
   feeding step 3. Unavailable actions use `aria-disabled` and stay focusable so the
   reason is discoverable; they do not run.
6. **`src/ui/toolbar/toolbar-overflow-menu.tsx`** — the `More` surface as DL-13 rows.
7. **CSS** appended to `src/styles.css`, reusing `.iconbtn` and `.tabbar__sep`.
8. **Tests**: overflow fitting (pure), toolbar rendering/tooltip/unavailable behaviour.
9. **Gallery**: `src/gallery/sections/toolbar-section.tsx` + one `section-registry.ts`
   entry, with a macOS/Windows switch so the chord text can be checked on both.

## Done for this pass

The design's §5 list, minus everything that needs shipping wiring: every group, overflow
at minimum width, an active tool, an action with no shortcut, an unavailable action with
its reason, hover and focus showing the same tooltip, `Cmd+Shift+E` / `Ctrl+Shift+E` for
Explorer, and no gallery module in the app bundle.

Gate: `npm test && npm run build && npm run generate:menu:check`, plus a screenshot of
`npm run prototype:gallery` for the owner's eye-review.

## Deferred to the shipping pass

Registering the three tool actions, the Windows `toggle-expand` rebind, replacing
`ChromeActions`, native menu entries, a numbered DL rule for tooltips and the overflow
surface, and the Explorer/Browser/Usage implementations themselves.

Known gaps left open on purpose, each one shipping-pass work:

- The overflow surface is `role="menu"` without arrow-key navigation. An ARIA menu
  implies roving focus; today it is a tab-through list, which is honest but incomplete.
- The update pill's width is measured when the toolbar resizes, not when the pill's own
  phase changes it. A phase change that widens the pill inside a stable window will not
  re-run the fit until the next resize.
- Tooltip and menu are `position: fixed` off a measured rect, so a scroll of their
  container leaves them behind. App chrome does not scroll; the gallery does, which is
  where this is visible.

## Owner questions

- Tooltip labels come from `ACTION_REGISTRY`, which holds macOS **menu** labels: "Close
  Pane", "Focus Expand", "Split Vertically". Chrome copy elsewhere is sentence case
  (DL-4.4 for rows, and `ChromeActions` writes "Split vertically" today). Either the
  registry grows a separate chrome label or the menu label is the one name — a copy
  decision, not a code one.
- An unavailable control is `--text-faint`, the design language's answer for disabled
  states (DL-3.4). In the shipped themes that is a small step from `--text-muted`, so
  the state is quiet. Making it louder means changing a token relationship every
  disabled control in the app shares — a design-language fork.
