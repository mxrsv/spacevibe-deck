import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OXLINT = fileURLToPath(new URL("../../node_modules/oxlint/bin/oxlint", import.meta.url));
const PLUGIN = fileURLToPath(new URL("./index.mjs", import.meta.url));
const SOURCE = /\.[cm]?[jt]sx?$/;

export interface Finding {
  readonly line: number;
  readonly message: string;
}

interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly filename: string;
  readonly labels: ReadonlyArray<{ readonly span: { readonly line: number } }>;
}

/**
 * Runs the real oxlint once over every fixture with one `deck/` rule switched on and
 * returns that rule's findings per fixture name. One process per call keeps the suite
 * cheap enough for the pre-push hook.
 */
export function lintFixtures(
  rule: string,
  fixtures: Readonly<Record<string, string>>,
): Record<string, Finding[]> {
  const dir = mkdtempSync(join(tmpdir(), "deck-oxlint-"));
  try {
    for (const [name, source] of Object.entries(fixtures)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), source);
    }
    const config = {
      jsPlugins: [PLUGIN],
      plugins: [],
      categories: { correctness: "off", suspicious: "off", perf: "off" },
      rules: { [`deck/${rule}`]: "error" },
    };
    writeFileSync(join(dir, "oxlintrc.json"), JSON.stringify(config));
    // A fixture that is not source, such as a rule's data file, is written but not linted.
    const sources = Object.keys(fixtures).filter((name) => SOURCE.test(name));
    const args = [OXLINT, "-c", "oxlintrc.json", "-f", "json", ...sources];
    let stdout: string;
    try {
      stdout = execFileSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
    } catch (error) {
      // oxlint exits 1 when it reports an error; the JSON report is complete either way.
      stdout = (error as { stdout: string }).stdout;
    }
    const { diagnostics } = JSON.parse(stdout) as { diagnostics: Diagnostic[] };
    const findings: Record<string, Finding[]> = Object.fromEntries(
      sources.map((name) => [name, []]),
    );
    for (const diagnostic of diagnostics) {
      if (diagnostic.code !== `deck(${rule})`) continue;
      findings[diagnostic.filename]?.push({
        line: diagnostic.labels[0]?.span.line ?? 0,
        message: diagnostic.message,
      });
    }
    return findings;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
