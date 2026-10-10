# DESIGN-LANGUAGE — Deck chrome

How Deck's chrome looks, in two tiers with different authority. Rules are numbered so code
can cite them (`DL-3.2`); the numbers stay stable because
[`design-language.test.ts`](../scripts/design-language.test.ts) resolves every citation.

**Part I — Invariants** (§1 resource budget, §2 tokens, §3 color roles, §4 typography, §7
motion budget, §20 numeric scales, §21 interaction states, with the §9 checklist and the §10
open gaps). These hold the system together: the token scales, accessibility (visible focus,
contrast, reduced motion, roles) and the resource budget. Tests enforce most of them.
Changing one is a fork: ask the owner first. A rule marked _(pattern)_ inside Part I belongs
to Part II.

**Part II — Patterns** (every other section). Each describes how a surface looks today, not
how it must look. A redesign may replace any of them. A pattern changes in a design pass,
not rule by rule: build the new design, the owner reviews it by eye, and the pattern text is
rewritten in the same change as the code. No per-rule permission is needed.

**Exploration is unbound.** Gallery specimens, prototypes and design proposals do not have
to follow the patterns. Propose the strongest design, then list the patterns it would
replace. Only two DL checks reach `src/gallery/`: a DL citation written there must resolve, and
`chatgpt-direction.css` stays on the radius scale. The casing, radius and weight scans read
only the shipping stylesheet.

**Writing here.** State the current design in present tense with its concrete values. Add a
one-line _Why_ only where a maintainer would otherwise get it wrong. No dates and no
amendment history: git keeps it. A retired rule keeps its ID as `Retired.` while code still
cites it.

# Part I — Invariants

## 1. Hard constraints (resource frugality)

- **DL-1.1** Chrome adds no runtime dependency beyond CSS and Preact. One exception: one icon
  package, `@phosphor-icons/react`, supplies every functional icon (§14). It is reached
  through the `preact/compat` alias and tree-shakes to the icons imported by name
  (`sideEffects: false`). A second icon package is not covered.
- **DL-1.2** Chrome animates only `transform`, `opacity`, `color`, `border-color` and
  `background-color`, for at most 300ms, with no infinite loop and nothing moving while the
  user is idle. Three scoped exceptions loop, each only while its state exists, each with
  `transform`/`opacity` alone, and each still under reduced motion:
  - the rail's `asked` mark radiates on a 1.8s loop (DL-27.3);
  - a worktree-card row shows a braille spinner while its agent works: ten stacked frames
    shown by `opacity`, 80ms each, an 800ms loop, only under `[data-state="working"]`;
    reduced motion keeps the first frame (DL-27.21);
  - the dev servers chip's 6px dot sends one ring out on a 1.8s loop while at least one
    server runs in the active checkout; zero servers or a failed scan (a still red dot)
    draw nothing moving; reduced motion keeps the still green dot (DL-36.1).

  No other surface inherits them. Panes draw no top-edge activity motion (DL-18.11).
  Why: an unread or live state exists precisely while nobody is watching, which is the
  only case that pays for a loop.
- **DL-1.3** No blurred or offset `box-shadow`, no `filter`, no `backdrop-filter`, no
  `requestAnimationFrame` loop and no timer that exists only to drive visuals. Depth comes
  from background steps and 1px lines; `box-shadow: inset 0 0 0 1px <color>` is a hairline
  and allowed. One exception: `.modal-scrim` uses `backdrop-filter` (DL-29.5), because its
  layer exists only while a modal is open.
- **DL-1.4** Native inputs (`<select>`, `<input type="color">`) laid invisibly over a styled
  pill are preferred to custom pickers: no JS, no extra DOM, native accessibility.
- **DL-1.5** `prefers-reduced-motion: reduce` disables chrome transitions; panels appear
  instantly.

## 2. Tokens

One source: `:root` in [`styles.css`](../src/styles.css), fed by
[`derive-colors.ts`](../src/lib/derive-colors.ts). The active terminal theme injects
`--bg --fg --accent --red --green --yellow --magenta --cyan`; every other color derives
through `color-mix`.

| token                                                                                         | role                                     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `--sidebar-bg` / `--sidebar-seam`                                                             | the side columns and their boundary      |
| `--chrome-1` / `--chrome-2`                                                                   | background steps for bars / panels       |
| `--input-bg`                                                                                  | recessed input surfaces                  |
| `--hair` / `--hair-strong`                                                                    | 1px lines inside a surface               |
| `--seam-recessed` / `--seam-divider` / `--seam-split` / `--seam-raised`                       | the boundaries BETWEEN surfaces (DL-2.3) |
| `--text-primary` / `--text-muted` / `--text-faint`                                            | text hierarchy                           |
| `--ui-font`                                                                                   | the one chrome typeface (DL-4.1)         |
| `--type-title` … `--type-micro`                                                               | the four standard text sizes (DL-4.4)    |
| `--radius-flat` / `--radius-tab` / `--radius-tight` / `--radius-control` / `--radius-surface` | the five radius roles (DL-20.1)          |
| `--duration` / `--ease`                                                                       | chrome state-change motion (DL-20.2)     |

- **DL-2.1** Components never hardcode a color. Every color is a token, or comes from the
  live theme object (a swatch previewing a theme's own colors).
- **DL-2.2** The theme drives all chrome: switching theme restyles everything with no
  component change. Every chrome tone is a function of `(background, foreground)` only, not
  of a preset id or a setting, so the gallery, the editor host and a theme card show the
  same chrome as the app. One exception: a background may pin a hand-picked sidebar,
  keyed by that background ([`PINNED_SIDEBAR_BG`](../src/lib/derive-colors.ts)). Deck's dark
  mode pins a `#141414` sidebar to its `#0a0a0a` pane; `#17181c` pins `#161b22` for legacy
  overrides. Overriding the background drops its pin.
- **DL-2.3** A boundary between two surfaces is a seam; a line inside one surface is a
  hairline. All of them mix from `--tone`, never `--fg`, so the terminal's text hue never
  tints chrome. `--seam-recessed` (shell boundaries: the command-row frame, sidebar, status
  bar, pane bar) is opaque. `--seam-divider` (12% `--tone`, alpha) marks every line inside
  the work area, including the top-tab bar's bottom edge (DL-18.6). Panes have no split line:
  they are rounded cards separated by the stage gutter (DL-18.12), and `--seam-split` (20%
  `--tone`) is the 1px edge around each card. The divider element stays as a transparent
  drag target. `--seam-raised` frames a surface that floats above chrome (popovers,
  dialogs). A background step stays louder than the seam that marks it;
  [`derive-colors.test.ts`](../src/lib/derive-colors.test.ts) locks this for every preset.

## 3. Color roles (strict)

- **DL-3.1** `--accent` marks interactive or active state only: hover and focus borders,
  the focus ring, active markers, affordance hints. Never a decorative fill or a large
  area.
- **DL-3.2** `--green` means on / enabled / success. `--red` means danger / destructive /
  error. `--yellow` means needs your eyes: a question, a permission wait, or a finished run
  nobody has checked — one step below `--red`'s failure. None of them is decoration.
  A diff's line counts are the one place green and red mean added and removed: `+N` in
  `--green`, `−M` in `--red`, a zero side in the count's neutral ink
  ([`DiffCounts`](../src/files/ui/changes-list.tsx)).
  Why: the owner wants the two counts apart at a glance (2026-10-10), as every diff tool shows
  them.
- **DL-3.3** Structure comes from hairlines and background steps, not from color or
  shadow.
- **DL-3.4** `--text-primary` carries keys and values; `--text-muted` carries secondary
  value text and a group label heading a list of rows; `--text-faint` carries
  descriptions, hints, column headers and disabled states. Inside `.agent-board` a group
  label is `--text-faint` at `--type-meta` (DL-34.5).
- **DL-3.5** The text tones have app-wide WCAG contrast floors: `--text-primary` ≥ 8:1,
  `--text-muted` ≥ 6:1, `--text-faint` ≥ 4.5:1, each measured on every surface it may sit
  on (`sidebarBg`, `chrome1`, `chrome2`, `tabActiveBg`, plus `inputBg` for primary). The
  three stay ordered (primary ≥ muted ≥ faint) and visibly distinct on every surface.
  Locked by [`derive-colors.test.ts`](../src/lib/derive-colors.test.ts).
  Why: faint styles 10.5–11px text, which WCAG AA rates as normal text.
- **DL-3.6** A built-in theme's `foreground` is a neutral gray of the same WCAG relative
  luminance as its palette's tinted ink, so the derived `--text-*` ladder stays neutral
  (6% saturation ceiling, tested). The ANSI sixteen are untouched; `cursor` follows
  `foreground` only where the palette had them equal. `deck-dark` ships `#e7e7e7` and
  `deck-light` `#272727`. Imported themes keep their own foreground. Anchor:
  [`THEME_PRESETS`](../src/settings/themes.ts).
- **DL-3.7** _(pattern)_ Settings chrome is achromatic: inside `.settings-screen` an
  enabled toggle, a selected segment, a step icon, hover and the focus ring sit on the
  neutral `--text-*` / `--tone` / `--hair-*` ladders, overriding `--green` and `--accent`.
  `--red` on a destructive action stays.

## 4. Typography

- **DL-4.1** Chrome text uses `--ui-font` everywhere: labels, values, paths, shortcut
  chips, headings. Monospace belongs to the terminal and to two pictures of terminals:
  the Agent Board's `.agent-board` subtree and Mission Control's window bodies, both in
  `--board-font` (the §31 code stack, declared once in `01-tokens.css`). The terminal's
  own font comes from the user's `fontFamily` setting through
  [`toFontStack`](../src/terminal/pane.ts); no chrome token reads it, and `--board-font`
  never does either.
- **DL-4.2** Values use `font-variant-numeric: tabular-nums` so changing numbers do not
  jitter.
- **DL-4.3** No `text-transform: uppercase`, no all-caps spelling used as styling and no
  `letter-spacing` on readable copy. Acronyms and proper nouns keep their own casing
  (`USD`, `VS Code`). The test allowlists hold exactly three exceptions:
  - `.pane__anchor-grip`, `letter-spacing: -1px`: glyph geometry that draws the `⋮⋮` grip;
  - `.settings-screen__title`, `letter-spacing: -0.02em`: optical correction at 24px;
  - `.board-label` (Agent Board): uppercase with `var(--label-tracking)` (0.06em), weight
    400, `--text-faint`, for the nav's two group headings and the state word only.
- **DL-4.4** Standard chrome text uses four named sizes:

  | role      | variable       | size   | carries                                                 |
  | --------- | -------------- | ------ | ------------------------------------------------------- |
  | title     | `--type-title` | 14px   | screen and panel titles, `More` menu rows, group labels |
  | body      | `--type-body`  | 12.5px | keys, row names, the text read as content               |
  | metadata  | `--type-meta`  | 11px   | values, counts, paths, branches, status copy            |
  | microcopy | `--type-micro` | 10.5px | descriptions, column headers, hints                     |

  A group label heading a list of rows is title-sized in `--text-muted` (the rail's
  cluster header via a local `--type-project` alias, DL-27.9; the footer's `Tools`; and
  `.cfg-group`). A column header is not a group label and stays at 10.5px faint (DL-15.5).
  Two scoped exceptions use the metadata rung for a group label: Recent activity's heading
  (DL-33.2) and the Board's `STATUS` / `PROJECTS` (DL-34.5). Keys, labels, column headers,
  descriptions and empty states are sentence-case; values are lowercase.
- **DL-4.5** Sizes come from the `--type-*` variables declared once in `:root`, never from
  a px literal at the use site. The closed list of exceptions, none of them standard chrome
  text:
  1. the §16 display figure, 40px, at most one per screen (DL-16.1);
  2. `.wshead__title`, 19px, the create-worktree form's screen heading;
  3. single-character marks and icon-glyph buttons, sized by glyph geometry (§14);
  4. the theme-gallery miniature (DL-24.2) and the preset-editor stage specimens;
  5. `.settings-screen__title`, 24px, the settings section heading;
  6. the rail project label, which reaches the 14px title rung through `--type-project`
     ([rail stylesheet](../src/styles/04a-agent-rail.css)).
- **DL-4.6** Weights are authored for the macOS variable face. Windows draws static Segoe
  UI with 400, 600 and 700 in the chrome's range, so under `.window--windows`
  [the weight ledger](../src/styles/21-windows-weights.css) maps each authored weight by
  role: reading text, quiet labels, pills and control text 400; names, labels and emphasis
  600; the heaviest text of a block 700. Two roles separated by weight on macOS stay a rung
  apart; otherwise ink and size carry the difference. No macOS value is edited to suit
  Windows. A shipped weight outside 400 / 600 / 700 with no ledger entry fails
  [`windows-weights.test.ts`](../src/styles/windows-weights.test.ts) (not covered: a
  `var()`/`calc()` weight in a `font:` shorthand, `@keyframes`, script and inline styles).

## 7. Motion budget (chrome)

- Panel slide-over: `transform` + `opacity`, 0.28s ease-out cubic.
- State changes (hover/active): `--duration` / `--ease` (DL-20.2).
- Spaces: Mission Control's zoom (DL-35.1) and the space slide (DL-35.2), `transform` +
  `opacity` at 0.28s.
- Nothing else moves except DL-1.2's scoped loops. See DL-1.5 for reduced motion.

## 20. Numeric scales

- **DL-20.1** Five radius roles, and no sixth picked at a use site:
  - `--radius-flat` (2px): a control packed into a dense row, where a larger corner would
    cost the text its width;
  - `--radius-tab` (6px): strip tabs and view buttons
    ([styles](../src/styles/05-tab-bar-toolbar.css)), the stage's panes and document surface
    (DL-18.12), and any control with a text label that is 28px tall or less;
  - `--radius-tight` (8px): anything drawn inside a control or row — marks, bars, scrollbar
    thumbs, miniature parts;
  - `--radius-control` (10px): anything the pointer acts on inside a surface — rows, pills,
    square icon buttons, chips outside a dense row;
  - `--radius-surface` (12px): anything that floats above chrome — popovers, dialogs, the
    file view.

  `50%` and the 999px capsule are shapes, not scale values. Full-bleed screens such as
  Settings have no radius. The design-language test fails a block that declares a height
  of 28px or less at `--radius-control` without a matching width; a control whose height
  comes from padding is held by review.
  Why: on a 24px box a 10px corner is most of the half-height and the control reads as a
  pill.
- **DL-20.2** One motion pair for chrome state change: `--duration` (150ms) and `--ease`
  (`cubic-bezier(0.4, 0, 0.2, 1)`). The slide-over's 0.28s stays inside DL-1.2's 300ms.
- **DL-20.3** Type sizes are not a numeric scale here; DL-4.4 is their only authority.
- **DL-20.4** Frame height is not a numeric scale either. DL-18.2's 34px is window
  geometry: `hiddenInset` and `--frame-lights-w` centre the macOS traffic lights in it, and
  the Windows overlay opens at the same height (`FRAME_HEIGHT_PX`, held to `--frame-h` by a
  test).
- **DL-20.5** There is no spacing, weight, border-width or layer scale. The z-index order
  is behavioural (Settings under the modal scrim depends on 40 > 35), not a token.

## 21. Interaction states

- **DL-21.1** Selection is a full wash on `--tab-active-bg` at `--radius-control`: no
  accent bar, border, `--accent` fill or shadow. One signifier for the active tab, rail
  item, settings category, board row and workspace row. Two scoped exceptions:
  - a selected tab-strip chip (DL-18.10) also carries a neutral 1px `--hair-strong` frame,
    and every chip carries that border as `transparent` at rest so selection changes a
    color, never geometry; the chip's wash follows its `--radius-tab` corner;
  - the Electron card rail's focused agent row is an inverted fill (DL-27.22).
- **DL-21.2** Hover is a 6% `--tone` wash, quieter than selection and never the same
  value. Why: a hover that paints "selected" tells the user they chose something they did
  not.
- **DL-21.3** Focus-visible is a 2px `--accent` outline that composes with either wash.
  Inside `.settings-screen` the outline is `--text-muted` (DL-3.7).
- **DL-21.4** Disabled is `--text-faint` on the unchanged surface.
- **DL-21.5** State changes use DL-20.2's `--duration` / `--ease` and only DL-1.2's
  properties. Reduced motion is handled by scope (§9).
- **DL-21.6** No accent bar beside the wash: one state, one signifier.
- **DL-21.7** A tab-strip chip, and an Agent Board card (DL-34.2), carry a resting wash,
  `--tab-rest-bg` (3% `--tone`), so the ladder reads 3% → 6% hover → `--tab-active-bg`.
  Everything else has no wash at rest. Why: an object floating alone on `--bg` with no wash
  reads as nothing there.
- **DL-21.8** An `.iconbtn` that toggles a surface (sidebar, dock, `More`, the browser's
  Inspect) paints no active state: hover, focus and unavailable only. The surface it opens
  is the readout. `aria-pressed` / `aria-expanded` stay on the button. Rows in the `More`
  menu still report their state (DL-23.5).

## 9. Agent checklist (anti-drift)

Before shipping a chrome UI change, check the invariants; patterns are not on this list.

1. Every color maps to a role in §3; no hardcoded hex (DL-2.1).
2. Any animation fits §7 and §1. Reduced motion is handled **by scope**
   (`.settings-screen *`, `.usage-screen *`), never by an allowlist of class names, which
   silently misses the next class.
3. No uppercase and no `letter-spacing` on copy (DL-4.3); text size comes from a
   `--type-*` variable (DL-4.5); chrome text uses `--ui-font` (DL-4.1).
4. Text fields go through `CommitInput`, multi-line ones through `CommitTextarea`
   (DL-6.3, DL-13.5): a store value bound straight into an input inside a surface that does
   not unmount wipes what the user types.
5. Eye-review on a rendered screenshot before calling it done — a green build proves
   nothing about design.

## 10. Known invariant gaps

Open places where shipped CSS breaks an invariant. Fix one when its surface is reworked.

| where                              | breaks         | note                                                          |
| ---------------------------------- | -------------- | ------------------------------------------------------------- |
| `.wsitem__spinner`                 | DL-1.2         | `wschase`: an infinite opacity loop for the working ring      |
| `button.attn-mark`                 | DL-1.3, DL-1.2 | `transition: filter`                                          |
| `.usage-range__option.is-active`   | DL-21.1        | 4% `--fg` wash instead of `--tab-active-bg`                   |
| `.toolbar-menu__row.is-active`     | DL-21.1        | `--accent` ink, no wash                                       |
| `.worktree-agents__item.is-active` | DL-21.1        | correct wash plus an `--accent` border                        |
| `@phosphor-icons/react`            | DL-1.1         | the gzip cost of the icon package has never been measured     |

# Part II — Patterns

## 0. Current direction

Today's chrome reads like a well-kept config file: quiet rows of key → value in the
terminal's own colors. The terminal is the content and chrome recedes. This is a direction,
not a rule; a redesign may change it. The resource budget behind it is an invariant (§1).

## 8. Copy

- English UI. Keys and group labels are sentence-case (`Show pane bar`); descriptions are
  terse and sentence-case (`Reopen last session's tabs`); values are lowercase (`on`, `off`,
  theme ids as written in code).
- A control says what happens; no vague labels.

## 5. Config row

Every setting is a row: key (optional one-line description) on the left, one interactive
value on the right. Rows hold no checkbox lists, chip grids, sliders or boxed steppers; two or
three equal options use the `binary` segmented group (DL-6.5). A `cfg-group` label is `--ui-font`
14px muted, sentence-case. A `cfg-row` holds `cfg-row__key` (`cfg-row__label` 12.5px primary, an
optional `cfg-row__desc` 10.5px faint) and `cfg-row__value`, a right-aligned slot with one
`cfg-btn` pill.

- **DL-5.1** Row hover is DL-21.2's quiet wash and nothing else.
- **DL-5.2** The pill (`.cfg-btn`) is the value inside a 1px `--hair` border at `--radius-tab`
  (DL-20.1). Hover raises the border to `--hair-strong`; focus-visible draws a 2px `--accent`
  outline (DL-21.3); disabled uses `--text-faint` (DL-21.4).
- **DL-5.3** Affordance glyphs (`↹` cycle, `▾` menu, `…` picker, `↺` reset) sit inside the pill
  in `--text-faint` and turn `--accent` on pill hover.

## 6. Value kinds

A row's value is one of eight kinds.

| kind     | looks like                   | interaction                           |
| -------- | ---------------------------- | ------------------------------------- |
| `cycle`  | `▪ tokyo-night ↹`            | click advances to the next option     |
| `binary` | `Light │ Dark`               | segmented radio group; click or ←/→   |
| `menu`   | `JetBrains Mono ▾`           | invisible native `<select>` overlay   |
| `step`   | `− 14px +` in one pill       | −/+ zones inside the pill             |
| `color`  | `▪ #16161e`                  | invisible native color input overlay  |
| `picker` | `custom …`                   | opens a native OS dialog (file/image) |
| `toggle` | `on` (green) / `off` (faint) | click flips; `role="switch"`          |
| `action` | `↺ reset` (red for danger)   | click runs the action                 |

`picker` reads `default` / `custom`. Appearance and Agents draw booleans as neutral
rail-and-thumb switches (`role="switch"`, `aria-checked`); other categories use text pills.
Appearance mode is a labelled radiogroup of pictured cards rather than a config row (§24), with
the segmented picker's keyboard and conversion-confirmation behaviour and a neutral frame plus
selection wash on the selected card. Anchors: [Studio styles](../src/styles/11-settings-studio.css),
[mode selector](../src/ui/settings/theme-mode-selector.tsx).

- **DL-6.1** An overridden-from-default value, including a custom `picker` pick, may show a small
  `↺` clear button beside the pill, the one second element a value slot holds.
- **DL-6.2** A `menu` whose option list cannot cover every case (font family, editor command) may
  open an inline text row under its own row (`.cfg-custom`), not a modal and not a second pill. A
  `picker` surfaces its errors the same way, via `.cfg-custom--error`.
- **DL-6.3** Every text field uses `CommitInput` (`src/ui/controls/commit-input.tsx`): the draft
  lives in local state and commits on blur/Enter.
  Why: a store-controlled `value={…}` input is a data-loss bug; the panel never unmounts, so any
  re-render rewrites the DOM value and wipes what the user was typing.
- **DL-6.4** A pill holding several buttons (`step`) puts the focus ring on the focused button; a
  pill wrapping one invisible native input (`menu`, `color`) puts it on the pill via
  `:focus-within`.
- **DL-6.5** Two or three equal, mutually exclusive choices are a `binary` segmented group;
  `cycle` suits a long list and above three options the kind is `menu`. Markup is
  `role="radiogroup"` with one `role="radio"` per option, a roving `tabindex` (one tab stop), and
  ←/→ (or ↑/↓) moving the selection itself. The selected option carries DL-21.1's wash plus a
  scoped neutral 1px `--hair-strong` frame, since the track is itself a wash. Track corner
  `--radius-control`, segment corner `--radius-tight` (DL-20.1).

## 11. Full-window screens

A full-window screen covers the stage instead of sitting beside it: full-bleed (no inset, no
radius, no raised seam; DL-20.1) with a fixed nav rail beside a section area. Settings is the only
one; the docked side panel displaces the terminal grid instead (DL-19.1, DL-19.7).

- **DL-11.1** The shell is a fixed 220px nav rail plus a section area that owns all scrolling; the
  rail never scrolls with the content. Settings covers the whole window, frame row included:
  `.settings-screen` is `position: fixed; inset: 0` over the sidebar, rail and frame row, while
  the Open board still stops below the strip. It exits by Escape and by a **Back** control in its
  own header, because a window with no tabs would otherwise be stranded under it. The header
  reserves the window controls' footprint (`--frame-lights-w` for the macOS traffic lights,
  `--frame-controls-w` for the Windows caption buttons, DL-18.4) and carries the window's drag
  region. Asserted by [`app.test.tsx`](../src/ui/app.test.tsx).
- **DL-11.2** The active rail item takes DL-21.1's selection wash, with no shadow, fill (DL-1.3)
  or accent bar.
- **DL-11.3** Retired.
- **DL-11.4** Rail items are text only, with no icons, in sentence-case `--ui-font` (DL-4.1,
  DL-4.4). The rail item is the category name, so a section does not repeat it as a sub-heading.
- **DL-11.5** A destructive action is an ordinary rail category, last in the registry, with the
  same title, sentence and grouped surface as the rest (DL-11.6). Its row keeps `--red` (DL-3.2),
  which DL-3.7's achromatic Settings surface does not override. No destructive action, no category.
- **DL-11.6** The section side is a document: the category label as a scoped 24px heading
  (DL-4.5 exception 5, DL-4.3's optical-tracking exception), its one-sentence description at
  `--type-title` / `--text-faint` with a 58-character measure, a hairline, then one surface
  holding every row: `--chrome-1`, 1px `--hair` edge, `--radius-surface`, no shadow (DL-1.3).
  Groups inside it are separated by a rule, not another box. The column measure is
  `min(680px, 100% - 80px)`, centred. Row padding is 10px block, 12px once a description gives
  the key two lines. Appearance and Agents use separate groups with the same surface, edge and
  radius at `min(1080px, 100% - 80px)`; Appearance puts controls beside a read-only terminal
  specimen of the current settings, stacking below 1100px. The outer disabled fieldset, focus
  trap, Back/Escape and draggable header are shared. Anchors:
  [`settings-screen.tsx`](../src/ui/settings/settings-screen.tsx),
  [Studio styles](../src/styles/11-settings-studio.css).
- **DL-11.7** Below 720px the rail narrows to 132px and its label truncates, with `title`
  carrying the whole name; the document swaps its centring gutters for 18px of edge padding
  (Deck's minimum is 480px).

## 12. Editable lists

A list the user adds to and deletes from (user-declared agents) is still made of config rows.

- **DL-12.1** A list section renders one `cfg-row` per item (`.cfg-row--item`): the item's name
  is the row key and its value fills the right side. There is no table, card, drag handle or reorder
  affordance.
- **DL-12.2** An item row may carry one `×` after the value, `--text-faint`, turning `--red` on
  hover (DL-3.2). It removes that row's own item.
- **DL-12.3** The list ends with an ordinary `cfg-row` whose pill is the `action` kind (`+`).
- **DL-12.4** Items the user cannot edit stay in the same list under their own group label, with
  the pill disabled (DL-5.2) and no `×`.
- **DL-12.5** Editing happens in place, never in a modal or drawer. The row key and its value may
  each become a `CommitInput` (DL-6.3); an editable key is the one interactive row key, because
  renaming an item is editing it.

## 13. Anchored popovers

A popover is a small screen anchored to a chrome button, made of rows. It is the Prompt Board
popover and the rail worktree card's segment and actions menus (`docs/internals/agent-rail.md`).

- **DL-13.1** A popover is a `--chrome-2` surface with a 1px `--seam-raised` inset hairline at
  `--radius-surface` (DL-20.1), anchored to its trigger; inside the rail it takes the card's
  `--asr-card-radius` (6px). No blurred shadow (DL-1.3): depth comes from the background step.
- **DL-13.2** Esc, an outside click or completing the action dismisses it, and focus returns to
  the pane or control that had it. The trigger carries `aria-expanded`; the surface is
  `role="dialog"` with a label.
- **DL-13.3** Content is §5 rows and §12 list rows.
- **DL-13.4** A §12 item row may expand exactly one inline editor region beneath it
  (`aria-expanded` on the row); expanding a row collapses any other.
- **DL-13.5** Multi-line text uses `CommitTextarea` (`src/ui/controls/commit-textarea.tsx`):
  DL-6.3 semantics (local draft, commit on blur / Cmd+Enter, Esc reverts), auto-grown up to a max
  height, then scrolling.
- **DL-13.6** Transient controls (pickers, search) reset when the popover opens.
- **DL-13.7** A popover is raised by hover, press or keyboard.
  - Hover, for a popover that describes what its trigger already shows and adds no state: an open
    delay, a pointer bridge into the surface, a pin by trigger identity (not index) so a
    re-ranked trigger closes rather than re-targets the menu, and a close on scroll (a
    `position: fixed` surface does not follow its anchor). Keyboard focus raises the same surface;
    the native `title` is removed (DL-23.10) because it never appears on focus, and the state
    word is in the accessible name (DL-27.2).
  - Press, for a trigger that stands for several things (the strip's merged `×N` segment and `+N`
    tail): press pins the popover, which ignores the hover close and closes on Escape, an
    outside press, a second press on its trigger, a choice, or its trigger leaving the shown
    set; hovering another trigger re-targets it and drops the pin. The trigger carries
    `aria-haspopup` and `aria-expanded`. A trigger for one thing keeps its press as its own action.
  - Keyboard, for a chord: `⌘T` raises the rail card's actions menu with no open delay or pointer
    bridge, pinned from the start, closing on Escape, an outside press, any scroll or a choice. It
    hangs under the stage strip's leading edge and states its subject in a heading (DL-27.25). Its
    press-to-open triggers (`New agent`, the bare row) carry `aria-haspopup` and `aria-expanded`
    and drop their native `title` (DL-23.10).
- **DL-13.8** A menu row may spend two lines, icon · title · detail, where the second line says
  what pressing it will do. The title is `--type-meta` at weight 600 over detail at
  `--type-micro` in `--text-faint`; nothing goes below `--type-micro` (DL-4.5). Detail does not
  restate the scope the surface states once.

## 14. Icons

Functional icons come from one package, `@phosphor-icons/react`, drawn through one primitive.

- **DL-14.1** `@phosphor-icons/react` is the only source of functional icons and `DeckIcon`
  (`src/ui/controls/deck-icon.tsx`) the only place its presentation is set: `color="currentColor"`,
  the weight, `aria-hidden`, `focusable="false"` and the unconditional `deck-icon` class. Icons are
  imported by name; nothing else authors an `<svg>` and no glyph character stands in for an
  action (`scripts/icon-system.test.ts`).
  - Weight is `bold` (24/256, about 1.2px) for every icon and `fill` for icons with a body whose
    silhouette survives filling: folders, files, `Robot`, `Gear`, `Trash`, `TerminalWindow`,
    `ChatText`, `ClipboardText`, `PaperPlaneTilt`, the pins, `Play`, `Stop`, `Gauge`,
    `GithubLogo` and `SidebarSimple` (both panel toggles). Glyphs, arrows, carets, layout pictures
    and stroke figures stay outlines: `fill` turns `X`, `Plus`, `Minus` and `Check` into solid
    tiles with the mark knocked out, carets into solid triangles, `Globe` and `Info` into a
    half-solid disc, and a solid `Star` reads as already starred.
  - The surface-scoped `filled` prop is a closed boolean, not a `weight` escape hatch. It is used
    by the rail's fallback project `Folder` in live and remembered headers
    ([`agent-rail.tsx`](../src/ui/agent-rail.tsx), DL-27.17), the three icon-only dock tabs
    (`TreeView`, `Gauge`, `ClockCounterClockwise`) and the toolbar's `More` trigger
    (`DotsThreeOutline`). `mirrored` flips a one-sided mark: the dock's toggle is `SidebarSimple`
    mirrored. The class is Deck's own `.deck-icon`, never a vendor name.
  - Why: weight lives in path data, not an attribute, so `deck-icon.test.tsx` compares drawn
    output against the library's `bold` / `fill`, and `dock-tabs.test.tsx` pins the dock icons.
- **DL-14.2** Four sizes are exported from `deck-icon.tsx` and used by name: `CHROME_ICON` 13
  (tab bar, titlebar), `ROW_ICON` 14 (config-row and popover actions), `BOARD_ICON` 15 (Open
  Board rows) and `RAIL_ICON` 16 (the `More` menu's rows, DL-23.9). `FEATURE_ICON` is the same 15
  for entry-point controls: the dock header's tab chips and panel toggle, and the toolbar's `More`
  trigger (DL-23.8). Their `.iconbtn` box stays 24px; the stage-strip panel toggle and the
  external-app split-button's caret stay at `CHROME_ICON`. The control sets padding and geometry,
  never the icon.
- **DL-14.3** CSS does not set `width`, `height`, `fill`, `stroke` or `stroke-width` on an icon:
  those declarations beat SVG attributes and silently disable DL-14.1, and a stray `fill` erases
  the icon. Colour is `color`, reaching the icon through `currentColor`.
- **DL-14.4** Icon-only controls are for familiar, repeated actions that carry a hover tooltip
  (close, add, split, next). Consequential or rare actions keep their word beside the icon:
  Restore Defaults reads `reset`, the Open Board's button reads `Open Folder…`.
- **DL-14.5** `Trash` deletes something the user declared and stored, `X` dismisses something
  transient, and actions that differ in consequence do not share an icon (Prompt Board uses
  `ClipboardText` and `PaperPlaneTilt`). Phosphor has no folder-with-git or branch-with-plus, so
  the create-worktree action keeps `GitBranch` and the rail's repository row uses `GitFork`.
- **DL-14.6** Outside the library by intent: the Deck brand mark, agent and OS logos, keyboard
  and terminal notation (`⌘`, `⏎`, `⎋`), selection and status dots, and `WorkspaceSpinner`.
  Every rail status mark is CSS (DL-27.3).
- **DL-14.7** The external-app control draws the icon of the installed version: the bundle's own
  `.icns`, converted by `/usr/bin/sips` and delivered as a `data:` URL in an `<img>`. No
  third-party logo is stored in the repo. A missing icon falls back to the app's initial on a
  `--chrome-2` tile, with the tooltip carrying the name, never an authored mark. Sizing is in CSS,
  which DL-14.3 allows because it governs authored `<svg>`.
  Why: `app.getFileIcon` returns the generic document icon for every `.app` bundle.

## 15. Read-only data tables

A page of measured numbers, such as the token usage grid, is a table of facts: every cell was
counted, and the table has no interaction.

- **DL-15.1** A metric table sits on the screen's own `--chrome-2` surface inside a 1px `--hair`
  container at `--radius-control` (DL-20.1). Rows are separated by `--hair` hairlines only: no
  zebra striping, no fills, no shadow (DL-1.3, DL-3.3).
- **DL-15.2** A metric table is read-only: no sort control, column reordering, row click target
  or row hover treatment.
  Why: DL-21.2's hover wash means "this row does something"; a row that lights up and does nothing
  breaks that promise.
- **DL-15.3** Horizontal overflow scrolls inside the table's own container (`overflow-x: auto`),
  never on the page body and never by shrinking the type. The shell around it keeps
  `min-height: 0` and a `minmax(0, 1fr)` track so the grid can shrink (DL-11.1).
- **DL-15.4** Numerals are right-aligned with `font-variant-numeric: tabular-nums` (DL-4.2); text
  columns are left-aligned. There is no `--mono` token: the monospace face is the terminal's
  (DL-4.1).
- **DL-15.5** A column header is sentence-case `--ui-font` at 10.5px in `--text-faint` at normal
  weight (DL-4.1, DL-4.3, DL-4.4), with no uppercase, bold or sort caret.
- **DL-15.6** An unknown, unavailable or not-applicable value renders as a single em dash `—` in
  `--text-faint`, never `0`, `n/a` or an empty cell.
- **DL-15.7** The markup is a real `<table>` with `<thead>`, `<tbody>`, `<th scope="col">` on
  every column header and `<th scope="row">` on the cell that identifies the row. The accessible
  name comes from a visible heading above via `aria-labelledby` and any disclaimer below via
  `aria-describedby`, not `<caption>`, which would slide out of view inside the DL-15.3 container.
- **DL-15.8** A table with no rows still renders its header row plus one spanning cell, in
  `--text-faint`, saying what is absent.
- **DL-15.9** A cell may hold rendered content rather than a string, and it stays facts (DL-15.2):
  no button, link, hover treatment, or tooltip carrying the only copy of a value. A brand mark is
  the shared asset (`src/lib/agent-logos.ts`), sized to the cell's line, with an empty `alt` when
  the name it identifies is the next element. Subordinate figures in a cell are `--text-faint`,
  right-aligned and tabular (DL-15.4); sub-lines that align across rows are one grid with fixed
  track widths, because an `auto` track resolves per cell.

## 16. Usage overview

The usage overview leads with the cost figure, then current allowance, then history. Allowance
comes from limit readings, cost from recorded token history; neither is a subscription invoice.

- **DL-16.1** The page runs **Estimated API cost → per-agent accounting and pricing details →
  Remaining allowance → cost period → Cost over time**; the selector sits beside the chart it
  names and still scopes the figure above it. The
  [allowance table](../src/ui/usage/remaining-allowance.tsx) shows actual returned durations,
  visible reset times and remaining percentages; missing, expired, failed and unsupported
  readings stay unknown, a measured zero stays zero. Allowance ignores the cost period, stays
  visible while token history loads or is stale, and keeps DL-33.1's treatment in the sidebar.
- **DL-16.2** The compact figure has the sentence-case label **Estimated API cost**, tabular
  numbers and a visible API-equivalent disclaimer. The
  [Overview treatment](../src/styles/12-usage.css) puts it first, separated from the allowance
  and chart by a hairline, on flat surfaces and theme tokens. A partial estimate discloses the
  excluded models and tokens; an absent amount is a dash, never zero.
- **DL-16.3** A **share bar** sits under any row that names a part of a stated total: a
  full-width track 4px tall, radius 2px (a capsule, not a DL-20.1 value),
  `color-mix(in srgb, var(--fg) 8%, transparent)`, filled left to right by the share. No
  gradient, shadow or animation (DL-1.3, DL-1.2).
- **DL-16.4** The fill takes the subject's established colour; for an agent, the `dotColor` of
  its pane dot and tab (`src/lib/process-info.ts`). It adds no colour role and no logo colour.
- **DL-16.5** A share bar is drawn only when its stated total is on screen, and is not a gauge
  or a meter against a budget. With no total, every bar is an empty track and no percentage is
  printed.
- **DL-16.6** Share bars are non-interactive and `aria-hidden`; the percentage is also text in
  [agent accounting](../src/ui/usage/sections/overview-section.tsx). The
  [cost timeline](../src/ui/usage/cost-timeline.tsx) draws static stacked columns in agent
  colours with a legend, a shared USD scale, interval labels and actual covered boundaries.
  **Chart data** is a keyboard-accessible disclosure with semantic row/column headers and exact
  formatted values, including missing and unpriced data. Colour and hover never carry meaning
  alone.
- **DL-16.7** The [cost-period selector](../src/ui/usage/usage-range-selector.tsx) sits between
  allowance and chart. Today, 7 days, 30 days and All update the chart, total, per-agent amounts,
  shares, tokens and price omissions together; allowance and reset times do not change.
  **Chart data** and **Pricing details** disclosures are allowed. The selector is segmented, not
  a §6 `cycle` pill, so every period is visible at once. Options are sentence-case `--ui-font`
  (DL-4.1, DL-4.4) on one row; the selected one wears the 4% `--fg` wash of DL-5.1 and DL-11.2,
  with no filled pill, chip, underline, border or shadow. The selected option stays visible
  beside every historical figure, an empty period says which period is empty, and the selection
  resets when the screen closes (DL-13.6).

## 17. Shortcut rows

Shortcut rows are §5 config rows in the Shortcuts settings category, each showing the running
platform's keymap only; the other platform's overrides stay stored and are not rendered.

- **DL-17.1** A shortcut row is a `cfg-row` (`.cfg-row--shortcut`) with every §5 property: key
  on the left, value slot on the right, DL-5.1 hover, the same vertical rhythm.
- **DL-17.2** The value slot holds the running platform's chord only, with no platform tag.
- **DL-17.3** The chord is a `cfg-btn` pill that records a chord when clicked. A value that
  cannot be pressed renders as a **readout**: no border, `--text-faint`, as on the repository
  rail.
- **DL-17.4** An action with no chord on the running platform reads `unbound` in `--text-faint`;
  this is a normal state, not an error.
- **DL-17.5** A chord claimed by two actions is named on both rows, in the row's `desc` slot, in
  `--red` (DL-3.2). It is reported, never refused, so two chords can be swapped.
- **DL-17.6** The row's only second element is DL-6.1's reset button, shown whenever the row
  carries a user override, including one equal to the shipped chord. While recording, a chord
  rebinds, bare Backspace/Delete unbinds and Esc cancels.
- **DL-17.7** Chords are notation, not icons (DL-14.6): `⌘⇧D` and `Ctrl+Alt+T` render as text,
  spelled only by `formatShortcutBinding` (`src/lib/shortcut-label.ts`).
- **DL-17.8** A refused keystroke says why, in the pill, and keeps listening. Each reason has
  its own words ("reserved by macOS", "add ⌘, ⌃ or ⌥"); none shows the idle "press keys…".

## 18. Command-row frame

Deck draws its own top row, the one permanent row that carries the window's identity and its
actions. §11 covers a full-window screen and §13 an anchored popover; neither describes it.

- **DL-18.1** There is one chrome row per layout. The retired `.titlebar` and `.deck-toolbar`
  elements are gone, and `src/ui/app.test.tsx` asserts both are absent.
- **DL-18.2** The row is `--frame-h` (34px) tall. In top-tab mode it paints `--chrome-1` and
  closes with a single `--seam-divider` bottom border (DL-2.3, DL-18.6). In sidebar mode its
  two occupants paint their own columns: `.deck-frame` uses `--sidebar-bg`, continuous with
  the rail under it, and `.stage__strip` stays transparent on the stage's `--bg`.
- **DL-18.3** Whichever element occupies the row is the frame, and the layout decides where
  the row is. In sidebar mode the shell's vertical seam splits it: `.deck-frame` at column 1
  carries the actions above the rail, `.stage__strip` at column 2 carries the tabs
  (DL-18.6). In top-tab mode the frame is `.tabbar` spanning the window, with the same
  height, `--chrome-1` and seam, and no `.deck-frame` is rendered.
- **DL-18.4** Each platform reserves the side of the row where its OS paints the window
  controls, as an inset inside the row: on macOS the traffic lights at the left behind
  `--frame-lights-w`; on Windows under the Electron host the minimize, maximize and close
  buttons at the right behind `--frame-controls-w`. The occupant at that end reserves the
  inset itself ([`22-caption-overlay.css`](../src/styles/22-caption-overlay.css)). The inset
  holds no content: the OS paints over exactly that box.
- **DL-18.5** Platform differences change the inset, never the row. `--frame-lights-w` is
  `0px` under `.window--windows`; `--frame-controls-w` is `0px` unless the shell carries
  `window--caption-overlay`, which `DesktopChrome` sets only on Windows with the Electron
  host. Tauri's Windows build keeps a native title bar above the row and reserves nothing.
- **DL-18.6** The tabs are the frame row's stage-side occupant in both layouts: `.tabbar` in
  top-tab mode, `.stage__strip` in sidebar mode, the same `TabStrip` in a `--frame-h` row.
  `.tabbar` closes with a 1px `--seam-divider` bottom edge; `.stage__strip` is transparent on
  `--bg` with no line under it, parted from the work area by the stage gutter alone. Its right edge stops at the docked panel when one is open (DL-19.1, `--explorer-w`).
  The rail lists no documents; the strip says what is open.
- **DL-18.7** The stage is the focal surface in every theme. The terminal and document
  surface keep the theme's `--bg`; the navigation frame and rail and every docked side panel
  share the derived `--sidebar-bg`, which never equals `--bg` (light and pure-black
  overrides included; [`derive-colors.ts`](../src/lib/derive-colors.ts)). On a dark theme the
  columns rise off the stage: `--sidebar-bg`, then `--chrome-1`, `--chrome-2` and
  `--tab-active-bg` stand above it, each measured from the sidebar rather than from `--bg`,
  in steps of 3/6/10 (light themes use 5/9/15 and their columns recede). `--input-bg` still
  recedes toward the stage; `--seam-raised` sits on the same ladder.
  Why: the dark steps stay narrow because the sidebar already spends 8% of DL-3.5's headroom.
- **DL-18.8** The browser is a stage surface, not a docked column: one chip on the strip, a
  globe plus the page title, ordered by when it was opened. While active it covers the
  terminal grid as the document surface does (the same `.stage__surface` rectangle and
  explorer inset, terminal left mounted). At most one surface holds the stage; activating
  another surface or a terminal steps the others back. The page is a native view above every
  DOM layer, so the surface tells the host to hide it whenever a DOM overlay opens or it
  loses the stage (DL-19.6). Closing the chip hides the view and keeps the page; only
  closing the window destroys it ([`BrowserSurface`](../src/browser/browser-surface.tsx)).
- **DL-18.9** The navigation column is resizable and hides completely. Its seam is a 9px
  drag target that paints nothing at rest ([`SidebarGrip`](../src/ui/sidebar-grip.tsx));
  hovered, and for the whole of a drag, it lights the `--stage-gutter` between column and
  stage in full `--accent` at `--radius-flat`, as `.split__divider:hover` does. The docked
  column's seam is identical (DL-19.4). A drag pulled past the floor hides the column instead
  of clamping: rail, frame row and seam go to zero and only the traffic lights' reserved
  inset survives, carried by the stage strip. The feature toolbar rides the strip's trailing
  end, and while the column is hidden the hide control moves to the strip's leading edge.
  `App` writes `--sidebar-w` and `[data-sidebar-collapsed]` onto `:root`
  ([`applySidebarShell`](../src/ui/sidebar-shell.ts)). On Electron the collapsed column is
  DL-27.29's avatar column; Tauri hides it.
  The frame row ([`SidebarFrameActions`](../src/ui/sidebar-toggle.tsx)) holds the traffic
  lights and the hide control at the left and, right-aligned, the Deck logo, the `Deck`
  label and the running version (`V1.2.3`), truncated on a narrow sidebar with the full
  value in a tooltip; the gap is a window drag region. Local Electron builds show an
  accent-filled `DEV` badge instead of the version (`isDevelopment` in
  [`platform.ts`](../src/lib/platform.ts)). A 1px `--hair-strong` bottom border separates
  the row from navigation. Below it the Electron rail mounts the create row (DL-27.14); Tauri's
  `RepositoryRail` keeps a pinned `New Workspace` launcher.
- **DL-18.10** A strip chip is a document or the browser, and both look identical: the same
  height, `--radius-tab`, `--type-meta` label, `max-width` (full name in `title`), close
  control and DL-21.1 wash when selected. A fixed 15px glyph slot holds one mark that says
  what the chip opened: the tree's file-type icon for a document
  ([`fileIcon`](../src/files/ui/file-icons.ts)), a globe for the browser. A chip says what
  is open and nothing else: no colour dot, no agent attention mark, no rename popover, and
  clicking the chip that holds the stage does nothing. The only dot is a document's unsaved
  marker. The close control's hover is DL-21.2's neutral wash, not red: closing is undoable (⌘⇧T).
  Order is when the chip was opened, on one window-wide clock. Dragging reorders within the
  pinned or the ordinary group, with a neutral insertion line and a label ghost; the strip
  scrolls horizontally on overflow, also during an edge drag; Escape cancels. Pinned chips
  come first, show a trailing pin glyph instead of the close button, and sit a 6px
  additional gap before the others. Right-click or Shift+F10 opens a popover with
  **Pin/Unpin**, **Close**, **Close Others** and **Close to the Right**; disabled actions
  stay visible, arrows move focus, and Escape or an outside press returns focus to the chip
  ([`TabStripMenu`](../src/ui/tab-strip-menu.tsx)). Order and pins last for the window
  session. ⌘⇧[ / ⌘⇧] and ⌘1–9 follow the visible order, sidebar mode scoping terminal tabs to
  the active repository; bulk closes skip pinned and hidden chips, keeping Busy/dirty guards.
  Terminals are not chips: DL-35.3's space marks come before every surface chip, with no
  label, glyph, close control, drag or pin, and a mark carries needs-you in yellow.
- **DL-18.11** No effect runs on a pane's top edge: no working line, no rail-click locator
  ([pane styles](../src/styles/06-stage-panes.css)). Rail selection still activates the
  exact pane, and agent phase and attention feed the rail indicators. The focused pane of a
  multi-pane tab wears a static focus mark: its card edge in the rail's inverted fill
  (DL-18.12) and its header joined to the terminal (DL-32.7). Only a `--duration` colour
  change animates; a one-pane tab has no mark (`is-active` is not set).
- **DL-18.12** A pane is a card on the stage gutter. `--stage-gutter` is 4px on all four
  edges of the work area and between panes
  ([`06-stage-panes.css`](../src/styles/06-stage-panes.css)); the card's 6px corner is
  `--radius-tab` (DL-20.1). The gutter paints `--sidebar-bg` (DL-18.7) and the card carries a
  1px `--seam-split` border. It is a real `border`, not DL-1.3's inset hairline: xterm fills
  the padding box and would paint over an inset line. The document surface takes the same
  gutter and radius; the browser tab is the exception, its web content being a native view
  that CSS cannot round. `.window--sidebar > .stage` carries the shell's one vertical line, a
  1px `--sidebar-seam` `border-left` running the frame's full height; a collapsed sidebar
  drops it. On the focused pane of a multi-pane tab
  (`.pane-slot.is-active`, set by [`layout-engine.ts`](../src/terminal/layout-engine.ts))
  the border takes DL-27.22's inverted fill, `--text-primary` at 74% over `--sidebar-bg`,
  and eases back with DL-20.2's motion pair; the card does not move.
  Why: the gutter is 4px because a terminal is measured in cells and 8px cost columns.

## 19. Docked side panels

A docked panel is a permanent column beside the stage that displaces content instead of
covering it; the file explorer is the resident instance.

- **DL-19.1** A docked panel is a column of the stage, not an overlay. The terminal grid's
  bounds shrink by exactly the panel's width, so panes resize around it.
- **DL-19.2** The seam is a single `--hair` border on the panel's inner edge (DL-3.3), with
  no shadow, gradient or second rule. The background step from `--bg` to `--sidebar-bg`
  separates the regions and keeps the panel on the navigation sidebar's plane (DL-18.7).
- **DL-19.3** The header is the tab row (DL-19.7), built from the window's own controls at
  the tab bar's 13px chrome icon size (DL-14.2). It is `--frame-h` tall with
  `box-sizing: border-box`, closing on the same pixel row as the stage strip beside it. A
  shown column carries its hide control at its outer edge, ending the tab row at the
  window's right edge short of the Windows caption buttons' footprint (DL-18.4); the stage
  strip carries the control only while the column is gone, and `App` gates that mount on the
  panel being absent ([`DockPanel`](../src/ui/dock/dock-panel.tsx)).
  Why: a 28px header once landed its hairline 5px above the strip's.
- **DL-19.4** Width is set by dragging the seam, persists as an ordinary setting and is
  clamped to a min and max; the floor is 360px. The drag target is 9px wide and paints
  nothing at rest; hovered, or during a drag, it lights the panel's hairline in the accent
  (DL-18.9, whose navigation seam behaves identically). A drag pulled past the floor closes
  the column under the pointer, and it returns if the pointer does; the width is written
  only on release, and a close writes none. The slide-over (§7) is suppressed during the
  gesture, since 280ms of easing inside a drag reads as lag
  ([`resolvePanelDrag`](../src/ui/panel-resize.ts)).
- **DL-19.5** One status line sits directly under the header, in `--text-faint` (DL-3.4) or
  `--red` for a failure (DL-3.2), and is the panel's only place for transient text. A panel
  reports its own state (a failure, a progress step, an unreadable directory) there and
  never raises a dialog; a dialog the user pressed a control to open may use the shared
  `Modal` shell (DL §29). Why: a background event must not steal the window.
- **DL-19.6** Foreign content (a web page, a preview) gets its own rectangle below the
  header, the only part of the column Deck does not paint. A native view cannot be covered
  by any DOM layer, so the panel hides it whenever an overlay opens.
- **DL-19.7** A panel hosting more than one surface names them in a tab row and shows exactly
  one at a time. The row is the header (DL-19.3): a `role="tablist"` of `role="tab"` chips,
  the active one carrying DL-21.1's full wash and idle chips none. The chips are icon-only,
  grouped immediately before the right-panel toggle at the window's outer edge, each with a
  sentence-case `aria-label` and DL-23.10's tooltip; their glyphs use Phosphor's `fill`
  weight, a surface-scoped exception to DL-14.1 ([`DockTabs`](../src/ui/dock/dock-tabs.tsx)).
  A tab the running host cannot serve is omitted, not disabled. The selection persists as a
  setting and is re-resolved against host support on every read, so changing host never
  paints an empty column ([`availableDockTabs`](../src/ui/dock/dock-tab-registry.ts)).
- **DL-19.8** A screen that moves into the column leaves its rail behind: §11's 120px rail
  would take a third of a 360px panel, so it becomes a compact chip row above the content,
  with the same `role="tablist"` and DL-21.1/21.2 selection language, walked with ←/→. A
  chip may print a shorter label if its full name stays the accessible name (WCAG 2.5.3).
- **DL-19.9** A panel tab hangs its own actions off the row that names what it shows; the
  shared header carries no control belonging to one tab. They are a trailing cluster of
  icon-only controls, visible at rest, sized to the row rather than to chrome: `.iconbtn`'s
  24px box would overflow the 22px data row, whose height every virtual-list index is computed
  from ([`TreeRootActions`](../src/files/ui/tree-root-actions.tsx)). The explorer's tree-root
  cluster is New file and New folder (omitted when the host cannot create), Show hidden
  files, Refresh and Collapse all: 89px at DL-19.4's floor, and the root's name truncates
  first. Show hidden files is a toggle: `aria-pressed` carries its state and its glyph shows
  it (`EyeSlash` hidden, `Eye` shown), with no wash; its tooltip is the name alone. The
  Explorer has two views and shows its switch above that row: a `role="tablist"` of two
  chips, Files and Changes, in a 28px row with DL-21.1's wash on the active chip at
  `--radius-tab`, walked with ←/→ ([`ExplorerSwitch`](../src/files/ui/explorer-switch.tsx)).
  The row below names the view showing: the tree root for Files, the branch for Changes,
  where the totals and Refresh sit ([`ChangesList`](../src/files/ui/changes-list.tsx)). A
  Changes chip the folder cannot serve is disabled with its reason, because a hidden entry
  cannot say why (DL-21.4); on a host that cannot serve the read the switch is omitted
  (DL-19.7).
  Why: the wash is DL-21.1's selection signifier, and a filter is not a selection.
- **DL-19.10** The explorer marks the document on the stage. While a file tab holds the
  stage, the row with that document's path carries DL-21.1's wash at `--radius-tab`
  (DL-20.1's 28px clause; hover takes the same corner), its name and icon take
  `--text-primary`, and it is `aria-selected`; DL-21.3's ring composes with it. When the
  document changes, the tree opens the folders above it and scrolls only as far as the row
  needs, never moving keyboard focus or the roving tab stop and never opening the dock. A
  document outside the root, under an excluded name, or a dot-path while hidden files are off
  marks nothing and changes no filter. While a terminal holds the stage no row is marked.

## 23. Action tooltips and the `More` menu

An action tooltip appears when the pointer pauses on a control. `More` is the toolbar's
overflow menu and the permanent home of the pane group.

- **DL-23.1** A tooltip shows the action's name, its chord when the active platform has one,
  and the reason when the action cannot run, and nothing else: no empty brackets, no idle
  placeholder. The trigger's accessible description carries the same content.
- **DL-23.2** Tooltip copy is sentence case. The action registry keeps its Title Case menu
  labels and trailing ellipses; the toolbar projection re-cases at its own boundary.
- **DL-23.3** A tooltip is a `--chrome-2` step with a 1px `--seam-raised` hairline (DL-2.3),
  `--radius-control`, DL-20.2 motion and `pointer-events: none`, so it never sits between the
  pointer and its control. No timers drive it (DL-1.3): it follows hover and focus.
- **DL-23.4** The tooltip and the overflow menu position `fixed` from a rect measured at
  open. A tooltip opens below its trigger by default; the rail's tools row, in the window's
  bottom edge, passes `placement: "above"`, and the tooltip is centred above it, clamped
  124px from the window's sides (below-opening tooltips use 90px)
  ([`action-tooltip.tsx`](../src/ui/controls/action-tooltip.tsx)).
- **DL-23.5** The overflow menu is a §13 popover made of rows. Group order, icon, label,
  chord and state survive the move off the bar, and the group separator moves with them.
  Arrows move focus with wraparound, Home/End jump, and unavailable rows stay in the cycle
  so their reason is reachable without a pointer.
- **DL-23.6** Unavailable is not disabled. A control that cannot run keeps its place in the
  tab order, reads `--text-faint` on an unchanged surface (DL-21.4), drops the hover wash,
  blocks activation and says why in its tooltip.
  Why: a `disabled` attribute makes the reason unreachable by keyboard.
- **DL-23.7** The update pill re-measures its reserved width when the toolbar resizes; a
  phase change that widens it without a resize can overlap for one frame.
- **DL-23.8** The pane group lives in `More`, not on the bar: Split vertically, Split
  horizontally, Focus expand and Close pane are rows at every window width, so the toolbar
  at the stage strip's trailing end can render zero controls and still draws the `Ellipsis`
  `More` control ([`feature-toolbar.tsx`](../src/ui/toolbar/feature-toolbar.tsx)). On
  Electron's sidebar layout `More` carries the pane group only, the global group being the
  rail's icon row (DL-28); top-tab mode, Tauri and an Electron window with no live rail print
  the pane group, a hairline, then the global group
  ([`deck-toolbar.tsx`](../src/ui/toolbar/deck-toolbar.tsx)).
  Why: a plain shell pane has no agent header (DL-32.8), so `More` keeps the pane group.
- **DL-23.9** `.toolbar-menu__row` takes `--type-title` (14px) for its label, `--type-body`
  for its chord and `--type-meta` for its unavailable reason, with a `RAIL_ICON` (16px)
  leading mark and 6px of vertical padding, a 28px row. This is a role widening of DL-4.4
  for this menu alone; §13's other popovers and §5 config rows keep `--type-body`/`ROW_ICON`.
- **DL-23.10** Any icon-only chrome control with an action may draw this tooltip; the dock
  header's three tab chips and its panel toggle do. A control that takes it drops its native
  `title` and resolves its chord from the action id through `shortcutLabel`, never a
  literal, so a rebind reaches the text and each platform sees its own notation.
  Why: two tooltips for one control is one too many; the native one skips keyboard focus.
- **DL-23.11** The toolbar carries one split-button, the external-app control: an icon that
  performs the frequent action (open this workspace in that app) joined to a caret that
  changes which app. The pair reads as one object, with a shared hairline frame, the caret
  narrower than the action and no gap. The caret opens the same `.toolbar-menu` popover that
  `More` opens. The control is absent, not disabled, when the host reports no installed app
  (DL-19.7); the action half takes DL-23.1's tooltip and DL-23.6's unavailable treatment.

## 24. The theme gallery

A grid of theme cards in [`theme-gallery.tsx`](../src/ui/settings/theme-gallery.tsx), mounted by
nothing: Appearance in Settings is a binary group (DL-6.5) over `deck-light` and `deck-dark`.
The component still builds and passes its tests, and the rules below describe it.

- **DL-24.1** The gallery is the only grid in a settings section and exists only for the theme.
- **DL-24.2** A card is a miniature of Deck, not a strip of swatches: the command row, the
  navigation rail and the stage in the window's proportions, with an agent line for the accent.
- **DL-24.3** Card colours are inline styles from that theme's own object, passed through
  `deriveChromeColors` ([`theme-card-preview.tsx`](../src/ui/settings/theme-card-preview.tsx)),
  as DL-2.1's swatch exception. Why: a card shows a theme that is not running, while every
  `--token` resolves to the one that is.
- **DL-24.4** The selected card is marked by an `--accent` border and a check in its footer, an
  exception to DL-21.1's one signifier: a selection wash is invisible over any preview colour.
- **DL-24.5** Actions are §5 `action` rows under the grid: import opens a native picker (§6's
  `picker` kind) and the folder row reveals the themes folder in the OS file manager. Removing
  an imported theme is deleting its file; there is no delete button.
- **DL-24.6** A file in the folder that does not parse gets a §5 row naming the file and the
  reason, in the danger treatment (DL-3.2); it is never dropped silently.

## 25. History rows

History rows list past sessions on the session history screen: content plus one named action,
resuming the session.

- **DL-25.1** The row body is inert and a visible `Resume` control is the only thing that acts;
  a row has no second action. Why: resuming spawns a pane, cds into a recorded directory and
  types a command with no undo, so a stray click on the list must not fire it.
- **DL-25.2** Row content runs in fixed order: an identity mark for the agent that ran it, the
  session's name (its title, or its id when no title was found), the project directory, when it
  last changed, and the action at the trailing edge. A long name truncates; nothing reorders.
  The identity mark is the agent's brand mark through
  [`AgentGlyph`](../src/ui/controls/agent-glyph.tsx), as in the rail row and strip chip.
- **DL-25.3** A row whose action cannot run is unavailable, not disabled (DL-23.6): it keeps its
  place in the tab order, reads `--text-faint` on an unchanged surface, drops the hover
  treatment and carries its reason in an accessible description. The action button itself stops
  looking runnable.
- **DL-25.4** A list that shows less than it found says so at its foot, naming the bound and the
  total.
- **DL-25.5** The action wears DL-5.2's quiet bordered pill: transparent fill, 1px `--hair`
  border at `--radius-tab`, hover moving `border-color` to `--hair-strong` and nothing else. It
  has no readout, chevron or state, and is always visible, never revealed on hover.

## 26. The sidebar banner

Removed with its code; the rail now closes with the footer described in §28.

- **DL-26.1** Retired.
- **DL-26.2** Retired.
- **DL-26.3** Retired.
- **DL-26.4** Retired.

## 27. The agent status rail

The navigation rail whose unit is a live agent rather than a checkout. On Electron,
[`AgentRail`](../src/ui/agent-rail.tsx) draws a flat tree, project › checkout › session, with
one two-line row per agent. Tauri keeps the legacy [`RepositoryRail`](../src/ui/repository-rail.tsx)
and does not inherit the Electron patterns below. The rail amends DL-3.2 (`--yellow`, DL-27.6)
and spends one scoped DL-1.2 exception on the unread ripple (DL-27.3); DL-1.3 is untouched,
because the ripple is a filled `::after` moved by `transform` and `opacity`, with no blur and no
shadow.

- **DL-27.1** A rail row is a container with a full-bleed hit layer behind it, not a
  `<button>`. Controls on the row, such as close, are real controls above that layer; the inert
  text spans pass their clicks through to it.
  Why: a button inside a button is not operable, so a row that carries its own smaller targets
  cannot be one element.
- **DL-27.2** A row carries at most one painted state mark; on Electron it is the corner badge
  on the row's logo (DL-27.21). No status word is painted as a mark; the word lives in `title`
  and the accessible name even when no mark is painted. On the tree, a session row's second
  line carries the state word as text when the agent has no turn yet: `Working`, `Needs you`,
  `Failed`, `Finished`, `Ready`, `No signal`, `Ended`.
  Why: a second signifier for the same state is DL-21.6's mistake.
- **DL-27.3** State has six words, drawn as one mark in a fixed 14px box (the resting dot paints
  9px of ink centred in it by `::before`), so row geometry never moves between states.
  - `failed` is `--red`. `asked` is `--status-unread`: a question, a permission wait, or a
    finished run not yet checked (the fold lives in one case label of `paneState`).
  - `done` and `idle` share one gray dot, `--tone` at 45%. `done` is a run the user checked;
    `idle` is an agent that has never run anything (the tracker's `hasRun` bit).
  - `ended` is a 7px square in the quiet gray, the one non-round mark in the column. It marks an
    agent whose process left the pane while the pane stayed up, with any exit status and no CLI
    error event. It spends no hue: not `--red`, which is only a CLI's own error event, and not
    `--status-unread`. The row keeps its agent name and glyph until the end is checked (the user
    focuses the pane, or output arrives while the pane is visible), then reverts to the shell it
    now is. A latched `error` or `warning` outranks the end; a `requested` or `completed` is
    dropped with the agent.
  - `working` is not a dot but `WorkspaceSpinner`, the ring the workspace avatar uses: 14px in
    `--text-primary`, 8 round dots holding still while a bright head runs around them on a
    staggered opacity cycle (`wschase`, 1.2s). The Electron row's working mark is the braille
    spinner of DL-27.21.

  When panes fold into one mark the loudest speaks: failed > asked > ended > working > done >
  idle. `failed` never reads as `idle`.

  Each mark carries its confidence: `explicit` (the CLI said it over a documented channel: OSC
  9;4, a BEL, a hook, the registry), `inferred` (read off output timing or the process table) or
  `unknown`. On the leading rail mark an inferred `asked` or `done` is drawn hollow, the same
  9px and hue with a 1.5px ring in place of the disc; `unknown` is the resting dot. `failed` is
  never hollow and `working` keeps its ring. The accessible name spells the doubt out:
  `needs you (inferred)`, `done (inferred)`. Electron badge dots are solid at both confidence
  levels (`asked` yellow, `done` quiet gray), `ended` is a filled quiet-gray square distinct from
  the round `done` dot, and idle paints no dot; the qualifier stays in the tooltip and accessible
  name ([card status styles](../src/styles/04c-rail-worktree-card.css)).
  Why: a dark surface must not turn a dot's centre into a dark hole.

  `asked` radiates: a 13px disc under the dot expands to 2.1x and fades on a 1.8s loop, so
  unread is the one state that radiates. The loop is infinite only while `[data-state="asked"]`
  is on the element, animates `transform` and `opacity` only, and runs while the user is idle
  (DL-1.2's second scoped exception). The ripple is an absolutely positioned `::after`, so the
  14px box is unchanged. Under `prefers-reduced-motion: reduce` the loop is absent and the dot
  wears a static 15px hairline ring. `failed` has no halo.
  Why: the disc is 13px, not the ring's 15px, because at 2.1x its 13.65px radius must clear the
  15.5px the dot's centre sits from the rail list's left edge; `overflow-x: hidden` clips a left
  overflow and never reports it in `scrollWidth`.
- **DL-27.4** A message line is trimmed by layout: `text-overflow: ellipsis` does the trimming
  and the full sentence stays in the DOM for the tooltip and the accessible name.
  Why: a row that ships a truncated string has thrown away the only copy of what the agent said.
- **DL-27.5** Close owns a fixed 16px trailing cell on the row. It appears on `:hover` and
  `:focus-within` alike, by `opacity` only: it stays in the tab order, is never added by reflow
  (DL-1.2), and the row's accessible name does not change when it appears. A hover affordance
  never hides or overlays another target. Closing is the only action a row carries.
- **DL-27.6** `--yellow` means only _needs your eyes_: attention a person must act on, one step
  below `--red`'s failure, never decoration. It covers an agent waiting on the user and a
  finished run nobody has checked. Amends DL-3.2.
- **DL-27.7** Retired.
- **DL-27.8** Selection paints on the row itself (DL-21.1's wash; the focused row inverts,
  DL-27.22), never on anything below it. Selection outranks hover (DL-21.2); a drag target reads
  over both.
- **DL-27.9** The stream is clustered by project: a project header prints once above its
  checkouts and sessions. The header is a project control, not a row; it carries no state mark,
  age or worktree level, and its press collapses or restores that project's rows. The name is
  14px (a locally scoped `--type-project: var(--type-title)`) in `--text-primary` at weight 600,
  with 6px top and 2px bottom padding. Rhythm: `.asr-stream` gap 10px, `.asr-cluster` gap 6px and
  the header's `margin-bottom: -6px`, giving 16px between projects and a 2px hug between a header
  and its rows; the collapsed rail keeps 4px on both gaps
  ([rail spacing](../src/styles/04a-agent-rail.css)).
- **DL-27.10** Every tab of a project sits under that project's header, whatever its state; there
  is no pinned `Needs you` block. The state mark says which row wants the user, and the
  `focus-next-attention` action (⌘⇧A, View menu) is the keyboard walk to the next one. Order is
  open order, not recency: clusters sit where their oldest tab put them and rows where they were
  opened, both read from the window's one open clock
  ([`open-sequence.ts`](../src/lib/open-sequence.ts)), the same key the tab strip sorts by
  (DL-18.10).
  Why: a list that reshuffles when an agent changes state moves the row the hand is already
  travelling to.
- **DL-27.11** Retired. Replaced by DL-27.28.
- **DL-27.12** Every project keeps the same hierarchy. A project header always prints, including
  for a project with one tab or one agent, and a checkout label always prints under it, including
  for a project with one worktree, so a project never changes visual type when a second tab or
  checkout opens. The header carries no state mark, age or worktree level of its own; its
  `N need you` count (DL-27.27) is not a state mark.
- **DL-27.13** Retired. Replaced by DL-27.28.
- **DL-27.14** On Electron the identity row (`toggle → logo → Deck`) is followed by a create row
  outside the scrolling list: three equal 24px buttons reading `Worktree`, `Folder`, `Agent`
  ([`rail-create-row.tsx`](../src/ui/rail-create-row.tsx)), in `--type-body` with `CHROME_ICON`
  and DL-23 tooltips that name the target. `Worktree` and `Folder` carry a `--hair` outline.
  `Agent` is the primary verb: last in DOM order so focus follows the eye, drawing `Plus` on the
  launcher's filled skin (`--text-primary` ground, `--bg` label). `Agent` opens the launch page
  on the focused checkout; `Worktree` opens a sidebar form that creates a checkout and starts
  nothing; `Folder` adds a folder to the rail and starts nothing. Collapsed, the three verbs
  stack as icon buttons at the top of the column, `Agent` filled the same way (DL-27.29).
  Tauri's legacy rail keeps its pinned `New Workspace` button.

  `Agent` can also be dragged onto a pane, docking an agent pane at that pane's nearest edge
  ([`new-pane-drag.ts`](../src/ui/new-pane-drag.ts)). The drag reuses the pane drag's vocabulary:
  a 5px threshold separates a click from a grab, the `.pane-drag-ghost` label follows the cursor
  and the half-pane `.drop-overlay` names the edge. At rest the only affordance is
  `cursor: grab` on hover. The drag goes inert (the ghost finds no target) whenever the stage is
  covered: a browser or document surface, the Open board, full-bleed Settings, any modal. A
  zoomed tab is the exception: the whole stage becomes the zoomed pane's drop zone, with four
  edges.
- **DL-27.15** Every row carries the agent's newest turn at equal legibility, in every state. On
  Electron the sentence is read off the agent's own session log
  ([`session-tail.ts`](../electron/resume/session-tail.ts)); Tauri's `RepositoryRail` keeps its
  own rows and prints the tab name. State never lowers the opacity, colour or weight of the
  glyph, name or turn; status emphasis belongs only to DL-27.3's mark. The message carries what
  an agent said and nothing else, trimmed by layout (DL-27.4); rows are two lines (DL-27.28).
  On a named tab the row's accessible name and tooltip carry both name and sentence
  (`auth · Fixing login`), and a generated ordinal, when two panes still read alike, lands on the
  sentence, never on a name. A double-click on a row renames its tab in place through the strip's
  field (DL-35.3). Built by `buildCardEntries` in
  [`agent-rail-card-model.ts`](../src/ui/agent-rail-card-model.ts).
- **DL-27.16** The rail shows live work: rows come from live tabs, and archived sessions never
  produce rows (resume belongs to the Sessions surface, reopening a recent folder to Open Board);
  the one exception is a checkout the user has worked in before (DL-27.23). With zero live tabs
  the rail and its resize/toggle chrome are absent and Open Board takes the stage, as a transient
  projection that does not write the saved sidebar width or collapsed state. Opening Open Board
  while tabs are live keeps the rail as the route back to running work. The right dock is
  likewise suppressed while Open Board owns the stage, without changing its saved open tab or
  visibility.
- **DL-27.17** A project header reads favicon → name → trailing slot. The favicon comes from the
  [workspace scanner](../electron/images.ts), using the repository root or the plain workspace
  folder; a missing, unreadable or broken image falls back to the filled `Folder`. Favicon and
  fallback use `FEATURE_ICON` (15px) in a 17px column separate from checkout content; the
  icon-to-name gap is 6px, the name is 14px (DL-27.9) and the icon sits 14px from the sidebar
  edge (DL-27.28). The caret sits at the far edge ([header component](../src/ui/agent-rail.tsx)).
  The images are decorative; the button's accessible name carries the expand/collapse action.
- **DL-27.18** Retired.
- **DL-27.19** Retired. Replaced by DL-27.28.
- **DL-27.20** A project header is a drag handle for the whole cluster: header plus every row
  under it moves as one. No handle glyph is drawn; the drag is announced by the ghost (which
  carries the header's label, not a clone of the block) and by the insertion line, a position
  rather than a state, drawn in `--hair-strong` at `--radius-flat` across the full list width.
  The collapse button shares the grab surface and gives up its `click` only past the 5px
  threshold; a remembered cluster's remove control never starts a drag. A pinned cluster keeps
  its slot across the live/remembered boundary; unpinned clusters keep live before remembered.
  Only the cluster drags: a tab row, a pane row and a row moved between clusters do not. The
  strip and the rail share one order key for tabs
  ([`strip-order.ts`](../src/lib/strip-order.ts)), and the strip has no notion of a project.
- **DL-27.21** Every row's close closes what the row names. An agent row closes that agent, with
  ⌘W's contract: the tab goes with it only when that pane was its last, and a tab holding an
  agent beside a plain shell keeps the shell. A row with no agent is a shell tab and closes the
  tab. A project header's close closes every tab of the project, secondary worktrees included,
  and then takes the project off the rail; the two halves are one act. The header's close sits in
  the header's own last grid track (DL-27.27); an agent row's is the 16px trailing cell
  (DL-27.5). The hover wash stays neutral (DL-21.2), not `--red`: closing an agent is an everyday
  act and the BUSY dialog guards a running process. The rail does not close a whole multi-agent
  tab; ⌘⇧W does.

  State sits on the row's logo as a corner badge ([shared row](../src/ui/worktree-card-row.tsx)):
  a 7px dot with a 3px ring in the row's ground (including the hover wash and the focused fill),
  sitting 5.5px outside the logo's box so its centre is 1px in from the corner and the cut-out
  takes the logo's rim. Idle is unmarked and a working row carries no dot. Working is a braille
  terminal spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, 16px, `--text-primary`) on the same corner; being sparse, its
  gap is a 2px text stroke in the row's ground hugging the dots, not a disc. The logo keeps its
  full colour or ink in every state, and the state word stays in the accessible name and
  tooltip. Loop and reduced-motion terms are DL-1.2's.
  Why: 5.5px, not 7.5px, which notches the tree's guide line.
- **DL-27.22** The focused session row carries the rail's one selection mark: a true inversion,
  `--text-primary` fill with `--bg` ink on the name, sentence, working spinner, neutral
  `done`/`ended` dots and close; `asked` and `failed` keep `--yellow` and `--red`. At most one
  row in the whole rail carries it: every tab has an active pane of its own, so the pure rail
  model ANDs a pane's focus with its tab's selection. This is a scoped exception to DL-21.1's
  "wash and nothing else", the one selection mark that is not `--tab-active-bg`, and it stays one
  signifier: no bar, frame or accent (DL-21.6). A document or the browser on the stage does not
  clear it; the active pane is unchanged and the mark shows where the keyboard returns to.
  Selection outranks hover (DL-21.2). A busy row draws no rim; the working spinner alone says it
  is busy. Tauri's legacy `.asr-leaf` keeps DL-21.1's wash, `--tab-active-bg` at
  `--radius-control`.
  Why: clearing the mark when a file opens would blink the rail on every file opened.
- **DL-27.23** The rail has three tiers: project, checkout, session. Every tab is printed under
  the checkout it runs in, and a checkout line is always labelled, including when a project has
  exactly one. A checkout with no open tab still prints when the user has worked in it before
  (Deck's workspace history); a worktree the user has never opened in Deck stays invisible,
  because git discovery supplies metadata and does not decide what becomes a row. A project git
  does not know has one implicit group, named by the folder and tagged `Folder`, drawn like any
  checkout; its actions menu carries no branch or checkout word
  ([`checkoutBadge`](../src/ui/agent-rail-card-model.ts)).
- **DL-27.24** Retired. Replaced by DL-27.28.
- **DL-27.25** Retired. Replaced by DL-27.28.
- **DL-27.26** The sidebar carries no aggregate attention line; the aggregate lives on the strip.
  [`AttentionChip`](../src/ui/attention/attention-chip.tsx) at the strip's trailing end prints
  the number of panes that are `asked` or `failed` (red dot when any failed, yellow otherwise)
  and is absent at zero. It opens a DL-13.1 popover listing only those panes, loudest first, each
  a DL-13.8 two-line row: the reason, then space and branch; an inferred state says so. Choosing
  a row calls `activateForAttention` on that pane, which acknowledges that pane and no other.
  Working, done, idle and ended are counted in the footer, never listed. The popover answers
  nothing on the agent's behalf.

  Tree rows carry no create control; the create verbs live in DL-27.14's row. A checkout with
  nothing open is entered by pressing its label, which opens the compact full-page launch page on
  it. Opening creates nothing. `Run` splits beside the focused pane only when that pane belongs
  to the checkout; otherwise it opens a new space there, and the destination line says which
  before the press. Cmd/Ctrl+T uses the page when it has workspace context and the Open board
  otherwise; the create controls omit menu ARIA on this route.

  Right-click on a checkout raises the actions menu
  ([action rows](../src/ui/worktree-card-menus.tsx)), which has no heading and two groups: the
  quick agents chosen in Settings → Agents, then all other actions, starting with `Open shell`
  (a new terminal tab at the checkout) and `New split here`. One separator divides the groups,
  and the first group has no leading separator or the hairline would draw across the surface's
  top edge. The `role="menu"` `aria-label` names project, checkout and branch. The agent group is
  never silently absent: while the discovery probe runs it states
  `Looking for installed agents…`, and when no selected agent is available it offers a route to
  Settings. That stated absence is a fact, not a menu item, so roving focus does not stop on it.
  The menu offers no external terminal app. Tauri retains the menu fallback.
- **DL-27.27** A live project header counts who needs the user: the number of the project's
  panes that are `asked` or `failed`, printed as `N need you` in `--status-unread` (`--red` when
  any failed), micro size, weight 400, and nothing at zero. A count is not a state mark, so this
  narrows DL-27.12's "no state mark" without breaking it. The count and the caret share one slot:
  the count at rest, the caret in its place on cluster hover or keyboard focus. A folded cluster
  with no count keeps the caret visible at rest, so folded reads differently from empty. The
  header's last track belongs to the live close alone, and the toggle stops 23px short of the
  edge so the count does not move ([header styles](../src/styles/04a-agent-rail.css)).
- **DL-27.28** The Electron rail is a flat tree: project › checkout › session. A project header
  is followed by one label line per checkout, showing the branch name and a `worktree` tag for a
  linked worktree, then that checkout's session rows, indented one step. No card frame, border or
  fill groups a checkout and the checkout line ends without a `+`; the current checkout carries
  no mark of its own, so the focused row is the only "you are here". A session row is two lines:
  the task label (tab name, else the session's first prompt, else the agent label, never an
  invented name) in the row's weight, then the agent label · the newest turn (DL-27.15) in
  `--text-muted`. Without a sentence the second line carries the state word in its place
  (DL-27.2), and an unnamed row's second line keeps the CLI prefix (`Claude Code · …`). The state
  word also stays in the accessible name. The badge and close follow DL-27.21 and the logo keeps
  its full colour; the model pill leaves the row for its tooltip. Rows are flat: no fill at rest,
  a hover wash only, and the focused row's inversion (DL-27.22). Indents: the project icon sits
  14px from the sidebar edge, a checkout's branch icon 22px, a session row's edge 26px. The
  project name is `--text-primary` at weight 600. The project header's caret is the only fold.
- **DL-27.29** Collapsed, the rail is a column of project avatars. On Electron the sidebar's
  collapse (DL-18.9's control, setting and drag) narrows the rail to one avatar per live project,
  in rail order, instead of hiding it. An avatar is the project's `WorkspaceIcon` with a corner
  badge counting the panes that need the user (`--status-unread`, `--red` when any failed, absent
  at zero; DL-27.27); the project holding the focused pane carries the current mark. The column
  opens with DL-27.14's three verbs as stacked icon buttons above the avatars, a hairline between,
  with native `title`s like the avatars. Pressing an avatar opens a DL-13 popover beside the
  column with that project's checkout tree exactly as DL-27.28 draws it; choosing a row focuses
  its pane and closes the popover, and Esc closes it. Collapse and expand never move the focused
  pane, and the strip's breadcrumb (DL-35.3) keeps the identity the column cannot print. The state
  word stays in each avatar's accessible name (DL-27.2).

## 28. The rail's action footer

The foot of the Electron sidebar rail is one row of six icon buttons, below the project list
and above the §33 usage summary, which closes the rail. The frozen Tauri rail and top-tab
mode do not mount the row ([`SidebarActions`](../src/ui/sidebar-actions.tsx)).

- **DL-28.1** The row is pinned below the scrolling workspace list, never inside the scroll
  region, so it stays in reach of the surfaces it opens.
- **DL-28.2** The six buttons are `RAIL_ICON`-sized, in this order: Session history, Token
  usage, Explorer, Prompts, Browser, Settings. Each has DL-23's tooltip (name and chord)
  opening above the button (DL-23.4). Hover takes DL-21.2's wash and keyboard focus DL-21.3's
  outline; an action that cannot run follows DL-23.6.
- **DL-28.3** The row carries everything that is not an operation on the focused pane: the
  surfaces Deck can open (Explorer is the dock's explorer tab, ⌘⇧B) and the window's own
  actions. Pane operations live on the agent pane's header (DL-32.8) and in `More`
  (DL-23.8). A surface the running host cannot serve is omitted, not disabled (DL-19.7).
- **DL-28.4** Top-tab mode has no rail, so the same members ride in the toolbar's `More`
  menu there, built from the same projection
  ([`pinnedMenu`](../src/ui/toolbar/feature-toolbar.tsx)). Top-tab mode, the Tauri host and
  an Electron window with no live rail put the global group in `More`; the Electron sidebar
  mounts the icon row instead, and `More` then carries the pane group only.
- **DL-28.5** The icons open their surface and report nothing: no DL-21.1 wash, no
  `aria-pressed`, no `aria-expanded` (DL-21.8), and pressing the icon of a surface already
  on screen does nothing. Prompts keeps `aria-haspopup` without `aria-expanded`. Closing
  belongs to each surface's own control. A chord stays a toggle (`revealDockTab`) and a
  launcher opens (`openDockTab`, [`settings-store.ts`](../src/settings/settings-store.ts)).
  Why: an icon painted active would promise a second press that puts the surface away.
- **DL-28.6** Collapsed to DL-27.29's avatar column, the six icons give way to a single
  `Tools` grid button at the column's foot. It opens a DL-13 popover beside the column whose
  rows are the same six tools with their chords (DL-23.5's row shape). Choosing a row runs
  it and closes the popover; Esc closes it and returns focus to the button; the stage
  overlay flag is raised while it is open so the browser's native view steps aside. The
  Prompt Board popover anchors to this button while the rail is collapsed. The button
  carries a native `title`, because a tooltip centred above the narrow column would hang far
  from it ([`RailToolsMenu`](../src/ui/rail-tools-menu.tsx)).

## 29. Modals

A modal is a short, focused step raised over the stage and taken back down: pick an agent, name
a preset, draft a layout. Anything longer-lived is a full-window screen (§11) or docked panel (§19).

- **DL-29.1** Every modal mounts through [`Modal`](../src/ui/modal.tsx), which owns the scrim,
  the frame, the focus grab and both ways out; the panel supplies its class, size and body.
- **DL-29.2** The panel is the dialog, not the scrim: `role="dialog"`, `aria-modal="true"` and a
  name. It takes focus on mount: the panel itself when the modal is driven by bare keys (digits,
  arrows), a named field when driven by typing.
- **DL-29.3** Escape closes. A click on the scrim also closes, except where the modal holds work
  that exists nowhere else yet: today `PresetEditor` and its unsaved split tree. `Modal` turns
  the exits off per modal with `dismissOnScrim` and `dismissOnEscape`.
- **DL-29.4** Scrim dismissal reads the pointer press, not the click. Why: a drag that starts
  inside the panel and releases outside makes the browser fire `click` on the scrim.
- **DL-29.5** The scrim is a translucent wash (42%) plus a blur, an exception to DL-1.3's
  `backdrop-filter` clause for this one selector. Escape stops dead (`preventDefault` +
  `stopPropagation`) because a live terminal reading raw keys sits behind the scrim.
- **DL-29.6** The panel stands on the chrome plane `--sidebar-bg`, the ground of the navigation
  column and docked panel (DL-18.7), not a `--chrome-1` step off the stage.
- **DL-29.7** A modal that acts on a target states it once, above the choices, as a §5 config row
  (`menu` value kind, DL-6, DL-1.4), and lists the choices as a column of rows, not a wrapped
  grid. A target with one possible value keeps the row as DL-17.3's readout; a target with no
  values is omitted, not disabled (DL-19.7).
- **DL-29.8** A modal answers the keyboard from anywhere, states the keys it answers and never
  offers a choice that cannot run.
  - Escape is caught at the document in the capture phase and stopped dead. Why: focus does not
    stay on the panel (a scrim click, a native `<select>`, a removed row).
  - A column of choices answers ArrowUp, ArrowDown, Home and End with roving focus; Enter is the
    native button press. Focus starts on the panel, not the first row; the first arrow enters
    the list.
  - Rows carry no digit badges; one `--type-meta` / `--text-faint` line under the choices
    (DL-3.4) states the digit shortcuts once.
  - A declared agent whose binary has left `$PATH` stays listed; choosing it opens Settings
    instead of spawning a shell that prints `command not found`.
- **DL-29.9** Retired.

## 30. The notice row

A persistent horizontal row the app raises about itself, as the first row of the stage's
content beneath the tab strip. Its one instance is the migration notice, shown on Tauri only.

- **DL-30.1** At most one is on screen, reserved for something only the user can decide or do:
  the migration notice qualifies because the replacement is downloaded by hand. Anything the
  app can fix itself belongs in the chrome message bar.
- **DL-30.2** The row costs the stage `--notice-h` of height; the terminal grid starts below it
  and the row never floats over the panes. It sits beneath the tab strip, never above. Why: the
  strip sits at `top: 0`, where a hidden sidebar puts the macOS traffic lights.
- **DL-30.3** It carries `role="status"`, not `role="alert"`: the notice stays true while the
  window is open, and an assertive region would interrupt a screen-reader user at launch.
- **DL-30.4** Its colour is a §3 chrome role: it paints `--chrome-1` and closes with the same
  `--seam-divider` as the strip and tab bar. It never wears red or yellow, the agent status
  dot's colours (DL-27). Weight comes from position and one bold lead sentence.
- **DL-30.5** The dismissal ✕ is neutral: the neutral hover wash of DL-21.2 (the tab strip's
  close, not the rail's red). Its accessible name carries "until Deck restarts".

## 31. The rendered document

The rendered markdown view is the one surface whose content is prose read for minutes, not
chrome read in glances; DL-4.4's ladder does not cover body copy of that length.

- **DL-31.1** A reading surface may declare a second type scale scoped to itself, derived from
  `--type-body`: the `--md-*` rungs in `01-tokens.css`, `calc()` offsets from it, so a chrome-wide
  type change reaches the document. They style exactly one selector subtree (`.md-doc`) and
  chrome never uses them (DL-4.5). A further reading surface joins this scale.
- **DL-31.2** Prose is capped near 72ch and centred; code, tables and diagrams may run the full
  width inside their own `overflow-x` container, which `markdown-render.ts` emits. Why:
  `overflow-x` on a `<table>` does nothing.
- **DL-31.3** A dead link (`javascript:`, `data:`, anything resolving outside the workspace
  root) is not drawn as a link: it takes the surrounding copy's colour and the default cursor.
- **DL-31.4** Colour is a §3 chrome role. Headings, rules, blockquote bars and table borders come
  from the `--hair` family and the `--text-*` ladder; a fenced block sits on `--chrome-1` and
  inline code on `--chrome-2`. Fenced code takes its tokenization from the editor's Monaco
  theme. No colour token exists for this surface alone.
- **DL-31.5** Monospace is scoped to code and escaped raw markup, at `0.92em` of the surrounding
  rung, so a code span inside an `h2` sits with the heading.
- **DL-31.6** The mode control is present in both modes. It is icon-only (DL-23.10) with the §23
  tooltip and no native `title`, sits at the surface's top-right corner and states the mode it
  would switch to.

## 32. The task launcher

The launcher is the compact launch page plus the Open Board's agent cards, sharing the
[launcher fields](../src/launcher/launcher-fields.tsx); treatment is in
[18-new-task-launcher.css](../src/styles/18-new-task-launcher.css).

- **DL-32.1** Agent cards are the Open Board's focal artifact. The
  [board](../src/open-board/board-composer.tsx) shows the launch page's compact cards (logo, name,
  an arrow press named `Run` by its `aria-label`) under the workspace popover (DL-13.1), with
  recent workspaces as a quieter second rhythm below. Choosing or dropping a folder sets context
  and never starts a process; Run opens the chosen agent in that folder. With staged prompts
  enabled the [composer](../src/launcher/launcher-fields.tsx) stays visible instead.
- **DL-32.2** The context toolbar prints identity, not field labels: folder glyph + name for a
  workspace, logo + name for an agent. `Workspace`, `Agent`, `Model` and `Effort` are accessible
  names only.
- **DL-32.3** Model and reasoning effort are one composite `menu` control showing the combined
  value; the two stay independent launch data. It is absent when the agent offers neither.
- **DL-32.4** Retired. Replaced by DL-32.6.
- **DL-32.5** A launcher control with nothing to offer is omitted, never shown inert (DL-19.7
  applied to host-only workspace actions and the runtime selector).
- **DL-32.6** The compact agent launcher is a transient stage page
  ([page](../src/launcher/agent-launch-page.tsx),
  [context row](../src/launcher/agent-launch-context.tsx)): compact cards with the existing
  agent logos and no profile or recent badges. The sidebar and strip keep their
  places and the page owns no strip item. Covered content stays mounted but inert and the native
  browser is hidden. Back and Escape return without creating a process; Settings returns focus
  to the page.
  A card is a tile on an `auto-fill, minmax(176px, 1fr)` grid: 20px logo, 12px name, `ArrowRight`
  on one line. Its press takes initial focus and is `Split` (`Run` when the folder has no tab);
  nothing is remembered and no modifier changes it. While the folder has a tab, a 34px icon-only
  `PlusCircle` button on the right edge starts a `New space` (`launchAgentAtTarget` with a
  `new-space` target), with a DL-13.7 hover tip (400ms for
  a pointer, at once on keyboard focus, no native `title`) and `aria-label`
  `Run <agent> in a new space`. A missing agent shows `Not installed`, disabled, with no icon.
  The context row has no field labels (DL-32.2): a workspace popover (DL-13.1, `Open folder…`
  first), a checkout popover (the repository's checkouts by branch; absent for a folder git does
  not know) and a placement chip, `Split beside <agent>` when the focused pane belongs to the
  chosen checkout, else `New space`. The chip is identity, not a control. Changing workspace or
  checkout re-targets in place and starts nothing; the launch does what the chip says.
- **DL-32.7** Agent panes carry one compact identity header. On Electron the
  [pane header](../src/terminal/pane-agent-header.tsx) is logo · the sidebar's latest message
  (one line, ellipsis, full text on hover) · Effort (Claude only; opens Claude's native
  model/effort picker, and Deck shows no unverified effort value) · pane actions (DL-32.8). It
  stays visible when the legacy shell pane bar is hidden; hover is neutral and keyboard focus
  explicit (`pane-agent-header.css`). On `.pane-slot.is-active` the bar takes
  the pane's `--bg` and a transparent bottom seam, so header and body read as one sheet inside
  DL-18.12's focus edge; other panes keep `--chrome-2` (DL-3.3). The height is unchanged.
  Why: the join needs xterm and `--bg` to read the same `theme.background`
  ([`theme-vars.ts`](../src/lib/theme-vars.ts)).
- **DL-32.8** The agent header ends in four icon buttons: Split horizontally, Split vertically,
  Focus expand, Close pane, each with DL-23's tooltip (name and chord). They act on the pane whose
  header holds them, not the focused pane
  ([`pane-header-actions.ts`](../src/terminal/pane-header-actions.ts)). They are `opacity: 0`
  until the pane is hovered or holds focus, stay in the tab order, and drop the fade under reduced
  motion (DL-1.5). Hover is DL-21.2's wash, focus DL-21.3's outline, and Focus expand is a toggle
  that paints no state (DL-21.8). Each stops `pointerdown` and `mousedown` so a press never starts
  the pane drag (`pane-drag.ts`). A plain shell pane has no agent header and keeps `More`. Below
  280px of header width the splits are not drawn.

## 33. Sidebar usage and retained activity rows

The sidebar footer is [AgentUsageSummary](../src/ui/usage/agent-usage-summary.tsx), composed
through [AgentRail](../src/ui/agent-rail.tsx) and styled in
[15-rail-footer.css](../src/styles/15-rail-footer.css). The retained
[RecentSessionActivity](../src/ui/sessions/recent-session-activity.tsx) component follows
DL-33.2–33.5 when reused; it is not the sidebar footer.

- **DL-33.1** Agent usage is one line of micro text under the tools row, below the project list:
  each agent's name and current window percentage (`Claude 42% · 5h`) in faint ink, the number in
  muted ink with tabular figures. The window shown is the one closest to its limit; the tooltip
  and accessible label list every window, reset times and unavailable-state explanations. Height
  follows content (border-box, no flex grow or shrink) under one `--seam-recessed` separator, with
  no card background. The [limit normalizer](../src/lib/agent-limits.ts) turns missing, failed,
  stale or reset windows into a dash and never infers a percentage from token counts. No limit
  colour is drawn. Selecting it opens the Usage dock; a collapsed sidebar hides it.
- **DL-33.2** Every row is a verified session summary. The store pins each tail request to the
  listed session id and accepts a sentence only when the returned id matches exactly, else falls
  back to the title, then the id. Rows are ordered by latest activity, never agent state. A row is
  glyph, sentence, age, state: a 15px `AgentGlyph`, a flexible ellipsized summary, a fixed 4em
  tabular-time column and a 14px state slot at the right edge. The agent label is not visible; the
  accessible name carries the agent, the full title or id and any loud state.
  [`findSessionPane`](../src/ui/sessions/live-session-state.ts) matches the exact session id and
  agent in this window (a contract-reported id outranks the tail store's pairing); a match
  supplies the rail's [RailStatusMark](../src/ui/controls/rail-status-mark.tsx), no match leaves
  the slot empty, never a gray dot. Times run from `now` to `99y+` (`—` for an invalid date). The
  summary yields before identity, time or state. The row is 30px
  minimum height with a 7px inset, `--radius-control` and `--state-hover-bg`; the heading is
  `--type-meta`, the summary and `View all` are `--type-micro`.
- **DL-33.3** The compact row opens its exact session: a matching agent still open in this window
  gets its pane focused, otherwise the row resumes the session in a new single-pane tab in its
  recorded folder. The match is rechecked at click time, and an exited agent's shell is never
  focused as a resumed session. While the tab materializes the row blocks repeated activation and
  shows an accent opening ring with an accessible `Opening…`, which ends when materialization
  answers and does not claim the agent is ready. The created pane stays the click destination
  during startup, before the CLI reports its session id, and the neutral working ring stays its
  signal. A failed open leaves a retryable inline error. A
  missing folder stays readable and focusable with `aria-disabled` and `folder is gone` but cannot
  be activated. The full history keeps its `Resume` control; `View all` opens the Sessions dock
  without selecting or resuming.
- **DL-33.4** A collapsed sidebar hides the activity block; an unsupported host omits it,
  `View all` included. A cold scan reads `Reading recent activity…`, a confirmed empty snapshot
  `No recent sessions.`, and an error keeps the last-good rows with the existing retry control. The
  only row transition is the tokenized background response.
- **DL-33.5** The block stays current and is never a poller.
  [recent-activity-sync.ts](../src/sessions/recent-activity-sync.ts) re-reads on `paneTails`,
  `tabViews` and window focus, never a bare interval. A burst collapses into one refresh, two
  refreshes keep a minimum interval, and a host that answered "no sessions" is not asked again.
  Why: a scan is real work on the process that owns every PTY.

## 34. The agent board

The Agent Board is a grid of live agent-pane cards under a short filter bar. It is retired as a
surface but still builds: Mission Control (§35) replaced it and
[`AGENT_BOARD_RETIRED`](../src/ui/agent-board-store.ts) keeps these rules from binding anything
on screen: ⌘⇧O, the View menu item and the toolbar button belong to Mission Control, and a
journaled Board is not restored. Code: [`agent-board-model.ts`](../src/ui/agent-board-model.ts),
[`agent-board.tsx`](../src/ui/agent-board.tsx),
[`19-agent-board.css`](../src/styles/19-agent-board.css). The detail panel
([`AgentBoardPanel`](../src/ui/agent-board-panel.tsx)) and nav
([`AgentBoardNav`](../src/ui/agent-board-nav.tsx)) are unmounted but keep their suites;
`boardStatusFilter` is written by the bar (`all`, `needs`) and nothing writes
`boardProjectFilter`. DL-34.3's frame colour and DL-34.5's mono face carry over to Mission
Control's windows (DL-35.1).

- **DL-34.1** The Board is a stage surface in the Inbox's own frame: it covers `.stage__surface`
  as the document and browser do (DL-18.8) with one strip chip, leaves the rail and dock at their
  widths, and relies on the grid's `auto-fill` for responsiveness. The shared toolbar's view
  control (inherited by Mission Control's `Overview` button) is one persistent button in both
  window layouts that toggles and reports `aria-pressed`; its selected wash mixes 18% `--tone`
  into `--chrome-2` with `--tone` text, 6px corners inside an 8px outer frame, no separate border.
- **DL-34.2** A card is a pane, and it outlives its agent. One card per agent pane; when the agent
  leaves, the card keeps the departed agent's logo and shows the word `ended` (filters and counts
  read `idle`) until the pane closes; its accessible name keeps the agent's name. Cards stay in
  rank order (the rank among live cards in pane-ordinal order), so a state change never re-sorts
  the grid. A [card](../src/ui/agent-board-card.tsx) wears DL-21.7's resting wash inside DL-1.3's
  inset hairline at `--radius-control`, in four groups: status, identity, what the agent said, footer. Identity is a 17px logo (or letter
  fallback) beside `agent · checkout` at `--type-title` (14px), 8px below status; the project is a
  pill sharing the status row with the ordinal and truncating before it. The message is the
  subject: 11px below identity, `--text-primary`, two clamped lines with a `min-height` so a row
  of cards is one height, `—` when empty. The footer, 11px below, shows only the last output's age
  (`2m ago`, `--` when unknown). The hover column sits in the foot, without Open in stage.
- **DL-34.3** `asked` and `failed` colour the card's frame, and nothing else does. The inset
  hairline takes `--status-unread` or `--red`; `working`, `done` and `idle` keep `--hair`. Every
  state leads its word with its rail mark (DL-27.3); `working` shows the pending ring beside a
  plain `WORKING`. The rail's `asked` ripple is off inside `.agent-board`. Green appears nowhere
  (DL-3.2 and the worktree card's colour rule own it).
- **DL-34.4** A press on a card, or a digit key, activates that agent's pane on the stage and
  acknowledges it (DL-34.10's `Open in stage`). The selection wash (`--tab-active-bg`) and
  `aria-current` stay in the markup and stylesheet but nothing selects. In a selected card the
  state word takes a second ink, `--board-state-failed-ink`, `--board-state-asked-ink` or
  `--board-state-neutral-ink`, each the resting ink mixed 70% toward `--fg`; a resting card keeps
  the pure hue.
  Why: on the selected wash the state word fell under DL-3.5's contrast floor.
- **DL-34.5** The Board is mono and near-flat; hierarchy is weight, case and tone. `--board-font`
  covers the subtree (DL-4.1); only `--type-title`, `--type-body` and `--type-meta` are used; 600
  weight is for the card name and panel title alone. `.board-label` (DL-4.3's third exception)
  marks the nav headings, the state word and the group headers, which sit at `--type-meta` (the
  Board-scoped exception to DL-4.3's group-label clause).
  `--text-primary` is names and values, `--text-muted` the task or tail, `--text-faint` labels,
  the where-line, meta and the number.
- **DL-34.6** Retired.
- **DL-34.7** Retired.
- **DL-34.8** Retired.
- **DL-34.9** Escape steps the Board back to the terminal in one press (a Board rule, not
  DL-29.8's: the Board is not a modal).
- **DL-34.10** Stop leaves the shell and the card; Restart resumes the conversation and exists
  only once the agent has left; Close lives in `More`. The hover column carries at most
  Stop-or-Restart and `More` and is out of the Tab order: the keyboard reaches the actions through
  `More` alone, opened with Shift+F10, and Escape returns focus to the card, not `<body>`. `More`
  lists only the rows the card's state admits.
- **DL-34.11** One short bar above the grid filters and re-lays the Board
  ([bar](../src/ui/agent-board-bar.tsx)). Left: `All` and `Needs me` (`asked` + `failed`), each
  counting every card so a count never shrinks with the filter. Right: group by project, then
  cards / list, as 24px icon buttons. Chosen chips and toggles wear DL-21.1's `--tab-active-bg`
  wash. A group header is a full-width grid row, `.board-label` over the checkout's where-line
  with a faint count, in the rail's order; cards keep rank order inside a group. The list is the
  same card on one line, with a trailing track so the hover column never covers the rank. The
  empty Board has no bar and keeps its launcher; an empty filter says so in one muted line.
  Filter, grouping and layout are Board-local and reset when the chip closes.

## 35. Spaces and Mission Control

A **space** is a terminal tab, named by its workspace folder until the user names it; the name
belongs to the tab, so every surface reads the same one. Built by
[`space-model.ts`](../src/ui/spaces/space-model.ts), [`space-bar.tsx`](../src/ui/spaces/space-bar.tsx),
[`space-slide.ts`](../src/ui/spaces/space-slide.ts),
[`mission-control.tsx`](../src/ui/mission-control/mission-control.tsx) and
[`20-mission-control.css`](../src/styles/20-mission-control.css).

- **DL-35.1** Mission Control zooms the current space's panes out into a spread of windows under
  a shelf of every space. ⌘⇧O / Ctrl+Shift+O, View ▸ Mission Control or the toolbar's `Overview`
  button (DL-34.1's view control, hidden by
  [`MISSION_CONTROL_BUTTON_HIDDEN`](../src/ui/toolbar/deck-toolbar.tsx)) opens it; the same chord,
  Esc or a press on the empty spread returns unchanged. The shelf lists every space in the window,
  grouped by workspace under the folder's name; each is a miniature tinted by state, with its
  label (name, or index while unnamed) and needs-you count. A double-click on the label renames in
  place (DL-35.3's field) and Esc there cancels the edit, not Mission Control; a single press on
  it never enters the space. A thumbnail is a `div` with the button role (the field is a text
  input); Enter and Space enter the space. Hover or focus previews its windows, a press enters
  that space, and a press on a window returns to exactly that pane (`activateForAttention`; Focus
  Expand follows the user's setting and is never switched on as a side effect). A window is a
  snapshot (`serializePane`), never a live xterm. Windows keep DL-34.3: `asked` and `failed` mark the head with a real 2px top border and
  nothing else is coloured; quoted text uses `--board-font` (DL-34.5).
  The zoom is a FLIP on `transform` with the backdrop and shelf on `opacity`, 280 ms
  `cubic-bezier(0.2, 0, 0, 1)` (the §7 slide-over duration, inside DL-1.2's 300 ms ceiling), run
  by WAAPI `element.animate`; a finite WAAPI animation is not DL-1.3's `requestAnimationFrame`
  loop, no timer drives it and nothing runs while idle. It ranks as an overlay at the Open
  board's tier (a pane chord behind it is blocked), hides the browser's native view, and has no
  blur (DL-29.5's scrim exception is not inherited). ⌃↑ is not the chord: macOS takes it first.
- **DL-35.2** Switching between existing spaces slides the stage, and only the current space
  holds a live terminal. A switch from one terminal tab to another (by mark, rail, ⌘⇧[ / ⌘⇧],
  ⌘1–9 or a horizontal trackpad swipe: 60 px of horizontal wheel delta, one space per gesture,
  momentum swallowed until the events pause for 200 ms) slides the incoming stage in from the
  side of its mark while a **ghost** of the outgoing one slides out: its panes' last rows as
  plain text in the terminal's face, in the rects they had, read before `hide()` released their
  renderers. No xterm is moved, cloned or kept alive. Duration and easing match DL-35.1,
  `transform` only, with the stage clipped by `overflow: clip` for the slide. A just-created tab,
  a switch a document or the browser was covering, and a switch into another repository's scope
  do not slide. ⌃← / ⌃→ are not bound: they are macOS's Spaces chords and word motion in shells.
- **DL-35.3** The strip draws terminal tabs as space marks. Its identity line is a breadcrumb
  project › branch › space › session for the focused pane, truncating from the project end first;
  an unnamed space whose folder is its project drops the name crumb, and the rename field takes
  its place while editing. Then come one mark per space of the current project (others are
  reached through the rail) and the document and browser chips; every mark precedes every surface
  chip, and ⌘1–9 and cycling count them in that order.
  A name is what the user typed, else the folder, plus an index when several spaces share the
  workspace (`spacevibe-deck 2`); `New space` on a launch card names the space
  `spacevibe-deck · Claude Code` ([`autoSpaceName`](../src/ui/spaces/space-model.ts), the folder
  shortened with `…` to fit 40 characters); the first pane of a folder and a split keep the
  folder. A typed name always replaces the auto name, and clearing it returns to `folder N`. A
  double-click on the name renames in place: Enter saves, Esc cancels, blur saves, an empty name
  reverts to the default, and the name is trimmed and capped at 40 characters. The field floats
  over the name's cell so marks do not move while typing, and the name is not a window-drag
  region. The name is journaled and restored with the tab.
  A terminal tab is not a chip (an exception to DL-18.10's one-chip-shape rule): a mark has no
  label, glyph, close control, drag or pin, and its context menu (Close, Close Others, Close to
  the Right) stays on it. Each project's marks share one **capsule**, a `group` named by the
  project: a tint with the marks tight inside (16px each), 6px from the next, outlined while it
  holds the current space. A repository and its worktrees are one project, a plain folder stands
  alone, and the key is the rail's `orderKey` from
  [`spaceLayoutFromRail`](../src/ui/spaces/space-order.ts) so strip, shelf and sidebar agree;
  the order is the sidebar's. The name cell stacks every space's label in one grid cell so marks
  never move on a switch. The current mark is a 16×6 pill drawn at full width and scaled to a dot
  at rest, so the change is a `transform` (DL-1.2), never a width.
  Needs-you (`asked` + `failed`) is the only state a mark carries: a resting dot is `--red` once
  anything in the space failed and `--status-unread` yellow for a question or an unread finished
  run (the rail's two inks, DL-3.2's two roles, never one colour for both); a current space that
  needs you keeps its pill with a 4px dot of that colour under it, and the shelf's counts wear the
  same two colours. A needs-you mark scrolled out of sight shows at the row's edge: a 44px fade
  into the strip and a 6px red dot on the side that hides one (`hiddenNeeds` in
  `space-edge.ts`, re-measured on scroll and resize), red whichever tone it hides. There is no
  spinner and no other state. Hovering a mark opens (after 600ms; keyboard focus at once) a
  DL-13.7 card (DL-13.1's stage surface, no native `title`) with the space's name (folder and
  index while unnamed), branch (Electron's repository scan; omitted without one) and counts; once
  a name takes the title, folder and index move to the branch line (`folder N · branch · counts`).
  Many marks scroll inside their own row, keeping the current one in view.
- **DL-35.4** Reduced motion is honoured by scope: WAAPI motion checks `prefers-reduced-motion`
  before playing and skips the zoom, the slide and every fade; the mark's pill transition exists
  only under `no-preference`. There is no class allowlist.

## 36. Dev servers

A chip on the stage strip counts the servers running in the active checkout; its popover lists
what the host found listening in the folders Deck knows, whoever started them. §13 and §25 cover
the surface and a row that carries an action; these rules add only what they do not. Built by
[`DevServersChip`](../src/ui/dev-servers/dev-servers-chip.tsx),
[`DevServersPopover`](../src/ui/dev-servers/dev-servers-popover.tsx),
[`DevServersPanel`](../src/ui/dev-servers/dev-servers-panel.tsx),
[`DevServerRow`](../src/ui/dev-servers/dev-server-row.tsx) and
[`24-dev-servers.css`](../src/styles/24-dev-servers.css).

- **DL-36.1** The chip counts the active checkout and says whether to trust the count. It sits at
  the strip's trailing end after the needs-you chip, wears the `HardDrives` glyph and the number
  of `Running` servers in the checkout the rail's active tab belongs to, and stays at zero (unlike
  the needs-you chip). Its dot is `--green` and radiates only while the number is above zero (the
  loop DL-1.2 records), `--red` and still when the last scan failed so the count may be stale,
  and absent otherwise. The chip is absent, not empty, until the host says it can discover
  servers and wherever it cannot. The popover is a 360px DL-13.1 surface raised by a press and
  dismissed as DL-13.2 says (Escape returns focus to the chip; completing `Open in Deck` closes
  it and leaves focus where the stage put it); it hides the browser tab's native view while open.
  A scope `<select>` (DL-1.4) offers `This worktree`, `This project` and `All projects` and opens
  on the active checkout every time (DL-13.6). A project row shows its project and branch as
  detail; a worktree row does not, since the scope row says it once (DL-13.8).
- **DL-36.2** A server row is a DL-25.1 row with one named action and two icon buttons, the
  documented extension of DL-25.1's "content plus one named action". The `Open` pill (DL-25.5,
  `Open in Deck`) is the only control with a word; beside it sit
  `Open in your browser` and `Copy URL` (`Copy address` when there is no web address), each a `.iconbtn` with an
  `ActionTooltip` (DL-23.1). Row content is fixed in order: state mark, endpoint, state word,
  address, then one line of facts (detail, protocol, age). A long address truncates with an
  ellipsis and never pushes the actions. The controls are cells of one keyboard grid with a single
  tab stop: ←/→ walk a row, ↑/↓ the same column of the next. An action that cannot run is
  unavailable, not disabled (DL-25.3, DL-23.6): focusable, `--text-faint`, no hover, its reason in
  the tooltip and the accessible description.
- **DL-36.3** State is a word and a shape; the protocol is a separate token. The mark is filled
  `--green` for `Running`, a hollow ring for `Stopped` and a dashed ring for `Unknown`, and the
  state word is always printed (DL-27.2). `Running` means a listener was seen in a fresh reading,
  not that the page works, so the protocol (`HTTP`, `HTTPS`, or why it is not identified) is a
  second token on the facts line and never changes the state word: a server that answers with an
  error or an untrusted certificate is still `Running`. `Stopped` and `Unknown` carry an age
  (`stopped 2 minutes ago`, `last seen 2 minutes ago`) instead of a protocol. `Unknown` is
  `--text-faint`, never yellow.
- **DL-36.4** One status line tells the truth about the last scan or the last action. DL-19.5's
  line reads `Scanned just now · 2 running` (counts over what is listed, `partial scan` when the
  host said so) until an action has something to report, then says what happened, in `--red`
  when it failed, until the next action or the popover closes. A failed scan adds a `LoadError`
  with `retry` instead of emptying the list. Opening or copying a URL is gated by the host's
  recheck of that exact instance immediately before; a refusal (stale, no longer running, not
  identified as a web server) is said in that line, and no URL is used without the recheck. The
  empty list says why (still scanning, scan failed, or none found for the scope) and offers
  `Show all projects (N)` when the other scopes hold servers.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

**The open claims are in the table below.** The only prior standing entry —
`DL-16`'s text being cited from nine places in `src/` but never written — was
closed on 2026-08-12 when the rule was transcribed from its call sites as §18
and the citations moved with it. `scripts/design-language.test.ts` now fails
the suite when a citation names a number with no declared rule or section. It
reads both spellings this repo uses — `DL-17.1` and `DL §17` /
`DESIGN-LANGUAGE §17` — but deliberately not a bare `§17`, which cites a spec,
a plan or a review far more often than it cites this document. Citing DL by
section therefore means naming DL, or the gate does not see the citation.

| Claim | Intent | Status | Evidence |
| --- | --- | --- | --- |
| The needs-you chip is a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-10-06 on `feat/attention-popover` (DL-27.26 amended): the chip, its popover and the strip mount. Drawn in the gallery's `needs-you chip` section in both themes; no `electron:dev` walk, no `electron:smoke`. The walk must cover a failed and an asked pane in different spaces, Enter and Esc by keyboard, the popover over the browser tab's native view, and the strip at a 480px window beside the sidebar, where the chip costs the marks row about one mark |
| The rail tree and the strip breadcrumb are a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-10-07 on `main` (DL-27.28, DL-27.27 and DL-35.3 amended): label lines, two-line rows, the needs-you header count, the breadcrumb and current-project marks. The gallery's `navigation` tree specimen was screenshotted; no `electron:dev` walk. The walk must cover sparse and dense lists, a narrow window, ⌘1–9 within one project, a checkout `+` from another checkout's pane (New space) and from its own (Split), and a first prompt arriving after launch |
| Spaces and Mission Control are a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | §35 landed 2026-09-28 on `feat/mission-control`: `tsc`, `npm test`, `npm run build` and `generate:menu:check` green; no `electron:dev` walk yet. It replaced this row's previous claim, "the Agent Board is a shipping surface", closed the same day when the Board was retired behind `AGENT_BOARD_RETIRED` (§34's retirement note) |
| Space workflow refinements are a shipping surface | `building` | built, unrun and unwalked; owner eye review owed | 2026-10-03 on `main` (4478840, 664edc5, 0fab403, 0c743a2): launch cards (DL-32.6), auto-named spaces and project capsules and the edge marker (DL-35.3). No `tsc`, `npm test` or `electron:dev` run yet. The walk must cover five agents on one card row, the New space tip by keyboard, a worktree inside its repository's capsule, and a red edge dot with enough spaces to scroll |
| The launch page's context row is a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-10-08 on `feat/launch-page-context` (DL-32.6 amended): the workspace and checkout popovers, the placement chip and `Open folder…`. No gallery specimen exists for the launch page. The walk must cover changing the workspace and the checkout, seeing the chip follow, `Open folder…`, and launching from a re-targeted page |
| Space names are a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-09-29 on `feat/space-names`: the strip (DL-35.3), the shelf (DL-35.1) and the rail row (DL-27.15's amendment) rename and render a name. The walk must cover the floating strip field over a short name and a 40-character one, the shelf field inside a 96px thumbnail, and a named and an unnamed space in one folder |
| Every needs-you surface of a space wears the rail's two inks | `building` | the strip's marks do; the rest stay single red, owner decision owed | 2026-10-06 on `feat/rail-row-badge`: the marks and the current space's under-dot paint `--status-unread` for a question and `--red` for a failure (DL-35.3). DL-35.3 also says the shelf counts wear the same two colours, but `.mc-space__needs` paints `--red` for both (its `data-tone` is emitted and the stylesheet never reads it); the miniature's cells and the hidden-needs edge dot are single red too. Unwalked in `electron:dev` |
| The collapsed rail is a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-10-07 on `feat/rail-collapsed` (DL-27.29, DL-18.9 amended): the avatar column, its needs-you badge and current mark, the flyout and `toggle-sidebar` (⌘B, Ctrl+Shift+L). No `electron:dev` walk. The walk must cover the traffic lights over a 52px column on macOS, a drag past the floor and back out, an avatar flyout over the browser tab, Esc returning focus to the avatar, and ⌘B from a terminal, a document and the tree |
| The rail's tools row and the pane-header actions are a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-10-07 on `main` (DL-28, DL-23.4, DL-23.8 and DL-32.8 amended): the icon row above the usage summary, the collapsed `Tools` button and its popover, the above-opening tooltip, `More` shrinking to the pane group, and the four header actions. Gallery-screenshotted; no `electron:dev` walk, no `electron:smoke`. The walk must cover the six tools by pointer and by chord, Prompts anchoring from the row and from the collapsed button, the tooltip above at a short window, the collapsed popover over the browser tab, the header actions on a focused, a hovered and a narrow pane, and a shell pane's `More` |

The violations table above is the DL-specific ledger; this one is for claims
that do not match the tree. Do not remove this section (D7).

| Settings Studio is an accepted shipping surface | `building` | integrated and browser-reviewed; owner acceptance pending | 2026-10-04: [Appearance](../src/ui/settings/sections/appearance-section.tsx) and [Agents](../src/ui/settings/sections/agents-section.tsx); 102 targeted tests and TypeScript passed, Chromium wide/480px interactions checked; full-window contracts retained, native acceptance unrun |
| The create row is a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-10-08 on `feat/launch-create-row` (DL-27.14, DL-27.26, DL-27.28 and DL-27.29 amended): the `Agent`, `Worktree` and `Folder` row, the sidebar worktree form, the collapsed column's stacked icons and a bare checkout's label press. No `electron:dev` walk. The walk must cover the three buttons by pointer and keyboard, `Agent` from the expanded and the collapsed rail, the drag onto a pane, creating a worktree and seeing its row, opening a folder, pressing a bare checkout's label, and Tauri unchanged |
| The dev servers chip is a shipping surface | `building` | built and unit-verified, native walk and owner eye review owed | 2026-10-09 on `feat/dev-servers` (DL-1.2 amended; DL-36 added): the strip chip, its live dot, the popover and its rows over the verified discovery core. Drawn only in the gallery mock (`dev-servers-mock`, variant B); no `electron:dev` walk, no `electron:smoke`, macOS only (Windows and Linux omit the chip, and no Windows device has run it). The walk must cover a server started from an external terminal before and after Deck opens, stop and restart, the three scopes following the rail, Open in Deck from a terminal, a file and the Board, the popover over the browser tab's native view, Escape and arrows by keyboard, a failed scan, and the chip absent on Tauri |
| The explorer's hidden-files toggle and active-document mark are a shipping surface | `building` | built and unit-verified, driven in the Electron app under Xvfb on Linux, macOS ⌘+click walk and owner eye review owed | 2026-10-09 on `feat/explorer-reveal` (DL-19.9 amended; DL-19.10 added): the fifth root-row control, the marked row at `--radius-tab`, and the reveal. Screenshots of the cluster at the 360px floor, the mark and the reveal went to the owner through the session, not into the repo. The walk must cover ⌘+click on a printed path with the folders above it collapsed (the xterm link cannot be activated on Linux, so it is unrun), the same with the dock closed and then opened, the mark against the explorer wash on a light theme, and the marked row sitting flush against the bottom edge after a reveal |
