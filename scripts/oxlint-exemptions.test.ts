import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The lint config exempts legacy files by name while the preset migration moves them
 * (AGENTS.md R9). A name that no longer exists exempts nothing and hides that the list
 * should have shrunk, so every named exemption must still point at a file.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

interface Override {
  readonly files: readonly string[];
  readonly excludeFiles?: readonly string[];
}

interface Config {
  readonly settings: { readonly shadcn: { readonly ignoreImports: readonly string[] } };
  readonly overrides: readonly Override[];
}

// `.oxlintrc.json` allows whole-line `//` comments; JSON.parse does not.
const config = JSON.parse(
  readFileSync(`${ROOT}.oxlintrc.json`, "utf8").replace(/^\s*\/\/.*$/gm, ""),
) as Config;

const isGlob = (path: string): boolean => /[*?{[]/.test(path);

const namedExemptions = config.overrides.flatMap((override) =>
  (override.excludeFiles ?? []).filter((path) => !isGlob(path)),
);

// The pre-preset controls the restyle checks ignore, by module name.
const ignoredControls = config.settings.shadcn.ignoreImports
  .flatMap((pattern) => /controls\/\(([^)]+)\)/.exec(pattern)?.[1].split("|") ?? [])
  .sort();

const exemptedControls = namedExemptions
  .filter((path) => path.startsWith("src/ui/controls/"))
  .map((path) => path.slice("src/ui/controls/".length).replace(/\.tsx?$/, ""))
  .sort();

describe("oxlint exemptions", () => {
  it("finds the named exemptions at all — an empty list would pass everything", () => {
    expect(namedExemptions.length).toBeGreaterThan(0);
    expect(ignoredControls.length).toBeGreaterThan(0);
  });

  it.each(namedExemptions)("%s still exists", (path) => {
    expect(existsSync(`${ROOT}${path}`)).toBe(true);
  });

  it("ignores exactly the controls it exempts from the preset theme checks", () => {
    expect(ignoredControls).toEqual(exemptedControls);
  });
});
