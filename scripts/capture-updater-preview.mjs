import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const OUTPUT_DIR = "/tmp/spacevibe-deck-updater-preview";
const STATES = ["available", "downloading", "downloaded", "download-failed"];
const LAYOUTS = ["top", "sidebar"];
const VIEWPORTS = [
  { name: "wide", width: 1100, height: 720 },
  { name: "compact", width: 480, height: 320 },
];

function baseUrl(argv) {
  const index = argv.indexOf("--base-url");
  const value = index === -1 ? undefined : argv[index + 1];
  if (!value) {
    throw new Error("Missing --base-url");
  }
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Preview base URL must be local HTTP");
  }
  return url;
}

await mkdir(OUTPUT_DIR, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: "dark",
      reducedMotion: "reduce",
    });
    for (const layout of LAYOUTS) {
      for (const state of STATES) {
        const url = new URL(baseUrl(process.argv.slice(2)));
        url.searchParams.set("update-preview", state);
        url.searchParams.set("layout", layout);
        await page.goto(url.toString(), { waitUntil: "networkidle" });
        const button = page.locator(".update-action");
        await button.waitFor({ state: "visible" });
        const bounds = await button.boundingBox();
        if (
          bounds === null ||
          bounds.x < 0 ||
          bounds.x + bounds.width > viewport.width
        ) {
          throw new Error(`Update action overflows ${viewport.name}/${layout}/${state}`);
        }
        if (state === "available") {
          await button.focus();
          const outline = await button.evaluate((element) => {
            const style = getComputedStyle(element);
            return { width: style.outlineWidth, style: style.outlineStyle };
          });
          if (outline.width !== "2px" || outline.style === "none") {
            throw new Error("Update action focus ring is not visible");
          }
        }
        const output = resolve(
          OUTPUT_DIR,
          `${viewport.name}-${layout}-${state}.png`,
        );
        await page.screenshot({ path: output, fullPage: true });
        console.log(output);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
