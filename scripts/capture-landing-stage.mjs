/* oxlint-disable eslint/no-console -- CLI tooling: stdout is the interface */
/**
 * Gate 2 of `docs/plans/2026-08-20-landing-stage-redesign.md` — shoot the
 * landing's app stage at three widths, twice.
 *
 * It serves the BUILT `marketing/landing-prototype/dist` over a throwaway
 * loopback server (the built bundle is what a visitor gets; `npm run dev`
 * proves nothing about it), then captures the hero and each of the six tour
 * panels at 1440 / 768 / 390 with motion allowed and again with
 * `prefers-reduced-motion: reduce` emulated — which is gate 4's visual layer,
 * produced in the same run.
 *
 * Measurements travel with the images: every shot writes one row into
 * `report.json`, and the page-level checks (no horizontal overflow, no rail
 * text under the 9px floor, the 390px rail/pane arithmetic) print a pass/fail
 * line each rather than an impression.
 *
 * Usage:
 *   npm run build:landing
 *   node scripts/capture-landing-stage.mjs [--out DIR] [--widths 1440,768,390]
 *
 * Requires a headless Chromium already on the machine — the same one the film
 * renderer uses, resolved by `findChromium()` from
 * `marketing/video/render/capture.mjs`. Nothing here re-implements that
 * lookup. If the binary is absent the gate is OWED, and the fallback is
 * `npm run prototype:landing` in the owner's own browser at the three widths.
 */

import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

import { chromium } from "playwright-core";

import { findChromium } from "../marketing/video/render/capture.mjs";

const DIST = resolve(import.meta.dirname, "../marketing/landing-prototype/dist");
const PAGE = "/landing-prototype/index.html";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

/** The rail's smallest type. T17's floors are `max(Ncqw, 9px)`. */
const RAIL_TYPE = [
  ".a-appwin__clustername",
  ".a-appwin__leafmsg",
  ".a-appwin__rowmsg",
  ".a-appwin__leafage",
  ".a-appwin__rowage",
  ".a-appwin__chiplabel",
];

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? fallback : process.argv[index + 1];
}

/**
 * Serve `dist` and nothing else. A path that escapes the root 404s rather
 * than reading up the tree.
 */
function serveDist() {
  const server = createServer(async (request, response) => {
    let path = decodeURIComponent(request.url.split("?")[0]);

    if (path.endsWith("/")) {
      path += "index.html";
    }

    const file = join(DIST, normalize(path));

    if (!file.startsWith(DIST)) {
      response.writeHead(403).end("forbidden");
      return;
    }

    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("not found");
    }
  });

  return new Promise((done) => {
    server.listen(0, "127.0.0.1", () => done(server));
  });
}

/**
 * Reveal every panel without waiting on the scroll observer, then let the
 * scene reveals and the hero's own stream settle. The panels are hidden until
 * `.is-revealed` lands, so a capture that only scrolls races the observer.
 */
async function revealAll(page) {
  await page.evaluate(() => {
    for (const panel of document.querySelectorAll(".panel")) {
      panel.classList.add("is-revealed", "is-visible");
    }
  });
  await page.waitForTimeout(2600);
}

/** One shot of one element, with its box recorded beside the file. */
async function shoot(page, selector, file, label) {
  const element = await page.$(selector);

  if (element === null) {
    console.log(`  MISSING  ${label} (${selector})`);
    return null;
  }

  await element.scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  await element.screenshot({ path: file });

  const box = await element.boundingBox();

  return {
    label,
    file,
    width: Number(box.width.toFixed(1)),
    height: Number(box.height.toFixed(1)),
  };
}

/**
 * The checks worth failing on. Each returns a `{ name, ok, detail }` row so
 * the run prints a verdict rather than a picture to squint at.
 */
async function measure(page, width) {
  return page.evaluate(
    ({ viewportWidth, railType }) => {
      const rows = [];
      const px = (value) => Number.parseFloat(value);
      const box = (selector) => {
        const element = document.querySelector(selector);

        return element === null ? null : element.getBoundingClientRect();
      };

      // R13 / the AGENTS.md trap: a one-pixel overflow inside a scroll
      // container moves the whole shell the first time focus lands in it.
      const scrollWidth = document.documentElement.scrollWidth;
      rows.push({
        name: "no horizontal page overflow",
        ok: scrollWidth <= window.innerWidth,
        detail: `scrollWidth ${scrollWidth} <= innerWidth ${window.innerWidth}`,
      });

      // The rail's own box must not scroll either — that is where a long
      // sentence would push out rather than ellipsize.
      const rails = [...document.querySelectorAll(".a-appwin__rail")];
      const spilling = rails.filter((rail) => rail.scrollWidth > rail.clientWidth + 1);
      rows.push({
        name: "no rail scrolls sideways",
        ok: spilling.length === 0,
        detail: `${rails.length} rails, ${spilling.length} overflowing`,
      });

      // T17's floors. 768 is the WORST legibility case, not 390: the
      // breakpoint is 47.5rem = 760px, so 768 sits above it and gets none of
      // the narrow rules.
      const sized = railType.flatMap((selector) =>
        [...document.querySelectorAll(selector)].map((node) => ({
          selector,
          size: px(getComputedStyle(node).fontSize),
        })),
      ).filter((entry) => Number.isFinite(entry.size));
      const smallest = sized.reduce(
        (low, entry) => (entry.size < low.size ? entry : low),
        sized[0] ?? { selector: "—", size: Number.NaN },
      );
      const floor = viewportWidth >= 760 ? 9 : 7;
      rows.push({
        name: `no rail text under ${floor}px`,
        ok: sized.length > 0 && smallest.size >= floor - 0.01,
        detail: `smallest ${smallest.size}px on ${smallest.selector} (${sized.length} nodes)`,
      });

      // The 390 arithmetic the plan states: .a-appwin is ~298.4px there, so
      // 42cqw is ~125.3px of rail and ~172px for the single pane.
      const hero = box(".direction-a .a-appwin");
      const heroRail = box(".direction-a .a-appwin__rail");
      const heroGrid = box(".direction-a .a-appwin__grid");
      rows.push({
        name: "hero rail and pane hold their share",
        ok:
          heroRail !== null &&
          heroGrid !== null &&
          (viewportWidth !== 390 || (heroRail.width >= 120 && heroGrid.width >= 165)),
        detail:
          heroRail === null
            ? "no hero rail"
            : `appwin ${hero.width.toFixed(1)} · rail ${heroRail.width.toFixed(1)} · grid ${heroGrid.width.toFixed(1)}`,
      });

      // No scene text may wrap out of its panel. A panel's window mock is the
      // clipping box; anything wider than it is off the drawing.
      const clipped = [];
      for (const panel of document.querySelectorAll(".panel")) {
        const win = panel.querySelector(".a-appwin");

        if (win === null) {
          continue;
        }

        const frame = win.getBoundingClientRect();

        for (const node of panel.querySelectorAll(".scene *")) {
          const rect = node.getBoundingClientRect();

          if (rect.width === 0 || rect.height === 0) {
            continue;
          }

          if (rect.right > frame.right + 1 || rect.left < frame.left - 1) {
            clipped.push(`${panel.dataset.scene}:${node.className}`);
          }
        }
      }
      rows.push({
        name: "no scene content escapes its window",
        ok: clipped.length === 0,
        detail: clipped.length === 0 ? "clean" : [...new Set(clipped)].slice(0, 6).join(", "),
      });

      // Panel 6's longest command is the densest single string in the tour.
      const commands = [...document.querySelectorAll(".scene-catalog__command")].map((node) => ({
        text: node.textContent.trim(),
        lines: Math.round(
          node.getBoundingClientRect().height / px(getComputedStyle(node).lineHeight || "0") || 1,
        ),
      }));
      const wrapped = commands.filter((entry) => entry.lines > 1);
      rows.push({
        name: "every catalog command stays on one line",
        ok: commands.length > 0 && wrapped.length === 0,
        detail: `${commands.length} commands, ${wrapped.length} wrapped`,
      });

      // The hero's stream hooks, counted where they actually render.
      rows.push({
        name: "the hero's rail and chip hooks exist",
        ok:
          document.querySelectorAll(".direction-a [data-tail]").length === 4 &&
          document.querySelectorAll(".direction-a [data-dot]").length === 3,
        detail: `${document.querySelectorAll(".direction-a [data-tail]").length} tails · ${document.querySelectorAll(".direction-a [data-dot]").length} dots`,
      });

      return {
        rows,
        rail: heroRail === null ? null : Number(heroRail.width.toFixed(1)),
        appwin: hero === null ? null : Number(hero.width.toFixed(1)),
        grid: heroGrid === null ? null : Number(heroGrid.width.toFixed(1)),
        tails: [...document.querySelectorAll(".direction-a [data-tail]")].map((node) =>
          node.textContent.trim(),
        ),
        states: [...document.querySelectorAll(".direction-a [data-dot]")].map(
          (node) => node.dataset.state,
        ),
      };
    },
    { viewportWidth: width, railType: RAIL_TYPE },
  );
}

/* ------------------------------------------------------------------ */

if (!existsSync(join(DIST, "landing-prototype/index.html"))) {
  throw new Error(`No built landing at ${DIST}. Run "npm run build:landing" first.`);
}

const outDir = resolve(flag("out", "/tmp/spacevibe-deck-landing-stage"));
const widths = String(flag("widths", "1440,768,390"))
  .split(",")
  .map(Number);

await mkdir(outDir, { recursive: true });

const server = await serveDist();
const { port } = server.address();
const executablePath = findChromium();

console.log(`chromium: ${executablePath}`);
console.log(`serving:  ${DIST}`);
console.log(`output:   ${outDir}\n`);

const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--force-color-profile=srgb", "--font-render-hinting=none"],
});

const report = [];
let failures = 0;

try {
  for (const motion of ["no-preference", "reduce"]) {
    for (const width of widths) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: "dark",
        reducedMotion: motion === "reduce" ? "reduce" : "no-preference",
      });

      await page.goto(`http://127.0.0.1:${port}${PAGE}`, { waitUntil: "networkidle" });
      await revealAll(page);

      const tag = motion === "reduce" ? "reduced" : "motion";
      const shots = [];

      console.log(`── ${width}px · prefers-reduced-motion: ${motion}`);

      shots.push(await shoot(page, ".direction-a .a-appwin", join(outDir, `hero-${width}-${tag}.png`), "hero"));

      for (const panel of await page.$$("article.panel")) {
        const scene = await panel.evaluate((node) => node.dataset.scene);
        const file = join(outDir, `panel-${scene}-${width}-${tag}.png`);

        await panel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);

        const win = await panel.$(".a-appwin");
        await win.scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        await win.screenshot({ path: file });

        const box = await win.boundingBox();
        shots.push({
          label: `panel:${scene}`,
          file,
          width: Number(box.width.toFixed(1)),
          height: Number(box.height.toFixed(1)),
        });
      }

      const measured = await measure(page, width);

      for (const row of measured.rows) {
        console.log(`  ${row.ok ? "PASS" : "FAIL"}  ${row.name} — ${row.detail}`);

        if (!row.ok) {
          failures += 1;
        }
      }

      console.log(
        `  rail sentences: ${measured.tails.map((t) => JSON.stringify(t.slice(0, 34))).join(", ")}`,
      );
      console.log(`  dot states:     ${measured.states.join(", ")}\n`);

      report.push({ width, motion, shots: shots.filter(Boolean), ...measured });
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

await writeFile(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log(`${report.reduce((n, run) => n + run.shots.length, 0)} images + report.json in ${outDir}`);

if (failures > 0) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exitCode = 1;
}
