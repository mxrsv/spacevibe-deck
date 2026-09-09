/* oxlint-disable eslint/no-console -- CLI tooling: stdout is the interface */
/**
 * Shoot the two images the landing's <head> references but Vite cannot emit:
 * the Open Graph cover every shared link renders, and the Apple touch icon.
 *
 * Both are written into `marketing/landing-prototype/assets/`, which
 * `vite.build.mjs` mirrors verbatim into `dist`. That path matters: a meta tag
 * is not an asset attribute, so Vite never rewrites it — the URL in
 * `og:image` has to be one that survives the build unhashed.
 *
 * The cover is the REAL hero off the built bundle, not a drawing of it, for
 * the same reason the stage capture shoots `dist`: a hand-made card drifts the
 * first time the product does. Motion is pinned with `prefers-reduced-motion`,
 * which holds the hero's scene cycle on the agents frame (HERO_SCENES).
 *
 * Usage:
 *   npm run build:landing
 *   node scripts/capture-og-cover.mjs
 *
 * Requires the same headless Chromium the stage capture and the film renderer
 * use. Absent binary = the gate is OWED; there is no fallback that produces a
 * correct 1.91:1 image.
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { chromium } from "playwright-core";

import { serveLandingDist } from "./serve-landing-dist.mjs";

import { findChromium } from "../marketing/video/render/capture.mjs";

const ASSETS = resolve(import.meta.dirname, "../marketing/landing-prototype/assets");
const ICON = resolve(import.meta.dirname, "../marketing/stage/assets/deck-icon.svg");

/** The browser the shot is composed in. Not the output size — see CLIP. */
const VIEWPORT = { width: 1600, height: 838 };
/** The crop, in CSS pixels of the zoomed page. 1200x628 is Open Graph's own
 *  reference size and 1.91:1. SCALE is what the file multiplies that by, and
 *  the `og:image:width`/`height` tags state the product: 1800x942. Twice the
 *  reference size looks no sharper in any card and costs ~450 KB more on a
 *  fetch every scraper makes cold. */
const CLIP = { width: 1200, height: 628 };
const SCALE = 1.5;
/** Apple's home-screen icon. One size covers every current device. */
const TOUCH_ICON = 180;
/** Page zoom for the shot — see the call site. */
const ZOOM = 0.75;

const server = await serveLandingDist();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: findChromium() });

try {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    reducedMotion: "reduce",
  });

  await page.goto(`${origin}/landing-prototype/index.html`, {
    waitUntil: "networkidle",
  });
  await page.waitForSelector(".direction-a .a-appwin");
  // Zoom out so the headline AND the app window share the 1.91:1 frame. At 1x
  // the hero alone fills it and the product is a sliver at the bottom edge.
  await page.evaluate((zoom) => {
    document.documentElement.style.zoom = String(zoom);
  }, ZOOM);
  // The hero's transcripts stream in on their own clock; a shot taken at load
  // catches empty panes.
  await page.waitForTimeout(2600);

  // Centre the crop on the page's own content column rather than on the
  // viewport. The layout caps its width, so an off-centre crop puts the
  // headline off-axis and one black band twice the width of the other.
  const column = await page.evaluate(() => {
    const box = document.querySelector(".a-topbar").getBoundingClientRect();

    return { centre: box.left + box.width / 2 };
  });
  const clip = {
    x: Math.round(column.centre - CLIP.width / 2),
    y: 0,
    ...CLIP,
  };

  const cover = join(ASSETS, "og-cover.png");
  await page.screenshot({ path: cover, clip });
  console.log(`cover:  ${cover} (${CLIP.width * SCALE}x${CLIP.height * SCALE})`);

  // The touch icon is the app mark on its own, rendered from the same SVG the
  // favicon uses rather than a second drawing of it.
  const svg = await readFile(ICON, "utf8");
  const iconPage = await browser.newPage({
    viewport: { width: TOUCH_ICON, height: TOUCH_ICON },
    deviceScaleFactor: 2,
  });
  await iconPage.setContent(
    `<style>html,body{margin:0;padding:0}svg{display:block;width:${TOUCH_ICON}px;height:${TOUCH_ICON}px}</style>${svg}`,
  );

  const touchIcon = join(ASSETS, "apple-touch-icon.png");
  await iconPage.screenshot({ path: touchIcon });
  console.log(`icon:   ${touchIcon} (${TOUCH_ICON * 2}x${TOUCH_ICON * 2})`);
} finally {
  await browser.close();
  server.close();
}
