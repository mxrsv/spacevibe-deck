import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The migration to `lucide-preact` is only worth anything if it holds. Nothing
 * stops a later change from hand-drawing one more icon or typing one more
 * arrow into a button, and each of those is invisible in review — this test is
 * what makes them loud.
 *
 * It scans `.ts` as well as `.tsx`: `search-bar.ts` builds its controls with
 * imperative DOM, so "icons live in components" is a habit, not a guarantee.
 */

const pathFromFileUrl = (
  url: URL,
  windows = process.platform === "win32",
): string => fileURLToPath(url, { windows });

const normalizeRelativePath = (path: string): string =>
  path.replaceAll("\\", "/");

const SOURCE_ROOT = pathFromFileUrl(new URL("../src/", import.meta.url));

/**
 * The two SVGs that are not functional icons, with the count each file is
 * allowed. Counts matter as much as paths: a file on this list must not become
 * a place where a hand-drawn icon can hide.
 */
const ALLOWED_SVG: ReadonlyMap<string, number> = new Map([
  // The Deck brand mark. A logo is identity, not an icon in a system.
  ["open-board/open-board.tsx", 1],
  // The agent-pending ring: ticks positioned by hand and spun by CSS. No
  // library icon expresses it, and it is a status visual, not an action.
  ["ui/workspace-spinner.tsx", 1],
]);

/**
 * Characters that were doing an icon's job before the migration. Keyboard and
 * terminal notation is exempt — `⌘`, `⏎`, `⎋` and friends name keys, and a key
 * is not an action.
 */
const RETIRED_GLYPHS: ReadonlyArray<{ glyph: string; meant: string }> = [
  { glyph: "↩", meant: "inject/submit" },
  { glyph: "▾", meant: "disclosure" },
  { glyph: "‹", meant: "previous" },
  { glyph: "›", meant: "next" },
  { glyph: "×", meant: "remove/close" },
  { glyph: "＋", meant: "add" },
  { glyph: "↹", meant: "cycle" },
  { glyph: "↺", meant: "reset" },
];

/**
 * Files that legitimately contain a retired glyph as data rather than as an
 * icon — terminal output, stored strings, shortcut legends and the tests that
 * assert on them.
 */
const GLYPH_EXEMPT = (path: string): boolean =>
  path.endsWith(".test.ts") ||
  path.endsWith(".test.tsx") ||
  path === "lib/shortcut-label.ts" ||
  path === "terminal/link-provider.ts" ||
  path === "open-board/workspaces-store.ts" ||
  // Its tooltips spell the Enter key as `⇧↩` / `↩`. Same character as the
  // Prompt Board's retired inject glyph, opposite meaning — one names a key,
  // the other named an action. The Paste/Send icons are asserted directly in
  // `prompt-popover.test.tsx`, so nothing is lost by exempting this file.
  path === "terminal/search-bar.ts";

function sourceFiles(dir = SOURCE_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")
      ? [full]
      : [];
  });
}

const files = sourceFiles().map((full) => ({
  path: normalizeRelativePath(relative(SOURCE_ROOT, full)),
  text: readFileSync(full, "utf8"),
}));

describe("icon system", () => {
  it("converts Windows file URLs without duplicating the drive root", () => {
    expect(
      pathFromFileUrl(new URL("file:///D:/a/spacevibe-deck/src/"), true),
    ).toBe("D:\\a\\spacevibe-deck\\src\\");
  });

  it("normalizes Windows separators for platform-neutral allowlists", () => {
    expect(normalizeRelativePath("open-board\\open-board.tsx")).toBe(
      "open-board/open-board.tsx",
    );
  });

  it("finds source files at all — a silent empty scan would pass everything", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("authors no SVG outside the two documented exceptions", () => {
    const drawn = files
      .map(({ path, text }) => ({
        path,
        count: text.split("<svg").length - 1,
      }))
      .filter(({ count }) => count > 0);

    const unexpected = drawn.filter(
      ({ path, count }) => ALLOWED_SVG.get(path) !== count,
    );

    expect(
      unexpected.map(
        ({ path, count }) =>
          `${path}: ${count} <svg>, allowed ${ALLOWED_SVG.get(path) ?? 0}`,
      ),
    ).toEqual([]);
  });

  it("keeps every allowed exception alive, so the list cannot rot", () => {
    for (const path of ALLOWED_SVG.keys()) {
      expect(files.some((file) => file.path === path)).toBe(true);
    }
  });

  it("does not put a retired glyph back to work as an icon", () => {
    const offenders = files
      .filter(({ path }) => !GLYPH_EXEMPT(path))
      .flatMap(({ path, text }) =>
        RETIRED_GLYPHS.filter(({ glyph }) => text.includes(glyph)).map(
          ({ glyph, meant }) => `${path}: ${glyph} (${meant})`,
        ),
      );

    expect(offenders).toEqual([]);
  });
});
