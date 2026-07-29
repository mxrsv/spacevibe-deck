# Deck — marketing assets

```
marketing/
├── stage/               shared app-window mock (chrome + data + brand)
├── video/               the marketing film — see video/README.md
├── landing-prototype/   the landing page prototype
└── cmd_e.py, stackgrid-cmd-e.*   legacy Manim explainer (superseded)
```

## `stage/` — one app window, three surfaces

The landing hero, the landing's scroll tour and the film all build their app
window from `stage/appwin.js` + `stage/stage-data.js`. There is no second
drawing of the UI to keep in sync: change the chrome once and every surface
follows.

`stage/brand.js` holds the product name and mark. The Stackgrid → Deck rename
is one edit there, not a grep.

## `video/` — the film

An end-to-end tour: Open board → three agents in parallel → one needs you →
⌘⇧A → ⌘E. Rendered from the DOM through a virtual clock, so a headless
capture reproduces exactly what the browser preview shows.

```bash
npm run video:preview                   # watch it live
npm run video:render                    # every preset into video/out/
npm run video:render -- --still 13.4    # one frame, for eyeballing a beat
```

Full details, preset matrix and how to change the beats:
[`video/README.md`](./video/README.md).

## Publishing a cut

`video/out/` is git-ignored. Once a cut is approved, copy what each surface
needs:

| Surface       | Render                      | Publish as                |
| ------------- | --------------------------- | ------------------------- |
| GitHub README | `deck-tour-gif.gif`         | `marketing/deck-tour.gif` |
| Landing       | `deck-tour-hero.webm`       | `deck-tour.webm`          |
| Landing       | `deck-tour-hero.mp4`        | `deck-tour.mp4`           |
| Landing       | `deck-tour-hero-poster.png` | `deck-tour-poster.png`    |
| YouTube / X   | `deck-tour-master.mp4`      | upload as-is              |
| Product Hunt  | `deck-tour-vertical.mp4`    | upload as-is              |

The landing's demo band (`landing-prototype/src/demo-reel.js`) already points at
the published names, so a cut goes live by copying those three files into the
served root:

```html
<video autoplay muted loop playsinline poster="/deck-tour-poster.png">
  <source src="/deck-tour.webm" type="video/webm" />
  <source src="/deck-tour.mp4" type="video/mp4" />
</video>
```

The band sizes the frame from the viewport height, up to the page column
(~1400 CSS px), which is why `hero` now delivers 2560×1440 — see
[`video/README.md`](./video/README.md).

## Legacy — the Manim explainer

`cmd_e.py` and the `stackgrid-cmd-e.*` files are the previous ⌘E-only
explainer: a hand-drawn approximation of the window that has to be redrawn by
hand whenever the app changes. Kept for reference; the film supersedes it.

```bash
# needs: pip install manim (ffmpeg + cairo/pango on PATH)
manim -qh --disable_caching cmd_e.py CmdE
```
