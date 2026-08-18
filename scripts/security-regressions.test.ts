import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(target);
    }
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.includes('.test.') ? [target] : [];
  });
}

describe('terminal diagnostics', () => {
  it('never ships a raw keystroke network tap', () => {
    const terminalRoot = new URL('../src/terminal/', import.meta.url).pathname;
    const sources = sourceFiles(terminalRoot)
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');
    const pane = readFileSync(new URL('../src/terminal/pane.ts', import.meta.url), 'utf8');

    expect(sources).not.toContain('127.0.0.1:8792');
    expect(pane).not.toContain('installImeTrace');
    expect(pane).not.toContain('from "./ime-trace"');
  });
});
