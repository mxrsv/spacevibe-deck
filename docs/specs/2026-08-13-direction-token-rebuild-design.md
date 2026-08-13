# Direction token rebuild — Design

Date: 2026-08-13 · Status: proposed, pending owner approval
Scope: `src/gallery/` only. Nothing here enters `src/styles.css` or the app bundle.
Source context: [redesign program handoff](../plans/2026-08-13-redesign-program-handoff.md)
`current` §4 decision 3 · [repository rail design](2026-08-13-repository-worktree-rail-design.md)
`proposed`, whose rail is this direction's left region.

## Goal

`src/gallery/chatgpt-direction.css` declares the reviewed visual direction as
**nine fixed hex values plus strays**. Ship them and `DL-2.1` retires, `DL-2.2`
becomes false, and Deck's four theme presets would restyle the terminal canvas
and nothing else.

The owner's decision is to keep the **relationships** those nine values encode
and rebuild them from `--bg`/`--tone` through `deriveChromeColors`, so chrome
still follows the terminal theme and the 7 / 5.5 / 4.5 contrast floors still
hold. This document says what those relationships are, what each becomes, and
what breaks if it is done naively.

**Non-goals.** Changing `deriveChromeColors`. Changing `src/styles.css`. Adding
a theme preset. Filling DL §20–§22 (§6). Shipping the direction into the app —
the gallery is the decision surface, and this rebuild is what makes the
decision reviewable.

## 1. What is there now, measured

`.gx-app--chatgpt` declares nine colour values:

| token                     | value                   | role as named by `tokens-section.tsx` |
| ------------------------- | ----------------------- | ------------------------------------- |
| `--gx-chat-app-under`     | `#0d0d0d`               | navigation ground                     |
| `--gx-chat-surface-main`  | `#181818`               | primary workspace                     |
| `--gx-chat-surface-raised`| `#242424`               | controls and overlays                 |
| `--gx-chat-pane-surface`  | `#111111`               | terminal canvas                       |
| `--gx-chat-selected`      | `#303030`               | persistent selection                  |
| `--gx-chat-border`        | `rgb(255 255 255 / 10%)`| quiet structure                       |
| `--gx-chat-ink`           | `#f3f3f3`               | primary text                          |
| `--gx-chat-ink-secondary` | `rgb(243 243 243 / 65%)`| supporting text                       |
| `--gx-chat-ink-faint`     | `rgb(243 243 243 / 42%)`| quiet metadata                        |

It also pins `--bg`, `--fg`, `--accent`, `--tone` and the five ANSI hues, and a
second block, `.gx-chatgpt-direction`, pins a **different** ramp for the same
roles (`--chrome-1: #212121`, `--chrome-2: #282828`, plus bare `#0d0d0d`,
`#101010` and `#151515` literals in rules). Two ramps disagreeing inside one
direction file is itself a reason to rebuild rather than to transcribe: there is
no single set of nine numbers to preserve, only an intent.

## 2. The three relationships being preserved

The owner named them, and they are the whole contract:

1. **One neutral surface ramp.** A monotonic ladder of backgrounds — ground,
   canvas, surface, raised — where every step is the same hue at a different
   distance from the ground, and no step is a colour decision of its own.
2. **One selection state.** A single wash means "this one", everywhere: rail
   item, worktree row, config row, tab, board row. Not one treatment per genre.
3. **One border role.** A single quiet line, used wherever structure is drawn,
   rather than a border palette.

Everything below is these three sentences expressed in existing tokens.

## 3. The rebuild map

| direction role      | rebuilt as         | why this token                                                                 |
| ------------------- | ------------------ | ------------------------------------------------------------------------------ |
| navigation ground   | `--bg`             | the ground is the theme's own background; the ramp starts where the theme does |
| terminal canvas     | `--bg`             | the pane is the terminal, and the terminal's colour is the user's, not ours    |
| primary workspace   | `--chrome-1`       | first step off the ground — the surface chrome sits on                         |
| controls / overlays | `--chrome-2`       | second step — what floats above chrome (DL-13.1)                               |
| persistent selection| `--tab-active-bg`  | already the app's "this one is active" background, at +0.15                    |
| quiet structure     | `--hair-strong`    | lines INSIDE a surface (DL-2.3)                                                |
| shell boundaries    | `--seam-recessed`  | boundaries BETWEEN surfaces (DL-2.3) — the one role the flat file conflated    |
| primary text        | `--text-primary`   | floored at 7:1                                                                 |
| supporting text     | `--text-muted`     | floored at 5.5:1                                                               |
| quiet metadata      | `--text-faint`     | floored at 4.5:1                                                               |

### 3.1 The ramp holds by construction, not by four numbers

`deriveChromeColors` builds `chrome1`, `chrome2` and `tabActiveBg` as the same
`mixHex(bg, tone, t)` at `t = 0.05, 0.09, 0.15`. Monotonic `t` on a fixed pair
gives a monotonic ladder for **every** theme, light or dark, without anyone
choosing a hex. That is relationship 1 preserved as an invariant — which is
strictly stronger than preserving `#0d0d0d < #111111 < #181818 < #242424`, a
statement that is true only for one theme.

`--seam-recessed` at `t = 0.02` sits below `chrome1`, which is what DL-2.3
requires: the step must stay louder than the seam that marks it.

### 3.2 The contrast floors are inherited, not re-derived

`ensureContrast` raises each text tone until it clears its floor against
`[inputBg, chrome1, chrome2, tabActiveBg]`. The rebuild paints text only on
those four surfaces and on `--bg`. On the four shipped presets — all dark, so
`tone` is white — `--bg` is darker than every floored surface, so contrast there
is strictly higher than the floor. The floors therefore hold without this
document adding a rule. §7 records where that argument stops.

## 4. What the rebuild changes on purpose

These are consequences, not side effects, and each is a visible change the
owner is being asked to look at:

- **`--accent` stops being white.** The flat file pins `--accent:
  var(--gx-chat-ink)`, which deletes the theme's accent from chrome — against
  DL-2.2 and DL-3.1, and against the owner's "chrome keeps following the
  terminal theme". Rebuilt, the active-tab marker and focus rings return to the
  theme's blue. This is the single most visible difference from the reviewed
  screenshot.
- **The popovers lose their blurred shadow.** `box-shadow: 0 12px 36px rgb(0 0
  0 / 28%)` is banned outright by DL-1.3; DL-13.1 says depth comes from the
  background step and an inset hairline. The rebuild uses the step.
- **Uppercase goes.** `.gx-chatgpt-explorer__root` and the rail's eyebrow both
  set `text-transform: uppercase`, which DL-4.3 bans with no exception.
- **Geometry and motion stay literal.** `--gx-chat-radius-control: 10px`,
  `--gx-chat-radius-surface: 16px`, `--gx-chat-duration: 150ms` and
  `--gx-chat-ease` are not colours and are not in the owner's three
  relationships. They stay as declared values, and they are §6's fork material.

## 5. The substitution trap this had to route around

A custom property whose value contains `var()` is substituted **at
computed-value time on the element that declares it**, and descendants inherit
the already-resolved value. So:

```css
.gx-app--chatgpt { --gx-chat-surface-main: var(--chrome-1); }   /* resolves HERE */
```

freezes every descendant to the gallery root's `--chrome-1`. The state matrix
publishes a different theme per cell via `applyThemeVars` on the cell's inline
style — and with the alias declared only at the root, **all four theme columns
would render identically**. The matrix would show a green result for the exact
property it exists to test.

This is the same mechanism `src/lib/theme-vars.ts` already documents for
`--status-unread`, which is why that token is published per element rather than
declared once in `:root`.

**The fix**: declare the alias block on every element that publishes a theme —
the gallery root, the matrix cell, and the specimen stage:

```css
.gx-app--chatgpt,
.gx-app--chatgpt .gx-cell,
.gx-app--chatgpt .gx-stage { /* the nine aliases */ }
```

The alternative — deleting the aliases and writing `var(--chrome-1)` at every
use site — is immune to the trap but throws away the role names, and
`tokens-section.tsx` renders those names as the contract the owner reviews.
One selector list is cheaper than losing the vocabulary.

## 6. Fork: DL §20, §21 and §22 stay empty

The handoff reserves them for the 2026-08-12 visual review's proposals and says
filling them is an R2 fork. The rebuild touches all three and fills none:

- **§20 Numeric scales.** The direction's `10px` / `16px` radii and `150ms`
  duration are a scale, and today they are literals in a gallery file with no
  rule behind them. Proposing the scale is the fork.
- **§21 Interaction states.** This is a **real conflict**, not a gap. The
  direction's selection is a full rounded background wash. `DL-5.1` and
  `DL-11.2` say the signifier is a 2px left accent bar plus a 4% `--fg` wash,
  and say it precisely so "active" reads the same everywhere in the app.
  Resolution taken here: **the shipping rail obeys the rule**, and the gallery
  direction sheet restyles it as a proposal — which is what a direction sheet
  does to every other surface too. Adopting the wash app-wide is the §21 fork.
- **§22 Surface genres.** §3's four-step ladder is a genre ladder — ground,
  canvas, surface, raised — and naming which genre a new surface belongs to is
  what §22 would decide. Not proposed.

## 7. Limits

- **Only the four shipped presets are proven.** tokyo-night, dracula, one-dark
  and catppuccin-mocha are all dark, so `luminance(bg) < 0.45` and `tone` is
  white for all four. The matrix proves those four and claims nothing else.
- **A light theme is unproven.** The ramp's ordering invariant survives (`tone`
  becomes black and the ladder descends), but `--bg` becomes the *lightest*
  surface while the text floors are measured against the four darker ones, so
  text painted on `--bg` could sit below its floor. Deck ships no light preset,
  a user colour override can produce one, and this is not tested.
- **`--tone` is not user-settable.** After the rebuild there is no fixed grey
  anywhere in the direction — which was the owner's condition, stated as a
  checkable property rather than a promise.
- **A green build is not an eye review** (DL §9.6). The evidence for this
  document is screenshots.

## 8. Verification — the state matrix earns its keep

`src/gallery/sections/matrix-section.tsx` returns to the registry. It renders
four themes × five states across three blocks (top tabs, sidebar, config rows),
with `hover` / `active` / `focus` re-scoped from the app's own stylesheet by
`force-states.ts` rather than reimplemented.

What it proves: that the ramp, the selection wash and the border role survive a
theme change, in one glance instead of four screenshots minutes apart — the
thing the flat hex file made structurally impossible.

What it cannot prove: native rendering, font smoothing, or how any of it looks
on a real display. Those need the packaged Electron screenshots.

Its sidebar block renders the **repository rail**, not `WorkspaceSidebar`,
because the redesign's left region is the rail.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                          | Intent     | Status       | Evidence                                                                     |
| ---------------------------------------------- | ---------- | ------------ | ----------------------------------------------------------------------------- |
| The direction ships no fixed hex               | `proposed` | `partial`    | Colours yes; radii, duration and easing stay literal — §4                     |
| The direction holds on any theme               | `proposed` | `unverified` | Four dark presets proven; a light theme inverts the text-on-`--bg` case — §7 |
| The direction complies with the design language| `proposed` | `partial`    | §21's selection conflict is unresolved and the rail obeys the rule instead    |
