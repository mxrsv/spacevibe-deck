# Hero motion trials — direction A (PROTOTYPE)

> **HISTORICAL as of 2026-08-19.** Everything below records how the hero's
> moving background was chosen; there is no moving background any more, and the
> page it describes has been rebuilt. The owner asked for the cursor.com
> formula, so on 2026-08-19:
>
> - `beams.js` (three.js) and `aurora.js` (ogl) were deleted outright, with both
>   dependencies; so were the closing band's 22s drift and the download button's
>   breathing halo. Nothing on the page loops any more.
> - The hero is CENTRED — pill, headline, subhead, one row of pill
>   buttons — over an app stage standing on a **light** oil painting: Caspar
>   David Friedrich's _Morning Mist in the Mountains_ (c. 1808, public domain),
>   declared once as `--plate-image` in `tokens.css`. Two Frederic Church oil
>   sketches (`plateau.webp`, `clouds.webp`) sit beside it as alternates pending
>   the owner's eye review; the losers get deleted when it closes.
> - The scroll tour is GONE. Its 340svh track, sticky pin, chapter rail and
>   `scroll-progress.js` are replaced by five stacked feature panels, each with
>   its own purpose-built window mock (`src/tour/panel-scenes.js`).
> - The 16-second demo reel is GONE too — the owner cut it for showing a build
>   the app has moved past. `demo-reel.js`, `demo-reel.css` and every `demo*`
>   copy string went with it, `primaryCta` became `seeFeatures` pointing at the
>   panels, and the `deck-tour.*` render cut left the landing's runtime-asset
>   list (the files stay in `marketing/`; the video pipeline still owns them).
>
> The `?motion=` switcher and the MOTION row went with the code they drove. Kept
> as the record of what was tried and why, not as a description of the page.

**Question:** what moving-background treatment does the direction A hero get?
Multi-round elimination — nothing is decided until a variant survives review.

Flip via the MOTION row in the switcher (visible only on direction A), keys `0–5`,
or `?motion=` in the URL. Base URL: `/landing-prototype/?direction=A&lang=en`.

## Round 1 candidates (2026-07-11)

| #   | key       | Concept                                                                   |
| --- | --------- | ------------------------------------------------------------------------- |
| 0   | `off`     | Baseline — static background as shipped in the direction pick.            |
| 1   | `sweep`   | Survey beam crossing the field, lighting the crosshair grid as it passes. |
| 2   | `plotter` | Hairlines + register marks drawing themselves in slow plotter cycles.     |
| 3   | `signal`  | Grid intersections blinking sparsely, like agent activity on a map.       |
| 4   | `drift`   | Ambient phosphor glow drifting + scanlines breathing. Pure atmosphere.    |
| 5   | `stream`  | Ghost terminal tokens scrolling vertically, like scrollback behind glass. |

Round 1 self-review notes:

- `sweep` — strongest single read; beam + grid highlight sync is clean.
- `plotter` — paths placed in the empty zones (top band, left column, bottom band)
  because the stage panel is opaque; ink/accent raised once already.
- `signal` — sparse by design; judged live, not by still frame. 64 dots, seeded PRNG.
- `drift` — intentionally the quietest; glow intensity raised once already.
- `stream` — most present; column near the copy might read as noise, judge live.

## Round 2 (2026-07-11) — `stream` leads

User picked `stream` as the favourite. Adjustments applied:

- Static plus-grid (`.direction-a::before`) is disabled while stream is active —
  two overlapping patterns read as noise. Gated via `data-hero-motion` on the
  section so other variants keep the grid.
- Token legibility raised: ink 9% → 17%, accent 22% → 36%.

## Round 3 (2026-07-11) — `stream` rebuilt as scatter batches

User asked for unordered text with per-batch entrance styles (columns felt too
regular). Rebuilt: 10 phase-shifted batches of 3–4 tokens at loose anchors,
cycling through four entrance styles — `type` (clip-path steps, terminal
typing), `rise` (fade-up), `flicker` (CRT stutter), `focus` (blur-in).
Anchors biased to the stage-free zones (left column / top band / bottom band)
because the stage panel is opaque; life duty raised to ~48% of each cycle so
the field never reads dead.

## Round 4 (2026-07-11) — upward drift + density

User asked for upward motion and a denser field. Applied:

- Every batch drifts upward for its whole cycle (translateY 2.75rem →
  -2.75rem on the batch container, ~5px/s); the loop seam lands in the dark
  half of the cycle so the jump never shows.
- Density up: 14 batches (was 10), 4–5 tokens each (was 3–4).
- Random zone anchors replaced with evenly spread slots (6 left column,
  4 top band, 4 bottom band) + jitter — random placement was piling
  batches onto each other and leaving dead frames.

## Round 5 (2026-07-11) — more slots, sharper tokens

- Slots 14 → 22 (left column 8, top band 6, bottom band 8 across two rows).
- Legibility up another notch: ink 17% → 24%, accent 36% → 48%.
- One slot (x15/y80) drifted into the "View on GitHub" row and read as
  garbage text — moved to the empty pocket between the CTA block and the
  switcher (x28/y72).

## Round 6 (2026-07-11) — copy backdrop removed in stream mode

The copy block's gradient backdrop (`.a-copy::before`) was masking the token
field behind the headline. Disabled while stream is active (same
`data-hero-motion` gate as the grid) — the 97%-white display type holds its
own directly on the 24% tokens.

## Round 7 (2026-07-11) — stage pulled off the copy

With the backdrop gone the stage's left edge sat under the headline. In
stream mode the stage narrows (88% → 74% of its grid area, desktop only) so
panel and copy never touch — verified on both EN and VI headlines.

Note: the token field is deterministic on purpose (seeded PRNG, same layout
every reload) so review rounds stay comparable. Swap the seed for
`Date.now()` when finalizing if a fresh field per visit is wanted.

## Verdict (2026-07-12) — `stream` ships

`stream` picked after seven tuning rounds: it's the only candidate that says
"live terminal work" instead of decorating the grid, and rounds 3–7 fixed the
legibility/composition issues that made it risky. Promotion cleanup applied:

- Deleted losing variants (`sweep`/`plotter`/`signal`/`drift` code + CSS) and
  directions B–E (`src/directions/{b,c,d,e}.js`, `styles/direction-{b,c,d,e}.css`).
- Deleted the review switcher and its state module; digit keys `0–5` and
  arrow-key direction cycling are gone with it.
- EN/VI became a real language toggle in the topbar (collapses to a lone
  toggle on mobile, where the rail already carries the brand).
- PRNG seed swapped from the fixed review seed to a random seed per visit —
  the field layout is still deterministic within a single render.

## Round 8 (2026-07-29) — `beams` replaces the aurora curtain

`stream` was later swapped for a violet WebGL aurora curtain (React Bits
`<Aurora />`, ported to vanilla `ogl` in `src/aurora.js`). That round predates
this log; the curtain now runs the **tour** section only.

The hero runs `beams` instead — React Bits `<Beams />` ported to vanilla
three.js in `src/beams.js`, dropping `@react-three/fiber` and `drei` (this page
has no React; R3F was only wrapping the scene graph). Applied with it:

- **Grey-white, not violet.** The hero background lost its violet wash so the
  beams carry the whole light language. The only accent above the fold is the
  primary CTA.
- **Hub band layout.** Copy went centred → left-aligned, matching the
  `spacevibe-hub` hero: a `// …` label, a two-tone display title, and the lede
  plus actions dropped into the first of four columns with the window mock
  filling the rest.
- **Two rules, not a grid.** Only the frame's left and right edges are drawn
  vertically; everything else is horizontal rules between them. Interior column
  rules fought the beams.
- **Tilt 14°.** The same angle the hub tilts its light sweep. Straight columns
  read as blinds behind left-aligned type.
- **Loaded late.** three is ~130 kB gzipped against ~27 kB for the rest of the
  page, so `beams.js` is a dynamic import and the field fades in after first
  paint. Entry chunk stays at 27.7 kB gzip.

## Round 9 (2026-07-29) — the rest of the page follows

Round 8 left the hero achromatic and everything under it violet, which read as
two documents stapled together. The seam turned out to be structural as much as
chromatic: the hero had a frame and the tour, closing band and footer had none.

- **One frame, whole document.** `--frame-width` in `tokens.css` is the single
  measure; `frame.css` draws its two edges as ONE fixed overlay rather than
  borders re-derived per section. Every horizontal rule on the page is a
  border on something that wide, so they all meet the verticals — verified at
  49 → 1391 for hero, tour, closing band and both footer rows at 1440.
- **Closing band matches the hero band.** A display line at
  `clamp(2.35rem, 5vw, 4rem)`, one step down the hero's curve. Two bands of the
  same shape at the two ends is what closes the document.
- **Chapters read on temperature, not hue.** `AURORA_SCENES` went from Tokyo
  Night blue / agent-brand / hot magenta to cool steel → neutral → warm ivory
  at 3–10% saturation. The stops had to be lifted well above the violet ones'
  lightness: the shader multiplies the ramp by a fractional intensity, and with
  no chroma to carry it the curtain is read on value alone.
- **Tokyo Night held at 60% saturation.** Same hues, same lightness, so the
  mock still reads as the real product but stops being the only saturated
  thing on the page. The macOS traffic lights are left alone — they are OS
  chrome, not theme.
- **No violet anywhere.** `--accent` is white. The primary CTA is a white face
  with dark text and an inverted hover sweep (dark plate slides in, label goes
  white). The plus-grid, the end-of-page bloom and the footer pools are all
  plain white at low alpha.
