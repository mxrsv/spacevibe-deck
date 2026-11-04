# UI recipes and the ratchet

Status: `decided` (owner, 2026-11-04 to 2026-11-05, through an intent round and two grilling
rounds). The visual standard is the multi-file mock
[`src/gallery/layout-mocks/ui-recipes/`](../../src/gallery/layout-mocks/ui-recipes/index.html)
(entry `index.html` with nine tabs, token layer `tokens.css`, recipes `chrome.css`), approved by eye;
the binding record of every decision is `DECISIONS.md` in the same folder. The working mark is the
braille spinner and the shadow strength is mid, both picked by eye on 2026-11-05.

This spec extends the [UI composition spec](2026-11-03-ui-composition.md) (CMP-1 to CMP-20). Where
the two differ, this spec wins for the items it names, and where an `RCP-n` rule names a value it
takes precedence over the preset's own, as a `CMP-n` value does. Where the mock and
[`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) disagree on anything this spec does not name, the DL
wins: the mock's grayscale logo dim, its `brightness()` backdrop and its `box-shadow` transitions do
not ship, so a remembered row's or an unpicked tile's logo dims by opacity alone. Dark means
graphite and light means Deck Light ([built-in themes](../../src/settings/built-in-themes.ts));
every other theme publishes the same tokens from its own roles.

## Problem

Deck draws the same thing several ways. Hover, selection, pressed, row heights, corners and depth
are restated per surface: the new shell's Tailwind blocks, the legacy stylesheets that CMP-19 moved
onto the scale, and the preset controls each carry their own recipe, and a surface migrated halfway
carries two. The preset controls still draw weight 500 and `shadow-md` popups, the shell's state
mark spins a ring while the worktree card shows a braille spinner, and the dock's Changes tree
paints a 2px focus ring.

The gates that exist hold few of these. The CSS gate fails on a font size under 12px, a focus
outline outside a text field and a divider line; the `.tsx` gate fails only on small text and
hand-drawn chips. Nothing fails on an off-scale radius, height, spacing value, weight, shadow or
state colour, or on a new Phosphor import outside the cut-over set.

The CMP-20 exemption also leaks. The CSS gate skips the old rail's and old dock's partials, yet they
still style classes that live surfaces render: `.rail-create` and `.nt-primary-action` in
`04f-rail-create-row.css` (the project rail and the launcher forms), and `.dock-panel`,
`.file-panel` and `.file-tree-shell__status` in `14-dock.css` (the agent dock). Those classes escape
every check.

## Requirements

### Tokens

- **RCP-1 One token per recipe.** Size, radius, spacing, row height, hover, focus, selected,
  pressed, disabled, lines, elevation, type and weight each have one recipe, declared once in
  [`01-tokens.css`](../../src/styles/01-tokens.css) and read through `var()` in a stylesheet or a
  token reference in a class (`h-(--row-32)`). Names follow the mock's `tokens.css`: Deck's existing
  names stay (`--state-hover-bg`, `--tab-active-bg`, `--tab-rest-bg`, the `--radius-*` roles,
  `--duration`, `--ease`, `--tone`, `--chrome-1`, `--chrome-2`, `--sidebar-bg`, `--input-bg`,
  `--seam-raised`, `--control-frame`), and a new name exists only where the mock added one. The
  mock's own scaffolding does not ship: window, menu, popover, modal, launcher, tooltip and settings
  widths, `--window-radius`, `--lights-d`, `--traffic-*`, `--term-*`, `--scrim-filter`,
  `--logo-mono-filter` and the `-soft` / `-strong` elevation variants.
- **RCP-2 Per-theme values.** A token is declared per theme where its value differs. State washes
  mix from `--tone` (white on dark, black on light), so they flip with the theme:
  - `--state-hover-bg` is 6% and `--tab-rest-bg` 3% of `--tone`;
  - `--tab-active-bg` stays derived as today ([`derive-colors.ts`](../../src/lib/derive-colors.ts)),
    and `--tab-active-focus-bg` is that wash mixed 10% toward `--fg` (DL-21.1);
  - the new grounds derive the same way: `--chrome-3` one step above `--chrome-2`; `--popover-bg`
    is `--sidebar-bg` on dark and white on light, so hover stays under selected inside a menu;
    `--card-bg` is `--chrome-1` on dark and `--bg` on light; `--well-bg` one step below the stage
    on dark and white on light; `--selection-bg` the theme's terminal selection.

  The mock's hex values are what graphite and Deck Light yield, not literals to copy.

### Sizes and type

- **RCP-3 Controls.** Heights 28, 32, 36 and 40 (`--control-h-28` to `--control-h-40`), radius 4,
  4, 6 and 6, horizontal padding 8, 12, 14 and 16 (`--control-pad-28` to `--control-pad-40`).
  Primary is filled; secondary is framed in `--control-frame` (`--control-frame-hover` on hover);
  ghost is bare; danger sits on `--danger-bg` (`--danger-bg-hover`) with `--ink-fail` text.
  - **Splits:** the two halves sit 2 apart. A button split's caret half pads 10. An icon split is a
    28 icon box and a 20-wide caret half carrying a 12 glyph.
  - **Command bar:** one 40 frame holding 32 controls, and the frame, not the input inside it,
    takes the focus ring. Its contents are LCH-5's
    ([launcher spec](2026-11-04-launcher-in-stage.md)).
- **RCP-4 Chip, badge, icon box, avatar.**
  - **Chip:** 24 or 20 (`--chip-h-24`, `--chip-h-20`), radius 4 or 3, padding 8 or 6
    (`--chip-pad-24`, `--chip-pad-20`), 12px text, pressable, no fill until hover.
  - **Badge:** 20 high (`--badge-h`) and at least as wide, a pill, padding 8 (`--badge-pad`), 12px
    at 600, read only. A status badge sits on `--state-needs-you-bg` or `--danger-bg` with ink
    text (RCP-10).
  - **Icon box:** 28, 24 or 20 square (`--icon-box-28`, `--icon-box-24`, `--icon-box-20`), radius
    4, 4 or 3, no fill until hover, holding a glyph of 16, 14 or 12 (`--icon-16`, `--icon-14`,
    `--icon-12`). The 20 box offers a 24 hit area.
  - **Glyph size follows the box.** A Hugeicons glyph's `size` prop admits only 12, 14 and 16
    (`DeckGlyphSize` in [`deck-icon.tsx`](../../src/ui/controls/deck-icon.tsx)), so any other size
    fails the typecheck. The Phosphor sizes 13 and 15 (`DeckIconSize`) leave with the last
    Phosphor import.
  - **Avatar:** a 24 box at radius 4 on `--tab-rest-bg` with the `--control-frame` hairline, two
    initials at 12px and 600, or one glyph at 400 when the first grapheme is wide (CJK, emoji).
- **RCP-5 Type and weight.**
  - **Sizes:** 16 for a dialog title (`--type-dialog`, new); 14 for buttons, inputs, labels and
    row titles (`--type-title`, `--type-body`, `--type-project`); 12 for chips, badges and metadata
    (`--type-meta`, with `--type-micro` kept at 12).
  - **Line heights:** 24, 20 and 16 (`--leading-dialog`, `--leading-body`, `--leading-meta`).
  - **Weights:** 400 (`--weight-regular`) and 600 (`--weight-strong`) only, never 500.
  - **Limits:** nothing is below 12. Terminal text and DL-4.5's closed list of exceptions stay
    outside the scale, and DL-4.6's Windows ledger still maps the two weights for Segoe UI.
- **RCP-6 Spacing.** The values are 0, 2, 4, 6, 8, 10, 12, 16 and 24 (`--space-0` to
  `--space-24`), used by role:

  | Role                       | Value                                 | Token                                             |
  | -------------------------- | ------------------------------------- | ------------------------------------------------- |
  | icon ↔ label               | 6                                     | `--space-icon-label`                              |
  | control horizontal padding | 8 / 12 / 14 / 16 at 28 / 32 / 36 / 40 | `--control-pad-28` to `--control-pad-40`          |
  | row horizontal padding     | 8                                     | `--space-pad-row`                                 |
  | inside a group             | 4 / 6 / 8                             | `--space-in-sm`, `--space-in-md`, `--space-in-lg` |
  | between groups             | 12 / 16                               | `--space-group-sm`, `--space-group-md`            |
  | between sections           | 24                                    | `--space-section`                                 |
  | between list rows          | 2                                     | `--space-list`                                    |

  Functional geometry stays outside the scale with named tokens of its own (CMP-15): hairlines
  (`--seam-w`), the tree indent (`--tree-indent`, 12), the frame, notice and status heights, the
  mark slot, the resize gutter, the fixed row end cell and the 36 control's 14 padding.
- **RCP-7 Row and bar heights.**
  - **Rows:** 24 for a dense list (Changes, the file tree, a card head, a section label,
    breadcrumbs); 32 for a menu item, a project header, a pane header or a one-line row; 44 for a
    two-line rail row (`--row-24`, `--row-32`, `--row-44`). Live and remembered rail rows are both
    44, and a setting row is at least 44.
  - **Bars:** 36 for a toolbar, search row or footer; 34 when the bar sits in the frame row
    (`--frame-h`); 40 as a view header band. A surface does not set its own bar height.
- **RCP-8 Radius roles.** DL-20.1's roles, unchanged:
  - `--radius-flat` 2: a control packed in a dense row, a meter;
  - `--radius-tight` 3: marks, bars, scrollbar thumbs, the 20 chip and the 20 icon box;
  - `--radius-tab` 4: strip tabs, view buttons, panes, cards;
  - `--radius-control` 4: rows, the 24 chip, the 28 and 24 icon boxes, controls 28 and 32;
  - `--radius-surface` 7: menu, popover, tooltip, floating panel, modal.

  A control 36 or 40 high takes the literal `6px` that DL-20.1 names; the mock's
  `--radius-control-lg` alias does not ship. `50%` and the pill (`--radius-pill`: badge, kbd,
  switch) are shapes.

### States

- **RCP-9 States.** One cascade for everything pressable, weakest first: hover equals keyboard
  focus, then selected, then selected with focus, then pressed. A state change never shifts layout
  and runs in `--duration` / `--ease`.
  - **Hover:** `--state-hover-bg`, background only.
  - **At rest:** no wash, except a strip tab (DL-21.7) and a panel footer on `--tab-rest-bg`.
  - **Selected:** `--tab-active-bg`, a full wash with no bar or border.
  - **Selected with keyboard focus:** `--tab-active-focus-bg`, one step stronger.
  - **Pressed:** `--state-pressed-bg`, black at 8% laid over the surface as a background layer, so
    a selected item keeps its wash beneath it; the same in both themes. A filled primary steps its
    own fill instead (`--primary-hover`, `--primary-pressed`).
  - **Disabled:** 50% opacity (`--state-disabled-opacity`), with no hover.
  - **Drag-over:** `--state-dragover-bg`, `--accent` at 18% on dark and 14% on light.
  - **Needs you:** `--state-needs-you-bg` (`--status-unread` at 14%) under the other states, with
    the title at 600.
  - **Focus ring:** only a text input has one (CMP-9): 3px outside it (`--ring-w`) in
    `--focus-ring` (`--fg` at 14%), with the border turning `--focus-border` (the muted text
    colour). Every other control shows keyboard focus as its hover (CMP-11).
- **RCP-10 Status ink and text on washes.** Text in a status hue uses `--ink-need`, `--ink-fail` or
  `--ink-ok`: the hue mixed (lab) toward `--text-primary` by the least amount that holds 4.5:1 on
  every surface and tint it sits on. Marks, dots and bars keep the pure hue (`--status-unread`,
  `--status-failed`, `--status-ok`). On the selected and drag-over washes:
  - fail text switches to `--ink-fail-wash`, a 50% mix on dark, where the 70% mix drops under
    4.5:1, and the same ink as `--ink-fail` on light;
  - faint text steps up to muted, and kbd and avatar text step up to primary, so every text keeps
    4.5:1 on both washes.

### Depth and lines

- **RCP-11 Elevation.** Three levels at mid strength, written only through the tokens:

  | Token      | Used on                                              | Dark                          | Light                           |
  | ---------- | ---------------------------------------------------- | ----------------------------- | ------------------------------- |
  | `--elev-1` | menu, popover, tooltip                               | `0 8px 24px rgba(0,0,0,0.42)` | `0 6px 20px rgba(16,20,26,0.16)` |
  | `--elev-2` | floating panel: the launcher over a space, slide-over | `0 16px 48px rgba(0,0,0,0.5)` | `0 14px 44px rgba(16,20,26,0.2)` |
  | `--elev-3` | modal                                                | `0 24px 64px rgba(0,0,0,0.58)` | `0 22px 60px rgba(16,20,26,0.24)` |

  - **Dark themes** add a 1px inset hairline to each level, `--elev-edge` (`--tone` at 8%).
  - **Light themes** are shadow only; a light floating panel and modal carry a 1px `--panel-frame`
    (`--seam-raised`) instead.
  - **Limits:** static, never transitioned or animated; floating elements only. The rail, stage
    and dock, and any repeated row or cell, get none.
  - **Preset popups** wear these tokens in place of the preset's `shadow-md` and `ring-1`.
- **RCP-12 Lines.** No divider lines (CMP-14). Groups separate by spacing: 8 between groups in a
  menu, 8 between groups in a bar. The rail row, checkout, dock file and profile menus drop their
  separators for that gap. Two lines stay:
  - a menu's 1px separator (`--menu-sep`) between a list that scrolls and the fixed actions under
    it;
  - a floating panel's frame (RCP-11).

  A panel footer separates by its resting wash, not a line, and a framed control's
  `--control-frame` is a frame, not a divider. The kept lines `composition-rules.test.ts` already
  lists stay as they are.

### Keys, icons and marks

- **RCP-13 Keyboard hints.** A shortcut is one badge per chord ("⌘O", not "⌘" and "O"): 20 high, a
  pill, 12px, `--text-muted`, never pressable. On a filled primary it reads `--primary-kbd-bg` and
  `--primary-kbd-fg`.
- **RCP-14 Icons.** Functional icons come from Hugeicons only (`@hugeicons/core-free-icons` through
  `DeckIcon`, stroke 2). No new `@phosphor-icons/react` import lands anywhere under `src/`; the
  existing ones are debt (RCP-26) and leave surface by surface.
- **RCP-15 State marks.** Every agent state mark sits in a 14 slot (`--mark-slot`) with DL-27.3's
  geometry: a 9 dot (`--mark-dot`), a 15 ring round the needs-you dot (`--mark-ring`) and a 7
  square for ended (`--mark-square`), drawn in a status token (`--status-unread`,
  `--status-failed`, `--status-working`, `--status-idle`), never a palette colour.
  - **Working is braille everywhere** a working state shows: the rail row, a strip tab, a pane
    header. Frames ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ at 80ms each, shown by opacity alone; under reduced motion it holds
    ⠹.
  - **Reuse:** it is the app's existing spinner (`CardMark` in
    [`worktree-card-row.tsx`](../../src/ui/worktree-card-row.tsx)), ten stacked frames, but each
    frame's dots are drawn by Deck rather than typed as characters, because the Windows monospace
    fallback may lack braille. If the frames are `<svg>`,
    [`icon-system.test.ts`](../../scripts/icon-system.test.ts) gains an `ALLOWED_SVG` entry for
    that file.
  - **Replaces:** the turning ring of
    [`AgentStateMark`](../../src/ui/blocks/agent-state-mark.tsx) and `WorkspaceSpinner` on the
    rail.

### Browser parts

- **RCP-16 Scrollbars and selection.** Declared once in the token layer. A scrollbar is a 6 thumb
  (`--scrollbar-w`) with no track at `--radius-tight`, painted only while the pointer is over its
  scroller, in `--scrollbar-thumb` (`--tone` at 20%) and `--scrollbar-thumb-hover` (32%); this
  replaces today's `--fg` mix. Text selection is `--selection-bg`.

### Surfaces

- **RCP-17 Rail width.** The rail keeps Deck's widths: 275 by default (`--sidebar-w`, with
  `--rail-w` an alias of it) and 200 at the minimum (`--rail-w-narrow`). At 200 the footer folds
  Tools to its icon.
- **RCP-18 Rail rows.**
  - **Leading mark:** the status mark leads the row in its 14 slot. A remembered row keeps the slot
    empty, so titles line up.
  - **End cell:** a remembered row ends in a fixed 32 cell (`--row-end-w`) where the age and the
    resume icon swap without moving anything. Ages print short: "yesterday" is "1d".
  - **Quiet:** a remembered row has no needs-you tint and no fail ink.
- **RCP-19 Row actions.** Hover actions overlay the row's end on an opaque ground, the surface with
  the row's own state on top, so a long title never shows through.
  - A folded project's count steps aside on hover and focus.
  - On a remembered row the actions sit before the age cell.
  - A checkout line ends without a `+` (DL-27.28).
- **RCP-20 Stage bar and pane header.**
  - **Tabs:** 28 high. The minimum width is the sum of the tab's parts plus a 40 title
    (`--tab-title-min`), so the title truncates first and never disappears. Close shows on keyboard
    focus as on hover. A preview tab's title is italic.
  - **Pane header:** 32, with the status as its mark plus the DL-27.2 word: Needs you, Working,
    Failed, Finished, Ready, Ended. The default action is one 24 "more"; the full cluster (split,
    expand, close) is the stage variant.
  - **Resize handle:** Deck's 4px pane gutter (`--resize-w`) paints `--ring` on hover, keyboard
    focus and drag, never the pressed black.
  - **Update action:** one 28 box capped at 200 (`--update-max-w`): available (primary),
    downloading (a framed status with a meter and %, not pressable), ready (primary).
- **RCP-21 Floating surfaces.**
  - **Menu:** 4 inset, 32 items 2 apart; a long list scrolls inside itself, about 6.5 rows tall.
  - **Tooltip:** no arrow, since Deck is flat; inverted (`--tooltip-bg` is `--fg`, `--tooltip-fg`
    is `--bg`), 12px, padding 6 by 10.
  - **Panel footer:** a 32 strip on `--tab-rest-bg`, a step in the ground.
  - **Modal:** padding 16, groups 16 apart, the title at 16 and 600, over `--scrim-bg`.
- **RCP-22 Dock cards and diff.** DOCK-10 of the [dock spec](2026-11-03-dock-tabbed-panel.md) owns
  the Changes behaviour; this is its recipe.
  - **Lines:** a changed line is its hue mixed 20% (lab) into the card (`--diff-add-bg`,
    `--diff-del-bg`); its gutter is a 15% mix (`--diff-add-gutter`, `--diff-del-gutter`) with the
    number in ink and a 3px bar (`--diff-bar-w`); context text is muted; a hunk line sits on
    `--diff-hunk-bg`.
  - **Card head:** 24, sticky, on the opaque card ground (`--card-bg`). The card clips with
    `overflow: clip`, so the head sticks to the stack's scroller. A card head folds but is never
    selected.
  - **Flash:** a card the list pane lands on flashes a 2px primary bar (`--flash-w`) on its leading
    edge, drawn above the sticky head.
- **RCP-23 Copy.** The surfaces this spec restyles carry no heading, eyebrow or helper sentence, and
  every string is English. A label change updates its `docs/user/` guide in the same commit.

### Ratchet

- **RCP-24 Two suites, one ledger.**
  [`composition-rules.test.ts`](../../src/styles/composition-rules.test.ts) gains the CSS checks of
  RCP-25 and [`ui-composition-gate.test.ts`](../../scripts/ui-composition-gate.test.ts) the `.tsx`
  checks of RCP-26.
  - **Ledger:** both count against
    [`ui-composition-debt.txt`](../../scripts/ui-composition-debt.txt), extended with the new rule
    names and CSS paths. One `path rule count` line per file and rule; a count only falls, a line
    at zero is removed, and a file not listed holds no hit.
  - **Existing checks:** the three CSS checks of today (size under 12, focus outline, divider line)
    stay at zero, and `small-text` and `chip-like` keep their rules.
  - **Scope:** the stylesheets the CSS suite reads today, and the `.tsx` files the gate scans plus
    `src/ui/controls/` for every new rule. The controls are where the preset's weights, shadows and
    rings live; `chip-like` still skips them, as the definition site of chips.
- **RCP-25 CSS checks.** In a scanned stylesheet:
  - **Radius:** `border-radius` reads a radius token, `0`, `50%`, the pill, or `6px` on a block 36
    to 40 high.
  - **Heights:** a `height`, `min-height` or `block-size` from 12 to 48px is 20, 24, 28, 32, 36, 40
    or 44, or a token. Longer lengths are layout.
  - **Spacing:** a px literal in `padding*`, `margin*`, `gap`, `row-gap` or `column-gap` is on
    RCP-6's scale (negatives included) or a token.
  - **Focus:** besides the outline check, a focus selector paints a `box-shadow` ring only on the
    text fields its list names.
  - **State backgrounds:** a `background`, `background-color` or `background-image` under
    `:hover`, `:active`, `:focus-visible`, `[aria-selected]`, `[aria-current]`, `[aria-pressed]` or
    an `is-*` state class reads an RCP-9 token, a filled control's own step (`--primary-hover`,
    `--primary-pressed`, `--danger-bg-hover`) or `--ring` on the resize gutter, or clears to
    `transparent` or `none`.
  - **Shadow:** a `box-shadow` with a blur radius is a single `--elev-*` token. A zero-blur shadow
    is a line and stays allowed: the 1px inset hairline, the CMP-9 focus ring, the DOCK-10 gutter
    bar. A rule that sets `--elev-*` never transitions or animates `box-shadow`.
  - **Weight:** a `font-weight`, or the weight in a `font` shorthand, is 400, 600, `normal`,
    `inherit` or a weight token. The Windows ledger
    ([`21-windows-weights.css`](../../src/styles/21-windows-weights.css)) is exempt, since it maps
    the authored weights for Segoe UI (DL-4.6).
- **RCP-26 `.tsx` checks.** In class strings, read the way the gate reads them today:
  - **Arbitrary values:** none on height, size, padding, margin, gap, radius, shadow or ring
    utilities (`h-[30px]`, `px-[7px]`, `rounded-[5px]`, `shadow-[...]`). A token reference
    (`h-(--row-32)`) passes, and layout utilities (width, inset, translate, grid templates, max
    sizes) may still take arbitrary values.
  - **Spacing steps:** a named spacing step off RCP-6's scale (`p-5`, `gap-7`) counts the same way;
    14 (`px-3.5`) passes only in the Button control.
  - **Weights:** only `font-normal` and `font-semibold`.
  - **Shadows:** only an `--elev-*` reference or `shadow-none`.
  - **Rings:** a ring utility under a focus variant appears only in the Input control
    ([`input.tsx`](../../src/ui/controls/input.tsx)); `dock-changes-tree.tsx`'s
    `focus-visible:ring-2` is the first debt entry. A popup's `ring-1` frame gives way to RCP-11.
  - **Phosphor:** each `@phosphor-icons/react` import counts as a `phosphor` hit, in `.ts` files
    too. `icon-system.test.ts` keeps its cut-over set, and a directory joins it when its count
    reaches zero.
- **RCP-27 Exceptions.** An off-scale value that must stay carries `ui-scale: <reason>`:
  `/* ui-scale: <reason> */` on the line above the declaration in CSS, `// ui-scale: <reason>` or
  `{/* ui-scale: <reason> */}` on the line above in `.tsx`. The hit then does not count. A
  `ui-scale:` with no reason fails both suites, and a change that adds one says so in its PR (R9).
- **RCP-28 CMP-20 partials.** The CMP-20 partials stay exempt, but before a surface's commit every
  live class they style moves to that surface's own stylesheet, where the checks see it. Known on
  2026-11-05: `.rail-create` and `.nt-primary-action` in `04f-rail-create-row.css`; `.dock-panel`,
  `.file-panel` and `.file-tree-shell__status` in `14-dock.css`.
- **RCP-29 What a test cannot judge.** The checks read values, not intent. They cannot tell whether
  spacing serves its role (a 6 used between groups, an 8 used for icon ↔ label), whether a wash
  sits on the right state, whether a height that comes from padding lands on the scale, or what a
  class built at run time or a control built in `.ts` draws. Review holds these against RCP-6's
  role table and the gallery sheets.

### Rollout

- **RCP-30 No switch.** This restyles existing surfaces and replaces none, so there is no release
  switch, and `main` stays releasable after every commit.
- **RCP-31 One commit per surface.** First the token layer and the ratchet land, with every current
  hit counted as debt; that commit also rewrites the ledger's header for the new rules and CSS
  paths. Then one commit per surface, in this order: the rail; the stage bar and pane
  header; the dock; menus, popovers and modals; Command Settings. A surface's commit brings its
  files' debt to zero, moves its CMP-20 classes out (RCP-28) and rewrites the DL rules it ships.
- **RCP-32 One eye review.** After the last surface, the owner reviews once, with no stop between
  surfaces. The review uses gallery state sheets built from the real components with the gallery's
  forced states ([`force-states.ts`](../../src/gallery/force-states.ts)), in graphite and Deck
  Light, beside the mock. Then the real app runs once. Pushing waits for that approval.

## Design-language changes

The owner approved these in conversation. Each is rewritten in
[`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) in the same commit that ships it.

| Rule        | Tier      | Change                                                                                                                                                                                               |
| ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DL-1.3      | invariant | Blurred, offset `box-shadow` is allowed as RCP-11's three static levels, through `--elev-*`, on floating elements only; DL-3.3's "not from shadow" takes the same exception. The bans on `filter`, `backdrop-filter` and visual timers stay, as does the scrim's. |
| DL-20.5     | invariant | The spacing steps get tokens (`--space-*` and RCP-6's role tokens); "no token declares the steps" goes.                                                                                             |
| §20, new    | invariant | A row-height scale (24, 32, 44; RCP-7) and a weight scale (400, 600; RCP-5). DL-20.5's "no weight scale" goes.                                                                                       |
| §21, new    | invariant | Pressed: `--state-pressed-bg`, the surface 8% toward black in both themes (RCP-9).                                                                                                                   |
| DL-27.3     | pattern   | The rail's working mark changes from `WorkspaceSpinner` to the braille spinner (RCP-15), accepted by eye.                                                                                            |
| DL-14.1     | pattern   | Phosphor gets a ratchet: no new import, existing ones counted down (RCP-26).                                                                                                                         |

These follow from the picks but change invariant text the table does not name. Confirm each with
the owner before the commit that ships it:

- **DL-1.2:** the braille loop spreads from the worktree-card row to the rail row, strip tab and
  pane header, and holds ⠹ under reduced motion rather than the first frame.
- **DL-1.3 and DL-1.6:** preset popups wear `--elev-*` instead of `shadow-md` and `ring-1`, the
  preset's weight 500 goes, and an `RCP-n` value takes precedence over the preset's own.
- **DL-4.4:** the ladder gains the 16 rung, `--type-dialog`, that DL-20.3 already names.
- **DL-21.7:** a panel footer and the avatar carry the 3% resting wash beside the strip tab.

## Acceptance

| ID   | Check                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Per surface (rail; stage bar and pane header; dock; menus, popovers and modals; Command Settings), at its commit: its files hold no line in the ledger, the tests beside its changed files pass, and the DL rules it ships are rewritten.                         |
| AC-2 | The owner approves every surface's gallery state sheet by eye beside the mock: rest, hover, focus, selected, selected with focus, pressed, disabled, drag-over and needs you, built from the real components. Then one run of the real app.                    |
| AC-3 | Both themes are checked: every sheet shows graphite and Deck Light, and status ink and every text tone hold at least 4.5:1 on every surface and wash they sit on in both.                                                                                 |
| AC-4 | The ratchet fails on one seeded value of each kind, in CSS and `.tsx` where the kind applies: radius, height, spacing, focus, state background, blurred shadow, weight, arbitrary utility, ring outside Input, new Phosphor import, and `ui-scale:` without a reason. The same value with `ui-scale: <reason>` passes. |
| AC-5 | After the ratchet lands, the ledger only falls: no later commit raises a count or adds a file.                                                                                                                                                                                                 |
| AC-6 | The `scripts/` and `src/styles/` policy suites, lint and the tests beside each changed file pass at every commit.                                                                                                                                               |

## Out of scope

- Terminal and editor content, the native browser view, the gallery, the landing and native OS
  dialogs.
- Layout and identity colours: the arrangement of rail, stage and dock, and each theme's own
  colours (graphite's teal Run stays).
- The CMP-20 surfaces: the old agent rail and its cards, the old dock column, the Agent Board and
  Mission Control.
- The Spaces bar, the browser-beside slot and the hunk queue, which are not live.
