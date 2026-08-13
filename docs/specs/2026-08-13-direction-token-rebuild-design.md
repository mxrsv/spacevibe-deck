# Direction token rebuild — Design

Date: 2026-08-13 · Status: §1–§8 decided and landed (`edf660f`, PR #16) ·
§9 added 2026-08-14, pending owner review
Scope: `src/gallery/` for §1–§8. **Amended 2026-08-14 by §9**, which is the shipping
addendum the [phases 2–5 plan](../plans/2026-08-13-redesign-phases-2-5.md) `current` §3.0
requires: §9 alone defines how the direction reaches `src/styles.css`, and the sentence
"nothing here enters the app bundle" survives only for the `--gx-chat-*` alias layer.
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

**Non-goals.** Changing `deriveChromeColors`. Adding a theme preset. Filling
DL §22.

Two former non-goals were lifted by §9 on 2026-08-14, after the owner approved
D1, D2, D3 and D9 of the phases 2–5 plan: **changing `src/styles.css`** and
**shipping the direction into the app**. They were correct while the gallery
was still the decision surface and the decision had not been made. They are
now the work. DL §20 and §21 are filled by §9.4; §22 stays reserved because
nothing in this program needs to name a surface genre.

## 1. What is there now, measured

`.gx-app--chatgpt` declares nine colour values:

| token                      | value                    | role as named by `tokens-section.tsx` |
| -------------------------- | ------------------------ | ------------------------------------- |
| `--gx-chat-app-under`      | `#0d0d0d`                | navigation ground                     |
| `--gx-chat-surface-main`   | `#181818`                | primary workspace                     |
| `--gx-chat-surface-raised` | `#242424`                | controls and overlays                 |
| `--gx-chat-pane-surface`   | `#111111`                | terminal canvas                       |
| `--gx-chat-selected`       | `#303030`                | persistent selection                  |
| `--gx-chat-border`         | `rgb(255 255 255 / 10%)` | quiet structure                       |
| `--gx-chat-ink`            | `#f3f3f3`                | primary text                          |
| `--gx-chat-ink-secondary`  | `rgb(243 243 243 / 65%)` | supporting text                       |
| `--gx-chat-ink-faint`      | `rgb(243 243 243 / 42%)` | quiet metadata                        |

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

| direction role       | rebuilt as        | why this token                                                                 |
| -------------------- | ----------------- | ------------------------------------------------------------------------------ |
| navigation ground    | `--bg`            | the ground is the theme's own background; the ramp starts where the theme does |
| terminal canvas      | `--bg`            | the pane is the terminal, and the terminal's colour is the user's, not ours    |
| primary workspace    | `--chrome-1`      | first step off the ground — the surface chrome sits on                         |
| controls / overlays  | `--chrome-2`      | second step — what floats above chrome (DL-13.1)                               |
| persistent selection | `--tab-active-bg` | already the app's "this one is active" background, at +0.15                    |
| quiet structure      | `--hair-strong`   | lines INSIDE a surface (DL-2.3)                                                |
| shell boundaries     | `--seam-recessed` | boundaries BETWEEN surfaces (DL-2.3) — the one role the flat file conflated    |
| primary text         | `--text-primary`  | floored at 7:1                                                                 |
| supporting text      | `--text-muted`    | floored at 5.5:1                                                               |
| quiet metadata       | `--text-faint`    | floored at 4.5:1                                                               |

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
.gx-app--chatgpt {
  --gx-chat-surface-main: var(--chrome-1);
} /* resolves HERE */
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
.gx-app--chatgpt .gx-stage {
  /* the ten aliases */
}
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
  becomes black and the ladder descends), but `--bg` becomes the _lightest_
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

## 9. Shipping addendum — how the direction reaches the app

Added 2026-08-14. §1–§8 describe a direction proven in a gallery; this section
is the only place that says how it becomes the app the owner launches. It exists
because the document's own non-goal used to be exactly that, so no file defined
the shipping path and phase 2 had nothing to execute against.

**Approval boundary.** This section records owner decisions D1, D2, D3 and D9 of
the [phases 2–5 plan](../plans/2026-08-13-redesign-phases-2-5.md) `current`, all
approved on 2026-08-14. It does not carry D4–D8 or D10–D12, and approving it
authorizes phase 2's CSS work only.

### 9.1 Both hosts receive this (D9)

`src/styles.css` is loaded by the Electron host and by the Tauri host that every
release still builds. There is no host-scoping seam in the stylesheet, and
inventing one out of CSS assumptions would hide the divergence rather than
manage it. So the restyle is **cross-host and visual-only**: no new Tauri
product behaviour, both hosts get the same renderer, and both hosts get their
own regression evidence.

The consequence is a rule about language, not about code: phase 2 evidence names
the two hosts separately and never labels a shared-renderer result "Electron
only". Neither host's evidence says anything about Windows.

One host value is not in the stylesheet and still has to follow the ground:
every Electron window paints [`#101014`](../../electron/main.ts#L163) `current`
before first render, and `src-tauri/tauri.conf.json` says `#16161e`. Whatever
`--bg` the redesign lands on, both of those follow it in the same change, or
window-open and resize flash a colour the app never shows again.

### 9.2 The role map — which token lands in which region

The rebuild map in §3 says what each direction role becomes. This table says
where in `src/styles.css` that token is consumed, so the migration is a list of
regions rather than a search for colours. The token column is the contract; the
region column is the work.

| direction role       | app token                               | `styles.css` regions that consume it                                                                                         |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| navigation ground    | `--bg`                                  | `html`/`body`/`#root`, `.window`, `.deck-frame` and the repository rail in sidebar mode, the settings nav, the Open board rail |
| terminal canvas      | `--bg`                                  | the pane stage only — no chrome colour enters the xterm canvas, and no `--mono` token is added                               |
| primary workspace    | `--chrome-1`                            | the content a rail points at: settings screen body, Open board body, the status bar, `.tabbar` in top-tab mode, the pane bar |
| controls / overlays  | `--chrome-2`                            | tab popover, prompt popover, preset editor, save dialog, settings screen, persist-error bar                                  |
| persistent selection | `--tab-active-bg`                       | active tab, active rail item, active settings category, selected board row, selected workspace row (§9.4, DL-21)             |
| quiet structure      | `--hair-strong`                         | lines INSIDE one surface: config rows, board cards, inputs                                                                   |
| shell boundaries     | `--seam-recessed`                       | frame bottom, tab bar, sidebar, status bar, pane bar — the DL-2.3 seam, already in place                                     |
| floating frames      | `--seam-raised`                         | the frame around any surface that floats above chrome; clears both DL §10 `--hair-strong` rows                               |
| primary text         | `--text-primary`                        | keys, values, active labels                                                                                                  |
| supporting text      | `--text-muted`                          | secondary values, inactive labels                                                                                            |
| quiet metadata       | `--text-faint`                          | descriptions, group labels, hints, disabled                                                                                  |
| control geometry     | `--radius-control` / `--radius-surface` | new in `:root` (§9.4, DL-20)                                                                                                 |
| chrome motion        | `--duration` / `--ease`                 | new in `:root` (§9.4, DL-20)                                                                                                 |

Nothing in this table is a new colour. Every row already exists in
`deriveChromeColors`; what phase 2 changes is which region asks for which one,
plus the two geometry rows that are genuinely new.

### 9.3 The alias layer does not ship

`--gx-chat-app-under`, `--gx-chat-surface-main` and the other eight aliases stay
in `src/gallery/chatgpt-direction.css` and enter no shipped file. They are role
NAMES for a review surface — `tokens-section.tsx` renders them as the contract
the owner reads — and the app already has names for the same roles in §2 of
DESIGN-LANGUAGE. Shipping the alias layer would give every chrome token two
spellings and make DL-2.1 ambiguous about which one a component may use.

This also keeps R7 intact in the direction the rule actually runs: shipping
modules must not import `src/gallery/`, and a shipped stylesheet consuming
gallery vocabulary would be that import in CSS form.

The substitution trap in §5 is a gallery problem and does not follow the tokens
into the app: `styles.css` declares its derived tokens once on `:root` and
`app.tsx` republishes them there on theme change, so there is no second element
publishing a competing theme.

### 9.4 The two DL sections this fills

**DL §20 Numeric scales (D2).** Two radius roles and one motion pair, taken from
the direction because that is what was eye-approved:
`--radius-control: 10px` for rows, pills and icon buttons;
`--radius-surface: 16px` for anything that floats above chrome;
`--duration: 150ms` with `--ease: cubic-bezier(0.4, 0, 0.2, 1)` for state change.
Consequences the owner is accepting with D2, spelled out because they rewrite
rules that are cited from code: **DL-5.2's 6px pill radius becomes
`--radius-control`**, and **DL-13.1's 8px popover radius becomes
`--radius-surface`**. §7's `0.13s` state-change figure becomes `--duration`; the
panel slide-over keeps its 0.28s, which is an entrance and still inside DL-1.2's
300ms ceiling.

**DL §21 Interaction states (D1).** The full rounded wash becomes the app-wide
selection signifier, and the 2px left accent bar in DL-5.1 and DL-11.2 is
retired. This is the fork the rebuild spec called "a real conflict, not a gap",
resolved in favour of what the owner approved in the gallery.

**§22 stays reserved.** Nothing in phases 2–5 needs to name a surface genre, and
filling a section to make it non-empty is how a rulebook acquires rules nobody
cited.

### 9.5 The hover/selected collision the direction file contains

The direction sheet gives `.gx-rail__item:hover` and `.gx-rail__item.is-active`
the **same declaration**, and does the same for `.settings-nav__item`. Hovering
an inactive rail item therefore paints exactly what "this one is selected" looks
like, and the two states become indistinguishable while the pointer is down the
list. A still screenshot cannot show this; the state matrix's hover column can,
which is the reason that matrix is un-parked.

DL §21 cannot be written from that file as it stands, because a selection rule
whose hover is identical to selection is not a rule. §21 resolves it using the
direction's **own** two values rather than inventing a third: the neutral wash
`.cfg-row:hover` already uses is hover, and `--tab-active-bg` is selected. Both
are already in the reviewed file; what changes is that the rail and the settings
nav stop using the selected value for hover.

This is a correction to the direction, made under D1 rather than beside it, and
it is called out here so the owner reviews it as a decision instead of finding it
in a diff.

### 9.6 What does not move

- **`--frame-h` stays 34px.** The direction's 54px was never eye-reviewed at
  native density, and DL-18.2's figure is load-bearing: `hiddenInset` plus
  `--frame-lights-w` are tuned so the macOS traffic lights centre inside the row.
  Changing it is a window-chrome decision, not a token decision.
- **The type scale stays DL-4.4's.** The gallery's 13px labels were a
  convenience of a comparison surface, not a reviewed decision.
- **`deriveChromeColors` does not change** — the handoff closed that, and §3.1's
  monotonic-ladder argument depends on the `t` values staying where they are.
- **`--accent` stays the theme's accent.** §4 already records that the flat file
  pinned it to white and that the rebuild returns it; shipping does not reopen it.
- **The z-index ladder is behavioural, not visual.** Settings-under-scrim depends
  on 40 > 35; reordering layers during a restyle is a logic change.
- **No `:is()` / `:where()` / `:not(a, b)` enters `styles.css`.**
  `src/gallery/force-states.ts` cannot parse them and the state matrix's forced
  states would break silently — the gate would go green while proving nothing.

### 9.7 Order and gates

The order of work, the per-step gates and the phase-end evidence are the phases
2–5 plan's §3.1–§3.4 and are not restated here. What this section adds to them:
the token layer moves as one unit — `:root`, `derive-colors.ts` and
`theme-vars.ts` together — because the `:root` `color-mix()` fallbacks are a
mirror of the JS math and a step that moves one without the other ships a first
paint that disagrees with every later frame.

## Chưa khớp thực tế

_(reality-drift ledger — heading text mandated by the global docs convention)_

| Claim                                           | Intent    | Status       | Evidence                                                                                                                                                                                                                    |
| ----------------------------------------------- | --------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The direction ships no fixed hex                | `current` | `partial`    | Colours yes. Radii, duration and easing are still literal — but §9.4 makes them DL-20 tokens rather than gallery strays, so what remains is one scale the rulebook now owns                                                 |
| The direction holds on any theme                | `current` | `unverified` | Four dark presets proven; a light theme inverts the text-on-`--bg` case — §7                                                                                                                                                |
| The direction complies with the design language | `current` | `partial`    | §21's selection conflict is **resolved** by §9.4 in favour of the wash. What is still partial is the tree: the app is not migrated to DL-20/DL-21, and §9.5's hover/selected collision is still live in the direction sheet |
