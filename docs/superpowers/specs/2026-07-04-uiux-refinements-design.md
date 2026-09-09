# UI/UX Refinements: Window Chrome, Tab Bar, Pane Bar, Theme Colors

**Date:** 2026-07-04
**Status:** Checkpoint — approved so far, further adjustments expected
**Demos:** `tabbar-mockups.html` and `color-demo.html` (scratchpad, served on localhost:4321 during the brainstorm)

## Problems

1. **Double-click on the top bar does not maximize the window.** With
   `titleBarStyle: Overlay` the native macOS title bar is gone, so the standard
   double-click-to-zoom behavior is lost. `data-tauri-drag-region` only handles
   dragging, not double-click zoom.
2. **The tab bar wastes vertical space and distracts.** 44px tall, with a
   crowded action cluster (split ×2, close pane, expand, theme swatch, gear)
   sharing one row with the traffic lights.
3. **Chrome colors break when the theme changes.** Chrome tones are derived by
   mixing the theme background with a fixed `white` percentage, and muted text
   uses fixed mix ratios (52% / 34%) with no contrast floor. On several
   presets the muted/faint text already fails readability (Tokyo Night:
   text-muted 3.55:1, text-faint 2.16:1), and a light background override
   breaks the chrome completely.

## Decisions (approved on demos)

### 1. Window chrome: two rows

- **Row 1 — title bar (~26px):** traffic lights only. Full-width Tauri drag
  region. Background = terminal background (`--bg`), no border.
  **Double-click toggles maximize** (`dblclick` on the drag region →
  `getCurrentWindow().toggleMaximize()`), restoring the native macOS zoom
  behavior.
- **Row 2 — tab bar (33px):** tabs start at the left edge, then the `+`
  button. Right side: pane action icons (split vertical, split horizontal,
  close pane, focus expand) at **13px glyph size** in 24px buttons, a hairline
  separator, then the settings gear. The theme swatch is removed from the bar
  (theme changes live in the settings panel).

### 2. Pane bar: info-only, hidden by default

- The per-pane header no longer hosts action buttons — actions live in the tab
  bar row and keyboard shortcuts (⌘D, ⌘⇧D, ⌘⇧W, ⌘E).
- When shown, the pane bar displays info only: process dot, cwd, git branch,
  agent badge.
- **Toggle lives in the settings panel; default is hidden.**
- When hidden, hovering the top ~26px of a pane reveals a small centered
  **anchor pill** (grip dots + cwd) that fades/slides in. The anchor is the
  drag handle for pane drag-dock (replaces dragging the pane bar).
- **Settings:** new boolean `showPaneBar` in `Settings`
  (`settings-schema.ts` + `validateSettings` + `DEFAULT_SETTINGS`, default
  `false`). `pane.ts` keeps building the bar and populating its info (cwd is
  still read by the drag ghost and the anchor) — visibility is CSS-only via a
  class on the pane container driven by `applySettings`.
- **Drag hit-target:** `pane-drag.ts` currently starts a drag only from
  `.pane__bar` (`el.closest(".pane__bar")`). It changes to accept both
  `.pane__bar` (when shown) and the new `.pane__anchor` element, which
  `pane.ts` renders inside a hover zone at the top of each pane. Ghost label
  keeps reading the cwd text.

### 3. Tab options popover

- Left-clicking the **active** tab opens a popover anchored under the tab
  (clicking an inactive tab just selects it).
- Popover contents:
  - **Rename** — text input, Enter commits, Escape cancels. A custom name
    overrides the process-derived label until cleared.
  - **Dot color** — row of preset swatches (theme accent colors); overrides
    the process-derived dot color.
- Clicking anywhere outside closes the popover.
- **State (override model):** `TabView` gains optional `name` and `dotColor`.
  Overrides live in the tab manager keyed by tab key; `syncViews` (which
  rebuilds `tabViews` from the process poll every 2s) merges overrides on top
  of process-derived values — so a rename survives polling. Clearing an
  override falls back to the process-derived label/color.
- **Persistence:** `SessionTab` (`session-schema.ts`) gains optional `name`
  and `dotColor`; `validateSession` and `buildSessionData` are extended.
  Because tab keys regenerate per launch, overrides are restored by tab
  order/index, not by key.
- **Shortcut guard:** the global capture-phase `handleShortcut` in
  `tab-manager.ts` ignores events whose target is an input/textarea (same
  approach as the existing IME guard), so ⌘-combos don't fire while typing in
  the rename field.

### 4. Theme-derived color system (app-wide standard)

All chrome UI (tab bar, status bar, pane bar, settings panel, popovers,
anchors, inputs) derives from the terminal theme. **No hardcoded chrome
colors.** Derivation rules:

- **Tone direction by background luminance:** if `luminance(bg) < 0.45` mix
  toward white, otherwise toward black.
- **Surface tokens** (mix of `--bg` toward tone):
  - `--chrome-1` (bars): 4%
  - `--chrome-2` (panels, popovers): 7%
  - tab active background: 15%
  - input background: 12% on dark themes, 6% on light themes (kept soft;
    readability comes from the `--text-primary` floor, not a bright surface)
- **Hairlines:** `--hair` = fg 12% over bg, `--hair-strong` = fg 20%.
- **Text tokens with contrast floors (WCAG-checked):**
  - `--text-primary` (chrome body text: input/select values, active tab label):
    start at raw fg, raise toward tone until **≥ 4.5:1** against both
    `--input-bg` and `--chrome-2`. Chrome never uses raw `--fg` directly —
    a low-contrast fg override (e.g. fg #565f89 on bg #1a1b26 gives 1.02:1 on
    inputs) must not sink the chrome.
  - `--text-muted`: start at fg 52% mix, raise toward tone until **≥ 4.5:1**
    against `--chrome-1`
  - `--text-faint`: start at fg 34% mix, raise toward tone until **≥ 3:1**
    against `--chrome-1`
- General rule: every text token is contrast-checked against the surface it
  sits on. These floors are the **standard for all current and future UI** in
  the app.

Implementation note: the contrast enforcement needs color math in JS (compute
derived hex values in `app.tsx` / a new `lib/derive-colors.ts` and set them as
CSS custom properties), replacing the pure-CSS `color-mix()` approach for the
text tokens. Surface tokens may stay as `color-mix()` with a JS-provided tone
variable, or be computed in JS alongside — decided at implementation time.

**Migration scope:** the token switch must cover *every* hardcoded-white mix
and raw-`--fg` usage in `styles.css`, not just the four spec tokens. Known
consumers to migrate: `.tab.is-active`, `.theme-chip`, `.select`/`.text-input`,
`.stepper`, `.segmented` (all mix `--bg` with literal `white`), plus the
chrome rules that use `var(--fg)` directly for text. The implementation plan
enumerates them with a repo-wide grep for `, white)` and `var(--fg)` in
`styles.css` so light-background themes cannot break any surface.

## Out of scope (this round)

- Status bar content/layout (unchanged apart from inheriting the new tokens).
- Keyboard shortcut for the pane-bar toggle (settings-only for now).
- Tab reordering, tab drag & drop.

## Resolved during spec review

- Per-tab overrides: state + merge model defined in §3 (was an open item).
- Persistence: `SessionTab` extension defined in §3 (was an open item).
- Cycle theme after removing the swatch: settings panel only; the
  `onCycleTheme` prop and `cycleTheme` helper are removed from the tab bar.

## Open items for the next adjustment pass

- Exact popover visuals/behavior polish (e.g. clear-override affordances).

## Testing

- Unit: `derive-colors` (luminance, contrast ratio, floor enforcement — table
  of all presets plus light/low-contrast overrides must pass the floors).
- Unit: tab rename/color override reducers in `tabs-store`.
- Manual (Tauri dev): double-click zoom on row 1; drag window from both rows;
  pane drag via hover anchor; popover open/close/rename/recolor; theme cycling
  through all presets watching contrast; settings toggle for pane bar.
