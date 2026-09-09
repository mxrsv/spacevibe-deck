# Stackgrid Landing — Scroll Tour Sections — Design Spec

Status: approved in conversation (2026-07-23); mock-first delivery requested
Date: 2026-07-23
Builds on: `2026-07-10-stackgrid-landing-design.md` (narrative + no-icon-grid rule)
and `2026-07-16-landing-stage-app-window-design.md` (hero stage conventions).

## Goal

Extend the landing prototype (`marketing/landing-prototype/`) below the hero with
a cinematic, scroll-driven product tour plus one closing band, so the page tells
the full story instead of stopping at the hero. The hero section ships as-is and
is not modified.

## Chosen direction

Of three explored options (story sections with interactive moments, interactive
playgrounds, scroll-driven tour), the user picked the **scroll-driven tour**:

- One tall tour section after the hero. A **new** app-window mock (not a handoff
  of the hero's window) sits `position: sticky` at viewport center and morphs
  through three chapters as the visitor scrolls.
- Native scrolling only — **no wheel hijacking, no scroll snapping**. A passive
  scroll listener + rAF maps the section's scroll progress (0→1) to a discrete
  chapter (1/2/3). Chapter changes flip a `data-chapter` attribute; CSS
  transitions (transform/opacity/grid tracks) do the morphing. No per-pixel
  scrubbing — this keeps the animation jank-free and the fallbacks trivial.

## The three chapters — "core proof sequence"

Matches the approved proof sequence from the 2026-07-10 spec: open a workspace
preset → materialize a multi-agent grid → Focus Expand to 65%.

1. **Open board — "Start from a known formation."**
   The window shows a simplified Open board: workspace sidebar (same data as the
   hero stage), and a stack of recent workspaces where the top row is
   highlighted with its remembered layout preset + agent selection and an
   `↵ Open` hint. Message: reopening your whole team is one keystroke.
2. **Agents launch — "Give every pane an agent."**
   The board crossfades into a three-pane split grid (same composition as the
   hero stage: two panes stacked left, one tall pane right). Pane chrome is
   tinted per agent — Claude magenta, Codex green, Gemini cyan — with busy dots
   and transcript content. Message: pick an agent once, every pane runs.
3. **Focus Expand — "See the system. Work the detail."**
   The focused (Claude) pane grows to **65%** on both axes via animated grid
   tracks; the other agents compress but stay fully visible. A `⌘E` kbd badge
   appears on the expanded pane. Message: steer one agent without losing the
   rest.

A copy rail beside the window lists the three chapter titles + one-line bodies;
the active chapter is highlighted, inactive ones dimmed. Clicking a rail entry
scrolls to that chapter's range.

## Closing band (not sticky)

A normal section after the tour:

- **Three proof chips** (text, not icon cards): real PTY / login shell
  (`$SHELL -l`, PATH/aliases/dotfiles intact) · local-first, no telemetry ·
  native Tauri 2, no Electron.
- **Shortcut ribbon**: ⌘D · ⌘⇧D · ⌘T · ⌘E · ⌘F · ⌘K with short labels.
- **CTA row**: Download for macOS (GitHub Releases latest) · Watch the 45-sec
  demo (opens the existing shared demo dialog via `data-open-demo`) · View on
  GitHub.

## Localization

- Rail copy, proof chips, shortcut labels, and CTAs are bilingual EN/VI through
  the existing `data-copy` mechanism; Vietnamese is written as natural product
  copy, not word-for-word translation.
- Everything **inside** the app window stays English-only, mirroring the
  released app (same convention as the hero stage, per the 2026-07-16 spec).
- The tour exposes `updateTourLocale(root, copy)` so a locale toggle swaps text
  in place without remounting (same reason as the hero: no flash, timers keep
  running).

## Architecture

- New module folder `marketing/landing-prototype/src/tour/`:
  - `index.js` — `renderTour(copy)` → `{ markup, mount }`, plus
    `updateTourLocale`. Mount wires the scroll engine and returns a disposer.
  - `stage-states.js` — frozen English-only stage data (board recents, tour
    panes with transcript lines). Reuses `stageSidebar` from
    `../product-stage.js`.
- New stylesheet `marketing/landing-prototype/styles/tour.css`. Design tokens
  (surfaces, violet accent `#b98cff`, fonts) mirror `direction-a.css` values;
  duplicated for now so the hero file stays untouched (extraction into a shared
  tokens file is a follow-up).
- `src/main.js` renders hero + tour markup into `#specimen-root` together, so
  the existing `mountDemoDialog` picks up the closing band's `data-open-demo`
  trigger with no changes.

## Fallbacks

- `prefers-reduced-motion: reduce` — transitions and pulse/cursor animations
  off; chapters still switch (instant state jumps).
- Narrow screens (< 768px) — single-column layout: the copy rail becomes a
  compact horizontal chapter strip above the window; sticky behavior is kept.
  A fully static stacked fallback (three frozen snapshots) is a candidate for
  the final version, decided after eye review of the mock on mobile.

## Mock-first delivery

The user asked for a **low-fidelity but visually representative mock** first
(v1, commit 1a62740), then upgraded it after review feedback ("too simple, not
app-like, needs background animation") to **v2** (commit 704340d):

- The tour window is the **shared `.a-appwin` chrome** (extracted from the hero
  into `src/appwin.js`) with **live streaming transcripts** via
  `mountStageStream`, busy-ring / unread-dot sidebar avatars, and a `⌘E` badge
  on the focused pane.
- The background is a second **aurora curtain** whose palette follows the
  chapter — ambient violet → the three agent brand colors → converged deep
  violet — via `mountAurora`'s new `{dispose, setScene}` API (color stops and
  amplitude lerp in the rAF loop; rendering pauses offscreen through an
  IntersectionObserver). A crosshair plus-grid backdrop brightens per chapter.

Resolved in the Task 1–7 harden pass:

- [x] Window entrance animation — scale/opacity-in on first viewport entry
  (`mountWindowEntrance`, `.tour__appwin[data-enter].is-entered`; Task 3).
- [x] Copy finalized — tour/finale/footer keys reviewed; the 8 hero/shared keys
  left frozen (Task 5).
- [x] Mobile static-stacked fallback shipped — `.tour--static` un-pins the track
  below 768px and stacks board + grid (`mountResponsiveMode`; Task 4).
- [x] Shared design tokens extracted to `styles/tokens.css`; hero + tour alias
  the same `--accent`/`--font-*`/`--sg-*` vars (Task 6).

No genuinely-deferred spec items remain. Remaining follow-up is human eye-review
(both locales, mobile + desktop) and a visible-focus-ring pass on the tour's
CTAs/rail/footer, which currently rely on the browser default outline.

Verification is by eye (per the 2026-07-10 funnel rule): the user reviews at
`http://127.0.0.1:5173/landing-prototype/` and requests adjustments; build
output alone is never proof of visual success.
