# DESIGN-LANGUAGE — Stackgrid chrome

Canonical rulebook for all **chrome UI** (settings panel, and — as they are
reworked — tab bar, status bar, pane bar, search bar, overlays). The settings
panel is the reference implementation. This is the single source of truth for
the app's visual language — tokens, color roles, typography, motion, copy.

Rules are numbered so they can be cited (`DL-3.2`). An agent editing chrome UI
must run the checklist in §9 before calling the work done.

## 0. Identity

> Stackgrid chrome reads like a well-kept config file: quiet rows of
> key → value set in the terminal's own colors. The terminal is the content;
> chrome recedes.

Everything below exists to serve that sentence and the app's founding
constraint: **consume as few machine resources as possible.**

## 1. Hard constraints (resource frugality)

- **DL-1.1** No new runtime dependencies for chrome UI. CSS + Preact only. One
  exception, approved 2026-08-09: `lucide-preact` supplies every functional
  icon (§14). It earns the exception by replacing hand-drawn SVG rather than
  adding a layer over it, and by tree-shaking to only the icons imported by
  name — a bounded cost, re-measured at each build against a gzip ceiling.
  A second icon dependency is not covered by this exception.
- **DL-1.2** Animate only `transform`, `opacity`, `color`, `border-color`,
  `background-color`. Max duration 300ms. No infinite / looping animations.
  Nothing animates while the user is idle.
- **DL-1.3** Banned: **blurred/offset** `box-shadow` (the app is a flat system —
  depth comes from background steps and 1px hairlines), `backdrop-filter`,
  `filter`, JS animation loops (`requestAnimationFrame`) for chrome, timers that
  exist only to drive visuals. `box-shadow: inset 0 0 0 1px <color>` is
  permitted — it is a hairline, not a shadow (it paints no blur and costs no
  compositing layer).
- **DL-1.4** Prefer native inputs (`<select>`, `<input type="color">`) overlaid
  invisibly on a styled pill over custom dropdown/picker widgets — zero JS,
  zero extra DOM, free accessibility.
- **DL-1.5** Honor `prefers-reduced-motion: reduce`: chrome transitions are
  disabled, panels appear instantly.

## 2. Tokens

Single source of truth: `:root` in `src/styles.css`. Theme colors are injected
from the active terminal theme (`--bg --fg --accent --red --green --yellow
--magenta --cyan`); everything else derives via `color-mix`:

| token                                                  | role                                     |
| ------------------------------------------------------ | ---------------------------------------- |
| `--chrome-1` / `--chrome-2`                            | background steps for bars / panels       |
| `--input-bg`                                           | recessed input surfaces                  |
| `--hair` / `--hair-strong`                             | 1px hairlines inside a surface           |
| `--seam-recessed` / `--seam-divider` / `--seam-raised` | the boundaries BETWEEN surfaces (DL-2.3) |
| `--text-primary` / `--text-muted` / `--text-faint`     | text hierarchy                           |
| `--ui-font`                                            | the one chrome typeface (DL-4.1)         |

- **DL-2.1** Components never hardcode colors. Every color routes through a
  token, or comes from the live theme object (e.g. swatches previewing a
  theme's own colors).
- **DL-2.2** The theme drives everything: switching theme must restyle all
  chrome with zero component changes.
- **DL-2.3** **A boundary between two surfaces is a seam, not a hairline.**
  Seams mix from `--tone`, never from `--fg`: a boundary belongs to the
  background ladder, and mixing from the foreground let the terminal's text hue
  into it. `--seam-recessed` (shell boundaries — the command-row frame, tab bar,
  sidebar, status, pane bar) is **opaque**, because an alpha border composites over whichever
  surface owns it and the two sides of a shell seam are different surfaces.
  `--seam-divider` (inside one continuous surface — the pane splits) stays
  alpha so it adapts to its ground. `--seam-raised` frames a surface that
  floats above chrome (popovers, dialogs).
  **The step must stay louder than the seam that marks it.** Before this rule a
  seam sat 15–24 luminance units above its surface while the `--bg` → `--chrome-1`
  step was 8–9, so every boundary read as ink drawn across the chrome;
  `derive-colors.test.ts` now locks the relationship for every preset.
  `--hair`/`--hair-strong` keep their meaning for lines INSIDE one surface.
  Anchors: the tokens in [`derive-colors.ts`](../src/lib/derive-colors.ts)
  `current` and their `:root` fallbacks in [`styles.css`](../src/styles.css)
  `current`, locked by
  [`derive-colors.test.ts`](../src/lib/derive-colors.test.ts) `current`.
  Approved as a fork on 2026-08-12 after the gallery study in
  [`seam-section.tsx`](../src/gallery/sections/seam-section.tsx) `current` —
  that file belongs to the dev-only gallery entry, so when the gallery is
  retired this one pointer goes with it (D8) and the rule stays.

## 3. Color roles (strict)

- **DL-3.1** `--accent` marks **interactive or active** only: hover/focus
  borders, focus ring, active markers, affordance hints. Never a decorative
  fill, never large areas.
- **DL-3.2** `--green` means only _on / enabled / success_. `--red` means only
  _danger / destructive / error_. Never decoration.
- **DL-3.3** Structure comes from `--hair` hairlines and background steps —
  not from color, not from shadows.
- **DL-3.4** Text hierarchy: `--text-primary` for keys and values,
  `--text-muted` for secondary value text (e.g. hex codes), `--text-faint` for
  descriptions, group labels, hints, disabled states.

## 4. Typography

- **DL-4.1** **The monospace face belongs to the terminal, and nowhere else.**
  Every pixel of chrome — labels, descriptions, values, paths, hex colours,
  theme ids, keyboard-shortcut chips, headings — uses `--ui-font`. Chrome is
  native UI and should read as native UI; mono there reads as terminal output
  that leaked out of its pane. The terminal's own font is not a chrome token at
  all: it comes from the user's `fontFamily` setting through
  [`toFontStack`](../src/terminal/pane.ts) `current`, so changing chrome
  typography can never change the terminal, and vice versa.
- **DL-4.2** Values still need `font-variant-numeric: tabular-nums`. Under mono
  this was nearly inert; under a proportional face it is what stops `13px` and
  `10k lines` from jittering as they change.
- **DL-4.3** **No uppercase anywhere.** No `text-transform`. Letter-spacing
  stays ≤ 0.06em, and tracking tuned against a monospace advance width has to
  be re-measured when a rule moves to `--ui-font`.
- **DL-4.4** Sizes (px): group label 10.5 · key 12.5 · description 10.5 ·
  value 11.5 · panel title 12. Keys sentence-case, descriptions and values
  lowercase.

## 5. The one control: config row

Every setting is a **row**: key (+ optional one-line description) on the left,
exactly **one interactive value** on the right. No other widget genres — no
segmented controls, checkbox lists, chip grids, sliders, or boxed steppers.

```
cfg-group                     ← group label (faint, lowercase)
cfg-row
├─ cfg-row__key
│  ├─ cfg-row__label          ← ui-font 12.5px primary
│  └─ cfg-row__desc           ← ui-font 10.5px faint (optional)
└─ cfg-row__value             ← right-aligned slot
   └─ cfg-btn …               ← the single interactive pill
```

- **DL-5.1** Row hover: 2px left accent bar + 4% `--fg` wash. Nothing else.
- **DL-5.2** The pill (`.cfg-btn`): the value inside a 1px `--hair` border,
  radius 6px. Hover → `--hair-strong` border. Focus-visible → 2px `--accent`
  outline (app-wide convention). Disabled → `--text-faint`.
- **DL-5.3** Affordance glyphs (`↹` cycle, `▾` menu, `…` picker, `↺` reset)
  live inside the pill as `--text-faint`, turning `--accent` on pill hover.

## 6. Value kinds (closed set)

Extend **this table first** before inventing a new kind; a value that doesn't
fit is a design decision, not an implementation detail.

| kind     | looks like                   | interaction                           |
| -------- | ---------------------------- | ------------------------------------- |
| `cycle`  | `▪ tokyo-night ↹`            | click advances to the next option     |
| `menu`   | `JetBrains Mono ▾`           | invisible native `<select>` overlay   |
| `step`   | `− 14px +` in one pill       | −/+ zones inside the pill             |
| `color`  | `▪ #16161e`                  | invisible native color input overlay  |
| `picker` | `custom …`                   | opens a native OS dialog (file/image) |
| `toggle` | `on` (green) / `off` (faint) | click flips; `role="switch"`          |
| `action` | `↺ reset` (red for danger)   | click runs the action                 |

`picker` differs from `menu`: its source is a native OS dialog (e.g. an image
file), not a fixed `<select>` list. Its value reads `default` / `custom`; a
custom pick shows the `↺` clear button (DL-6.1); any failure shows inline via
`.cfg-custom--error` (DL-6.2).

- **DL-6.1** An overridden-from-default value may show a small `↺` clear
  button beside the pill — the only permitted second element in a value slot.
- **DL-6.2** A `menu` whose option list can't cover every case (font family,
  editor command) may open an **inline text row** under its own row
  (`.cfg-custom`) — never a modal, never a second pill. A `picker` surfaces its
  errors the same way, via `.cfg-custom--error`.
- **DL-6.3** Every text field uses `CommitInput`
  (`src/ui/controls/commit-input.tsx`): the draft lives in local state and
  commits on blur/Enter. A store-controlled `value={…}` input in the panel is a
  data-loss bug — the panel never unmounts, so any app re-render rewrites the
  DOM value and wipes what the user was typing.
- **DL-6.4** A pill holding several buttons (`step`) puts the focus ring on the
  focused button, not the pill; a pill wrapping one invisible native input
  (`menu`, `color`) puts it on the pill via `:focus-within`.

## 7. Motion budget (chrome)

- Panel slide-over: `transform` + `opacity`, 0.28s ease-out cubic (existing).
- State changes (hover/active): 0.13s ease.
- Nothing else moves. See DL-1.2 / DL-1.5.

## 8. Copy

- English UI. Keys sentence-case (`Show pane bar`); descriptions terse and
  lowercase (`reopen tabs on launch`); values lowercase (`on`, `off`,
  theme ids as written in code).
- A control says what happens; no vague labels.

## 9. Agent checklist (anti-drift)

Before shipping any chrome UI change:

1. Is it expressible as a config row (§5) using an existing value kind (§6)?
   If not — propose an edit to this document first, then implement. (This has
   already been violated once: a segmented control was added for "Tab bar
   position" and had to be rewritten as a `cycle`.)
2. Every color maps to a role in §3; no hardcoded hex (DL-2.1).
3. Any animation fits the budget in §7 and the constraints in §1. Reduced-motion
   is handled **by scope** (`.settings-screen *`), never by an allowlist of
   class names — an allowlist silently misses the next class.
4. No uppercase (§4). No monospace anywhere in chrome — if a rule reaches for
   it, the answer is `--ui-font` (DL-4.1).
5. Text fields go through `CommitInput`, multi-line ones through
   `CommitTextarea` (DL-6.3, DL-13.5). Never bind a store value straight into
   an `<input value=…>` / `<textarea value=…>` inside a surface that does not
   unmount.
6. Eye-review on a rendered screenshot before calling it done — a green build
   proves nothing about design.

## 10. Migration status (what does NOT comply yet)

This document is the target, not a description of the whole app. Only the
settings panel has been reworked. Known survivors, to be fixed as each surface
is reworked — **do not "fix" them opportunistically inside an unrelated change**:

| where                                                                              | violates            | note                                                                                                                                                                               |
| ---------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.tab-popover__label`                                                              | DL-4.3 (uppercase)  | rework with the tab popover                                                                                                                                                        |
| config rows, Open board, inputs, `.search-bar`                                     | DL-2.3              | still on `--hair` for lines that are boundaries between surfaces; migrate per surface                                                                                              |
| `.settings-screen`, and the other `--hair-strong` frames around floating surfaces  | DL-2.3              | a surface floating above chrome takes `--seam-raised` — `.tab-popover` was converted, `.settings-screen` (`inset: 8px` over the stage, `z-index: 35`) was not; migrate per surface |
| `.search-bar`                                                                      | DL-1.3 (box-shadow) | real blurred shadow — drop                                                                                                                                                         |
| `.workspace-row.is-selected`, `.preset-chip.is-selected`, `.mock-pane.is-selected` | —                   | inset hairlines, allowed under DL-1.3                                                                                                                                              |

## 11. Settings shell

The settings surface is a full-window screen, not a drawer: a fixed category
rail beside a section area. §5's config row is still the only control inside a
section — these rules govern the frame around it.

- **DL-11.1** The settings shell is a two-column surface: a fixed nav rail, and
  a section area that owns **all** scrolling. The rail never scrolls with the
  content beside it.
- **DL-11.2** The active category is marked by a 2px left accent bar plus a 4%
  `--fg` wash — the same signifier as config row hover (DL-5.1), so "active"
  reads the same everywhere in the app. No shadow, no fill (DL-1.3).
- **DL-11.3** Category icons are Lucide icons rendered through `DeckIcon` (§14)
  at 16px, one per category, chosen for what the category _is_ rather than for
  variety. They were hand-drawn inline SVG until 2026-08-09; the rule now
  points at §14 so icon questions are settled in one place instead of once per
  category.
- **DL-11.4** Category labels are lowercase `--ui-font` (DL-4.1, like all
  chrome). The rail item _is_ the group label it replaced, so a section does
  not repeat its own name as a heading inside itself.
- **DL-11.5** Destructive actions never sit among navigable categories. They
  are pinned to the rail's foot, below a hairline, marked `--red` (DL-3.2).

## 12. Editable lists

Approved as a fork on 2026-08-04, for user-declared agents. §5 allows exactly
one interactive value per row and forbids list widgets outright, which a list
the user adds to and deletes from cannot satisfy. These rules say how a list is
still made of rows rather than becoming a new widget genre.

- **DL-12.1** A list section renders **one `cfg-row` per item** (`.cfg-row--item`).
  The item's name is the row key, its value fills the right side. There is no
  table, no card, no drag handle, no reorder affordance.
- **DL-12.2** An item row may carry **one** destructive affordance: a `×` after
  the value, `--text-faint`, turning `--red` on hover (DL-3.2). It is the only
  place in the app where a row holds a second interactive element, and it is
  allowed **only** for removing that row's own item.
- **DL-12.3** The list ends with the add affordance: an ordinary `cfg-row` whose
  pill is the `action` kind (`+`). Adding is a row, not a floating button.
- **DL-12.4** Items the user cannot edit stay in the same list under their own
  group label, with the pill in its disabled treatment (DL-5.2) and no `×`. A
  separate surface for them would imply two kinds of thing; they are one set
  with different permissions.
- **DL-12.5** Editing happens **in place**, never in a modal or a drawer. Both
  the row key and its value may become a `CommitInput` (DL-6.3) — the single
  documented exception to §5's non-interactive key, and it exists because
  renaming an item is editing that item, not configuring a setting.

## 13. Anchored popovers

Approved as a fork on 2026-08-08, for the Prompt Board. §5 governs rows inside
a settings section; a popover is a small screen anchored to a chrome button,
and these rules say how it stays made of rows instead of becoming a new widget
genre.

- **DL-13.1** A popover is a `--chrome-2` surface with a 1px `--hair-strong`
  inset hairline, radius 8px, anchored to its trigger. No blurred shadow
  (DL-1.3); depth comes from the background step.
- **DL-13.2** Dismissal: Esc, outside click, or completing the popover's
  action. On dismiss, focus returns to the pane (or control) that had it. The
  trigger carries `aria-expanded`; the surface is `role="dialog"` with a label.
- **DL-13.3** Content inside a popover is made of §5 rows and §12 list rows —
  a popover is a small screen, not a new widget genre.
- **DL-13.4** A §12 item row may expand exactly one inline editor region
  beneath it (`aria-expanded` on the row); expanding a row collapses any other.
  This is the documented extension of DL-12.5 for items whose value is
  multi-line.
- **DL-13.5** Multi-line text uses `CommitTextarea`
  (`src/ui/controls/commit-textarea.tsx`): DL-6.3 semantics (local draft,
  commit on blur / Cmd+Enter, Esc reverts), auto-grown by content up to a max
  height, then scrolls.
- **DL-13.6** Transient controls in a popover (pickers, search) reset when it
  opens; a popover never remembers half-finished state across opens.

## 14. Icons

Approved as a fork on 2026-08-09. Before it, icons came from two places at
once — hand-drawn SVG in some files, typographic characters (`×`, `▾`, `↹`,
`↺`, `‹`) in others — so the same action could look like a picture in one
surface and like text in the next. These rules exist so an icon question is
answered here rather than re-argued per button.

- **DL-14.1** `lucide-preact` is the only source of functional icons, and
  `DeckIcon` (`src/ui/controls/deck-icon.tsx`) is the only place its
  presentation is set: `fill="none"`, `stroke="currentColor"`,
  `strokeWidth={1.8}`, `aria-hidden`, `focusable="false"`. Icons are imported
  by name. Nothing else authors an `<svg>`, and no glyph character stands in
  for an action — `scripts/icon-system.test.ts` enforces both.
- **DL-14.2** Four sizes, exported from `deck-icon.tsx` and used by name:
  `CHROME_ICON` 13 (tab bar, titlebar), `ROW_ICON` 14 (config-row and popover
  actions), `BOARD_ICON` 15 (Open Board rows), `RAIL_ICON` 16 (settings rail).
  An icon never sets a control's padding or geometry; the control does.
- **DL-14.3** CSS never sets `width`, `height`, `stroke` or `stroke-width` on
  an icon. Those declarations beat SVG attributes, so one of them silently
  disables DL-14.1 wherever it lands. Colour is expressed as `color` and
  reaches the icon through `currentColor`.
- **DL-14.4** Icon-only controls are for familiar, repeated actions that
  already carry a hover tooltip (close, add, split, next). Consequential or
  rare actions keep their word beside the icon — Restore Defaults reads
  `reset`, the Open Board's button reads `Open Folder…`.
- **DL-14.5** Meaning, not decoration: `Trash2` deletes something the user
  declared and stored, `X` dismisses something transient. Two actions that
  differ in consequence never share an icon — which is why Prompt Board
  distinguishes `ClipboardPaste` from `Send`.
- **DL-14.6** Outside the library by intent, and not exceptions to be widened:
  the Deck brand mark, agent and OS logos, keyboard and terminal notation
  (`⌘`, `⏎`, `⎋`), selection and status dots, and `WorkspaceSpinner`. A logo is
  identity and a key legend is notation; neither is an icon in a system.

## 17. Shortcut rows

Approved as a fork on 2026-08-11, for the Shortcuts settings category. §5 gives
a row exactly one interactive value and §6 is a closed set of interactive
kinds; a shortcut row breaks both, because it shows the SAME setting on two
platforms at once and only one of the two can be edited on the machine in
front of you. These rules say how that stays a row instead of becoming a table.

The alternative was rejected on the evidence: a two-column table would have
been a second settings surface with its own header, alignment and scroll
behaviour, and §5's row is what makes settings scan as one document.

- **DL-17.1** A shortcut row is a `cfg-row` (`.cfg-row--shortcut`) and keeps
  every §5 property: key on the left, value slot on the right, DL-5.1 hover,
  the same vertical rhythm. It is a row that holds notation, not a new genre.
- **DL-17.2** The value slot holds **one chord per platform**, each preceded by
  a faint lowercase platform tag (`mac`, `win`) of fixed width so the chords
  form a column down the list. The tag labels the value; it is not itself a
  value and is never interactive.
- **DL-17.3** Exactly one chord is editable: the one for the platform the app
  is RUNNING on. It is a `cfg-btn` pill that records a chord when clicked. The
  other platform's chord is a **readout** — no border, `--text-faint` — because
  a border is what promises "you can press this" everywhere else in settings,
  and a chord can only be recorded on the keyboard that produces it.
- **DL-17.4** An action with no chord on a platform reads `unbound` in
  `--text-faint`. This is a normal state, not an error: most actions ship bound
  on one keymap only.
- **DL-17.5** A chord claimed by two actions is named on **both** rows, in the
  row's `desc` slot, in `--red` (DL-3.2 — a shortcut that silently shadows
  another one is an error, not a warning). It is reported, never refused:
  swapping two actions' chords must pass through a colliding state, and
  rejecting the first half makes the swap impossible to finish.
- **DL-17.6** The row's only second element is DL-6.1's reset button, shown
  whenever the row carries a user override — including an override that happens
  to equal the shipped chord, because what reset removes is the override, not a
  difference. Recording covers the other two outcomes without further
  controls — a chord rebinds, bare Backspace/Delete unbinds, Esc cancels.
- **DL-17.7** Chords are **notation, not icons** (DL-14.6): `⌘⇧D`, `Ctrl+Alt+T`
  are rendered as text, never as pictograms, and `formatShortcutBinding`
  (`src/lib/shortcut-label.ts`) is the only place their spelling is decided.
- **DL-17.8** A refused keystroke says WHY, in the pill, and keeps listening.
  Every refusal reason gets its own words: "reserved by macOS" is not the same
  message as "add ⌘, ⌃ or ⌥", and neither may render as the idle "press keys…"
  — a rule the user cannot see reads as a dead control.

## 18. Command-row frame

The number was in use before the text was. `DL-18` (as `DL-16`) has been cited
from nine places in `src/` since the title bar and the tab bar were collapsed
into one row; these rules are transcribed from those call sites on 2026-08-12,
so they record what the frame already does rather than proposing anything new.

Deck authors its own top row. §11 covers a full-window screen and §13 an
anchored popover; neither describes the one permanent row that carries the
window's identity and its actions at the same time.

- **DL-18.1** There is **one** chrome row above the stage, never two. `.window`
  is a three-row grid — `--frame-h`, the stage, `--status-h` — and the retired
  `.titlebar` and `.deck-toolbar` elements do not come back. Two stacked chrome
  rows is the shape this section exists to remove, which is why
  `src/ui/app.test.tsx` asserts both are absent in every platform and layout
  combination.
- **DL-18.2** The row is `--frame-h` tall on `--chrome-1`, closed by a single
  `--seam-recessed` bottom border and nothing else. That border is a boundary
  between two surfaces, so it takes the seam (DL-2.3), not the in-surface
  hairline this rule cited while the frame still used `--hair`. 34px is not a
  taste value: it carries a 26px control comfortably and clears the macOS
  traffic lights, which need roughly 28px of vertical room.
- **DL-18.3** **Whichever element occupies that row IS the frame.** In sidebar
  mode it is `.deck-frame`, spanning `1 / -1` and carrying the actions, with the
  sidebar starting beneath it. In top-tab mode it is `.tabbar` itself — same
  height, same surface, same single seam — and no `.deck-frame` is rendered
  above it. A layout picks one occupant; it never nests one inside the other.
- **DL-18.4** On macOS the traffic lights sit **inside** the row behind a
  reserved inset of `--frame-lights-w`, and whichever element is the frame
  reserves that inset itself. The inset is a footprint, not a control: the OS
  paints its buttons over exactly that box, so it is `aria-hidden`, holds no
  content, and anything placed there would sit underneath them. The frame is
  Deck's chrome, not OS spacing the app happens to sit under.
- **DL-18.5** Platform differences change the inset, never the row. Windows
  draws its own controls and owns the system title row, so `--frame-lights-w`
  is `0px` and the inset collapses to zero width and paints nothing — the row
  keeps the same height and the same content. Whether the element is left out
  of the tree or collapsed by CSS is each occupant's business; what the rule
  requires is that nothing is reserved. Reserving space no OS will paint into
  is a gap, not a frame.

## 19. Docked side panels

Added 2026-08-12 for the browser panel, and written to cover the class rather
than the instance.

**Numbered 19, not 16.** This section was written as §17 while Shortcut rows
held §15 and the application frame held §16. On 2026-08-12 all three moved up
by two — §17, §18, §19 — so that §15 and §16 carry exactly one meaning across
every branch of this repository; another branch had independently spent those
two numbers on read-only data tables and the display figure, and two rulebooks
disagreeing about what `DL-15` addresses is a collision that merges silently.
§18 is the application frame, immediately above. The file-explorer design's own
"§15 (docked side panels)" was already stale before that move; when that panel
is built it joins this section rather than opening a third number for the same
surface class.

A docked panel is a surface §11 (full-window screens) and §13 (anchored
popovers) do not describe: it is permanent, it displaces content instead of
covering it, and it can hold something that is not Deck's own pixels.

- **DL-19.1** A docked panel is a **column of the stage, not an overlay**. The
  terminal grid's own bounds shrink by exactly the panel's width, so panes
  resize around it. Nothing in the app floats permanently over a pane.
- **DL-19.2** The seam is a single `--hair` border on the panel's inner edge
  (DL-3.3). No shadow, no gradient, no second rule — the background step from
  `--bg` to `--chrome-2` is what separates the two regions.
- **DL-19.3** The panel's own header is a **bar of `iconbtn` controls**, the
  same class and the same 13px chrome icon size the tab bar uses (DL-14.2). A
  docked panel borrows the window's controls; it does not invent a set.
- **DL-19.4** Width is user-set by dragging the seam and persists as an
  ordinary setting, clamped to a min and max. The drag target is wider than the
  hairline it sits on and paints nothing — the hairline stays 1px.
- **DL-19.5** One status line, directly under the header, in `--text-faint`
  (DL-3.4) — or `--red` when it reports a failure (DL-3.2). It is the panel's
  only place for transient text; a panel does not raise dialogs of its own.
- **DL-19.6** When a panel hosts **foreign content** (a web page, a preview),
  Deck's chrome never overlaps it: the content gets its own rectangle below the
  header, and that rectangle is the only part of the column Deck does not
  paint. A native view stacked over it cannot be covered by any DOM layer, so
  the panel must hide it whenever an overlay opens — the visual rule and the
  implementation rule are the same rule here.

## 20. Numeric scales

_Reserved. Proposed by [the 2026-08-12 visual review](review/2026-08-12-visual-system-codex-review.md); not adopted. Adopting it is an R2 fork._

## 21. Interaction states

_Reserved. Same source, same status._

## 22. Surface genres

_Reserved. Same source, same status._

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

**Empty.** The only standing entry — `DL-16`'s text being cited from nine
places in `src/` but never written — was closed on 2026-08-12 when the rule was
transcribed from its call sites as §18 and the citations moved with it.
`scripts/design-language.test.ts` now fails the suite when a citation names a
number with no declared rule or section. It reads both spellings this repo
uses — `DL-17.1` and `DL §17` / `DESIGN-LANGUAGE §17` — but deliberately not a
bare `§17`, which cites a spec, a plan or a review far more often than it cites
this document. Citing DL by section therefore means naming DL, or the gate does
not see the citation.

The violations table above is the DL-specific ledger; this one is for claims
that do not match the tree. Do not remove this section (D7).
