import { readdirSync, readFileSync, statSync } from "node:fs";
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

const pathFromFileUrl = (
  url: URL,
  windows = process.platform === "win32",
): string => fileURLToPath(url, { windows });

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
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
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
    const pkg: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
    );
    const scripts =
      typeof pkg === "object" && pkg !== null && "scripts" in pkg
        ? (pkg as { scripts: Record<string, string> }).scripts
        : {};
    expect(scripts["prototype:gallery"]).toContain("/gallery.html");
    // A shared port would make the gallery and `tauri dev` fight over 1420.
    expect(scripts["prototype:gallery"]).not.toContain("1420");
  });
});
