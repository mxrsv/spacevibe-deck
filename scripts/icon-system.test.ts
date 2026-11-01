import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The migration to one icon library is only worth anything if it holds. Icons have outlived two
 * libraries already — `lucide-preact` until 2026-08-09, `@phosphor-icons/react` since — and a third
 * is arriving surface by surface: the new shell draws Hugeicons through `DeckIcon`, and Phosphor
 * stays only in surfaces not yet cut over (DL-14.1). So this test holds the package boundary of
 * each half as well as the rule that icons come from a package at all. Nothing stops a later
 * change from hand-drawing one more icon or typing one more arrow into a button, and each of
 * those is invisible in review — this test is what makes them loud.
 *
 * It scans `.ts` as well as `.tsx`: `search-bar.ts` builds its controls with
 * imperative DOM, so "icons live in components" is a habit, not a guarantee.
 */

const pathFromFileUrl = (url: URL, windows = process.platform === "win32"): string =>
  fileURLToPath(url, { windows });

const normalizeRelativePath = (path: string): string => path.replaceAll("\\", "/");

const SOURCE_ROOT = pathFromFileUrl(new URL("../src/", import.meta.url));

/**
 * The SVG that is not a functional icon, with the count its file is
 * allowed. Counts matter as much as paths: a file on this list must not become
 * a place where a hand-drawn icon can hide.
 */
const ALLOWED_SVG: ReadonlyMap<string, number> = new Map([
  // The agent-pending ring: ticks positioned by hand and spun by CSS. No
  // library icon expresses it, and it is a status visual, not an action.
  ["ui/workspace-spinner.tsx", 1],
  // A limit's remaining share, drawn from a live number. No library icon has a
  // value, and it is a status visual, not an action.
  ["ui/blocks/usage-ring.tsx", 1],
  // The single-colour agent marks, inlined by design review F1 (2026-09-18).
  // Their assets are `fill="#fff"`, so as an `<img>` they vanished on the light
  // theme; an inline `<svg fill="currentColor">` follows the chrome tone
  // (DL-2.2) without a `filter` (DL-1.3). Brand marks, not action icons.
  ["lib/agent-logos.ts", 1],
  ["ui/controls/agent-glyph.tsx", 1],
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
  path === "terminal/search-bar.ts" ||
  // Sample terminal transcripts: `›` is Codex's own prompt in PTY text, not a UI icon.
  path === "gallery/layout-mocks/layout-fixture.ts";

/** The one module that renders a Hugeicons glyph, so the stroke and the a11y attributes live once. */
const GLYPH_RENDERER = "ui/controls/deck-icon.tsx";

/**
 * Files that import `@hugeicons/react` without going through `DeckIcon`. The layout mocks are the
 * gallery's specimens of the shell; they are not shipping UI and they set their own stroke.
 */
const HUGEICONS_REACT_EXEMPT = (path: string): boolean => path.startsWith("gallery/");

/**
 * The cut-over set: surfaces that now draw Hugeicons only. A path ending in `/` is a directory,
 * anything else is a file. A surface joins this list in the change that converts it; a shared
 * file that an old surface still renders (`font-row`, `logo-row`, `github-star-button`, the
 * space bar's shipped caret) stays out until that surface is cut over.
 */
const HUGEICONS_ONLY: readonly string[] = [
  "ui/project-rail/",
  "ui/agent-dock/",
  "ui/command-settings/",
  "ui/blocks/",
  "terminal/pane-agent-header.tsx",
  // The preset controls' own chevrons, checks and close glyphs.
  "ui/controls/button.tsx",
  "ui/controls/select.tsx",
  "ui/controls/dropdown-menu.tsx",
  "ui/controls/dialog.tsx",
  "ui/controls/sheet.tsx",
];

const inCutOverSet = (path: string): boolean =>
  HUGEICONS_ONLY.some((entry) => (entry.endsWith("/") ? path.startsWith(entry) : path === entry));

function sourceFiles(dir = SOURCE_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    return entry.name.endsWith(".tsx") || entry.name.endsWith(".ts") ? [full] : [];
  });
}

const files = sourceFiles().map((full) => ({
  path: normalizeRelativePath(relative(SOURCE_ROOT, full)),
  text: readFileSync(full, "utf8"),
}));

describe("icon system", () => {
  it("converts Windows file URLs without duplicating the drive root", () => {
    expect(pathFromFileUrl(new URL("file:///D:/a/spacevibe-deck/src/"), true)).toBe(
      "D:\\a\\spacevibe-deck\\src\\",
    );
  });

  it("normalizes Windows separators for platform-neutral allowlists", () => {
    expect(normalizeRelativePath("open-board\\open-board.tsx")).toBe("open-board/open-board.tsx");
  });

  it("finds source files at all — a silent empty scan would pass everything", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("authors no SVG outside the documented exceptions", () => {
    const drawn = files
      .map(({ path, text }) => ({
        path,
        count: text.split("<svg").length - 1,
      }))
      .filter(({ count }) => count > 0);

    const unexpected = drawn.filter(({ path, count }) => ALLOWED_SVG.get(path) !== count);

    expect(
      unexpected.map(
        ({ path, count }) => `${path}: ${count} <svg>, allowed ${ALLOWED_SVG.get(path) ?? 0}`,
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

  it("renders Hugeicons only through DeckIcon", () => {
    const offenders = files
      .filter(({ path }) => path !== GLYPH_RENDERER && !HUGEICONS_REACT_EXEMPT(path))
      .filter(({ text }) => text.includes("@hugeicons/react"))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps Phosphor out of every surface that has been cut over to Hugeicons", () => {
    const cutOver = files.filter(({ path }) => inCutOverSet(path));
    // A silently empty set would pass everything.
    expect(cutOver.length).toBeGreaterThan(30);

    const offenders = cutOver
      .filter(({ text }) => text.includes("@phosphor-icons/react"))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("keeps every cut-over entry pointing at something", () => {
    for (const entry of HUGEICONS_ONLY) {
      expect(files.some(({ path }) => inCutOverSet(path) && path.startsWith(entry))).toBe(true);
    }
  });
});
