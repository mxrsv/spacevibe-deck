# Deck — marketing assets

```
marketing/
├── stage/               shared app-window mock (chrome + data + brand)
├── video/               the marketing film — see video/README.md
└── landing-prototype/   the landing page prototype
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

`video/out/` is git-ignored. The landing no longer embeds the rendered film;
publish an approved cut directly to its destination instead of copying binary
outputs back into this repository.
