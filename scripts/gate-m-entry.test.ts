import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Gate M's harness is a verification artifact, not a product route
 * (file-explorer plan §5.0.3). These tests are what keep that sentence true:
 * the application renderer must not be able to reach `gate-m-main.tsx`, the
 * shipping `index.html` graph must not reference the gate page, and the host
 * must select it only under the explicit `DECK_GATE_M=1` launch.
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

describe("gate-m graph isolation", () => {
  it("no application module imports the gate-m entry", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SOURCE_ROOT)) {
      if (file.endsWith("gate-m-main.tsx")) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (specifiers(source).some((specifier) => specifier.includes("gate-m"))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shipping index.html does not reference the gate page", () => {
    const html = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
    expect(html).not.toContain("gate-m");
  });

  it("only the dedicated Vite config builds the gate graph", () => {
    const shipping = readFileSync(join(REPO_ROOT, "vite.config.ts"), "utf8");
    expect(shipping).not.toContain("gate-m");
    const gate = readFileSync(join(REPO_ROOT, "vite.gate-m.config.mjs"), "utf8");
    expect(gate).toContain('input: "gate-m.html"');
    expect(gate).toContain("dist-gate-m-renderer");
  });

  it("the host loads the gate page only behind DECK_GATE_M=1", () => {
    const main = readFileSync(join(REPO_ROOT, "electron", "main.ts"), "utf8");
    expect(main).toContain('process.env.DECK_GATE_M === "1"');
    // The gate page is referenced exactly once, inside the GATE_M branch,
    // and the normal path still loads the application renderer.
    expect(main.match(/gate-m\.html/g)).toHaveLength(1);
    expect(main).toContain('path.join(RENDERER_DIR, "index.html")');
  });
});
