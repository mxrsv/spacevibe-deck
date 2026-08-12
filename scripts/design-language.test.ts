import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// `URL.pathname` yields `/C:/…` on Windows, which `readFileSync` cannot open;
// `scripts/gallery-entry.test.ts` learned this first.
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const RULEBOOK = join(ROOT, "docs/DESIGN-LANGUAGE.md");
const SCANNED_DIRS = ["src", "electron", "scripts"];
const SCANNED_EXT = /\.(ts|tsx|css)$/;
const SECTION = /^## (\d+)\. (.+)$/gm;
const RULE = /\*\*DL-(\d+)\.(\d+)\*\*/g;
const CITATION = /DL-(\d+)(?:\.(\d+))?/g;
/**
 * The other spelling this repo uses — `DL §17`, `DESIGN-LANGUAGE §19`. The
 * rulebook prefix is required: a bare `§7` cites a spec, a plan or a review far
 * more often than it cites this document, and there is no way to tell which
 * from the digits. Citing DL by section therefore means naming DL.
 */
const SECTION_CITATION =
  /(?:DL|DESIGN-LANGUAGE(?:\.md)?)\s*§\s*(\d+)(?:\.(\d+))?/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "node_modules" || entry === "dist") return [];
    // The gate's own regex literals are not citations.
    if (entry === "design-language.test.ts") return [];
    if (statSync(path).isDirectory()) return walk(path);
    return SCANNED_EXT.test(entry) ? [path] : [];
  });
}

function declared(): { sections: Set<string>; rules: Set<string> } {
  const text = readFileSync(RULEBOOK, "utf8");
  const sections = new Set<string>();
  for (const match of text.matchAll(SECTION)) sections.add(match[1]);
  const rules = new Set<string>();
  for (const match of text.matchAll(RULE)) rules.add(`${match[1]}.${match[2]}`);
  return { sections, rules };
}

describe("design-language citations", () => {
  it("declares every section number exactly once", () => {
    const text = readFileSync(RULEBOOK, "utf8");
    const numbers = [...text.matchAll(SECTION)].map((m) => m[1]);
    const duplicates = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    expect(duplicates).toEqual([]);
  });

  it("scans a non-empty set of files", () => {
    const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(100);
  });

  it("resolves every cited rule to a declared rule or section", () => {
    const { sections, rules } = declared();
    const spellings = [
      { pattern: CITATION, prefix: "DL-" },
      { pattern: SECTION_CITATION, prefix: "DL §" },
    ] as const;
    const unresolved: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const { pattern, prefix } of spellings) {
          for (const match of text.matchAll(pattern)) {
            const id = match[2] ? `${match[1]}.${match[2]}` : match[1];
            const ok = match[2] ? rules.has(id) : sections.has(id);
            if (!ok)
              unresolved.push(`${file.replace(ROOT, "")}: ${prefix}${id}`);
          }
        }
      }
    }
    expect(unresolved).toEqual([]);
  });
});
