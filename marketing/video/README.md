# Deck — marketing film

An end-to-end tour of the app: the Open board remembers a workspace, ⏎ opens
three agents side by side, one finishes, one asks for you, ⌘⇧A jumps to it and
⌘E gives it 65% of the layout.

The app window in the film is **not a drawing**. It is assembled from
`marketing/stage/` — the same renderers and data the landing hero uses — so
when the app's chrome changes, both surfaces change together.

## How it works

Nothing animates itself. `src/script.js` is a set of keyframe tracks;
`sceneStateAt(t)` turns a timestamp into a complete scene state, and
`window.__deckVideo.seek(t)` paints it. The browser preview drives `seek()`
from `requestAnimationFrame`; the renderer drives it frame by frame. Same
function, same picture — and the render is reproducible because no wall clock
is involved.

CSS `transition` and `@keyframes` are disabled inside the frame for the same
reason (`styles/video.css`).

| File                  | Role                                                      |
| --------------------- | --------------------------------------------------------- |
| `src/script.js`       | the film — beat sheet, tracks, `sceneStateAt(t)`          |
| `src/copy.js`         | every word on screen, plus the Open-board rows            |
| `src/stage-driver.js` | builds the app stage, paints a state onto it              |
| `src/transcript.js`   | replays the shared pane scripts as a pure function of `t` |
| `src/camera.js`       | the rig transform + rack focus                            |
| `src/backdrop.js`     | aurora curtain, vignette, grain                           |
| `src/overlay.js`      | keyboard callouts, end card                               |
| `src/timeline.js`     | keyframe sampling                                         |
| `render/`             | Playwright frame grabber + ffmpeg encoders                |

## Preview

```bash
npm run video:preview     # opens http://127.0.0.1:5174/video/
```

Add `?t=13.4` to freeze on a beat, `?render=1` to park the clock entirely.

## Render

```bash
npm run video:render                    # every preset
npm run video:render -- --preset gif    # one preset
npm run video:render -- --still 13.4    # a single frame, for eyeballing
```

Output lands in `marketing/video/out/` (git-ignored — publish a cut by hand
once it's approved).

| Preset     | Delivered | fps | Range   | Files     | Use                       |
| ---------- | --------- | --- | ------- | --------- | ------------------------- |
| `master`   | 1920×1080 | 60  | 0–20s   | mp4, webm | YouTube / X, re-edits     |
| `hero`     | 2560×1440 | 30  | 0–16.2s | mp4, webm | landing demo band (loops) |
| `gif`      | 720×405   | 12  | 1–14.2s | gif       | GitHub README             |
| `vertical` | 1080×1920 | 30  | 0–20s   | mp4       | Product Hunt / social     |

`hero` and `gif` stop before the end card and fade in and out to black, so
they loop without a hard cut. The GIF is sized down hard on purpose — weight
is what decides whether a README embed is usable.

`hero` is the one preset that captures above what it delivers: viewport
1600×900 at `scale: 2`, resampled from 3200×1800 down to 2560×1440 (`output`
in `render/presets.js`). Its type is 12px inside a window that occupies ~71% of
the frame, so a 1:1 capture leaves a Retina display nothing to resolve — that
was the "why is the demo blurry" bug, not the bitrate.

**The 9:16 cut is not just a crop.** Pane transcripts are unreadable on a
phone, so below a 1:1 aspect ratio the frame grows a brand strip above the
window and a large caption below it (`VERTICAL_CAPTIONS` in `src/copy.js`),
and hides the small keyboard callouts. The window becomes evidence; the type
carries the story. All of it is CSS-gated on `max-aspect-ratio: 1/1`, so the
landscape cuts are untouched.

Requirements: `ffmpeg` on PATH (`brew install ffmpeg`) and a Playwright
Chromium in `~/Library/Caches/ms-playwright` (`npx playwright install
chromium`). The browser is deliberately not a project dependency — rendering
the film is a maintainer task, not something `npm ci` should pay for.

## Changing the film

- **Timing** — the `T` map at the top of `src/script.js` is the beat sheet.
  Move a beat there and every track that references it follows.
- **Words** — `src/copy.js`.
- **What the agents say** — `marketing/stage/stage-data.js`, shared with the
  landing hero.
- **The product name** — `marketing/stage/brand.js`, one constant.
