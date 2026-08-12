import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = new URL("..", import.meta.url).pathname;
const RULEBOOK = join(ROOT, "docs/DESIGN-LANGUAGE.md");
const SCANNED_DIRS = ["src", "electron", "scripts"];
const SCANNED_EXT = /\.(ts|tsx|css)$/;
const SECTION = /^## (\d+)\. (.+)$/gm;
const RULE = /\*\*DL-(\d+)\.(\d+)\*\*/g;
const CITATION = /DL-(\d+)(?:\.(\d+))?/g;

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
    const unresolved: string[] = [];
    for (const dir of SCANNED_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(CITATION)) {
          const id = match[2] ? `${match[1]}.${match[2]}` : match[1];
          const ok = match[2] ? rules.has(id) : sections.has(id);
          if (!ok) unresolved.push(`${file.replace(ROOT, "")}: DL-${id}`);
        }
      }
    }
    expect(unresolved).toEqual([]);
  });
});
