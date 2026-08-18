import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverClaude } from './discover';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureHome(): string {
  const home = mkdtempSync(path.join(tmpdir(), 'usage-discover-'));
  temps.push(home);
  return home;
}

function write(home: string, rel: string): string {
  const target = path.join(home, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, '{}\n');
  return target;
}

describe('discoverClaude', () => {
  it('reaches subagent transcripts nested under subagents/workflows/<id>/', () => {
    const home = fixtureHome();
    const session = write(home, '.claude/projects/proj-a/session-1.jsonl');
    const flat = write(home, '.claude/projects/proj-a/session-3/subagents/agent-1.jsonl');
    const nested = write(
      home,
      '.claude/projects/proj-a/session-3/subagents/workflows/wf-1/agent-2.jsonl',
    );

    const found = discoverClaude(home);
    expect(found.state).toBe('present');
    expect(found.files).toEqual([session, flat, nested]);
  });

  it('treats a project without a subagents directory as present, not unreadable', () => {
    const home = fixtureHome();
    const session = write(home, '.claude/projects/proj-a/session-1.jsonl');

    const found = discoverClaude(home);
    expect(found.state).toBe('present');
    expect(found.files).toEqual([session]);
  });
});
