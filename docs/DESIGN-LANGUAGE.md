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
  **Amended 2026-08-16 with exactly one scoped exception to the 300ms cap:**
  the focus ping runs 1500ms (DL-27.7). It is a **locator**, not a state
  change — it says where focus just went in a grid of identical panes — and
  300ms is below the threshold at which an eye that was looking elsewhere can
  catch it. The exception is scoped to that one effect; nothing else in the
  app inherits it, and a second surface wanting a long animation amends this
  rule again rather than citing DL-27.7. The allowed-property list is
  unchanged: the ping animates `opacity`, and the ring it fades in is a static
  inset hairline because DL-1.3 is **not** amended.
- **DL-1.3** Banned: **blurred/offset** `box-shadow` (the app is a flat system —
  depth comes from background steps and 1px hairlines), `backdrop-filter`,
  `filter`, JS animation loops (`requestAnimationFrame`) for chrome, timers that
  exist only to drive visuals. `box-shadow: inset 0 0 0 1px <color>` is
  permitted — it is a hairline, not a shadow (it paints no blur and costs no
  compositing layer).
  **Amended 2026-08-16 with exactly one scoped exception to the
  `backdrop-filter` clause:** `.modal-scrim` blurs what is behind it (DL-29.5).
  The exception is scoped to that one selector, and it earns it on the same
  ground the rest of this section stands on — cost. A modal scrim exists only
  while a modal is open, so its compositing layer is **transient**, unlike a
  blurred bar or panel that would pay for itself on every frame the app
  paints. Nothing else inherits it: a second surface wanting blur amends this
  rule again rather than citing DL-29.5. The `filter` clause, the
  `box-shadow` clause and the loop clauses are **unchanged**.
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
| `--sidebar-bg` / `--sidebar-seam`                      | recessed side columns and their boundary |
| `--chrome-1` / `--chrome-2`                            | background steps for bars / panels       |
| `--input-bg`                                           | recessed input surfaces                  |
| `--hair` / `--hair-strong`                             | 1px hairlines inside a surface           |
| `--seam-recessed` / `--seam-divider` / `--seam-raised` | the boundaries BETWEEN surfaces (DL-2.3) |
| `--text-primary` / `--text-muted` / `--text-faint`     | text hierarchy                           |
| `--ui-font`                                            | the one chrome typeface (DL-4.1)         |
| `--type-title` … `--type-micro`                        | the four standard text sizes (DL-4.4)    |
| `--radius-control` / `--radius-surface`                | the two radius roles (DL-20.1)           |
| `--duration` / `--ease`                                | chrome state-change motion (DL-20.2)     |

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
  _danger / destructive / error_. `--yellow` means only _an agent is waiting
  on you_ — attention a person must answer, one step below `--red`'s failure.
  Never decoration, none of the three.
  `--yellow` was **added 2026-08-16** with the agent status rail (DL-27.6).
  This rule assigned roles to green and red only, while `--status-unread` and
  `.attn-mark--warning` had been painting with yellow for as long as they have
  existed — a colour in use with no rule is a colour the next surface can mean
  anything by. The amendment legitimises what those two already do rather than
  letting the rail quietly reuse it a third time.
- **DL-3.3** Structure comes from `--hair` hairlines and background steps —
  not from color, not from shadows.
- **DL-3.4** Text hierarchy: `--text-primary` for keys and values,
  `--text-muted` for secondary value text (e.g. hex codes), `--text-faint` for
  descriptions, group labels, hints, disabled states.
- **DL-3.5** **The three text tones have measured contrast floors, and the
  floors are app-wide.** As WCAG contrast ratios: `--text-primary` ≥ **8:1**,
  `--text-muted` ≥ **6:1**, `--text-faint` ≥ **4.5:1**. Each floor is measured
  against **every** chrome surface the tone is permitted to sit on — `sidebarBg`,
  `chrome1`, `chrome2` and `tabActiveBg`, with `inputBg` added for
  `--text-primary`, which is the only tone a recessed input carries. Measuring
  on the darkest surface alone is what let the two surfaces users read most sit
  below the ratio the floor promised. `--text-faint` holds 4.5 and not 3
  because it styles 10.5–11px text, which WCAG AA rates as normal text.
  Meeting a floor is not sufficient: after the raise the three tones stay
  **ordered** (primary ≥ muted ≥ faint on every surface) and **visually
  distinct**, so a config row's label / value / description hierarchy survives.
  Three tones that all clear their floors by converging on one colour satisfy
  the numbers and lose the rule. Selected 2026-08-16 with the Native balanced
  direction, raising the 7 / 5.5 / 4.5 the derivation had carried since the
  ladder was built; the ordering algorithm and the surface set are unchanged.
  Anchors: [`deriveChromeColors`](../src/lib/derive-colors.ts) `current`,
  locked by [`derive-colors.test.ts`](../src/lib/derive-colors.test.ts)
  `current` — both moved to these floors in the rollout's task 2, 2026-08-16.

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
- **DL-4.3** **No uppercase as a styling device, and no artificial tracking.**
  Readable copy — every key, label, description, value, heading, column header,
  hint and empty-state message — carries no `text-transform: uppercase`, no
  all-caps spelling used as styling, and no non-zero `letter-spacing`. Amended
  2026-08-16 with the Native balanced direction: the ≤ 0.06em tracking cap and
  the one sanctioned uppercase (the §16 eyebrow) are both retired, so this rule
  now holds no exception for copy at all. The tracking that existed was tuned
  against a monospace advance width; under `--ui-font` the face already carries
  its own fitting, and re-opening or tightening it is a second opinion about a
  decision the typeface has already made — at chrome sizes it costs legibility
  and buys a texture nobody asked for.
  **One exception, and it is not copy:** `.pane__anchor-grip`
  (`letter-spacing: -1px`) pulls the two `⋮⋮` glyphs into a single grip
  pattern. That is **glyph geometry** — the spacing draws an icon-like control
  the way an SVG path would, and there is no word in it to read.
  [`design-language.test.ts`](../scripts/design-language.test.ts) `current`
  holds that allowlist to exactly this one selector; a second entry is an edit
  to this rule first.
  Clarified 2026-08-15: acronyms and proper nouns keep their dictionary casing
  (`USD`, `PNG`, `VS Code`, `iTerm2`) — the ban is on all-caps LABELS, not on
  words whose spelling is uppercase.
- **DL-4.4** **Four text sizes, and they are named.** Standard chrome text
  comes from one ladder — the Native balanced hierarchy, selected 2026-08-16:

  | role      | variable       | size   | carries                                           |
  | --------- | -------------- | ------ | ------------------------------------------------- |
  | title     | `--type-title` | 14px   | screen and panel titles                           |
  | body      | `--type-body`  | 12.5px | keys, row names, the text read as content         |
  | metadata  | `--type-meta`  | 11px   | values, counts, paths, branches, status copy      |
  | microcopy | `--type-micro` | 10.5px | descriptions, group labels, column headers, hints |

  Before this amendment the rule read "group label 10.5 · key 12.5 ·
  description 10.5 · value 11.5 · panel title 12" — the same shape as bare
  literals with no names, which is what let 200 use sites drift one at a time.
  The §16 display figure stays at **40px**, at most one per screen; it is the
  first of DL-4.5's named exceptions rather than a fifth rung of this ladder.
  Keys, group labels, rail labels, column headers, descriptions,
  table titles and empty-state messages are sentence-case; values stay
  lowercase (amended 2026-08-15 — chrome text that NAMES or DESCRIBES
  something is capitalized, text that IS the value is not; until then
  everything but keys was lowercase).

- **DL-4.5** **The ladder is variables, not repeated literals.** Standard
  chrome text takes its size from `--type-title` / `--type-body` /
  `--type-meta` / `--type-micro`, declared once in `:root`
  ([`styles.css`](../src/styles.css) `current` — the rollout's task 3 declared
  them, 2026-08-16), never from a px literal repeated at the use site. One ladder, one
  place to re-measure it; a second standard ladder declared beside this one is
  the failure this rule exists to prevent. The exceptions are a **closed
  list**, and each sits outside the ladder because it is not standard chrome
  text:

  1. the **§16 display figure** (40px) — the one number a screen exists to
     state (DL-16.1);
  2. the board's **structural screen heading** (`.wshead__title`, 19px) — the
     name of what a full-window screen is about, a structural level the four
     roles do not have. Its last mount since 2026-08-16 is the create-worktree
     form; the config view that first carried it (with the workspace's own
     name) is gone;
  3. **single-character marks and icon-glyph buttons**, whose size is the
     glyph's geometry (§14), not a text size;
  4. the **theme-gallery miniature** (DL-24.2) and the **preset-editor stage
     specimens** — drawings of Deck's own window, where every length is tuned
     against the drawing rather than against reading.

  Anything else that wants its own size amends this list before it ships.

## 5. The one control: config row

Every setting is a **row**: key (+ optional one-line description) on the left,
exactly **one interactive value** on the right. No other widget genres — no
segmented controls, checkbox lists, chip grids, sliders, or boxed steppers.

```
cfg-group                     ← group label (faint, sentence-case)
cfg-row
├─ cfg-row__key
│  ├─ cfg-row__label          ← ui-font 12.5px primary
│  └─ cfg-row__desc           ← ui-font 10.5px faint (optional)
└─ cfg-row__value             ← right-aligned slot
   └─ cfg-btn …               ← the single interactive pill
```

- **DL-5.1** Row hover is DL-21.2's quiet wash. Nothing else. Until 2026-08-14
  this rule read "2px left accent bar + 4% `--fg` wash"; §21 retired the bar
  app-wide, and this rule now points there rather than restating a second copy
  of the signifier that would drift from it.
- **DL-5.2** The pill (`.cfg-btn`): the value inside a 1px `--hair` border, at
  `--radius-control` (DL-20.1 — 6px until 2026-08-14). Hover → `--hair-strong`
  border. Focus-visible → 2px `--accent` outline (app-wide convention, DL-21.3).
  Disabled → `--text-faint` (DL-21.4).
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
- State changes (hover/active): `--duration` / `--ease` (DL-20.2). This read
  "0.13s ease" until 2026-08-14, when the figure became a token at 150ms.
- Nothing else moves. See DL-1.2 / DL-1.5.

## 8. Copy

- English UI. Keys and group labels sentence-case (`Show pane bar`);
  descriptions terse and sentence-case (`Reopen last session's tabs`); values
  lowercase (`on`, `off`, theme ids as written in code) — amended 2026-08-15,
  descriptions and group labels were lowercase before.
- A control says what happens; no vague labels.

## 9. Agent checklist (anti-drift)

Before shipping any chrome UI change:

1. Is it expressible as a config row (§5) using an existing value kind (§6)?
   If not — propose an edit to this document first, then implement. (This has
   already been violated once: a segmented control was added for "Tab bar
   position" and had to be rewritten as a `cycle`.)
2. Every color maps to a role in §3; no hardcoded hex (DL-2.1).
3. Any animation fits the budget in §7 and the constraints in §1. Reduced-motion
   is handled **by scope** (`.settings-screen *`, `.usage-screen *`), never by
   an allowlist of class names — an allowlist silently misses the next class.
   A new full-window screen adds its own scope to that list; it does not add
   the individual classes inside it.
4. No uppercase and no `letter-spacing` on copy (DL-4.3); text size comes from
   a `--type-*` variable, not a px literal (DL-4.5). No monospace anywhere in
   chrome — if a rule reaches for it, the answer is `--ui-font` (DL-4.1).
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

| where                                                                                                   | violates | note                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.cfg-btn`, inputs                                                                                      | DL-2.3   | still on `--hair`. These are lines INSIDE a surface, which is what `--hair` is for, so this row is a re-read rather than a debt: the boundary cases were the frames, and they moved. The board's layout cards were the third member and left with the config view (2026-08-16) |
| `.workspace-row.is-selected`, `.preset-chip.is-selected`, `.mock-pane.is-selected`                      | —        | inset hairlines, allowed under DL-1.3                                                                                                                                                                                                                                          |
| `.wsitem__spinner`, `.asr-row__mark[data-state="working"]`, `.asr-row__mark[data-state="asked"]::after` | DL-1.2   | looping animations. See the note below — opened 2026-08-16, not closed                                                                                                                                                                                                         |

**Opened 2026-08-16** by the agent status rail, and stated here because DL-27.7
deliberately does not cover it: DL-1.2 bans **infinite / looping** animations
and says nothing animates while the user is idle, but the rail's `working` arc
turns on a 1.8s loop and its `asked` halo pulses on a 2.4s one. Both were
rendered, reviewed and approved by the owner as the specimen's design on
2026-08-16, and both are the app's existing practice rather than a new habit:
`.wsitem__spinner` has shipped a 2.2s infinite spin for the same "an agent is
working" meaning since long before this ledger, unrecorded until now. DL-27.7
amends the **duration cap** for the focus ping alone and was frozen at that
scope on purpose, so widening it to cover loops would be this task rewriting a
decision it was handed. The rows above are therefore the honest state: the
looping marks are approved design that DL-1.2 as written forbids, and closing
the gap — by amending DL-1.2's loop clause, by bounding the loops, or by
dropping them — is an owner decision, not an implementation detail (§9.1). All
three are already skipped under `prefers-reduced-motion`, which is the part
that was never in question.

**Closed 2026-08-14** by the redesign's phase 2, each in the commit that fixed it:
`.tab-popover__label`'s uppercase (DL-4.3), `.settings-screen` and `.search-bar`'s
`--hair-strong` frames (DL-2.3, now `--seam-raised`), `.search-bar`'s blurred
`box-shadow` (DL-1.3), and the three rows §20/§21 opened for themselves — the accent
bars, the 53 radius literals and the state-change duration literals are all on tokens.
`.row.is-selected`'s solid `--accent` fill went with them (DL-3.1). The `marketing/`
chrome mirrors followed at phase end: the mock's frame moved into its navigation
column (DL-18.3), its selection took the §21 wash mixed from the neutral tone, and
its chrome radii took DL-20.1's control role — still hand-copied, still importing
nothing from `src/`, so the next chrome change must update them by hand again.

**Also closed 2026-08-14**, by the gallery-vs-app pass rather than the redesign —
both were rows the gallery had been documenting rather than rows this section
carried, which is why neither appears in the table above:

- **The disabled pill had no treatment at all** (DL-5.2, DL-21.4). `.cfg-btn`
  declared nothing for `:disabled` or `.cfg-btn--disabled`, so a disabled pill
  rendered identically to an enabled one — the state matrix measured this and
  said so in the specimen. Now `--text-faint`, with the hover border and hint
  accent switched off, matching both the attribute and the class.
- **`.tab-popover` drew a real border where `.prompt-popover` drew an inset
  hairline** (DL-13.1). The radius already agreed; the edge did not. The
  `border` is now the same `box-shadow: inset 0 0 0 1px var(--seam-raised)`,
  which DL-1.3 permits and DL-13.1 asks for by name.

**Closed 2026-08-16** by the Native balanced rollout, which amended DL-4.3 and
DL-4.5 and then fixed every surface those amendments put in debt (R2):

- **Styled uppercase is gone from chrome copy** (DL-4.3).
  `.board-home__recents-head` and `.wtf__label` were the last two
  `text-transform: uppercase` declarations; `.usage-hero__eyebrow`'s copy went
  with them, from `RAW TOKEN COST` to sentence-case `Raw token cost`, which
  also closes the sanctioned-uppercase exception DL-16.2 used to grant.
  `.tab-popover__label`'s uppercase had already closed on 2026-08-14.
- **Artificial tracking is gone from chrome copy** (DL-4.3) — the
  `letter-spacing` declarations on `.cfg-group`, `.tab-popover__label`,
  `.home-action`, `.board-home__recents-head`, `.row__name`, `.wtf__label`,
  `.wshead__title`, `.sect__title`, `.lcard__name`,
  `.metric-table__table thead .metric-table__cell`, `.usage-hero__eyebrow` and
  `.usage-hero__figure` were **deleted**, not zeroed. (`.sect__title` and
  `.lcard__name` have since gone entirely, with the board's config view on
  2026-08-16 — the entry stays as the record of what this pass touched.) `.pane__anchor-grip`'s
  `letter-spacing: -1px` is the one declaration left in the stylesheet and it
  is **sanctioned, not debt**: DL-4.3 names it as glyph geometry and
  [`design-language.test.ts`](../scripts/design-language.test.ts) `current`
  holds the allowlist to exactly that selector.
- **Standard chrome text moved onto the `--type-*` roles** (DL-4.5), across
  the frame, tabs, panes and status bar; the repository rail; the open board's
  home and worktree-form views (its config view was still standing then, and
  went on 2026-08-16); prompt and tab popovers; the settings
  surface and theme cards; dialogs, browser controls, the file surface and
  session-history rows; and the usage screen. 117 declarations now read a role
  variable. The 21 `font-size` literals that remain are DL-4.5's closed
  exception list — the 40px display figure, `.wshead__title`'s 19px, the
  single-character marks and icon-glyph buttons, and the preset-editor stage
  specimens — plus `.window`'s 13px, which is the shell's root default that
  relative units resolve against rather than a text role.

**Closed by deletion 2026-08-16** — the open board's **config view**. Picking a
workspace opens it with the layout and agent it was last opened with, so the
Layout + Agent screen between the two is gone and every selector that only
existed there went with it: `.board-config*`, `.sect*`, `.lgrid`, `.lcard*`,
`.builtin`, and the footer's `.foot__lead` / `.foot__sum` / `.foot__keys`.
Nothing was re-styled to comply — the surface stopped existing, which is the
cheapest way a debt ever closes. What survives is shared: `.wshead*`,
`.board-back`, `.foot` and `.foot__act` belong to the create-worktree form, and
`.agents` / `.achip*` / `.shellmark` are `AgentQuickPicker`'s, now the app's
only agent picker. The board's one warning moved to `.board-home__notice`
(DL-3.2), which is where a failed open is said at all.

**Also closed 2026-08-16** — `.iconbtn.is-active` (DL-21.1). The frame's icon
buttons marked active with `color: var(--accent)` over a 15% `--accent` fill,
which is the one thing DL-21.1 names by hand that active must not be. It now
takes the same neutral `--tab-active-bg` wash and `--text-primary` ink as
`.tab.is-active`, `.wsitem.is-active`, `.settings-nav__item.is-active` and
`.sessions-nav__item.is-active`, so the app has one signifier for active again.
Found by the owner from a rendered screenshot, not by a test.

Still open on the same rule, and deliberately not fixed in that pass
(scope: the owner pointed at the frame's icon buttons):

| where                              | violates         | note                                                                                                                               |
| ---------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `.usage-nav__item.is-active`       | DL-21.6, DL-21.1 | keeps a `border-left-color: var(--accent)` bar — the retired accent marker — beside a 4% `--fg` wash that is not `--tab-active-bg` |
| `.usage-range__option.is-active`   | DL-21.1          | 4% `--fg` wash instead of `--tab-active-bg`; also mixes from `--fg` rather than `--tone` (DL-2.3's correction)                     |
| `.toolbar-menu__row.is-active`     | DL-21.1          | marks active with `--accent` ink and no wash                                                                                       |
| `.worktree-agents__item.is-active` | DL-21.1          | correct wash, but adds an `--accent` border as a second signifier                                                                  |

**Opened 2026-08-16** by the modal shell (§29), and recorded here rather than
fixed. Amending DL-1.3's `backdrop-filter` clause for `.modal-scrim` meant
reading that rule closely, which turned up three `filter` declarations the
ledger had never carried. They are **not** covered by the scrim's exception —
that one is scoped to `backdrop-filter` on a single selector — and they are not
this task's to remove (§10's own instruction, and the surfaces they belong to
were not reworked here):

| where                                          | violates       | note                                                                                                                                                             |
| ---------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.sidebar-banner img` / `.sidebar-banner__art` | DL-1.3         | `filter: saturate() contrast()` grading the banner art, plus a second declaration on the `--woven` treatment. A standing layer, unlike the scrim's transient one |
| `button.attn-mark`                             | DL-1.3, DL-1.2 | `transition: filter` — banned as a property AND absent from DL-1.2's animatable list                                                                             |

## 11. Full-window screens

**Two members left this class on 2026-08-16.** Token usage and session
history became tabs of the docked side panel (DL-19.7); Settings is the only
full-window screen Deck still has. The rules below are unchanged and still
describe the class — what changed is who belongs to it, and with it the
three-way mutual exclusion those two used to keep with Settings: a docked
column displaces the terminal grid (DL-19.1) instead of covering it, so it
does not compete for Settings' layer at all.

A full-window screen covers the stage instead of sitting beside it: it is
**full-bleed** (no inset, no radius, no raised seam of its own — those belong
to surfaces that float, DL-20.1), with a fixed nav rail beside a section area.
Settings was the first and is still the reference implementation; the token
usage screen (2026-08-10) is the second, which is why these rules now say "a
full-window screen" where they used to say "the settings shell". §5's config
row is still the only control inside a settings section — these rules govern
the frame around it, whatever a given screen puts in its sections.

- **DL-11.1** A full-window screen shell is a two-column surface: a fixed nav
  rail, and a section area that owns **all** scrolling. The rail never scrolls
  with the content beside it.
- **DL-11.2** The active rail item is marked by DL-21.1's selection wash — the
  same signifier as every other "this one" in the app. No shadow, no fill
  (DL-1.3), and no accent bar: this rule mandated one until 2026-08-14, at which
  point §21 made the wash the single selection signifier. The rule's intent is
  unchanged and was always the point — "active" reads the same everywhere; only
  the mark it names has moved.
- **DL-11.3** Rail icons are Lucide icons rendered through `DeckIcon` (§14)
  at 16px, one per rail item, chosen for what the item _is_ rather than for
  variety. They were hand-drawn inline SVG until 2026-08-09; the rule now
  points at §14 so icon questions are settled in one place instead of once per
  item.
- **DL-11.4** Rail labels are sentence-case `--ui-font` (DL-4.1, DL-4.4;
  lowercase until 2026-08-15). The rail item _is_ the group label it replaced, so a section does
  not repeat its own name as a heading inside itself.
- **DL-11.5** Destructive actions never sit among navigable rail items. They
  are pinned to the rail's foot, below a hairline, marked `--red` (DL-3.2). A
  screen with no destructive action has no foot at all; the slot is not filled
  with something else to keep the shape symmetrical.

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

- **DL-13.1** A popover is a `--chrome-2` surface with a 1px `--seam-raised`
  inset hairline at `--radius-surface` (DL-20.1 — 8px until 2026-08-14),
  anchored to its trigger. No blurred shadow (DL-1.3); depth comes from the
  background step. The frame is a seam, not a hairline: a popover floats above
  chrome, so its edge is a boundary between two surfaces (DL-2.3), which is the
  §10 debt this rule carried while it still said `--hair-strong`.
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

## 15. Read-only data tables

Approved as a fork on 2026-08-10, for the token usage dashboard. §5 governs a
row whose key carries exactly one interactive value, and §12 governs a list the
user adds to and deletes from; a page of measured numbers is neither. A daily
usage grid has no key to name, no value to set, and nothing to add or remove —
every cell is a fact that was counted. These rules say how such a grid stays
part of this design language instead of becoming a new widget genre: it is a
**table of facts**, and the one thing it must never grow is an interaction.

- **DL-15.1** A metric table sits on the screen's own `--chrome-2` surface
  inside a 1px `--hair` container at `--radius-control` — written as "radius
  8px, the same box §13 gives a popover" before DL-20.1 closed radii to two
  roles; a table is content INSIDE a surface, not a floating surface, so it
  takes the control role, minus the hairline emphasis. Rows are separated by `--hair`
  hairlines and nothing else: no zebra striping, no fills, no shadow (DL-1.3,
  DL-3.3). Depth in this app is a background step, and a table is not a card.
- **DL-15.2** A metric table is **read-only and non-interactive**: no sort
  control, no column reordering, no row click target, and — the part that gets
  broken first — **no row hover treatment**. DL-21.2's hover wash means
  "this row does something" (the rule named DL-5.1's accent bar before §21
  retired it); a row that lights up under the pointer and then
  does nothing is a broken promise, and it is the one affordance a reader will
  try. Adding sorting or filtering is a design decision, not an implementation
  detail: propose an edit to this document first (§9.1).
- **DL-15.3** Horizontal overflow scrolls **inside the table's own container**,
  never on the page body and never by shrinking the type. The container carries
  `overflow-x: auto`; the shell around it keeps `min-height: 0` and a
  `minmax(0, 1fr)` track so the grid can actually shrink (DL-11.1). A wide
  table is then one element's problem instead of a horizontal scrollbar under
  the whole app.
- **DL-15.4** Numerals are **right-aligned** and set with
  `font-variant-numeric: tabular-nums` (DL-4.2); text columns stay
  left-aligned. This repo has **no `--mono` token** and will not gain one — the
  monospace face belongs to the terminal (DL-4.1), and a mono column here would
  read as terminal output that leaked into native UI. Tabular figures in
  `--ui-font` are what hold a column of digits in line, and right alignment is
  what makes magnitudes comparable down the column; between them they do
  everything a monospace column was wanted for.
- **DL-15.5** A column header is sentence-case `--ui-font` at 10.5px in
  `--text-faint` at normal weight (DL-4.1, DL-4.3, DL-4.4; lowercase until
  2026-08-15) — the same treatment
  as a `cfg-group` label, because that is what it is: the name of the thing
  below it, not a heading competing with the data. No uppercase, no bold, no
  sort caret.
- **DL-15.6** A value that is unknown, unavailable or not applicable renders as
  a single em dash `—` in `--text-faint`. Never `0`, never `n/a`, never an
  empty cell. Zero is a measurement and the dash is the absence of one: a table
  that prints `0` where it means "we hold no price for this model" is stating a
  fact it does not have.
- **DL-15.7** The markup is a real `<table>` with `<thead>`, `<tbody>`,
  `<th scope="col">` on every column header and `<th scope="row">` on the cell
  that identifies the row. A grid of `<div>`s is unreadable to assistive tech,
  and this is data whose only meaning is which row and which column a number
  sits in. The table's accessible name comes from a visible heading above it
  via `aria-labelledby`, and any disclaimer under it via `aria-describedby` —
  not from `<caption>`, because a caption lives inside the DL-15.3 scroll
  container and would slide out of view with the columns.
- **DL-15.8** A table with no rows still renders its header row plus one
  spanning cell saying what is absent, in `--text-faint`. A table that vanishes
  when empty leaves the reader unable to tell "nothing has happened yet" from
  "something is broken" — a distinction the screen around it is required to
  make, and which it cannot make if the evidence disappears.
- **DL-15.9** A cell may hold **rendered content rather than a string** —
  added 2026-08-15, when the daily view merged its per-agent rows into one row
  per day and had to keep both levels visible. Three constraints keep that from
  becoming a second widget genre. The content stays **facts**: DL-15.2 governs
  whatever a section puts in a cell, so no button, no link, no hover
  treatment, no tooltip carrying the only copy of a value. A **brand mark** is
  the same asset the rest of the app uses (`lib/agent-logos.ts`), sized to the
  cell's own line rather than to a chip, and its `alt` is empty when the name
  it identifies is the next element — an alt string there makes a screen
  reader say the name twice. And **subordinate figures inside a cell** are
  `--text-faint`, right-aligned and tabular (DL-15.4): they are read against
  each other inside one cell, never against the row's own numeric columns,
  which stay the louder number. Sub-lines that must align across rows are laid
  out as one grid with fixed track widths, because an `auto` track resolves per
  cell and would put identical figures at different offsets on consecutive
  rows.

## 16. The display figure

Approved as a fork on 2026-08-10, for the token usage overview. §15 governs a
table of facts and §5 a row whose key carries one value; neither covers a
screen whose entire job is to state **one number** and then account for it. The
overview is not a denser table — it is a single figure with its own breakdown
underneath, and these rules say how that stays part of this design language
instead of becoming a dashboard genre with its own vocabulary. It is still a
key beside a value and a fact on a surface; only the scale of the headline and
the shape of the proportion are new.

- **DL-16.1** A screen may carry **at most one display figure**: the number the
  screen exists to state. It is set at the DL-4.4 display size (40px), weight
  600–700, `--text-primary`, `font-variant-numeric: tabular-nums` (DL-4.2).
  A screen with two display figures has none — the second one demotes the
  first to a heading and the reader no longer knows what the screen is about.
  If a second number matters, it goes in the accounting below at ordinary
  sizes, never at this one.
- **DL-16.2** The display figure is introduced by an **eyebrow label**:
  sentence-case microcopy (`Raw token cost`) at `--type-micro` (10.5px) in
  `--text-muted`, with **no** tracking and no `text-transform`. Its whole job
  is to name what the number is; the 40px figure under it already has all the
  emphasis the pairing needs, and a label that shouts beside a figure that is
  large is two things competing to be read first. **Amended 2026-08-16**,
  reversing the 2026-08-10 fork: this label used to be the one sanctioned
  uppercase in the app (`RAW TOKEN COST`) with letter-spacing 0.08em, both
  written as deliberate exceptions to DL-4.3. The Native balanced direction
  retired the exception rather than the eyebrow — DL-4.3 now bans styled
  uppercase and tracking on readable copy with no exception at all, so there is
  nothing here for another surface to cite. DL-15.5's sentence-case column
  headers, which this rule used to have to defend itself against, are simply
  what everything looks like now.
- **DL-16.3** A **share bar** may sit under any row that names a part of a
  stated total: a full-width track 4px tall, radius 2px (half its own
  track — a capsule, a shape rather than a DL-20.1 scale value), track
  `color-mix(in srgb, var(--fg) 8%, transparent)`, filled left to right by that
  row's share. It carries no gradient, no shadow and no animation (DL-1.3,
  DL-1.2) — it is a printed proportion, not a thing that moves.
- **DL-16.4** The fill takes **the subject's own established colour** — for an
  agent, the terminal-theme colour it already wears on its pane dot and tab
  (`dotColor`, `src/lib/process-info.ts`). It never introduces a colour role of
  its own and never uses a brand colour sampled from a logo: §3's roles stay
  closed, and an agent that is magenta everywhere else in the app must be
  magenta here too.
- **DL-16.5** A share bar is a **proportion of a stated total**, and it is drawn
  only when that total is on screen. It is not a gauge, not a progress
  indicator, and not a meter against a budget or a quota — nothing in it may
  imply a limit the app does not know. When the total is unavailable, every
  bar renders as an empty track and no percentage is printed anywhere; a bar
  that fills against an unknown denominator is an invented number.
- **DL-16.6** A share bar is **not interactive**: no hover treatment, no click
  target, no tooltip carrying the only copy of a value. The DL-15.2 reasoning
  applies unchanged — an affordance that reacts and then does nothing is a
  broken promise. The percentage is always written in text beside the bar, so
  the bar itself is `aria-hidden` and removing it would lose no information.
- **DL-16.7** A display figure may carry a **range selector**, and it is the
  only control permitted on a metric screen. It is not a setting and it is not
  a filter over a list: it says **what period the figure covers**, so it
  belongs to the figure exactly the way the `*` disclaimer does, and it sits
  with the figure rather than in a toolbar. DL-15.2 is unchanged and still
  governs the tables themselves — the selector sits outside them, and nothing
  inside a metric table becomes interactive because this rule exists.
  - **Segmented, not a §6 `cycle` pill.** §6 says to extend its table before
    inventing a value kind, so the reason is recorded here: every period must
    be **visible at once**, because the set of available comparisons is itself
    information — a reader who cannot see that "7 days" exists will not think
    to ask for it. A `cycle` shows one option and hides the rest, and it turns
    "go back one period" into three clicks through states the reader did not
    want. That is a real cost paid for visual tidiness, and this is the one
    place the app declines to pay it.
  - **Appearance.** Options are sentence-case `--ui-font` (DL-4.1, DL-4.4) on
    one row. The
    selected option is marked with the signifier this app already means by
    "active" — the 4% `--fg` wash of DL-5.1 and DL-11.2 — never a filled pill,
    a coloured chip, an underline or a border invented for this control. No
    shadow (DL-1.3). A reader who has learned what "active" looks like in
    Settings must not have to learn it twice.
  - **Restate the range wherever it is implied.** Selecting a period changes
    every number on the screen, so no figure, share or count may be left
    ambiguous about what it covers: the selected option stays visible beside
    them, and an empty period says which period is empty rather than only that
    something is missing. A number whose period the reader has to remember is
    a number they will misread.
  - **Transient.** The selection is view state, not a preference: it resets
    when the screen closes, for the reason DL-13.6 gives — a surface never
    remembers half-finished state across opens, and a figure silently scoped
    to a period chosen last week is worse than one that always starts whole.

## 17. Shortcut rows

Approved as a fork on 2026-08-11, for the Shortcuts settings category; amended
2026-08-15, when the row stopped showing both platforms' keymaps at once. §6
is a closed set of interactive kinds and the capture pill (DL-17.3, DL-17.8)
is not in it; these rules say how a row holding one stays a §5 row instead of
becoming a table or a second settings surface.

The 2026-08-11 form showed BOTH keymaps per row, running-platform pill beside
an other-platform readout, each behind a `mac`/`win` tag. Reversed 2026-08-15:
an installed desktop app knows which platform it is running on, so printing
both is a docs-page convention, not an app one. The other keymap's overrides
remain stored in settings; they are simply not rendered.

- **DL-17.1** A shortcut row is a `cfg-row` (`.cfg-row--shortcut`) and keeps
  every §5 property: key on the left, value slot on the right, DL-5.1 hover,
  the same vertical rhythm. It is a row that holds notation, not a new genre.
- **DL-17.2** The value slot holds **the running platform's chord only** —
  no platform tag, no other-platform column (amended 2026-08-15; the tag
  labelled a distinction the row no longer draws).
- **DL-17.3** The chord is editable: a `cfg-btn` pill that records a chord
  when clicked, for the platform the app is RUNNING on — a chord can only be
  recorded on the keyboard that produces it. The precedent this rule set
  stands: a value that cannot be pressed renders as a **readout** — no
  border, `--text-faint` — because a border is what promises "you can press
  this" everywhere else in settings. Shortcut rows themselves stopped showing
  a readout on 2026-08-15; the precedent's other call sites (the repository
  rail) keep citing it.
- **DL-17.4** An action with no chord on the running platform reads `unbound`
  in `--text-faint`. This is a normal state, not an error: most actions ship
  bound on one keymap only.
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

- **DL-18.1** There is **one** chrome row per layout, never two, and the retired
  `.titlebar` and `.deck-toolbar` elements do not come back. Two stacked chrome
  rows is the shape this section exists to remove, which is why
  `src/ui/app.test.tsx` asserts both are absent in every platform and layout
  combination. Until 2026-08-14 this rule also said the row sits **above the
  stage**; in sidebar mode it no longer does (DL-18.3), and the count is what
  the rule was always about.
- **DL-18.2** The row is `--frame-h` tall, and what it paints depends on which
  element is the frame. In top-tab mode it is `--chrome-1` closed by a single
  `--seam-recessed` bottom border and nothing else — that border is a boundary
  between two surfaces, so it takes the seam (DL-2.3). In sidebar mode its two
  occupants paint their own columns: `.deck-frame` uses `--sidebar-bg`, continuous
  with the rail under it, while `.stage__strip` stays transparent on the stage's
  `--bg`. The shell's structural line is vertical there — the stage's left edge.
  34px is not a taste value in either mode: it carries a 26px control comfortably
  and clears the macOS traffic lights, which need roughly 28px of vertical room.
  The reviewed direction drew it at 54px and that figure was declined under
  DL-20.4.
- **DL-18.3** **Whichever element occupies that row IS the frame, and the
  layout decides where the row is.** In sidebar mode the row is split by the
  shell's vertical seam and has one occupant per side: `.deck-frame` at column
  1, carrying the actions with the rail beneath it, and `.stage__strip` at
  column 2, carrying the tabs (DL-18.6). In top-tab mode there is no
  navigation column, so the frame is `.tabbar` spanning the window — same
  height, same `--chrome-1`, same single seam — and no `.deck-frame` is
  rendered. Neither layout nests one occupant inside another. Adopted
  2026-08-14 with the redesign's shell; before it, sidebar mode put a
  full-width band above both columns, and until later the same day column 2's
  half of the row was empty and the terminal ran to the top of the window.
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
- **DL-18.6** **The tabs are the frame row's stage-side occupant, in both
  layouts.** Top-tab mode has always drawn them there; sidebar mode does too
  since 2026-08-14, as `.stage__strip` — the same `TabStrip` component, the
  same `--frame-h` row, filling the half of it that column 2 owns. It stays
  transparent on the stage's `--bg`, matching DL-18.2's sidebar clause; it
  introduces no second SURFACE. **Amended 2026-08-16: it does close with one
  `--seam-recessed` hairline along its bottom edge** — the same line `.tabbar`
  has always drawn under itself in top-tab mode (DL-2.3's shell boundary), so
  both layouts mark where chrome ends and the work area begins in the same
  way. The owner asked for it after reading a strip whose chips looked like
  they were floating in the terminal. Its right edge stops at
  whatever docked panel is open
  (DL-19.1's arithmetic, `--explorer-w`), because those
  panels own their columns top to bottom. This adds an occupant, not a row —
  DL-18.1's count is unchanged, and no layout stacks two chrome rows. One
  consequence is deliberate and worth stating: the same chips exist in both
  layouts, so the navigation rail no longer lists documents at all. A rail row
  says which repository and worktree a session is in; the strip says what is
  open. **Amended 2026-08-16:** the strip is ONE row of one chip shape, in the
  order things were opened — see DL-18.10, which retired the segments this
  rule and DL-18.8 used to name.
- **DL-18.7** **The stage is the focal surface in every theme.** The terminal
  and document surface keep the active theme's `--bg`; the left navigation
  frame/rail and every docked side panel share the derived `--sidebar-bg`.
  `--sidebar-bg` must never equal `--bg`, including for light and pure-black
  overrides, and the vertical boundary uses the derived `--sidebar-seam`.
  The invariant is derived and published by
  [`derive-colors.ts`](../src/lib/derive-colors.ts) `current` and
  [`theme-vars.ts`](../src/lib/theme-vars.ts) `current`, with preset and override
  coverage in [`derive-colors.test.ts`](../src/lib/derive-colors.test.ts)
  `current`. Approved by the owner on 2026-08-14 to keep attention on the center
  work area instead of either sidebar.
- **DL-18.8** **The browser is a stage surface, not a docked column
  (2026-08-15).** It is one chip on the strip — globe icon plus page title,
  placed by when it was opened since DL-18.10 replaced the segment it used to
  close — and, while active, it covers the
  terminal grid exactly as the document surface does: the same
  `.stage__surface` rectangle, the same cover-don't-unmount rule, the same
  explorer inset. At most one surface holds the stage; activating any
  surface or terminal tab steps the others back
  ([`BrowserSurface`](../src/browser/browser-surface.tsx) `current`,
  [`composeSurfaceStrip`](../src/ui/stage-surface-strip.ts) `current`).
  Because the page is a native view that paints above every DOM layer, the
  surface tells the host to hide whenever a DOM overlay opens or it loses
  the stage — DL-19.6's visual-rule-is-implementation-rule, carried along
  when the browser left §19's class. Closing the chip hides the view and
  keeps the page; only closing the window destroys it.

- **DL-18.9** **The navigation column is resizable, and hiding it hides it
  completely (2026-08-16).** Its seam takes the same drag target DL-19.4 gives
  a docked panel — wider than the hairline, painting nothing
  ([`SidebarGrip`](../src/ui/sidebar-grip.tsx) `current`) — and a drag pulled
  past the floor hides the column on release instead of clamping there. The
  column goes to zero: rail, frame row and seam all go with it
  ([`SIDEBAR_HIDDEN_WIDTH`](../src/ui/panel-resize.ts) `current`), and the one
  thing that survives is the traffic lights' reserved inset, which the stage
  strip carries while the column is gone. What makes zero possible is that
  the frame row holds **only window controls**: the traffic lights and the
  hide control beside them
  ([`SidebarToggle`](../src/ui/sidebar-toggle.tsx) `current`). The feature
  toolbar is not a window control and rides the stage strip's trailing end
  instead, so the column's width never decides how many of its actions are
  visible. While the column is hidden the control moves to the strip's leading
  edge — a hidden column cannot hold its own way back out. One width, one
  owner: `App` writes `--sidebar-w` and `[data-sidebar-collapsed]` onto
  `:root` ([`applySidebarShell`](../src/ui/sidebar-shell.ts) `current`) the
  way theme tokens are written, and the stylesheet's own declarations are the
  pre-JS fallback rather than a second source.

  **This rule replaced a collapse-to-icon-rail reading the same day it was
  written.** That reading existed because the frame row lived inside the
  column (DL-18.3) and could not go to zero without taking the traffic lights
  with it; moving the toolbar out and the hide control up removed the
  constraint rather than working around it.

- **DL-18.10** **One chip shape, one row, one order (2026-08-16).** The strip
  had two segments until this rule: every terminal tab, a `.tabbar__sep`
  hairline, then every non-terminal surface. Both are gone. A chip is a
  terminal tab, a document or the browser and looks identical either way —
  same height, same `--radius-control`, same `--type-body` label, same close
  control, DL-21.1's wash for the selected one — and what it opened is said by
  its **glyph**, never by its shape, its position or a divider. That glyph
  slot is a fixed 15px box holding exactly ONE mark: an agent's brand mark for
  a terminal tab (DL-14.6 covers the logo), the `SquareTerminal` glyph when no
  agent is recognised; a document takes the file-type icon the tree already
  uses
  ([`fileIcon`](../src/files/ui/file-icons.ts) `current`), which is where that
  vocabulary stopped being docked-panel-only; the browser keeps its globe.
  **Order is when it was opened**, on one window-wide clock the three owners
  share ([`open-sequence.ts`](../src/lib/open-sequence.ts) `current`,
  [`mergeStripOrder`](../src/lib/strip-order.ts) `current`), so a document
  opened before a terminal tab sits before it. The keyboard walks that same
  merge — the point of the rule rather than a side effect: ⌘⇧[ / ⌘⇧], ⌘1–9 and
  ⌘9 count CHIPS, so ⌘2 can land on a document. Approved by the owner on
  2026-08-16, who chose the glyph-led chip and the interleaved order over
  keeping documents in a segment of their own. Two things deliberately did NOT
  change: a label is never coloured by git status (Deck's file model has no
  git status to read), and sidebar mode still scopes the terminal chips to the
  active repository (DL-18.6) — the merge orders whatever that scope leaves
  visible.
  **Amended the same day, after the owner saw it rendered — a chip says WHAT
  is open and nothing else.** Three things came off it, in the order the owner
  asked:
  1. the per-tab **colour dot**, which rode the brand mark's corner for one
     revision — one 15px box carrying two marks read as noise, not identity;
  2. the **agent attention mark** (working spinner, done dot), because agent
     state belongs to the rail (§27) and a chip that also reported it made the
     strip a second status surface competing with the first;
  3. the **rename/colour popover** a chip used to open, so a click on the chip
     that already holds the stage is inert.
     The only dot left on the strip is a document chip's unsaved marker, which is
     state about the FILE, not about an agent. The close control's hover is
     DL-21.2's neutral wash, **not** a red one: closing a tab is an everyday
     action with an undo (⌘⇧T), so tinting it red spent DL-3.2's danger colour on
     something that is not dangerous.
     All of this is **removal from the strip, not deletion of the features**, at
     the owner's word: `dotColor` still round-trips through settings,
     materialization and session restore; `AgentAttentionMark` and `TabPopover`
     are unchanged and still raised by the rail; the strip simply stopped being a
     claimant. One consequence to state plainly — **top-tab mode has no rail, so
     ⌘⇧R (`open-tab-options`) reaches nothing there** until a rail exists in that
     layout or the action is retired.

## 19. Docked side panels

Added 2026-08-12 for the browser panel, and written to cover the class rather
than the instance — which proved right: on 2026-08-15 the browser left this
class for the stage (DL-18.8), and the file explorer remains the section's
resident instance. The rules keep saying "panel" for whatever docks next.

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
  `--bg` to `--sidebar-bg` is what separates the two regions and keeps the panel
  in the same recessed family as the navigation sidebar (DL-18.7).
- **DL-19.3** The panel's own header is a **bar of the window's own controls**,
  the same classes and the same 13px chrome icon size the tab bar uses
  (DL-14.2). A docked panel borrows the window's controls; it does not invent
  a set. **Amended 2026-08-16:** the column hosts several surfaces, so that
  bar is the tab row (DL-19.7) rather than a title plus a hide control. The
  hide control left the header for the stage strip — a closed column cannot
  hold its own way back out, which is DL-18.9's reasoning applied to the
  other edge
  ([`DockPanel`](../src/ui/dock/dock-panel.tsx) `current`,
  [`DockToggle`](../src/ui/dock/dock-toggle.tsx) `current`).
- **DL-19.4** Width is user-set by dragging the seam and persists as an
  ordinary setting, clamped to a min and max. The drag target is wider than the
  hairline it sits on and paints nothing — the hairline stays 1px. **A drag
  pulled past the floor is a close, not a clamp (amended 2026-08-16):** the
  panel dims while the gesture is armed and closes on release, and that path
  writes no width — the floor is not a preference the user expressed. It dims
  rather than closing under the pointer because closing unmounts the grip the
  gesture is captured on, which would make an overshoot unrecoverable. The
  same threshold serves the navigation column's seam (DL-18.9), where past the
  floor means collapse
  ([`resolvePanelDrag`](../src/ui/panel-resize.ts) `current`).
- **DL-19.5** One status line, directly under the header, in `--text-faint`
  (DL-3.4) — or `--red` when it reports a failure (DL-3.2). It is the panel's
  only place for transient text; a panel does not raise dialogs of its own.
- **DL-19.6** When a panel hosts **foreign content** (a web page, a preview),
  Deck's chrome never overlaps it: the content gets its own rectangle below the
  header, and that rectangle is the only part of the column Deck does not
  paint. A native view stacked over it cannot be covered by any DOM layer, so
  the panel must hide it whenever an overlay opens — the visual rule and the
  implementation rule are the same rule here.
- **DL-19.7** **A docked panel that hosts more than one surface names them
  in a tab row, and shows exactly one at a time (2026-08-16).** The row IS
  the panel's header (DL-19.3): a `role="tablist"` of `role="tab"` chips,
  each an icon plus a sentence-case label (DL-4.4), the active chip carrying
  DL-21.1's full wash and idle chips carrying none — the same selection
  language the settings and usage rails already use, laid out as a row
  ([`DockTabs`](../src/ui/dock/dock-tabs.tsx) `current`). A tab the running
  host cannot serve is **omitted, not disabled**: a chip that opens an empty
  surface is worse than no chip
  ([`availableDockTabs`](../src/ui/dock/dock-tab-registry.ts) `current`).
  The selection persists as an ordinary setting and is re-resolved against
  host support on every read, so moving between hosts never paints an empty
  column and never destroys the user's own choice.
- **DL-19.8** **A screen that moves into the column leaves its rail behind
  (2026-08-16).** §11's navigation rail is a full-window shape: it earns its
  fixed column because a window has prose width to spend. The docked column
  does not — at DL-19.4's 360px floor a 120px rail is a third of the panel,
  and the session history rail spent it on labels it then clipped to `Cla…`,
  which is rent paid for nothing. Inside the column, that navigation becomes
  a **compact chip row above the content**: the same `role="tablist"`, the
  same DL-21.1/21.2 selection language, laid out along the axis the column
  has room on and walked with ←/→ instead of ↑/↓. A chip may print a shorter
  label than the rail did, provided the full name stays its accessible name
  (WCAG 2.5.3 — the short label must be contained in it). This is a layout
  rule, not a second genre: nothing about the items changes but their
  direction and their padding.

## 20. Numeric scales

Approved as a fork on 2026-08-14 (plan decision D2). Proposed by
[the 2026-08-12 visual review](review/2026-08-12-visual-system-codex-review.md)
`current`, which asked for seven closed scales; **two of them are adopted and the rest are
not**. The numbers are the ones the owner eye-approved in the gallery direction,
not the review's, because a scale nobody has looked at rendered is a table, not a
decision. Design:
[direction token rebuild §9.4](specs/2026-08-13-direction-token-rebuild-design.md)
`decided`.

- **DL-20.1** Two radius roles, and no third picked at a use site.
  `--radius-control` (10px) is anything the pointer acts on inside a surface —
  rows, pills, icon buttons, chips. `--radius-surface` (16px) is anything that
  floats above chrome — popovers, dialogs. The settings screen left this set
  on 2026-08-16: it is full-bleed over the stage (DL-11), so it has no radius
  of its own. A value chosen by feel at a use site is not part of this scale,
  and `border-radius: 50%` stays a shape rather than a scale value.
- **DL-20.2** One motion pair for chrome state change: `--duration` (150ms) and
  `--ease` (`cubic-bezier(0.4, 0, 0.2, 1)`). §7's 0.13s figure was this rule
  before it had a token; it is now spelled `--duration`. The panel slide-over's
  0.28s entrance is unchanged and stays inside DL-1.2's 300ms ceiling.
- **DL-20.3** **Type is not in this section.** DL-4.4 remains the only authority
  on chrome text sizes. The direction's 13px labels were a convenience of a
  comparison surface — one font size read at gallery zoom, never reviewed at
  native density — and adopting them would have moved every label in the app on
  the strength of a screenshot that was not asking about type.
- **DL-20.4** **Frame height is not in this section either.** DL-18.2's 34px is
  load-bearing geometry: `hiddenInset` and `--frame-lights-w` are tuned so the
  macOS traffic lights centre inside the row. The direction's 54px was never seen
  at native density. Changing the frame is a window-chrome decision with its own
  fork, not a numeric-scale entry.
- **DL-20.5** Spacing, weight, border-width and layer scales are **not adopted**.
  The review proposed all four; none of them was rendered for review, and the
  z-index ladder in particular is behavioural — settings-under-scrim depends on
  40 > 35, so turning it into a named scale is a logic change wearing a token's
  clothes.

## 21. Interaction states

Approved as a fork on 2026-08-14 (plan decision D1). This section resolves what
the direction rebuild called
[a real conflict, not a gap](specs/2026-08-13-direction-token-rebuild-design.md)
`decided`: the reviewed direction marks selection with a full rounded wash,
while DL-5.1 and DL-11.2 mandated a 2px left accent bar. Both cannot be "how
active reads everywhere". The wash wins, because it is what the owner approved
looking at rendered specimens across four themes.

- **DL-21.1** **Selection is a full wash on `--tab-active-bg`, at
  `--radius-control`, and nothing else.** No accent bar, no border, no fill of
  `--accent`, no shadow. One signifier for every genre: active tab, active rail
  item, active settings category, selected board row, selected workspace row.
  **One scoped exception, added 2026-08-16: the tab strip's chips (DL-18.10)
  also carry a neutral 1px frame in `--hair-strong` when selected.** A chip is
  the one selected thing in the app with no list around it — a rail row sits
  among rows on a painted column, while a chip floats on a transparent strip
  over the stage's own `--bg`, so the 15% wash had nothing to be brighter
  than and the owner could not tell which tab was live. The frame is neutral
  and traces the chip, so it is **not** DL-21.6's retired accent marker
  returning; every chip carries the same border as `transparent` at all times
  so selecting one changes a colour, never the row's geometry (DL-1.2's
  `border-color` is the animated property). Other genres are unchanged: a
  border on a rail row or a settings category is still a violation.
- **DL-21.2** **Hover is a quieter wash than selection, never the same one.**
  Hover is a neutral `--tone` wash at 6%; selection is `--tab-active-bg`. They
  are different values on purpose — a hover that paints what "selected" looks
  like tells the user they have already chosen something they have not, and the
  gallery direction sheet shipped exactly that collision on the rail and the
  settings nav. The state matrix's hover column is where this is checked.
  The wash mixes from `--tone`, not from `--fg`: the reviewed direction wrote it
  as 6% of its ink alias, which is `--fg`, and that is the same mistake DL-2.3
  corrected for seams — a neutral wash belongs to the background ladder, and
  mixing it from the foreground lets the terminal's text hue into chrome that is
  supposed to be colourless. The percentage is the direction's; the source is
  normalized on purpose.
- **DL-21.3** Focus-visible stays a 2px `--accent` outline (DL-5.2), and it
  composes with either wash rather than replacing it. Focus is where the
  keyboard is; selection is what the app is showing. A surface can be both.
- **DL-21.4** Disabled stays `--text-faint` on the unchanged surface (DL-3.4).
  It reads quietly in the dark presets and that is accepted: `--text-faint` is
  one shared token, and loudening it here would move every disabled control in
  the app on the strength of one surface's reading.
- **DL-21.5** State changes transition with DL-20.2's `--duration`/`--ease`, and
  only the properties DL-1.2 allows. Reduced motion is handled **by scope**, per
  §9's checklist item 3 — never by an allowlist of class names.
- **DL-21.6** The retired accent bar does not come back as a second marker
  beside the wash. Two signifiers for one state is how the app got a rule and a
  direction disagreeing in the first place.
- **DL-21.7** **A tab-strip chip is the one control with a wash at REST
  (2026-08-16).** `--tab-rest-bg` is 3% of `--tone` — half of DL-21.2's hover —
  so the ladder a chip rides reads 3% → 6% → `--tab-active-bg` (15%) plus
  DL-21.1's frame. Everywhere else, rest still means no wash at all. The reason
  is the same one behind DL-21.1's scoped frame and it is worth stating once:
  a chip has no list around it. A rail row sits among rows on a painted column,
  so "no wash" reads as _this row is not selected_; a chip floats alone on the
  stage's own `--bg`, where "no wash" reads as _there is nothing here_ — the
  owner could not see how many tabs were open. The step is small on purpose: a
  chip at rest must stay quieter than a hovered one, or DL-21.2's separation
  collapses. No new derived colour: `--tab-rest-bg` is a `--tone` mix in
  `:root`, riding the `--tone` that `theme-vars.ts` already keeps current, and
  it sits between `--bg` and `--tab-active-bg`, both of which DL-3.5's contrast
  floors already measure.

## 22. Surface genres

_Reserved. Same source, same status._

## 23. Action tooltips and the `More` menu

Added 2026-08-14 with the feature toolbar's shipping pass (phase 3 of the
redesign program). §13 covers popovers a user opens on purpose; nothing covered
the surface that appears because the pointer paused, or the menu behind the
toolbar's `More` control. **Amended 2026-08-16:** that menu was described here
as existing "only because the window got narrow", and it is not that any more —
DL-23.8 made it the pane group's permanent home, so overflow-by-width is one
of two ways a row gets there rather than the reason the menu exists. Numbered
23 because §15/§16 were reserved
for the usage sections (now landed above) and §20–§22 were spent by the same
program
([toolbar spec](specs/2026-08-12-feature-toolbar-design.md) `decided`).

- **DL-23.1** A tooltip shows the action's **name, its chord when the active
  platform has one, and the reason when the action cannot run** — nothing
  else. No empty brackets for a missing chord, no idle placeholder. The same
  content reaches assistive technology through the trigger's accessible
  description; the tooltip is never the only carrier.
- **DL-23.2** Tooltip copy is **sentence case at the toolbar layer**. The
  action registry keeps its Title Case menu labels and trailing ellipses —
  menu grammar belongs to menus — and the projection re-cases at its own
  boundary, so neither surface leaks its grammar into the other.
- **DL-23.3** A tooltip is a `--chrome-2` step with a 1px `--seam-raised`
  hairline (DL-2.3), `--radius-control` (it hugs one control, it does not
  float like a screen), DL-20.2 motion, and `pointer-events: none` — it may
  never sit between the pointer and the control that summoned it. No timers
  drive it (DL-1.3): it appears on hover/focus and leaves with them.
- **DL-23.4** Tooltip and overflow menu position `fixed` from a rect measured
  at open. **Accepted, not a debt:** both are dismissed by scroll-free
  interactions and outlive no layout change; an anchored-positioning rewrite
  buys nothing the app can show. Revisit only if chrome ever scrolls under an
  open tooltip.
- **DL-23.5** The overflow menu is a §13 popover made of rows: group order,
  icon, label, chord and state survive the move off the bar, and the group
  separator moves with them. `role="menu"` promises arrow keys, so arrows
  move focus with wraparound and Home/End jump; unavailable rows stay in the
  cycle because their reason must be reachable without a pointer (DL-23.6).
- **DL-23.6** **Unavailable is not disabled.** A control that cannot run keeps
  its place in the tab order, reads `--text-faint` on an unchanged surface
  (DL-21.4), drops the hover wash, blocks activation, and says why in its
  tooltip. A `disabled` attribute would make the reason unreachable by
  keyboard.
- **DL-23.7** The update pill re-measures its reserved width when the toolbar
  itself resizes. **Accepted:** a phase change that widens the pill without a
  resize can overlap for one frame until the next layout pass; wiring the
  pill's phase into the fit calculation would couple the toolbar to updater
  state for a one-frame cosmetic. Revisit if the pill ever animates width.
- **DL-23.8** **The pane group lives in `More`, not on the bar (2026-08-16).**
  Split vertically, Split horizontally, Focus expand and Close pane are rows
  in the menu at every window width, so the toolbar at the stage strip's
  trailing end is the `Ellipsis` control alone. The bar was four glyphs a
  reader had to learn, sitting where the eye goes least, for actions whose
  chords are the fast path anyway; a row says the name and prints the chord,
  which is how the action teaches itself. This does not move them out of the
  toolbar — DL-28.3 still keeps pane operations away from the rail's footer,
  and `More` is the toolbar's own surface. Consequences that are rules, not
  incidents: the bar may render **zero** controls and must still draw `More`
  ([`feature-toolbar.tsx`](../src/ui/toolbar/feature-toolbar.tsx) `current`),
  and top-tab mode's menu prints the pane group first, then the DL-28.4 rows,
  separated by the group hairline DL-23.5 already carries.

## 24. The theme gallery

Approved as a fork on 2026-08-15, for the theme picker. §5 allows exactly one
interactive value per row and forbids chip grids by name; a picker whose value
is a picture cannot satisfy it. Numbered 24 because §22 stays reserved — the
next free number above §23, not the gap.

The fork is narrow on purpose. It buys ONE grid, for ONE setting, and the
argument does not generalise: a theme is the only value in this app that a user
recognises faster as an image than as a word. Everything around the grid — the
import picker, the folder, a file that would not parse — stays §5 rows.

- **DL-24.1** The gallery is the only grid in a settings section, and it exists
  only for the theme. Any other setting that wants one is a new fork, argued on
  its own value, not an extension of this rule.
- **DL-24.2** A card is a **miniature of Deck**, not a strip of swatches: the
  command row, the navigation rail and the stage in the proportions the window
  has them, with an agent line to carry the accent. The card answers "what will
  my window look like" — a palette strip answers a question nobody asked.
- **DL-24.3** Card colours are inline styles from **that theme's own object**,
  passed through the same `deriveChromeColors` the app publishes as custom
  properties ([`theme-card-preview.tsx`](../src/ui/settings/theme-card-preview.tsx)
  `current`). This is DL-2.1's swatch exception and it is load-bearing: a card
  must show a theme that is NOT running, and every `--token` resolves to the
  one that is. Hand-picked hexes here would be a second visual truth, and the
  first thing they would get wrong is the thing the card exists to show.
- **DL-24.4** The selected card is marked by an `--accent` border **and** a
  check in its footer. This is the documented exception to DL-21.1's one
  signifier: the wash every other selection uses is invisible over a preview
  that can be any colour, so the mark has to sit outside the picture.
- **DL-24.5** Actions on the collection are ordinary §5 `action` rows under the
  grid — import opens a native picker (§6's `picker` kind), and the folder row
  reveals it in the OS file manager. Removing an imported theme is deleting its
  file; the app grows no delete button, because the folder is the model and two
  ways to remove one thing is how they disagree.
- **DL-24.6** A file in the folder that does not parse gets a §5 row naming the
  file and the reason, in the danger treatment (DL-3.2). It is never dropped
  silently: an import that vanishes looks like it never happened, and the user
  imports the same broken file again.

## 25. History rows

Approved as a fork on 2026-08-16, for the session history screen. §15 is
explicitly read-only — a table of facts nobody clicks — and §5's config row is
a key beside exactly one setting changed in place; neither describes a list
whose rows CARRY an action. A history row does not read a fact or set a value,
it offers to resume a session. Numbered 25 because §22 stays reserved — the
next free number above §24, not the gap
([session history spec](specs/2026-08-14-session-history-design.md) `decided`).

- **DL-25.1** **Amended 2026-08-16, reversing this rule's original form.** A
  history row is **content plus one named action**: the body is inert and the
  row carries a visible `Resume` control that is the only thing which acts.
  The rule used to read the other way — the whole row was the button — on the
  argument that a history row has no second job to protect. What that missed is
  the SIZE of the one job: resuming spawns a pane, cds into a recorded
  directory and types a command into it. That is not a navigation a stray
  click should be able to fire while the user is reading a list, and unlike
  §12's `×` there is no undo waiting on the other side. The row keeps one
  outcome; it stops being one giant target for it. Rows are still not allowed a
  SECOND action — a row that needs two needs a different genre.
- **DL-25.2** Row content is fixed in order and role: an identity mark for
  which agent ran it, the thing's own name (the session's title, or its id
  when no title was found), where it came from (the project directory), when it
  last changed, and — since 2026-08-16 — its action at the trailing edge. A row
  never reorders these to fit a longer value — the name gives way and truncates
  instead, so a long title never pushes the project, the time or the action out
  of their place. The identity mark is the agent's own brand mark through
  [`AgentGlyph`](../src/ui/controls/agent-glyph.tsx) `current`, not a
  stand-in from the icon set: a rail row, a strip chip and a history row all
  name the same agents, and three surfaces drawing `claude` three ways is
  exactly the divergence that component was extracted to stop.
- **DL-25.3** A row whose action cannot run is **unavailable, not disabled**
  (DL-23.6): it keeps its place in the tab order, reads `--text-faint` on an
  unchanged surface, drops the hover treatment, and carries its reason in an
  accessible description. A `disabled` attribute would make that reason
  unreachable by keyboard — the same failure DL-23.6 already refuses for a
  toolbar control, and a row that cannot resume because its recorded directory
  is gone is no different a case. Since DL-25.1's amendment the state has to
  reach the ACTION, not only the ink: the button is what can no longer run, so
  the button is what must stop looking runnable.
- **DL-25.4** A list that shows less than it found says so, in chrome copy at
  the foot of the list, naming the bound and the total. Silence would read as
  "this is everything" when it is really "this is the newest N" — the list
  equivalent of the lie an empty table would tell by vanishing instead of
  saying so.
- **DL-25.5** **The row's action wears the quiet bordered pill (2026-08-16).**
  It takes DL-5.2's skin — transparent fill, a 1px `--hair` border at
  `--radius-control`, hover moving `border-color` to `--hair-strong` and
  nothing else — and none of that pill's value affordances: it sets nothing and
  reads nothing back, so it carries no readout, no chevron and no state. The
  skin is borrowed rather than reinvented for the reason DL-17.3 already
  established for a pressable readout: the app has exactly one look for
  "a quiet thing you can press", and a second one invented per surface is how
  a design language stops being one. The action is **always visible, never
  hover-revealed**: a control that appears only under a pointer is unreachable
  by touch and invisible to anyone scanning the list, and this is the surface's
  primary action.

## 26. The sidebar banner

Approved as a fork on 2026-08-16, for the rail's Woven Flag banner
([`sidebar-banner.tsx`](../src/ui/sidebar-banner.tsx) `current`). §5 covers
rows that read or set a value; a banner sets nothing and is not a row at all,
so it needed its own short contract rather than a stretch of an existing one.
Numbered 26 because §22 stays reserved — the next free number above §25, not
the gap.

The fork is narrow: it exists to keep the two artwork kinds — a built-in
preset flag and an imported image — from drifting into two different looks
after the Gallery's Native-balanced rollout promoted the Woven Flag direction
into shipping code.

- **DL-26.1** One component renders both artwork kinds, and one treatment
  class — `sidebar-banner--woven` — carries the look for both. The class
  belongs to the wrapper both branches render inside, never to a
  branch-specific element or a concatenated string: there is exactly one place
  a future edit could drop it, and that place is shared.
- **DL-26.2** The treatment is texture, shallow fold light, matte colour, and
  the existing fade into the rail below it — nothing else. A preset's artwork
  is desaturated and dimmed to that matte colour, not shown at full
  saturation; an imported image gets the identical treatment, not a lighter
  or unfiltered pass.
- **DL-26.3** No theme-specific banner variants exist, and none may be added.
  A theme supplies colour only — through the artwork itself (preset) or the
  imported file (custom) — never a different texture, fold-light angle, or
  blend mode per theme. A theme that wants a different banner look is asking
  for a second component, which this rule refuses.
- **DL-26.4** The banner is decorative, not a control: `aria-hidden="true"`,
  no interaction handlers, and any `<img>` branch is non-draggable. It must
  never obscure navigation — it sits behind the rail's own controls and the
  fade in DL-26.2 exists so the boundary between banner and rail stays
  legible, not so the banner can compete with what sits on top of it.

## 27. The agent status rail

Approved as a fork on 2026-08-16, for the navigation rail whose unit is a live
agent rather than a checkout
([agent status rail spec](specs/2026-08-16-agent-status-rail-design.md)
`decided`). §25's history row is one control with one outcome, and §5's config
row is a key beside exactly one setting; neither describes a row that is
simultaneously a target and a strip of smaller targets. A rail row goes to a
tab, its agent chips go to individual panes, and its disclosure unfolds those
panes into rows — four destinations inside one row, which is the whole reason
the rail is worth building and exactly what the two existing genres refuse.
Numbered 27 because §22 stays reserved — the next free number above §26, not
the gap. The spec was written against "§26"; the sidebar banner took that
number first.

Two rules elsewhere are amended in place by this fork rather than restated
here: **DL-3.2** gains `--yellow`, and **DL-1.2**'s 300ms cap gains one scoped
exception. **DL-1.3 is not amended.** A real glow around the focused pane was
considered and refused: the app is a flat system, depth comes from background
steps and hairlines, and a blurred `box-shadow` costs a compositing layer for
a 1.5s effect. The ping is the inset hairline DL-1.3 explicitly permits.

- **DL-27.1** **The row is a container with a full-bleed hit layer behind it,
  not a `<button>`.** Agent chips and the disclosure are real controls sitting
  above that layer; the inert text spans pass their clicks through to it. A
  button inside a button is not operable, so a row that carries its own
  smaller targets cannot be one element — the layer is what keeps the row
  reading as a single target anyway.
- **DL-27.2** **State is carried by ONE mark at the row's right edge, and
  there is no status word in the row.** The word survives in `title` and in
  the accessible name, so the shape is the fast read and never the only read.
  A second signifier for the same state is DL-21.6's mistake in a new place.
- **DL-27.3** **The mark palette is closed, and so is its precedence.**
  `failed` is `--red` filled · `asked` is `--yellow` filled with a halo ·
  `done` is `--accent` hollow · `working` is a `--text-primary` turning arc ·
  `resting` is a `--hair-strong` hairline ring. `asked` and `done` are
  deliberately different colours: "answer me" and "read my result" are
  different requests. When a tab folds its panes into one row the loudest one
  speaks: failed > asked > done > working > resting. `failed` is never
  allowed to read as `resting`.
- **DL-27.4** **The message line is trimmed by layout, never by slicing the
  string.** `text-overflow: ellipsis` does the trimming; the full sentence
  stays in the DOM for the tooltip and the accessible name. A row that ships
  a truncated string has thrown away the only copy of what the agent said.
- **DL-27.5** **Hover actions sit at the trailing end of the meta line, in
  space that line reserves for them.** Rename, recolour and close are revealed
  by `:hover` and `:focus-within` alike, so they stay reachable from the
  keyboard; they are hidden by `opacity`, never removed from the tab order, and
  the row's accessible name does not change when they appear. **Amended
  2026-08-16 by DL-27.10**, which moved the age off the name line: they used to
  swap in over the age + mark pair, and with the age gone that pair is 10px
  wide, so the actions would have covered agent chips — which are TARGETS, not
  readouts, and must never be hidden or overlaid by a hover affordance. Their
  width is reserved as padding on the meta line at rest, never added on
  `:hover`, because a control that appears by pushing text sideways is a reflow
  (DL-1.2).
- **DL-27.6** **Amends DL-3.2.** `--yellow` means only _an agent is waiting on
  you_ — attention a person must answer, one step below `--red`'s failure.
  Never decoration.
- **DL-27.7** **Amends DL-1.2's 300ms cap with exactly one scoped exception:
  the 1500ms focus ping.** Focusing a pane from the rail sends the eye into a
  grid of identical panes, so the pane answers back — its border rings once
  and fades. That is a locator, not a state change, and 300ms is below the
  threshold at which an eye that was looking elsewhere can catch it. Nothing
  else in the app inherits the exception. **DL-1.3 is not amended**: the ring
  is an inset hairline (`box-shadow: inset 0 0 0 2px var(--accent)`) on an
  overlay whose `opacity` is what animates — `opacity` is on DL-1.2's
  allowed-property list and `box-shadow` is not. The overlay is
  `pointer-events: none`, never reflows the terminal, and is skipped entirely
  under reduced motion by scope, per §9's checklist.
- **DL-27.8** **The selection wash belongs to the whole item, not to the row
  inside it.** DL-21.1 gives the list one selection wash; this rule says where
  it lands in a genre whose unit unfolds. A tab is one thing even when it is
  open into a header line plus a row per agent, so the wash covers the
  disclosure gutter, the row and those agent rows together. Washing the top
  line alone would say the row is selected and the agents inside it are
  something else. The row's own background stays out of the way so the item
  paints one unbroken block, and selection still outranks hover (DL-21.2)
  while a drag target still reads over both.
- **DL-27.9** **The stream is clustered by project: the name is printed once
  above its tabs, and a row inside a labelled cluster names the TAB instead.**
  Added 2026-08-16, after the rail shipped: the project name is the loudest
  word in a row, so N tabs in one project printed it N times and recency
  scattered the copies down the list. The header is a **label, not a row** — no
  state mark, no age, no disclosure, nothing to press — which is what keeps
  this from reinstating the repository → worktree tree the rail replaced; the
  worktree stays a suffix on the row. **A cluster of one prints no header** and
  its row names the project itself, because most projects have exactly one tab
  and a header apiece would double the rail's height to repeat the row.
  A row's own name is the tab: the user's name for it, else the agents running
  in it, else `shell`. **Amended the same day by DL-27.10:** the sentence "the
  pinned block is never clustered" is void, because there is no pinned block —
  every tab of a project is under that project's header, whatever its state.
  While tier 3 is unbuilt the message line falls back to the tab title, so it
  is printed **only when a person typed that title**: a derived label repeating
  the name above it is not a turn.
- **DL-27.10** **A project is printed once, its tabs are all under it, and the
  list never reorders itself.** Added 2026-08-16, replacing the pinned
  `Needs you` block and recency ordering with three things that hold together:

  - **No pinned block.** A tab that wants the user stays in its own cluster.
    Lifting it out printed the project twice — once as a job and once as a
    place — and the second copy was the one the user was already reading the
    list by. The state mark (DL-27.3) is what says "this one wants you", and a
    mark does not need the row to move to be seen. `--yellow`'s meaning
    (DL-27.6) is unchanged; only its former block is gone. The queue itself
    survives as the `focus-next-attention` action (⌘⇧A, View menu), which is
    where "take me to the next one" belongs — a keyboard walk, not a second
    copy of the list.
  - **Open order, not recency.** Clusters sit where their OLDEST tab put them
    and rows sit where they were opened, both read from the window's one open
    clock ([`open-sequence.ts`](../src/lib/open-sequence.ts) `current`) — the
    same key the tab strip sorts by (DL-18.10), so the strip and the rail can
    never disagree about where a tab is. A list that reshuffles whenever an
    agent changes state moves the row the hand is already travelling to.
  - **The age is on its own line, leading it.** It used to sit on the name
    line between the agent chips and the state mark, splitting the row's one
    glyph cluster with a number and squeezing the chips. The second line is
    the age, then the turn when there is one; a row with neither prints no
    second line at all.

## 28. The rail's action footer

Approved as a fork on 2026-08-16, for the two window actions that belong to
neither the dock's tab row nor the toolbar's pane group
([`SidebarActions`](../src/ui/sidebar-actions.tsx) `current`). §5 covers rows
that read or set a value and §19 covers a docked panel; a pinned footer of
navigation actions inside the rail is neither. Numbered 28 because §22 stays
reserved — the next free number above §27, not the gap.

- **DL-28.1** The footer is **pinned between the scrolling workspace list and
  the banner**, never inside the scroll region. The banner keeps the closing
  position it has always had (DL-26.4), and the footer never scrolls out of
  reach of the surfaces it opens.
- **DL-28.2** Its members are **rows, not icons**: the column has prose width,
  so a row says what it does instead of teaching a glyph. Hover takes DL-21.2's
  quieter wash, and an action that cannot run follows DL-23.6 rather than
  taking a `disabled` attribute.
- **DL-28.3** The footer carries **everything that is not an operation on the
  focused pane**: the surfaces Deck can open (the browser, and the dock's own
  tabs) and the window's own actions. A control that acts on a pane — a
  split, a close, a zoom — belongs to the toolbar and stays there. The dock's
  tab row (DL-19.7) is not a competing home: it switches between surfaces
  already on screen, while these rows say in words what can be opened at all.
  A row for a surface the running host cannot serve is **omitted, not
  disabled**, matching DL-19.7.
- **DL-28.4** **Top-tab mode has no rail, so the same members ride in the
  toolbar's `More` menu there** — one menu standing in for the footer, never
  a second row of icons that layout does not otherwise have. Both mounts are
  built from one projection, so neither can drift
  ([`pinnedMenu`](../src/ui/toolbar/feature-toolbar.tsx) `current`).

- **DL-28.5** **These rows OPEN, and report nothing (2026-08-16).** They carry
  no selection state — no DL-21.1 wash, no `aria-pressed`, no `aria-expanded` —
  and pressing the row of a surface already on screen is a no-op. Closing
  belongs to each surface's own control: the dock's toggle, the browser chip's
  ✕, a screen's close button, Escape. A row that painted itself active would be
  promising a second press that puts the surface away, which this footer
  deliberately does not offer. The distinction is with chords, not against
  them: a chord stays a toggle (`revealDockTab`), a launcher opens
  (`openDockTab`, [`settings-store.ts`](../src/settings/settings-store.ts)
  `current`).

## 29. Modals

Approved as a fork on 2026-08-16. The gap was documented before it was closed:
the gallery's overlays section had been carrying a note that DL-6.2 and DL-12.5
both say "never a modal" while `.preset-editor` and `.save-preset` were modals
over `.modal-scrim`, with a radius and a rise-in no rule mentioned — §11 covers
full-window screens and §13 covers anchored popovers, and neither reaches
these. Numbered 29 because §22 stays reserved — the next free number above §28,
not the gap.

A modal is **not** a fourth way to show a screen. It is for a short, focused
step the app raises over the stage and takes back down: pick an agent, name a
preset, draft a layout. Anything longer-lived is a full-window screen (§11) or
a docked panel (§19).

- **DL-29.1** **One shell, one implementation.** Every modal mounts through
  [`Modal`](../src/ui/modal.tsx) `current`, which owns the scrim, the frame,
  the focus grab and both ways out. The panel supplies its class, its size and
  its body — nothing else. Three hand-rolled copies of the same wrapper is how
  the app arrived at three modals that agreed on their look and disagreed on
  their behaviour: none of them could be dismissed by clicking the scrim,
  because no one place was responsible for saying they should be.
- **DL-29.2** **The panel is the dialog, not the scrim.** It carries
  `role="dialog"`, `aria-modal="true"` and a name, and it takes focus on mount:
  the panel itself when the modal is driven by bare keys (digits, arrows), a
  named field when it is driven by typing. A modal that opens without focus is
  a modal whose shortcuts silently do nothing.
- **DL-29.3** **Two ways out, and only a draft may withdraw the second.**
  Escape always closes. A click on the scrim closes too — **except** where the
  modal holds work that exists nowhere else yet, which today is `PresetEditor`
  and its unsaved split tree. Withdrawing the scrim is a decision about data
  loss, never about how important the modal feels.
- **DL-29.4** **Scrim dismissal reads the pointer PRESS, not the click.** A
  drag that starts inside the panel — a divider, a text selection — releases
  outside it, and the browser then fires `click` on the nearest common
  ancestor, which is the scrim. A modal that closed on that would be punishing
  the user for the gesture it just asked them to make.
- **DL-29.5** **The scrim is a translucent wash PLUS a blur, and it amends
  DL-1.3's `backdrop-filter` clause for this one selector.** The wash alone had
  to be opaque enough (65% `--bg`) to stop terminal text competing with the
  panel, which meant the stage behind it read as gone rather than as waiting.
  Wash and blur together carry that at 42%: what is behind stays legible as
  shape and colour, and unreadable as text — which is what a modal wants to
  say. Escape stops at the panel (`preventDefault` + `stopPropagation`), since
  a live terminal reading raw keys is one element behind it.
- **DL-29.6** **The panel stands on the recessed chrome plane
  (`--sidebar-bg`), the same ground as the navigation column and the docked
  panel** — not a `--chrome-1` step off the stage. Added 2026-08-16, after the
  blur landed and the two were seen together. A panel one step off `--bg`
  floating over a blurred `--bg` reads as a lighter smudge of the same ground
  rather than as an object; the recessed plane is the only ground in the app
  that never appears on the stage, so the panel is unmistakably chrome the
  moment it opens. It also stops modals from being a third chrome surface
  colour: DL-18.7 already put both side columns on this plane, and a modal is
  the same kind of thing — chrome raised over the work area.
- **DL-29.7** **A modal that acts on a target states the target ONCE, above
  the choices, and lists the choices as a column of rows.** Added 2026-08-16
  with the quick picker's worktree destination. Two halves of one rule: the
  target is a §5 config row (`menu` value kind, DL-6, DL-1.4) at the top of
  the panel, not repeated per choice — five copies of one value is five things
  to keep in sync and one question about which of them is live. The choices
  below it become **rows in a column**, not the wrapped grid the open board
  used to carry (that grid went with the board's config view on 2026-08-16,
  which leaves this modal the only agent picker in the app): a grid reads
  left-to-right-then-down, which leaves the pairing between
  "this destination" and "these agents" ambiguous, and a modal panel is prose
  width anyway (§28's reasoning, in a different container). A target with only
  one possible value keeps the row and renders as DL-17.3's **readout** — the
  choices still have to be read against somewhere — and a target with no
  values at all is **omitted, not disabled** (DL-19.7).

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
