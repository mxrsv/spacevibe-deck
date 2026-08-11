# External review — visual system constraints and a ChatGPT-desktop direction

**Reviewer:** Codex CLI 0.147.0, read-only, invoked 2026-08-12 with the chrome gallery
screenshots attached (tokens page, live spread audit, window chrome in both tab-bar
positions, settings screen).
**Question put to it:** is the plan of "closed numeric scales + a stylesheet-reading gate

- per-surface migration" right, and what does a redesign toward the ChatGPT desktop app's
  feel look like under Deck's existing hard constraints?

Point-in-time record. Nothing here is approved; every DL rule below is a **proposal**,
and adopting any of them is an R2 fork. The reviewer answered in Vietnamese because it
read the machine's global instructions; this file is the English record (R1).

---

## 1. Verdict: conditional pass, four layers missing

The plan is directionally right but insufficient on its own. Banning literals without
adding meaning just turns `7px` into `--magic-7`.

1. **Semantic aliases above the numeric scales.** A selector should reach for
   `--space-control-x`, `--state-hover-bg`, `--radius-surface` — not pick `--space-3` by
   feel. The scale controls the value; the semantic token controls the decision.
2. **An explicit state model.** Hover and selected/current are currently conflated: the
   config row's hover is a 2px accent bar plus a wash (DL-5.1) and the settings rail's
   _active_ state is the same treatment (DL-11.2). A user should not have to tell a
   temporary state from a persistent one by how long it lasts. Proposal: hover loses the
   accent marker; only selected/current may carry one.
3. **Surface taxonomy and shared primitives, migrated before surfaces.** Two popovers,
   two modals and the Open board each invent their own frame, buttons and state
   treatment. Order the migration primitive-first: row → button/input → popover frame →
   dialog frame → then each surface.
4. **A semantic gate, not only a numeric one.** See §1a — this is where the review
   found real violations the numeric plan would have passed.

### 1a. Violations the numeric gate would not have caught — all verified in this repo

| Finding                                         | Location                                           | Rule                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transition: filter 0.15s ease`                 | [`styles.css:370`](../../src/styles.css#L366-L371) | DL-1.2 (property not on the allowed list) and DL-1.3 (`filter` banned outright)                                                                                   |
| `transition: box-shadow 0.18s ease`             | [`styles.css:852`](../../src/styles.css#L845-L853) | DL-1.2                                                                                                                                                            |
| `transition` on `left`/`top`/`width`/`height`   | `.drop-overlay`                                    | DL-1.2 — animating geometry                                                                                                                                       |
| `animation: wsspin 2.2s linear infinite`        | [`styles.css:243`](../../src/styles.css#L240-L245) | DL-1.2 "no infinite / looping animations, nothing animates while idle". `WorkspaceSpinner` is exempt from the _icon_ system (DL-14.6), not from the motion budget |
| `white` inside a `color-mix`                    | `.drop-overlay.is-swap`                            | DL-2.1                                                                                                                                                            |
| Solid `background: var(--accent)` on rows/cards | several sites incl. Open board selection           | DL-3.1 "never a decorative fill, never large areas"                                                                                                               |
| §7 still specifies a 280ms panel slide-over     | [`DESIGN-LANGUAGE.md:156`](../DESIGN-LANGUAGE.md)  | Settings is now a full-window 220ms fade + 4px translate — the rulebook describes a surface that no longer exists                                                 |

**Two audit bugs the reviewer found, both fixed the same day** in
[`css-audit.ts`](../../src/gallery/css-audit.ts) `current`:

- The spacing tally counted whole declaration strings, so `padding: 6px 14px` read as one
  value and the total came out **67**. Split into individual lengths it is **23 steps**
  (`0`, `-1px`, and 1–18, 20, 24, 26px). 67 was never a count of steps.
- The colour scan matched hex and `rgb()` only, so the `white` above was invisible. Named
  colours are now scanned with the name fenced on both sides, which is what keeps
  `white-space: nowrap` and `var(--red)` from reading as violations.

### 1b. What the reviewer would cut

The hover accent bar; decorative rotation on the add/gear buttons; `filter: brightness`;
transitions on geometry and `box-shadow`; the two hand-written modal frames; and the idea
that _every_ number outside `:root` is wrong — viewport units, percentages, intrinsic
sizing and documented component dimensions must stay explicit or a fake token appears.

On splitting `styles.css`: its 2 829 lines are a maintenance problem but **not** the cause
of the spread, and splitting first would only scatter the inconsistency. Split after the
taxonomy is stable, and make the gate follow the import graph rather than one filename.

---

## 2. ChatGPT-desktop feel vs Deck's hard constraints

Treat "ChatGPT desktop" as a set of adjectives — _quiet, coherent, softly rounded,
restrained_ — not a blueprint. The product has itself just been restructured into
Chat/Work/Codex, so any single screen is a moving target.

| Trait                            | Reachable?    | The legitimate route                                                                 |
| -------------------------------- | ------------- | ------------------------------------------------------------------------------------ |
| Quiet, low-noise surfaces        | yes           | the `--bg → --chrome-1 → --chrome-2` steps, light hairlines, less accent fill        |
| Even spacing rhythm              | yes           | a 2–24px scale — while keeping chrome heights as they are                            |
| Compact, softly rounded controls | yes           | 6px controls, 8px surfaces, 12px dialogs                                             |
| System sans with light hierarchy | yes           | keep `--ui-font`; express hierarchy with size and weight, not by fading text further |
| Discreet motion                  | yes           | one-shot fade/translate, 130–220ms                                                   |
| Chat-app whitespace              | partly        | increase space _between groups_, never row/tab/status height                         |
| Soft elevation via shadow        | **no**        | background step + 1px inset hairline + occlusion + scrim                             |
| `backdrop-filter` / blur         | **no**        | a theme-derived scrim; make the popover more opaque than its ground                  |
| Fixed neutral grey palette       | **no**        | neutral wash from `--tone`; accent and semantic colours stay from the terminal theme |
| Floating cards everywhere        | not advisable | only popovers and dialogs read as raised; screens and rails stay flat                |
| Pills for everything             | not advisable | pills are for values and controls; rows and containers do not become capsules        |

**Do not relax DL-1.3.** The gain is a familiar softness; the cost is added
compositing/paint variability next to many live terminal views, and it breaks "the
terminal is the content; chrome recedes". Three cheap depth tools already exist: surface
step, hairline, scrim.

**The bigger collision is information density, not shadow.** ChatGPT can spend whitespace
guiding the eye down a conversation; Deck has to keep many workspaces, tabs, agent states
and shortcut hints coexisting around terminal output. If the redesign makes the tab bar,
status bar or sidebar taller, it copied the wrong part.

---

## 3. Proposed token set

### Numeric foundations

| Group   | Token                    |                            Value | Replaces                             |
| ------- | ------------------------ | -------------------------------: | ------------------------------------ |
| Spacing | `--space-1`              |                            `2px` | optical gap, tiny inset              |
|         | `--space-2`              |                            `4px` | icon/text gap, compact padding       |
|         | `--space-3`              |                            `6px` | control padding, compact row gap     |
|         | `--space-4`              |                            `8px` | standard row/control gap             |
|         | `--space-5`              |                           `12px` | panel inset, group separation        |
|         | `--space-6`              |                           `16px` | section/dialog padding               |
|         | `--space-7`              |                           `24px` | screen-level separation              |
| Radius  | `--radius-sm`            |                            `4px` | kbd, swatch, tiny input              |
|         | `--radius-control`       |                            `6px` | buttons, value pills                 |
|         | `--radius-surface`       |                            `8px` | rows, cards, popovers                |
|         | `--radius-dialog`        |                           `12px` | modal dialogs only                   |
| Shape   | `--radius-round`         |                          `999px` | capsules only; circles stay `50%`    |
| Type    | `--font-size-meta`       |                         `10.5px` | hints, group labels, descriptions    |
|         | `--font-size-compact`    |                         `11.5px` | values, status text, compact actions |
|         | `--font-size-body`       |                         `12.5px` | rows, labels, normal buttons         |
|         | `--font-size-title`      |                           `13px` | panel/dialog titles                  |
|         | `--font-size-display`    |                           `19px` | Open board workspace title only      |
| Weight  | `--font-weight-regular`  |                            `400` | normal text                          |
|         | `--font-weight-medium`   |                            `500` | buttons, active values               |
|         | `--font-weight-semibold` |                            `600` | selected labels, titles              |
|         | `--font-weight-bold`     |                            `700` | screen display title                 |
| Leading | `--line-height-tight`    |                              `1` | icons, badges                        |
|         | `--line-height-ui`       |                           `1.25` | chrome text                          |
|         | `--line-height-copy`     |                           `1.45` | descriptions, textareas              |
| Motion  | `--duration-fast`        |                          `130ms` | hover, focus, colour change          |
|         | `--duration-base`        |                          `180ms` | compact surface state                |
|         | `--duration-enter`       |                          `220ms` | screen/dialog entrance               |
| Easing  | `--ease-state`           |                           `ease` | state transitions                    |
|         | `--ease-enter`           | `cubic-bezier(0.22, 1, 0.36, 1)` | one-shot entrance                    |
| Border  | `--border-hair`          |                            `1px` | structural line                      |
|         | `--border-strong`        |                            `2px` | focus / current marker               |
|         | `--focus-offset`         |                            `1px` | external focus ring                  |
| Control | `--control-h-compact`    |                           `24px` | icon buttons, value pills            |
|         | `--control-h`            |                           `28px` | inputs, action buttons               |

Seven spacing steps because that spans optical adjustment to screen separation while
holding desktop density: four is too coarse for nested chrome, eight or more reopens the
door to picking by feel. Radius needs four real roles; `50%` and the capsule are shapes,
not extra steps. Type needs five levels because the Open board genuinely has a display
title — today's separate 10 / 11 / 12 / 17px values do not need to exist.

### Surfaces and interaction states

| Token                     | Value                                                        | Replaces                                   |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| `--surface-base`          | `var(--bg)`                                                  | terminal/stage base                        |
| `--surface-chrome`        | `color-mix(in srgb, var(--bg) 96%, var(--tone))`             | `--chrome-1`                               |
| `--surface-raised`        | `color-mix(in srgb, var(--bg) 93%, var(--tone))`             | `--chrome-2`                               |
| `--surface-recessed`      | `color-mix(in srgb, var(--bg) 88%, var(--tone))`             | `--input-bg` fallback                      |
| `--surface-scrim`         | `color-mix(in srgb, var(--bg) 65%, transparent)`             | modal scrim                                |
| `--state-hover-bg`        | `color-mix(in srgb, var(--tone) 5%, transparent)`            | the 4/6/7/8% `--fg` hover washes           |
| `--state-active-bg`       | `color-mix(in srgb, var(--tone) 8%, transparent)`            | pressed state                              |
| `--state-selected-bg`     | `color-mix(in srgb, var(--tone) 12%, transparent)`           | `--tab-active-bg`, assorted selected mixes |
| `--state-selected-line`   | `color-mix(in srgb, var(--accent) 70%, var(--text-primary))` | the 50–70% accent borders                  |
| `--state-disabled-fg`     | `var(--text-faint)`                                          | raw `opacity: .4` on controls              |
| `--state-disabled-bg`     | `color-mix(in srgb, var(--tone) 3%, transparent)`            | disabled fills                             |
| `--state-focus-ring`      | `color-mix(in srgb, var(--accent) 80%, var(--text-primary))` | raw `--accent` focus                       |
| `--state-danger-hover-bg` | `color-mix(in srgb, var(--red) 14%, transparent)`            | the repeated red 13/22% washes             |

Neutral states mix over `--tone`, not `--fg`: a terminal foreground can be violet or blue,
and the brief asks for quiet _neutral_ surfaces. Accent is then left for the current
marker, focus, and interactive emphasis only.

`deriveChromeColors()` stays the runtime source for surface and text contrast — it already
enforces 7 / 5.5 / 4.5 floors, which a static CSS fallback cannot
([`derive-colors.ts`](../../src/lib/derive-colors.ts#L99)).

### Layers

| Token             | Value | Role                                  |
| ----------------- | ----: | ------------------------------------- |
| `--layer-base`    |   `0` | normal flow                           |
| `--layer-local`   |   `1` | in-component divider / pseudo-element |
| `--layer-pane`    |  `10` | pane anchor, search, zoom             |
| `--layer-screen`  |  `20` | Open board, Settings                  |
| `--layer-popover` |  `30` | anchored popovers                     |
| `--layer-notice`  |  `40` | transient error/status notice         |
| `--layer-modal`   |  `50` | scrim + blocking dialog               |
| `--layer-drag`    |  `60` | drag preview / ghost                  |

Eight layers because there are eight real stacking relationships. The goal is not the
smallest set of integers; it is that nobody picks `35`, `999` or `1000` again.

---

## 4. Proposed rulebook sections

§15 is already reserved for docked side panels (the file-explorer fork), so these start at
§16.

### 16. Numeric scales

- **DL-16.1** Use only the closed spacing, radius, type, weight, duration, border and
  layer scales declared in `:root`; a value chosen at a use site is not part of the design
  system.
- **DL-16.2** Consume scales through semantic aliases where a role repeats;
  `--state-hover-bg` is a decision, while `--space-3` is only a measurement.
- **DL-16.3** Do not disguise one-off geometry as a scale token. Viewport units,
  percentages, intrinsic sizing and documented component dimensions stay explicit or enter
  a counted selector/property/value allowlist, because `--modal-width-720` would only
  rename a literal.
- **DL-16.4** Scan every stylesheet imported by the shipped renderer, assert the scan is
  non-empty, and require every allowlist entry to remain present at its declared count;
  silent omissions are worse than no gate.
- **DL-16.5** Enforce the hard constraints in the same gate: reject named or literal
  colours outside the token layer, banned visual properties, forbidden transition
  properties and looping chrome animations. Numeric conformity does not make a semantic
  violation valid.
- **DL-16.6** Preserve the contrast floors `deriveChromeColors` produces across every
  bundled preset; quiet text may be lower in hierarchy, never lower in readability.

### 17. Interaction states

- **DL-17.1** Hover uses only `--state-hover-bg`; it adds no accent marker, because hover
  is temporary and must not resemble current selection.
- **DL-17.2** Active means pointer-down or key activation and uses `--state-active-bg`;
  "active" is never a synonym for selected/current.
- **DL-17.3** Selected/current uses `--state-selected-bg` and may add one
  `--state-selected-line` marker where location needs reinforcing; a row or card never
  takes a solid accent fill.
- **DL-17.4** Focus-visible always keeps a 2px `--state-focus-ring`; hover, selected and
  focus may coexist, because keyboard location must not disappear once an item is selected.
- **DL-17.5** Disabled controls use the disabled foreground/background tokens and keep
  their geometry; do not dim the whole control with opacity, which weakens borders and
  semantic colours together.
- **DL-17.6** Danger changes only the semantic foreground, border or
  `--state-danger-hover-bg`; red never becomes a generic hover treatment.
- **DL-17.7** Transition state only with the duration/easing tokens and the properties
  DL-1.2 allows; a token does not legalize animating layout, shadow or filter.

### 18. Surface genres

- **DL-18.1** Every overlay is exactly one of: full-window screen, anchored popover,
  blocking dialog, transient notice, drag feedback. Add a genre here before styling a
  sixth kind.
- **DL-18.2** A full-window screen is flush, square and unscrimmed on `--surface-raised`;
  internal rails and regions separate with hairlines, because the screen replaces the
  stage rather than floating above it.
- **DL-18.3** An anchored popover uses one shared frame: `--surface-raised`, a 1px inset
  `--hair-strong`, `--radius-surface`, `--layer-popover`. Content may set width, never
  restyle the frame.
- **DL-18.4** A blocking dialog uses `--surface-raised`, the shared scrim, a 1px hairline,
  `--radius-dialog` and `--layer-modal`, and only for a bounded task that must freeze its
  underlying context; configuration extensions and editable-list edits stay inline under
  DL-6.2 and DL-12.5.
- **DL-18.5** A dialog exposes `role="dialog"`, `aria-modal="true"` and a labelled title,
  traps focus, closes on Esc where safe, and returns focus to its trigger: visual
  modality without input modality is broken modality.
- **DL-18.6** A transient notice has no scrim and never takes focus; semantic colour names
  its condition while the ordinary surface frame keeps it part of the chrome.
- **DL-18.7** Drag feedback is pointer-transparent and sits on `--layer-drag`; it may use
  accent line/fill tokens, never shadow, blur, or transitions on positional geometry.
- **DL-18.8** Screens, popovers and dialogs may enter once with opacity plus a small
  transform using `--duration-enter`; they stop moving when settled and appear instantly
  under reduced motion.

---

## 5. Per-surface change list

| Surface           | Changes                                                                                                                          | Must not change                                                                   | Density                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- |
| Tab bar           | map padding/gaps/radii; neutral hover; persistent selected fill; add a visible focus state; drop the add/gear rotation           | 33px height, dots, attention state, close behaviour, label truncation             | unchanged                                         |
| Status bar        | map type/spacing/hairline; make text roles consistent                                                                            | do not turn segments into pills; keep 28px and the shortcut hints                 | unchanged                                         |
| Workspace sidebar | share the tab's hover/selected model; drop `filter`; replace the looping spinner with a static working mark or a one-shot entry  | 200px width, logo, the two-line label/path, close affordance                      | unchanged                                         |
| Config row        | hover is a neutral wash only; drop the accent bar; normalize gap/padding                                                         | key → value with an optional description                                          | row height unchanged                              |
| `cycle`           | shared pill plus active feedback; icon/hint surfaces on hover/focus                                                              | never a segmented control                                                         | unchanged                                         |
| `menu`            | shared pill over the native `<select>` overlay                                                                                   | no custom dropdown                                                                | unchanged                                         |
| `step`            | one pill, focus on the actual −/+ button, per-zone active state                                                                  | do not split into three boxed buttons                                             | unchanged                                         |
| `color`           | keep the 12px swatch, shared pill and ring                                                                                       | no custom palette widget                                                          | unchanged                                         |
| `picker`          | shared pill; clear and error stay inline                                                                                         | do not wrap the OS picker in modal chrome                                         | unchanged                                         |
| `toggle`          | `on` keeps green; `off` is normal-inactive, not disabled-looking                                                                 | no large switch track                                                             | unchanged                                         |
| `action`          | neutral by default; red only for destructive; active/disabled from tokens                                                        | not every action becomes a solid CTA                                              | unchanged                                         |
| Settings shell    | hover and current nav must differ; keep the 620px content measure; map header/rail spacing                                       | do not card-ify sections; do not move scroll ownership                            | unchanged                                         |
| Tab popover       | adopt the shared popover frame (inset hairline, 8px radius); drop the uppercase label; use config-row vocabulary                 | do not force it to the Prompt popover's width                                     | unchanged                                         |
| Prompt popover    | keep the §13 frame, 320px width, inline editor, reset-on-open                                                                    | do not grow padding or move the editor into a modal                               | unchanged                                         |
| Preset editor     | adopt the shared dialog frame; add modal semantics and focus handling; drop the decorative glyph; keep the spatial editing stage | do not force a spatial editor into config rows                                    | broadly unchanged                                 |
| Save preset       | same dialog frame and control primitives; clarify new-vs-overwrite selection                                                     | no second modal skin; do not turn it into a settings editor                       | unchanged                                         |
| Open board        | drop the solid accent selected row for a selected wash plus marker; unify card/chip/button states and spacing                    | 300px rail, thumbnails, keyboard hints, responsive grid, the 19px workspace title | unchanged; do not grow card padding or min-height |

The most likely way density drifts is snapping every `7/9/10/14px` up a step. Migration
must hold real heights first; the 2/4/6/8/12/16/24 scale allows that.

---

## 6. What the reviewer asked to see next

1. **Two or three actual ChatGPT desktop screenshots** the owner means, with build/version.
   "ChatGPT-like" is too broad, and the product just changed materially.
2. **A gallery matrix at one size** across all four themes, both tab positions, and
   hover/active/selected/focus/disabled. Tokyo Night alone does not prove a neutral wash
   works on Dracula or One Dark.
3. **Screenshots from a packaged build at 1× and 2×**, not only the browser gallery, to
   judge hairlines, radii and font rasterization.
4. **Before/after measurements** for tab height, status height, sidebar row, config row
   with and without a description, popover padding, Open board card height — the gate
   against density drift.
5. **A computed contrast report** for the focus/selected/state tokens over `--bg`,
   `--chrome-1`, `--chrome-2` and `--input-bg`, across the four presets and some extreme
   custom overrides.
6. If DL-1.3 is to be reopened at all: **a paint/compositor trace with 8–12 live PTYs**.
   Without that evidence, shadow and blur are not worth reconsidering.

---

## Reviewer claims checked against this repo

Every finding in §1a was verified by reading the cited lines; none was taken on trust.
Two of the reviewer's incidental claims were also checked and hold: §15 is indeed already
reserved (AGENTS.md, file-explorer fork), and the settings surface really does use a
220ms fade while §7 documents a 280ms slide-over.

Not verified, and left as the reviewer's judgement rather than fact: the assertion that
splitting `styles.css` first would scatter inconsistency, the specific step counts (seven
spacing / four radius / five type), and the claim that relaxing DL-1.3 would measurably
cost paint next to live PTYs — item 6 above is the experiment that would settle it.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

Not applicable: this is a frozen point-in-time review, not a living document. The
violations it found are recorded in §1a and remain unfixed as of 2026-08-12.
