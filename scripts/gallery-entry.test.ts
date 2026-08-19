/* oxlint-disable jest/valid-expect, vitest/valid-expect -- vitest expect() takes a failure message as its second argument */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The gallery is a design harness, not a feature, and its whole cost argument
 * is that it ships nothing: `vite build` walks the root `index.html` graph
 * only, so a second entry costs the app bundle zero bytes.
 *
 * That holds exactly as long as no app module imports gallery code. One
 * `import { Specimen } from "../gallery/specimen"` inside a real component
 * would quietly pull the harness — its stub IPC, its seed data, its CSS — into
 * the shipped bundle, and nothing else in this repo would notice. This test is
 * what notices.
 *
 * It also pins the direction of the dependency the other way round: the
 * gallery may import app code freely, because rendering the real components is
 * the entire point.
 */

const pathFromFileUrl = (url: URL, windows = process.platform === "win32"): string =>
  fileURLToPath(url, { windows });

const REPO_ROOT = pathFromFileUrl(new URL("../", import.meta.url));
const SOURCE_ROOT = join(REPO_ROOT, "src");
const GALLERY_DIR = "gallery/";

const normalize = (path: string): string => path.replaceAll("\\", "/");

function sourceFiles(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/** Every `from "…"` specifier in a file, import or re-export alike. */
function specifiers(source: string): readonly string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("the gallery entry stays out of the app bundle", () => {
  it("is reachable: gallery.html points at the gallery entry module", () => {
    const html = readFileSync(join(REPO_ROOT, "gallery.html"), "utf8");
    expect(html).toContain("/src/gallery/main.tsx");
  });

  it("is not the app entry: index.html still points at the app", () => {
    const html = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
    expect(html).toContain("/src/main.tsx");
    expect(html).not.toContain("gallery");
  });

  it("no app module imports anything from src/gallery/", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SOURCE_ROOT)) {
      const rel = normalize(relative(SOURCE_ROOT, file));
      if (rel.startsWith(GALLERY_DIR)) {
        continue;
      }
      for (const specifier of specifiers(readFileSync(file, "utf8"))) {
        if (normalize(specifier).includes("/gallery/")) {
          offenders.push(`${rel} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has a script that serves it on its own port", () => {
    const pkg: unknown = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    const scripts =
      typeof pkg === "object" && pkg !== null && "scripts" in pkg
        ? (pkg as { scripts: Record<string, string> }).scripts
        : {};
    expect(scripts["prototype:gallery"]).toContain("/gallery.html");
    // A shared port would make the gallery and `tauri dev` fight over 1420.
    expect(scripts["prototype:gallery"]).not.toContain("1420");
  });

  it("returns the Electron store load-state contract from the gallery host", () => {
    const host = readFileSync(join(SOURCE_ROOT, "gallery/host-stub.ts"), "utf8");
    const handler = host.match(/store_load:\s*\(args\)\s*=>\s*\{[\s\S]*?\n\s*\},/);

    expect(handler?.[0]).toContain('return { state: "ready", fresh: false };');
  });

  it("seeds Settings as ready without reading the user's real store", () => {
    const entry = readFileSync(join(SOURCE_ROOT, "gallery/main.tsx"), "utf8");

    expect(entry).toContain("settingsLoadState.value = LOAD_READY");
    expect(entry).not.toContain("initSettings(");
  });

  it("includes all three worktree-item directions in one review specimen", () => {
    const fixtures = readFileSync(join(SOURCE_ROOT, "gallery/chrome-fixtures.tsx"), "utf8");

    expect(fixtures).toContain("worktreeItemVariantsSpecimen");
    expect(fixtures).toContain('id: "compact"');
    expect(fixtures).toContain('id: "focus"');
    expect(fixtures).toContain('id: "agent"');
  });

  it("applies the selected woven banner treatment to the full shell specimen", () => {
    const banner = readFileSync(join(SOURCE_ROOT, "ui/sidebar-banner.tsx"), "utf8");

    expect(banner).toContain('class="sidebar-banner sidebar-banner--woven"');
  });

  it("fades the full shell banner from the visible sidebar surface", () => {
    const direction = readFileSync(join(SOURCE_ROOT, "gallery/chatgpt-direction.css"), "utf8");
    const styles = readFileSync(join(SOURCE_ROOT, "styles/02-shell.css"), "utf8");

    expect(direction).toContain("--sidebar-banner-fade-color: var(--gx-chat-app-under);");
    expect(styles).toContain("var(--sidebar-banner-fade-color, var(--sidebar-bg))");
  });

  it("keeps only selected candidates after a comparison round closes", () => {
    const chrome = readFileSync(join(SOURCE_ROOT, "gallery/sections/chrome-section.tsx"), "utf8");
    const navigation = readFileSync(
      join(SOURCE_ROOT, "gallery/sections/navigation-section.tsx"),
      "utf8",
    );
    const treatment = readFileSync(
      join(SOURCE_ROOT, "gallery/sections/treatment-direction-review.tsx"),
      "utf8",
    );
    const matrix = readFileSync(join(SOURCE_ROOT, "gallery/sections/matrix-section.tsx"), "utf8");

    expect(existsSync(join(SOURCE_ROOT, "gallery/worktree-navigation-variants.tsx"))).toBe(false);
    expect(existsSync(join(SOURCE_ROOT, "gallery/worktree-navigation-variants.css"))).toBe(false);
    expect(existsSync(join(SOURCE_ROOT, "gallery/hybrid-navigation-variants.tsx"))).toBe(false);
    expect(existsSync(join(SOURCE_ROOT, "gallery/hybrid-navigation-variants.css"))).toBe(false);
    expect(navigation).toContain("agentStatusRailSpecimen");
    expect(treatment).toContain("Native balanced");
    expect(treatment).not.toContain("Operator dense");
    expect(treatment).not.toContain("Calm focus");
    expect(matrix).toContain("NATIVE_BALANCED_TYPE_SCALE");
    expect(matrix).not.toContain("Current common");
    expect(matrix).not.toContain("High legibility");
    expect(chrome).toContain("Woven Flag");
    expect(chrome).not.toContain("Graphic Pattern");
    expect(chrome).not.toContain("Ambient Light");
  });

  it("mounts the shipping AgentRail in every current shell specimen", () => {
    const currentShells = [
      "gallery/sections/chrome-section.tsx",
      "gallery/sections/matrix-section.tsx",
      "gallery/sections/board-section.tsx",
    ];

    for (const path of currentShells) {
      const source = readFileSync(join(SOURCE_ROOT, path), "utf8");
      expect(source, path).toContain("agentRailNavigationSpecimen");
      expect(source, path).not.toContain("repositorySidebarSpecimen");
      expect(source, path).not.toContain("worktreeAgentPresenceSpecimen");
    }

    const gallery = readFileSync(join(SOURCE_ROOT, "gallery/gallery.tsx"), "utf8");
    expect(gallery).toContain("Deck Electron");
    expect(gallery).not.toContain("ChatGPT Desktop");

    const chrome = readFileSync(join(SOURCE_ROOT, "gallery/sections/chrome-section.tsx"), "utf8");
    expect(chrome).toContain("Current Electron target shell");
    expect(chrome).not.toContain("Shipping Electron shell");

    const fixtures = readFileSync(join(SOURCE_ROOT, "gallery/chrome-fixtures.tsx"), "utf8");
    expect(fixtures).toContain("promptsDisabled ?");
  });

  /**
   * The other half of the one-way rule, and the one the direction check above
   * cannot see: a gallery that imports app code is correct, but a gallery that
   * REIMPLEMENTS it is a second source of truth wearing the same numbers.
   *
   * Both duplications this pins were real. `muted-contrast-candidate.tsx` held
   * the 8 / 6 floors as a gallery-only proposal for as long as the proposal was
   * a proposal; `deriveChromeColors` applies them itself now, so a gallery copy
   * could only ever drift away from what ships. The type scale was four
   * literals in `matrix-section.tsx` while it was a candidate; it is `:root`
   * variables in `styles.css` now (DL-4.5), and the specimen has to read them
   * rather than restate them — otherwise the section that exists to show the
   * scale is the one place it can be wrong.
   */
  it("promotes a chosen candidate rather than keeping a second copy of it", () => {
    const matrix = readFileSync(join(SOURCE_ROOT, "gallery/sections/matrix-section.tsx"), "utf8");

    expect(existsSync(join(SOURCE_ROOT, "gallery/muted-contrast-candidate.tsx"))).toBe(false);
    expect(matrix).not.toContain("muted-contrast-candidate");
    expect(matrix).not.toContain("ContrastCandidate");
    // The type specimen aliases the shipping variables instead of sizing
    // itself, so the four numbers appear nowhere in gallery code.
    expect(matrix).toContain("var(--type-title)");
    expect(matrix).toContain("var(--type-micro)");
    for (const size of ["14px", "12.5", "11px", "10.5"]) {
      expect(matrix).not.toContain(size);
    }
    // Same rule for the contrast floors: `derive-colors.ts` exports the three
    // it enforces, so the ladder labels them with the constant rather than
    // with a number that could disagree with what the derivation used.
    expect(matrix).toContain("TEXT_PRIMARY_FLOOR");
    expect(matrix).toContain("TEXT_MUTED_FLOOR");
    expect(matrix).toContain("TEXT_FAINT_FLOOR");
    for (const literal of ["floor: 8", "floor: 6", "floor: 4.5"]) {
      expect(matrix).not.toContain(literal);
    }
  });
});
