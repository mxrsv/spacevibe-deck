# External review — the seam system

**Reviewer:** Codex CLI 0.147.0, read-only, invoked 2026-08-12 as a follow-up to
[the visual-system review](2026-08-12-visual-system-codex-review.md) `current`.
**Question put to it:** the owner reports that what still does not read like the Codex
desktop app is the seam system — how 1px lines combine with the surface backgrounds
behind them, the contrast between surfaces, the paddings, and specifically that the lines
between horizontal and vertical docks should not be crisp but should sit back, soft and
slightly sunken.

Point-in-time record. **The owner reviewed the gallery study on 2026-08-12 and chose
column C**, so §2 is no longer a proposal: it ships, and the rule behind it is now
[DL-2.3](../DESIGN-LANGUAGE.md) `current`. What did NOT ship is listed in §5.

---

## 1. Measured cause

Measured in the browser against the four shipped themes, reading the painted colour of a
probe rather than the token text:

| theme            | step `--bg` → `--chrome-1` | seam against the surface it edges |
| ---------------- | -------------------------: | --------------------------------: |
| tokyo-night      |                       +9.0 |                         **+20.6** |
| dracula          |                       +8.9 |                         **+23.5** |
| catppuccin-mocha |                       +8.9 |                         **+20.9** |
| one-dark         |                       +8.2 |                         **+15.1** |

The seam is 1.8× to 2.8× louder than the step it marks, and it is a _lightening_ line, so
the eye reads ink laid across the chrome instead of the edge of a plane.

The reviewer added four mechanisms behind that number, all verified in this repo:

- The seam derives from `--fg`, not `--tone` —
  [`derive-colors.ts`](../../src/lib/derive-colors.ts#L128) `current` sets
  `hair: alpha(fg, 0.12)` while every surface is `mixHex(bg, tone, …)`. The terminal's
  text hue therefore leaks into a boundary that should belong to the background ladder.
- An alpha border composites over the surface that _owns_ it, so the same token paints
  two different colours on the two sides of one boundary.
- Every boundary is one-sided; there is no counter-edge to suggest geometry.
- Shell boundaries, pane dividers and raised frames all share one treatment despite
  having different depth roles.

## 2. What the reviewer proposes

A wider background step carrying the structure, and a much weaker seam — explicitly
**not** a lowlight/highlight bevel on every dock edge, because 2 CSS pixels become 4
device pixels at DPR 2 and add more banding than softness.

```css
--chrome-1: color-mix(in srgb, var(--bg) 95%, var(--tone)); /* from 96% */
--chrome-2: color-mix(in srgb, var(--bg) 91%, var(--tone)); /* from 93% */

--seam-recessed: color-mix(
  in srgb,
  var(--bg) 98%,
  var(--tone)
); /* shell boundaries */
--seam-divider: color-mix(
  in srgb,
  var(--tone) 3%,
  transparent
); /* inside one surface */
--seam-raised: color-mix(
  in srgb,
  var(--bg) 86%,
  var(--tone)
); /* popover/dialog frame */
```

Seams mix over `--tone`, never `--fg`. The two structural seams are opaque so a boundary
paints one colour regardless of which side owns the border; the divider stays alpha
because it must adapt inside both `--bg` and `--chrome-1`. Popovers and dialogs drop
`border` for `box-shadow: inset 0 0 0 1px`, which DL-1.3 permits as a hairline.

Under those values the seam inverts from +15…+24 above its surface to −6…−7 below it,
while the step grows to +10.6…+11.6.

Padding corrections it named: `.tabbar` `0 8px 0 6px` → `0 8px`; `.pane__bar`
`6px 11px` → `6px 12px`; `.tab-popover` `10px 12px 12px` → `8px 12px 12px`; the preset
editor's toolbar and footer `10px 14px` → `8px 16px`. Chrome heights stay as they are.

## 3. Where a change would have to land

`:root` in [`styles.css`](../../src/styles.css) is only a pre-JS fallback. The running
app reads what [`applyThemeVars`](../../src/lib/theme-vars.ts#L44) `current` publishes
from [`deriveChromeColors`](../../src/lib/derive-colors.ts#L101) `current`, so a change
made only in CSS would leave every live theme exactly as it is.

## 4. The gallery study, and what it decided

[`seam-section.tsx`](../../src/gallery/sections/seam-section.tsx) `current` renders the
same shell three times on the app's own `.tabbar` / `.wsbar` / `.split__divider` /
`.status` / `.pane` classes. The step and seam numbers under each shell are measured
from the painted result and re-measure on a theme switch.

Column C won. The study is kept rather than deleted with the decision: column C now
carries no overrides (it is simply the app), while A pins the old values and B pins the
bevel, so the next person tempted to widen a hairline has to look at the comparison
first. Measured after the change, tokyo-night reads `+11.9 / −6.9` where it read
`+9.3 / +20.5`.

## 5. What shipped, and what did not

Shipped: the three seam tokens in
[`derive-colors.ts`](../../src/lib/derive-colors.ts#L99) `current`, published by
[`applyThemeVars`](../../src/lib/theme-vars.ts#L51) `current`, the widened
`--chrome-1`/`--chrome-2` steps, and the six structural call sites plus four raised
frames in [`styles.css`](../../src/styles.css) `current`. The relationship — step louder
than seam, seam below the surface — is locked for every preset by
[`derive-colors.test.ts`](../../src/lib/derive-colors.test.ts) `current`.

Not shipped: the padding corrections in §2, the `border` → `inset` change on dialog
frames, and every `--hair` line that is really a boundary between surfaces in the
settings panel, the Open board and the inputs. Those surfaces were not part of what was
reviewed, and DL-10 forbids fixing them opportunistically inside an unrelated change.

## Chưa khớp thực tế

| Claim                                                               | Intent    | Status     | Evidence                                                                                                     |
| ------------------------------------------------------------------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| Deck's seams read as sunken edges everywhere | `building` | partial | Shell boundaries, pane dividers and popover frames migrated; config rows, the Open board and inputs still draw boundaries with `--hair` |
| The change was judged on native macOS chrome | `decided` | unverified | Reviewed in the browser gallery only; no packaged-build screenshot yet |
| The proposal survives a light theme                                 | `decided` | unverified | All four shipped presets are dark; `--tone` flips to black on a light theme and the mixes are untested there |
| `--tab-active-bg` still reads correctly against a wider chrome step | `decided` | unverified | Not part of the study; it is `mixHex(bg, tone, 0.15)` and sits next to `--chrome-1`                          |
