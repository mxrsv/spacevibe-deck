# Code review (read-only): worktree loading ring

**Reviewer:** not recorded. The document does not identify its author, and nothing in the
repository attributes it; it is kept for its findings, not its provenance.
**Filed:** 2026-08-12, moved here from `docs/plans/` during the consolidation pass.

Point-in-time record. The findings below were true of the code as it stood when they were
written and have not been re-verified since.

Scope: `src/gallery/chrome-fixtures.tsx` (LOADING_*, LOADING_TICKS, WorktreeLoadingRing, WorktreeActivity),
`src/gallery/gallery.css` (`.gx-worktree-loading*`, keyframes, reduced-motion rule).
Reference: codex-clipboard-klp8nA.png. Rendered: /tmp/deck-loading-gallery.knmuGx/row.png.
No files were edited.

---

## Findings

### High — travel direction is counter-clockwise
- `chrome-fixtures.tsx:111` — index increases clockwise (SVG y-down, angle grows from -90deg).
- `chrome-fixtures.tsx:140` — `animationDelay: -index * step`, so tick i peaks at `cycle - i*step`.
  Peak order after t=0 is 11, 10, 9 ... = counter-clockwise.
- Fix if clockwise intended: `-(((LOADING_TICK_COUNT - index) % LOADING_TICK_COUNT) * tickStepMs)`.

### Medium — cycle duration duplicated
- `chrome-fixtures.tsx:104` (`LOADING_CYCLE_MS = 1_080`) vs `gallery.css:756` (`1080ms`).
  Any drift desynchronises the per-tick delays and makes the head wobble. Prefer a CSS var.

### Medium — resemblance: base segments too faint
- `gallery.css:755` `fill: var(--text-faint)` = `color-mix(--fg 34%, --bg)` (`src/styles.css:26`).
  In the rendered crop the unlit segments almost vanish; the reference shows 12 evenly visible
  gray dashes. Raise the base fill (or add `opacity`) so the full ring reads at rest.

### Low
- a11y: `chrome-fixtures.tsx:158` `role="status"` inside the row `<button>` (`:187`) injects the
  label into the button's accessible name and creates a live region that never updates.
  `role="img"` fits a static indicator better.
- `gallery.css:769` reduced-motion uses `:first-child`; a dedicated class/attribute is sturdier.
  With animation off, the other 11 ticks stay near-invisible (see Medium above).
- Perf: 12 elements animating `fill` = paint every frame, per working row. Fine for a prototype.
- `gallery.css:751` `overflow: visible` is unneeded (max extent 10.6 < 12 in a 24 viewBox).

## Verified as correct
- No rotation on the `<svg>`; geometry is static, only `fill` animates.
- Loading lives in `WorktreeActivity`, separate from the avatar; classes and fixtures are
  gallery-only (`src/gallery/sections/{chrome,matrix}-section.tsx` are the sole importers).
- Keyframes 0-9% primary -> 27% muted -> 44% faint give a ~5-segment fading head.

Verdict: APPROVE WITH NOTES
