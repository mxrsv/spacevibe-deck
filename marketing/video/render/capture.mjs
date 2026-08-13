/**
 * Frame grabber — drives the page's virtual clock and screenshots each frame.
 *
 * No real time passes during a capture: the page is loaded with `?render=1`,
 * which parks its rAF loop, and every frame is produced by seeking to an
 * exact timestamp. Re-running this produces byte-identical frames.
 */

import { existsSync, readdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright-core";

/**
 * Locate the newest headless-shell already on this machine. Keeping the
 * browser out of the repo's install step is deliberate — rendering the film
 * is a maintainer task, not something `npm ci` should pay for.
 */
export function findChromium() {
  // PLAYWRIGHT_BROWSERS_PATH wins when set — CI and cloud sessions install
  // there; the maintainer's Mac keeps its default per-user cache.
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    join(homedir(), "Library", "Caches", "ms-playwright");

  if (!existsSync(root)) {
    throw new Error(
      `No Playwright browser cache at ${root}. Run "npx playwright install chromium" first.`,
    );
  }

  const shells = [
    ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
    ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chrome-linux", "headless_shell"],
  ];
  const candidates = readdirSync(root)
    .filter((entry) => entry.startsWith("chromium_headless_shell-"))
    .sort()
    .reverse()
    .flatMap((entry) => shells.map((shell) => join(root, entry, ...shell)))
    .filter((path) => existsSync(path));

  if (candidates.length === 0) {
    throw new Error(
      `No chrome-headless-shell found under ${root}. Run "npx playwright install chromium".`,
    );
  }

  return candidates[0];
}

/**
 * @param {object} options
 * @param {string} options.url page to capture, without query params
 * @param {{ width: number, height: number, fps: number, scale: number,
 *   range: [number, number] }} options.preset
 * @param {string} options.framesDir
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{ frameCount: number, framesDir: string }>}
 */
export async function captureFrames({ url, preset, framesDir, onProgress }) {
  const [start, end] = preset.range;

  if (end <= start) {
    throw new Error(`Preset range [${start}, ${end}] is empty.`);
  }

  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--force-color-profile=srgb", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: preset.width, height: preset.height },
      deviceScaleFactor: preset.scale,
      colorScheme: "dark",
      reducedMotion: "no-preference",
    });

    const errors = [];

    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });

    await page.goto(`${url}?render=1`, { waitUntil: "load" });
    await page.waitForFunction(
      () => document.documentElement.dataset.videoReady === "true",
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate(() => document.fonts.ready);

    if (errors.length > 0) {
      throw new Error(`Page reported errors:\n  ${errors.join("\n  ")}`);
    }

    const frameCount = Math.round((end - start) * preset.fps);

    for (let i = 0; i < frameCount; i += 1) {
      const t = start + i / preset.fps;

      await page.evaluate((time) => window.__deckVideo.seek(time), t);
      await page.screenshot({
        path: join(framesDir, `frame-${String(i).padStart(5, "0")}.png`),
        animations: "disabled",
      });

      onProgress?.(i + 1, frameCount);
    }

    if (errors.length > 0) {
      throw new Error(`Page reported errors:\n  ${errors.join("\n  ")}`);
    }

    return { frameCount, framesDir };
  } finally {
    await browser.close();
  }
}

/**
 * Grab a single frame — used for video posters and for eyeballing a beat.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {{ width: number, height: number, scale: number }} options.preset
 * @param {number} options.time
 * @param {string} options.outPath
 */
export async function captureStill({ url, preset, time, outPath }) {
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ["--force-color-profile=srgb", "--font-render-hinting=none"],
  });

  try {
    const page = await browser.newPage({
      viewport: { width: preset.width, height: preset.height },
      deviceScaleFactor: preset.scale,
      colorScheme: "dark",
    });

    await page.goto(`${url}?render=1`, { waitUntil: "load" });
    await page.waitForFunction(
      () => document.documentElement.dataset.videoReady === "true",
      undefined,
      { timeout: 15_000 },
    );
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate((t) => window.__deckVideo.seek(t), time);
    await page.screenshot({ path: outPath, animations: "disabled" });
  } finally {
    await browser.close();
  }
}
