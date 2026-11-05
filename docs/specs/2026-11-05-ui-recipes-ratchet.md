# UI recipes and the ratchet

Status: `decided` (owner, 2026-11-04 to 2026-11-05, through an intent round and two grilling
rounds). The visual standard is the multi-file mock
[`src/gallery/layout-mocks/ui-recipes/`](../../src/gallery/layout-mocks/ui-recipes/index.html)
(entry `index.html` with nine tabs, token layer `tokens.css`, recipes `chrome.css`), approved by eye;
the binding record of every decision is
[`DECISIONS.md`](../../src/gallery/layout-mocks/ui-recipes/DECISIONS.md) in the same folder. The
working mark is the braille spinner and the shadow strength is mid, both picked by eye on
2026-11-05.

Amended 2026-11-05 after PR #98, which shipped tokens only, with the owner's parity decisions P0 to
P9 (`DECISIONS.md`, "Parity decisions"). **The mock is the per-surface standard the app is changed
to match: structure, content, look and theme** (grilling Q23, restated as P0). The ledger and the
tests are how the ratchet holds the recipes; they are not how a surface is accepted (AC-7).

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
  `--logo-mono-filter` and the `-soft` / `-strong` elevation variants. The widths themselves are
  still part of parity (MPR-1 to MPR-8): a surface takes the mock's width, written in its own
  stylesheet rather than as a global token.
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
- **RCP-23 Copy.** The surfaces this spec changes carry no heading, eyebrow or helper sentence, and
  every string is English. A label or flow change updates its `docs/user/` guide in the same
  commit; P2's install tile updates [`agents.md`](../user/agents.md).

### Mock parity

The mock is the standard each surface is changed to match (Q23, P0): which elements exist, their
order, their content and copy, the recipes above, and both themes. A path below is relative to the
mock folder `src/gallery/layout-mocks/ui-recipes/`. Where the window tab and a per-group tab draw
the same surface, the per-group tab is the detailed standard and the window tab the composed one.

Each requirement lists the parity deltas it closes. The deltas were measured on 2026-11-05 between
the composed app and the mock (51 ids; STA-05, DOC-07 and OVE-02 do not exist). A delta whose
mock claim was wrong against the mock file is closed as "no difference" with the remaining
difference named. An item marked **open** waits for the owner and is listed under
[Open for the owner](#open-for-the-owner); it is never dropped.

- **MPR-0 The reference.** The mock folder is the reference: `index.html` and nine tabs in the
  order Window, Launcher, Rail, Stage, Dock, Overlays, Settings, Notices, Rules, each with
  Dark/Light and Worst case (Q24, Q29); `tokens.css`, `chrome.css`, `app.js` and one HTML per tab,
  each under 800 lines (Q31); real data with a Worst-case toggle (Q25); the Window tab's composed
  moment (Q30); directions B and C dropped (Q26). The owner approved it by eye on 2026-11-05. A
  change to a surface's standard is a change to the mock first, approved by eye. The real side of
  every comparison is the composed app captured from an isolated-userData run (P8).
- **RCP-30a Themes change backgrounds only (P10, owner 2026-11-05).** `--primary` and its ink, hover and pressed are one ivory in every built-in and custom theme, light included. A theme only changes the background surfaces (stage, rail/sidebar, chrome ladder, inputs, cards, popovers) and the inks derived from them. Accent, status and focus colours stay shared. This rewrites how `src/lib/theme-vars.ts` and `src/lib/derive-colors.ts` map a theme. In particular, `primary = ui.accent` goes. It amends DL §3, an invariant the owner approved here. Light themes keep the ivory fill, and the button needs no frame as long as its fill against the surface stays visible on the eye sheet; that check is part of AC-9.

- **MPR-1 Window frame** (`window.html`, `app.js:593-594` `railFrame`).
  - **Structure:** the frame row holds the traffic lights and the sidebar toggle only. The "Deck"
    logo, name and the DEV or version chip leave the frame (P5).
  - **Dev marker:** a development build shows a small dot on the sidebar toggle (P5); its meaning
    is in the toggle's accessible name.
  - **Kept:** the drag region and the room for the Windows caption buttons (P5).
  - **Heights:** the frame row is 34 and the rail's search bar 36 under it (Pass decisions "Bar
    heights", RCP-7); `--frame-h` is declared once.
  - **DL:** DL-18.9 is rewritten for the brandless frame in the same commit (P5).
  - **Closes:** WIN-01 (brand in the frame), WIN-02 (frame row 40 and a doubled `--frame-h`).
- **MPR-2 Launcher** (`launcher.html`, `launcher.js:263-384`; LCH-5 owns its behaviour).
  - **Command bar:** one 40 frame holding 32 controls, the project chip, the filter input with a
    leading search icon and the Run split, 640 wide (P9, `launcher.js:368-370`, RCP-3).
  - **Run:** ivory, like every primary action in every theme (P10, which supersedes P7).
  - **Agent tiles:** one row of 36 tiles with the mock's padding, radius and selected wash
    (`launcher.js:323-334`). An agent that is not installed stays in the row as a dimmed 36 tile
    with a download mark; pressing it installs. There is no framed Install button, so the row
    never wraps (P2). This amends [LCH-8](2026-11-04-launcher-in-stage.md)'s "Install on a missing
    quick agent": the install lives on the tile.
  - **Multi-pick key:** the trailing key reads ⇧ only, with its meaning in a tooltip and the
    accessible name (P6).
  - **Destination line:** a + icon before "New space in ‹project›" and a split icon before "Beside
    ‹agent›" (P6, `launcher.js:318-322`).
  - **Rail beside it:** at zero tabs the target project's header is selected and ends in the
    forward arrow (`launcher.js:291-298`); an empty project shows its header only (P1).
  - **Stage frame:** the breadcrumb project › branch at the top left and the shared toolbar (Pass
    decisions "Stage frame").
  - **Over a live space:** a floating panel at `--elev-2` over the `--scrim-bg` colour scrim, with
    no `filter` dim (owner answer 5, RCP-11).
  - **Project menu:** as `launcher.js:335-355` (see MPR-6 for its chord badge).
  - **Closes:** WIN-10 and LAU-02 (teal Run, closed by P10: `--primary` is ivory in every theme), LAU-01 (frame 700 and 40 controls), LAU-03 (no search icon),
    LAU-04 (Install buttons wrap the row; closed by P2, which overrides the mock's installed-only
    row), LAU-05 (tile padding 8 and wash), LAU-06 (plain destination text), LAU-07 ("adds" word),
    LAU-08 (no selected header or arrow; "No sessions"), LAU-09 (no breadcrumb at zero tabs),
    LAU-11 (no scrim). LAU-10 (900 wide): the 640 frame and the single row close the wrap; below
    the mock's width is **open**.
- **MPR-3 Rail** (`rail.html`, `rail.js:72-160`, the launcher's rail at `launcher.js:263-304`).
  - **Controls row:** search, the needs-you chip, Organize and an unframed 28 ghost +
    (`rail.js:148-152`).
  - **Rows and heads:** project heads, agent rows at 44 with the leading mark, remembered rows,
    checkout lines nested under their label (`rail.js:96-97`, DL-27.28), the Archived section and
    the hidden list, as RCP-17 to RCP-19 draw them.
  - **Empty project:** its header only. "No sessions" goes; "No sessions match" stays while
    searching (P1).
  - **+ menu:** 240 wide, one line per item (`--menu-w`, `launcher.js:269`). Its contents are
    **open**: the mock draws Open folder…, Clone repository… and New worktree…; LCH-8 adds Create
    workspace…, and the app also has Resume a session….
  - **Row titles:** a row is titled by its session with a one-line sentence, as the mock draws it,
    once the agent provides one. Whether the app's agent-name fallback differs with a real agent is
    **open** until the P8 capture runs with a real session.
  - **Closes:** RAI-01 ("No sessions"), RAI-02 (framed +), RAI-03 (176 menu that wraps), RAI-04
    (checkout as a project-level row), WIN-09 (titles; data-dependent, **open**).
- **MPR-4 Stage** (`stage.html`, `window.html:71-99`, `app.js:533-561`).
  - **Toolbar:** attention chip with the bell icon, dev-servers chip with the server icon and
    count, the open-in-app icon split (its glyph is **open**: the mock's generic external icon, or the
    app's own icon as today), more, and the dock toggle,
    which is always present and shows its pressed state (`window.html:71-84`, Pass decisions
    "Stage frame").
  - **Overflow menu:** Split right, Split down, Expand pane, Close pane; a gap; Browser, Prompts,
    Settings; each with one chord badge (`stage.html:138-158`, Q18).
  - **Pane header:** 32, mark, agent name, session title, the DL-27.2 status word, and one 24
    "more" at the end; gap 6 between icon and label (Pass decisions "Pane header", RCP-20).
  - **Tab strip:** the mock draws a strip of tabs with marks, close and + under the frame, and its
    tab menu (`window.html:87-97`, `stage.html:199`, `stage.html:352`). The app has no tab strip
    since DL-35.3 moved the tab list to the rail. Required per Q23 and P0; the DL-35.3 rewrite it
    needs is **open**, and the surface's commit waits for that answer.
  - **Browser panel:** its toolbar as the mock draws it; the page area stays native (out of scope).
  - **Narrow:** the mock draws no narrow stage; how the breadcrumb truncates at 900 is **open**.
  - **Closes:** WIN-03 and STA-01 (no tab strip, **open**), WIN-04 (chip and open-in-app icons,
    dock toggle only while closed), WIN-05 and STA-02 (no more, no title), WIN-06 (gap 8), STA-03
    (four-item overflow menu), STA-04 (chords as plain text), STA-06 (900 wide, **open**).
- **MPR-5 Dock** (`dock.html`, `dock.js:81-258` and its states at `dock.js:322-377`).
  - **Strip:** a 34 bar with four view icons, Changes, Usage, History and Files, always shown;
    then the file tabs, +, widen and close (P3, `dock.js:102-111`); 28 icon boxes.
  - **Changes:** the 40 band ("Uncommitted", file count, +/−, the list-pane toggle, refresh), the
    sticky card stack and the list/tree pane (`dock.js:81-87`, `dock.js:155-167`), and a panel
    footer on the 3% resting wash with the totals and the list/tree toggle
    (`window.html:117-125`). The window tab draws the pane under the stack and the dock tab beside
    it; which one ships is **open**.
  - **Usage:** with no agent, a centred empty state with its icon under the "Today" band with its
    info and Usage details buttons (P4, `dock.js:89-92`, `dock.js:343`); with data, the fact cards
    and agent cards (`dock.js:169-181`).
  - **History:** the band with the count and Rescan, then rows, or the centred empty state with its
    icon (`dock.js:93-96`, `dock.js:183-188`, `dock.js:345-355`).
  - **Files:** the band with the search field, refresh and New file; the tree with its folder dots;
    a file tab with the breadcrumb band, Open-in split, Wrap lines and tree toggle, and the
    external-change bar (`dock.js:190-258`). A preview tab is italic. Status letters in the Files
    tree: the window tab prints M, A, D in the Changes list (`window.html:125`), the dock tab's
    Files tree prints none; **open**.
  - **Recipes:** RCP-7 (24 rows, 34 strip, 40 band), RCP-21 (panel footer), RCP-22 (cards and
    diff), RCP-4 (icon boxes).
  - **Closes:** WIN-07 and DOC-01 (no Files icon), WIN-08 and DOC-02 (no list/tree pane), DOC-03
    (Usage plain line), DOC-04 (History plain line; rows need recorded sessions, measured in P8),
    DOC-05 (Files tree, status letters **open**), DOC-06 (file tab; the editor stays out of scope),
    DOC-08 (no panel footer), DOC-09 (24 box in a 40 row).
- **MPR-6 Overlays** (`overlays.html`, `overlays.js`, `overlays-forms.js`, `overlays-modals.js`).
  - **Menus:** the rail row menu and its New here submenu (`overlays.js:40-61`), the checkout menu
    (`overlays.js:63-75`), the dock file menu (`overlays.js:77`), the launcher project menu with
    one ⌘O badge (`launcher.js:354`, Q18) and the profile menu (`overlays.js:124`): items, order,
    gaps and chords as drawn.
  - **Popovers and tooltips:** attention, dev servers, prompt list and editor
    (`overlays.js:187-258`) and the tooltip with no arrow (`overlays.js:259-311`).
  - **Modals:** remove project, create file, preset editor, save preset and usage consent
    (`overlays-modals.js:15-62`).
  - **Forms:** the worktree form (`overlays-forms.js:13-25`) and Clone and Create workspace in the
    stage (`overlays-forms.js:26-188`): a head with Back and Close icon buttons and a one-line
    title, the labels GitHub repository, Parent folder, Folder name and Final path, and the primary
    with its ↵ badge. The Clone label that reads "Folder01Icon name"
    (`src/open-board/clone-workspace-form.tsx:247`) is a defect and reads "Folder name".
  - **Usage details page** (`overlays-forms.js:189-266`).
  - **Recipes:** RCP-11 (elevation), RCP-12 (gaps, not separators), RCP-13 (chords), RCP-21
    (menu, tooltip, panel footer, modal), RCP-3 (form controls).
  - **Closes:** OVE-01 (no difference: the mock's row menu has Open in Finder,
    `overlays.js:46-49`; the remaining difference is gaps in place of separators, RCP-12), RAI-05
    and OVE-03 (no difference: the mock's checkout menu has no New worktree…, which sits in the
    New here submenu, `overlays.js:56-61`), OVE-04 (two badges for ⌘O), OVE-05 (the Folder01Icon
    label), OVE-06 (two-line head, no Close, an arrow glyph in place of the ↵ badge; the primary turns ivory by P10).
- **MPR-7 Command Settings** (`settings.html`, `settings.js`, `settings-rows.js`).
  - **Frame:** search, area chips at 12 and 400 (RCP-4, Q20), the list, and the footer whose hints
    read Move, Open and Close for every row, results included (`settings.js:52-53`).
  - **Rows:** the toggle, select, shortcut, editable agent list and theme card patterns
    (`settings-rows.js:22-267`), with no helper sentence under a row (RCP-23) and buttons in
    sentence case with the button recipe.
  - **Closes:** SET-01 (frame; matches apart from the items here), SET-02 ("Go to"), SET-03 (chip
    size and weight), SET-04 (helper sentences), SET-05 (lowercase buttons with trailing icons),
    SET-06 (theme cards; their order is checked side by side under AC-14).
- **MPR-8 Notices** (`notices.html`).
  - **Persist error:** a full-width bar at the bottom of the stage with its icon, text, Retry and a
    Dismiss icon button (`notices.html:41-43`). The app's bar has no retry action, so Retry is
    **open**; the shape, icon and icon Dismiss are required.
  - **Update action:** available, downloading and ready (`notices.html:76-90`, RCP-20).
  - **Launcher failure line** with its Retry (`notices.html:45-50`).
  - **Closes:** NOT-01 (floating card, text Dismiss, no Retry).

#### Open for the owner

Each item blocks only its own surface's commit.

1. **Tab strip (MPR-4):** draw it as the mock does and rewrite DL-35.3, or keep the rail as the tab
   list and remove the strip from the mock.
2. **Rail + menu contents (MPR-3):** the mock's three items, or LCH-8's four plus Resume a
   session….
3. **Changes list pane (MPR-5):** under the card stack with the footer (window tab) or beside it
   (dock tab).
4. **Files status letters (MPR-5):** whether the Files tree prints M, A, D.
5. **Persist-error Retry (MPR-8):** add a retry-save action, or draw the bar without Retry.
6. **Narrow widths (MPR-2, MPR-4):** the launcher and stage below the mock's width (LAU-10,
   STA-06); the mock draws neither.
7. **Session titles (MPR-3):** re-check WIN-09 with a real agent's session in the P8 capture.
8. **Open-in-app glyph (MPR-4):** the mock's generic external icon may be a stand-in for the app's
   own icon, which the app shows today (WIN-04).
9. **Release switch (RCP-30):** DECISIONS.md notes, undecided, that the release switches keep the
   new surfaces off in packaged builds, so a release looks like the mock only after LCH-10's
   cut-over.

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

- **RCP-30 Surfaces change to match the mock.** Each surface changes in structure and content, not
  only in values, until it matches its mock tab (MPR-1 to MPR-8). This spec adds no release switch
  of its own, so `main` stays releasable after every commit; surfaces already behind a switch, such
  as the launcher behind LCH-10, change behind it, and whether a packaged release shows them before
  the cut-over is open item 9.
- **RCP-31 One commit per surface.** First the token layer and the ratchet land, with every current
  hit counted as debt; that commit also rewrites the ledger's header for the new rules and CSS
  paths. Then one commit per surface, in this order (Q6): the rail; the stage bar and pane header,
  with the window frame, the launcher and the browser toolbar; the dock; menus, popovers, modals,
  forms, notices and the usage page; Command Settings. Placing the browser toolbar, notices, forms
  and the usage page is the owner's answer 6; placing the window frame and the launcher with the
  stage bar is this amendment's choice, since they share its frame row and toolbar. A surface's
  commit brings its files' debt to zero, moves its CMP-20 classes out (RCP-28), closes its MPR's
  deltas and rewrites the DL rules it ships.
- **RCP-32 One eye review.** After the last surface, the owner reviews once, with no stop between
  surfaces. The review uses gallery state sheets built from the real components with the gallery's
  forced states ([`force-states.ts`](../../src/gallery/force-states.ts)), in graphite and Deck
  Light, beside the mock, and the side-by-side parity of AC-7. Then the real app runs once. Pushing
  waits for that approval.

## Design-language changes

The owner approved these in conversation. Each is rewritten in
[`DESIGN-LANGUAGE.md`](../DESIGN-LANGUAGE.md) in the same commit that ships it.

| Rule | Tier | Change |
| --- | --- | --- |
| DL-1.3 | invariant | Blurred, offset `box-shadow` is allowed as RCP-11's three static levels, through `--elev-*`, on floating elements only; DL-3.3's "not from shadow" takes the same exception. The bans on `filter`, `backdrop-filter` and visual timers stay, as does the scrim's. |
| DL-20.5 | invariant | The spacing steps get tokens (`--space-*` and RCP-6's role tokens); "no token declares the steps" goes. |
| §20, new | invariant | A row-height scale (24, 32, 44; RCP-7) and a weight scale (400, 600; RCP-5). DL-20.5's "no weight scale" goes. |
| §21, new | invariant | Pressed: `--state-pressed-bg`, the surface 8% toward black in both themes (RCP-9). |
| DL-27.3 | pattern | The rail's working mark changes from `WorkspaceSpinner` to the braille spinner (RCP-15), accepted by eye. |
| DL-14.1 | pattern | Phosphor gets a ratchet: no new import, existing ones counted down (RCP-26). |
| DL-18.9 | pattern | The frame row carries no brand; a development build marks the sidebar toggle with a dot (P5, MPR-1). |
| DL-1.2 | invariant | The braille loop spreads from the worktree-card row to the rail row, strip tab and pane header, and holds ⠹ under reduced motion rather than the first frame (owner answer 1). |
| DL-1.3, DL-1.6 | invariant | Preset popups wear `--elev-*` instead of `shadow-md` and `ring-1`, the preset's weight 500 goes, and an `RCP-n` value takes precedence over the preset's own (owner answer 2). |
| DL-4.4 | invariant | The ladder gains the 16 rung, `--type-dialog`, that DL-20.3 already names (owner answer 3). |
| DL-21.7 | invariant | A panel footer and the avatar carry the 3% resting wash beside the strip tab (owner answer 4). |

The last four rows were approved on 2026-11-05 as the six answers recorded in the
[build plan](../plans/2026-11-05-ui-recipes-ratchet.md) (local, not committed). DL-35.3 changes
only if the owner keeps the mock's tab strip (open item 1).

## Acceptance

| ID | Check |
| --- | --- |
| AC-1 | Per surface, at its commit (RCP-31's order): its files hold no line in the ledger, the tests beside its changed files pass, and the DL rules it ships are rewritten. This covers the ratchet only; parity is AC-7. |
| AC-2 | The owner approves every surface's gallery state sheet by eye beside the mock: rest, hover, focus, selected, selected with focus, pressed, disabled, drag-over and needs you, built from the real components. Then one run of the real app. |
| AC-3 | Both themes are checked: every sheet shows graphite and Deck Light, and status ink and every text tone hold at least 4.5:1 on every surface and wash they sit on in both. |
| AC-4 | The ratchet fails on one seeded value of each kind, in CSS and `.tsx` where the kind applies: radius, height, spacing, focus, state background, blurred shadow, weight, arbitrary utility, ring outside Input, new Phosphor import, and `ui-scale:` without a reason. The same value with `ui-scale: <reason>` passes. |
| AC-5 | After the ratchet lands, the ledger only falls: no later commit raises a count or adds a file. |
| AC-6 | The `scripts/` and `src/styles/` policy suites, lint and the tests beside each changed file pass at every commit. |
| AC-7 | **Parity, per surface.** The composed real app, from an isolated-userData run (P8), and the surface's mock tab are captured side by side at the same size, in graphite and in Deck Light. Elements, order and copy match. Computed styles are diffed (padding, gap, size, radius, hover and focus colours), and every delta the surface's MPR lists, and every new one the diff finds, is closed or listed as an accepted difference with the owner's yes. AC-1, AC-5 and AC-6 passing is not sufficient on its own. |
| AC-8 | Window frame passes AC-7 against the Window tab (MPR-1); a development build shows the toggle dot and a packaged build none. |
| AC-9 | Launcher passes AC-7 against the Launcher tab (MPR-2), including a not-installed agent's tile, the ivory Run in graphite with other primaries unchanged, and the launcher over a live space. |
| AC-10 | Rail passes AC-7 against the Rail tab (MPR-3), including remembered rows, the Archived section and the inline rename field. |
| AC-11 | Stage passes AC-7 against the Stage tab (MPR-4): toolbar, overflow menu, pane header, the tab strip and tab menu as open item 1 resolves, and the browser toolbar. |
| AC-12 | Dock passes AC-7 against the Dock tab (MPR-5): every view with data, empty and loading, a file tab and the external-change bar. |
| AC-13 | Overlays pass AC-7 against the Overlays tab (MPR-6): every listed menu, popover, tooltip, modal and form, and the usage details page; the Clone form reads "Folder name". |
| AC-14 | Command Settings passes AC-7 against the Settings tab (MPR-7): the frame and each row pattern, the shortcut row and the agent list included. |
| AC-15 | Notices pass AC-7 against the Notices tab (MPR-8): the persist bar, the three update states and the launcher failure line. |
| AC-16 | The P8 capture reaches every surface the 2026-11-05 capture did not: remembered and archived rows, inline rename, the update action, the browser panel, the tab menu, the prompt and attention popovers, the external-change bar, the remembered row menu, create file, the worktree form, the preset editor, usage consent, the shortcut row, the agent list, the launcher failure line and loading skeleton. A surface it cannot reach is named with its reason. |
| AC-17 | Every open item that touches a surface is answered by the owner before that surface's commit, and the answer is recorded in `DECISIONS.md`. |

## Traceability

Every decision in [`DECISIONS.md`](../../src/gallery/layout-mocks/ui-recipes/DECISIONS.md) maps to
a requirement and an acceptance check. "A1" to "A6" are the owner's six answers for the build.

| Decision | Decided | Requirement | Acceptance |
| --- | --- | --- | --- |
| Intent | One recipe per thing, one token each, per theme; a ratchet enforces it | RCP-1, RCP-24 | AC-1, AC-4 |
| Q1 | The composition spec is the base; DL wins on radius 7 and ease; DL-20.5 gets spacing tokens | RCP-6, RCP-8, RCP-9 | AC-1 |
| Q2 | The ratchet covers radius, height, spacing, focus, state backgrounds, shadow, weight | RCP-25, RCP-26 | AC-4 |
| Q3 | Per-file debt ledger; CMP-20 surfaces exempt | RCP-24, RCP-28 | AC-1, AC-5 |
| Q4 | State tokens derive from `--tone` | RCP-2, RCP-9 | AC-3 |
| Q5 | One commit per surface, one eye review at the end | RCP-30, RCP-31, RCP-32 | AC-1, AC-2 |
| Q6 | Order rail → stage bar and pane header → dock → overlays → settings | RCP-31 | AC-1 |
| Q7 | Review on gallery sheets from real components, both themes, beside the mock, then one app run | RCP-32 | AC-2, AC-3, AC-7 |
| Q8 | Shadows are allowed | RCP-11 | AC-4 |
| Q8.1 | Three levels: menu, floating panel, modal | RCP-11 | AC-4, AC-13 |
| Q8.2 | Dark = shadow + inset hairline, light = shadow only | RCP-11 | AC-3 |
| Q8.3 | Static only, token only, floating elements only | RCP-11, RCP-25 | AC-4 |
| Q9 | Hugeicons; the ratchet blocks new Phosphor imports | RCP-14, RCP-26 | AC-4, AC-5 |
| Q10 | Rows 24/32/44 | RCP-7 | AC-4, AC-10 |
| Q11 | Live classes move out of the CMP-20 partials | RCP-28 | AC-1 |
| Q12 | The spacing role table | RCP-6 | AC-4, AC-7 |
| Q13 | Deck's existing token names win | RCP-1 | AC-1 |
| Q14 | Pressed = 8% toward black | RCP-9 | AC-2 |
| Q15 | Shadow strength picked by eye: mid | RCP-11 | AC-2 |
| Q16 | The Tailwind allowlist | RCP-26 | AC-4 |
| Q17 | The `ui-scale: <reason>` exception | RCP-27 | AC-4 |
| Q18 | One badge per chord | RCP-13, MPR-4, MPR-6 | AC-11, AC-13 |
| Q19 | Rail rows 52 → 44, live and remembered | RCP-7, MPR-3 | AC-10 |
| Q20 | Weights 400/600 only | RCP-5, MPR-7 | AC-4, AC-14 |
| Q21 | DeckIcon size typed 16/14/12 | RCP-4 | AC-6 |
| Q22 | Scrollbar and selection are tokens | RCP-16 | AC-3 |
| Q23 | Draw every surface; the mock is the standard the app is changed to match | MPR-0 to MPR-8, RCP-30 | AC-7 to AC-15 |
| Q24 | A composed window plus per-group state tabs, both themes | MPR-0 | AC-2, AC-7 |
| Q25 | Real data plus a Worst-case toggle | MPR-0 | AC-7 |
| Q26 | Drop directions B and C | MPR-0 | AC-2 |
| Q27 | The surface list | MPR-1 to MPR-8 | AC-8 to AC-16 |
| Q28 | Settings drawn as row patterns | MPR-7 | AC-14 |
| Q29 | The tab order | MPR-0 | AC-7 |
| Q30 | The composed scene | MPR-0 | AC-7 |
| Q31 | The file split | MPR-0 | AC-2 |
| Pick: working mark | Braille (B) everywhere a working state shows | RCP-15 | AC-2, AC-10, AC-11 |
| Pick: shadow | Mid for all three levels | RCP-11 | AC-2 |
| Pick: mock approved | Mock approved by eye on 2026-11-05 | MPR-0 | AC-7 |
| Pick: DL items | The six pending DL items approved | RCP-5, RCP-11, RCP-15, RCP-21 | AC-1 |
| A1 | DL-1.2 braille loop spreads, holds ⠹ | RCP-15 | AC-1, AC-2 |
| A2 | DL-1.3 / DL-1.6 preset popups on `--elev-*`, no 500 | RCP-11, RCP-26 | AC-1, AC-4 |
| A3 | DL-4.4 gains the 16 rung | RCP-5 | AC-1 |
| A4 | DL-21.7 panel footer and avatar on the 3% wash | RCP-9, RCP-21 | AC-1, AC-2 |
| A5 | Dims use no `filter`: opacity 0.5 and a colour scrim | RCP-1, MPR-2 | AC-9 |
| A6 | Browser toolbar with the stage bar; notices, forms, usage page with overlays | RCP-31 | AC-1 |
| P0 | The mock is the standard, per surface; layout is in scope | RCP-30, MPR-0 to MPR-8 | AC-7 to AC-15 |
| P1 | Drop "No sessions"; keep "No sessions match" | MPR-2, MPR-3 | AC-9, AC-10 |
| P2 | Not-installed agents stay as a dimmed 36 tile with a download mark; no Install button | MPR-2, RCP-23 | AC-9 |
| P3 | The dock strip always shows Files; keep +, widen, close | MPR-5 | AC-12 |
| P4 | Usage empty: icon, centred, plus the Today band | MPR-5 | AC-12 |
| P5 | No brand in the frame; dev dot on the toggle; keep drag and caption room | MPR-1 | AC-8 |
| P6 | Launcher ⇧ only with a tooltip; + and split icons on the destination | MPR-2 | AC-9 |
| P7 | Superseded by P10 | MPR-2 | AC-9 |
| P10 | `--primary` is one ivory in every theme; a theme changes only background surfaces | RCP-30a, MPR-2, MPR-6 | AC-9 |
| P8 | Capture the composed real app with an isolated userData run | MPR-0 | AC-7, AC-16 |
| P9 | Command bar controls 32 inside a 40 frame | MPR-2, RCP-3 | AC-9 |
| Noted | Release switches keep the new surfaces off in packaged builds | RCP-30, open item 9 | AC-17 |

## Out of scope

- Terminal and editor content, the native browser view, the gallery, the landing and native OS
  dialogs.
- The CMP-20 surfaces: the old agent rail and its cards, the old dock column, the Agent Board and
  Mission Control.
- The Spaces bar, the browser-beside slot and the hunk queue, which are not live.
