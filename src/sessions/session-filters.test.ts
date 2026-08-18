import { describe, expect, it } from 'vitest';
import { cappedAgents, distinctProjects, filterSessions } from './session-filters';
import type { SessionEntry } from '../lib/session-history';

function entry(over: Partial<SessionEntry>): SessionEntry {
  return {
    agent: 'claude',
    sessionId: 'id',
    cwd: '/work/a',
    lastActivityMs: 0,
    title: null,
    sourcePath: '/p',
    ...over,
  };
}

describe('filterSessions', () => {
  const entries = [
    entry({
      sessionId: '1',
      agent: 'claude',
      cwd: '/work/a',
      lastActivityMs: 30,
    }),
    entry({
      sessionId: '2',
      agent: 'codex',
      cwd: '/work/a',
      lastActivityMs: 20,
    }),
    entry({
      sessionId: '3',
      agent: 'codex',
      cwd: '/work/b',
      lastActivityMs: 10,
    }),
  ];

  it('passes everything through on all/null', () => {
    expect(filterSessions(entries, { agent: 'all', project: null })).toHaveLength(3);
  });

  it('filters by agent', () => {
    const out = filterSessions(entries, { agent: 'codex', project: null });
    expect(out.map((e) => e.sessionId)).toEqual(['2', '3']);
  });

  it('composes agent and project', () => {
    const out = filterSessions(entries, { agent: 'codex', project: '/work/a' });
    expect(out.map((e) => e.sessionId)).toEqual(['2']);
  });

  it('returns the same array instance semantics, never mutating the input', () => {
    const before = [...entries];
    filterSessions(entries, { agent: 'claude', project: null });
    expect(entries).toEqual(before);
  });
});

describe('distinctProjects', () => {
  it('lists each cwd once, most recently active first', () => {
    const out = distinctProjects([
      entry({ cwd: '/work/b', lastActivityMs: 10 }),
      entry({ cwd: '/work/a', lastActivityMs: 30 }),
      entry({ cwd: '/work/b', lastActivityMs: 40 }),
    ]);
    expect(out).toEqual(['/work/b', '/work/a']);
  });
});

describe('cappedAgents', () => {
  it('names only the agents whose candidates exceeded the cap', () => {
    expect(cappedAgents({ claude: 900, codex: 12 }, 500)).toEqual(['claude']);
    expect(cappedAgents({ claude: 4, codex: 12 }, 500)).toEqual([]);
  });
});
