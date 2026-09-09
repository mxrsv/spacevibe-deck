/**
 * The head tags and crawler files are hand-written HTML, which means nothing
 * type-checks them and a stray edit can drop a canonical or leave the declared
 * image size behind the file it names. This pins the parts that are only wrong
 * in production: an absolute URL that stopped being absolute, an `og:image`
 * pointing at a file nobody shipped, dimensions that disagree with the PNG,
 * and a sitemap that lists URLs the pages do not claim as canonical.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SITE = "https://deck.spacevibe.dev";

function read(relative) {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** One `<meta>` value, whichever attribute names it. */
function meta(html, name) {
  const pattern = new RegExp(
    `<meta\\s+(?:property|name)="${name}"\\s+content="([^"]*)"`,
    "s",
  );
  const inline = html.match(pattern);

  if (inline !== null) {
    return inline[1];
  }

  // Prettier breaks long tags across lines, attribute per line.
  const wrapped = html.match(
    new RegExp(`(?:property|name)="${name}"\\s+content="([^"]*)"`, "s"),
  );

  return wrapped === null ? null : wrapped[1];
}

/** Width and height straight out of the PNG's IHDR chunk. */
function pngSize(relative) {
  const bytes = readFileSync(fileURLToPath(new URL(relative, import.meta.url)));

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const PAGES = [
  { file: "../index.html", canonical: `${SITE}/`, title: "SpaceVibe Deck" },
  {
    file: "../changelog/index.html",
    canonical: `${SITE}/changelog`,
    title: "Changelog",
  },
];

describe.each(PAGES)("$file", ({ file, canonical, title }) => {
  const html = read(file);

  it("names one canonical URL, absolute", () => {
    const links = [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)];

    expect(links).toHaveLength(1);
    expect(links[0][1]).toBe(canonical);
  });

  it("carries the card a scraper reads", () => {
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "og:site_name")).toBe("SpaceVibe Deck");
    expect(meta(html, "og:url")).toBe(canonical);
    expect(meta(html, "og:title")).toContain(title);
    expect(meta(html, "og:description")).toBeTruthy();
    expect(meta(html, "twitter:card")).toBe("summary_large_image");
    expect(meta(html, "twitter:image")).toBe(meta(html, "og:image"));
  });

  it("points the card image at a shipped file, at its real size", () => {
    const url = meta(html, "og:image");

    expect(url.startsWith(`${SITE}/`)).toBe(true);

    const size = pngSize("../assets/og-cover.png");

    expect(url).toBe(`${SITE}/landing-prototype/assets/og-cover.png`);
    expect(Number(meta(html, "og:image:width"))).toBe(size.width);
    expect(Number(meta(html, "og:image:height"))).toBe(size.height);
    // Open Graph and Twitter both want 1.91:1, and both have a 1200px floor.
    expect(size.width / size.height).toBeCloseTo(1.91, 2);
    expect(size.width).toBeGreaterThanOrEqual(1200);
  });

  it("lets crawlers in and states a theme colour", () => {
    expect(meta(html, "robots")).toContain("index");
    expect(meta(html, "theme-color")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("crawler files", () => {
  it("robots.txt points at the sitemap by absolute URL", () => {
    expect(read("../robots.txt")).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it("the sitemap lists exactly the pages' own canonical URLs", () => {
    const listed = [...read("../sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );

    expect(listed.sort()).toEqual(PAGES.map((page) => page.canonical).sort());
  });

  it("ships the touch icon the pages link", () => {
    const icon = pngSize("../assets/apple-touch-icon.png");

    expect(icon.width).toBe(icon.height);
    expect(icon.width).toBeGreaterThanOrEqual(180);
  });
});
