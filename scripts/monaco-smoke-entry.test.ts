import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The packaged Monaco smoke harness is a verification artifact, not a product
 * route. These tests are what keep that sentence true: the application renderer
 * must not be able to reach `monaco-smoke-main.tsx`, the
 * shipping `index.html` graph must not reference the smoke page, and the host
 * must select it only under the explicit `DECK_MONACO_SMOKE=1` launch.
 */

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SOURCE_ROOT = join(REPO_ROOT, "src");

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

function specifiers(source: string): readonly string[] {
  return [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("packaged Monaco smoke graph isolation", () => {
  it("no application module imports the Monaco smoke entry", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SOURCE_ROOT)) {
      if (file.endsWith("monaco-smoke-main.tsx")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (specifiers(source).some((specifier) => specifier.includes("monaco-smoke"))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shipping index.html does not reference the smoke page", () => {
    const html = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
    expect(html).not.toContain("monaco-smoke");
  });

  it("only the dedicated Vite config builds the smoke graph", () => {
    const shipping = readFileSync(join(REPO_ROOT, "vite.config.ts"), "utf8");
    expect(shipping).not.toContain("monaco-smoke");
    const smoke = readFileSync(join(REPO_ROOT, "vite.monaco-smoke.config.mjs"), "utf8");
    expect(smoke).toContain('input: "monaco-smoke.html"');
    expect(smoke).toContain("dist-monaco-smoke-renderer");
  });

  it("the host loads the smoke page only behind DECK_MONACO_SMOKE=1", () => {
    const main = readFileSync(join(REPO_ROOT, "electron", "main.ts"), "utf8");
    expect(main).toContain('process.env.DECK_MONACO_SMOKE === "1"');
    // The smoke page is referenced exactly once, inside the MONACO_SMOKE branch,
    // and the normal path still loads the application renderer.
    expect(main.match(/monaco-smoke\.html/g)).toHaveLength(1);
    expect(main).toContain('path.join(RENDERER_DIR, "index.html")');
  });
});
