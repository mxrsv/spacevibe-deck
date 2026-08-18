import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanClaude } from './claude';
import { scanCodex, CODEX_RESTORE_SCAN } from './codex';
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  CODEX_DIR,
  CODEX_ARCHIVED_DIR,
  CODEX_ROLLOUT_PREFIX,
  CODEX_SESSIONS_DIR,
  TRANSCRIPT_EXTENSION,
} from '../usage/model';

const T0 = Date.parse('2026-08-01T00:00:00Z');

function writeAt(filePath: string, contents: string, mtimeMs: number): void {
  writeFileSync(filePath, contents);
  utimesSync(filePath, mtimeMs / 1000, mtimeMs / 1000);
}

/** A `session_meta` line padded past 8 KiB, the way a real rollout's embedded
 *  base_instructions pads it (~18.6 KB measured, 2026-08-16). */
function codexMeta(id: string, cwd: string, source: unknown): string {
  return JSON.stringify({
    type: 'session_meta',
    payload: {
      id,
      cwd,
      source,
      base_instructions: { text: 'x'.repeat(12_000) },
    },
  });
}

describe('scanCodex', () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'sessions-scan-'));
    const live = path.join(home, CODEX_DIR, CODEX_SESSIONS_DIR, '2026', '08', '01');
    mkdirSync(live, { recursive: true });
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}cli${TRANSCRIPT_EXTENSION}`),
      [
        codexMeta('cli-id', '/work/repo', 'cli'),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'text',
                text: '<environment_context>ignore me</environment_context>',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'text', text: 'make the thing work' }],
          },
        }),
      ].join('\n'),
      T0 + 3000,
    );
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}exec${TRANSCRIPT_EXTENSION}`),
      codexMeta('exec-id', '/work/repo', 'exec'),
      T0 + 2000,
    );
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}sub${TRANSCRIPT_EXTENSION}`),
      codexMeta('sub-id', '/work/repo', { subagent: { depth: 1 } }),
      T0 + 1000,
    );
    // No `source` key at all — the shape `resolve.test.ts` already writes.
    writeAt(
      path.join(live, `${CODEX_ROLLOUT_PREFIX}legacy${TRANSCRIPT_EXTENSION}`),
      JSON.stringify({
        type: 'session_meta',
        payload: { id: 'legacy-id', cwd: '/work/repo' },
      }),
      T0 + 500,
    );
    const old = path.join(home, CODEX_DIR, CODEX_ARCHIVED_DIR);
    mkdirSync(old, { recursive: true });
    writeAt(
      path.join(old, `${CODEX_ROLLOUT_PREFIX}old${TRANSCRIPT_EXTENSION}`),
      codexMeta('old-id', '/work/repo', 'cli'),
      T0,
    );
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  // The shipped bug: an 8 KiB head cannot parse an 18 KB session_meta line.
  it('parses a session_meta line larger than 8 KiB', () => {
    const result = scanCodex(home, CODEX_RESTORE_SCAN);
    expect(result.records.map((r) => r.id)).toContain('cli-id');
  });

  it('drops exec and subagent rollouts when interactiveOnly is set', () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      interactiveOnly: true,
    });
    const ids = result.records.map((r) => r.id);
    expect(ids).toContain('cli-id');
    expect(ids).not.toContain('exec-id');
    expect(ids).not.toContain('sub-id');
  });

  // `resolve.test.ts`'s own codex fixture writes `payload: { id, cwd }` with
  // NO `source` at all (verified 2026-08-16, resolve.test.ts:98). A filter
  // that requires a known-good marker would delete that session and break a
  // test this task must keep green — so the filter names what to REJECT.
  it('keeps a rollout whose session_meta carries no source field', () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      interactiveOnly: true,
    });
    expect(result.records.map((r) => r.id)).toContain('legacy-id');
  });

  it('drops archived rollouts when includeArchived is false', () => {
    const result = scanCodex(home, {
      ...CODEX_RESTORE_SCAN,
      includeArchived: false,
    });
    expect(result.records.map((r) => r.id)).not.toContain('old-id');
  });

  it('keeps archived rollouts by default, as restore always has', () => {
    const result = scanCodex(home, CODEX_RESTORE_SCAN);
    expect(result.records.map((r) => r.id)).toContain('old-id');
  });

  it('takes the first user turn that is not an injected context block as the title', () => {
    const result = scanCodex(home, { ...CODEX_RESTORE_SCAN, withTitle: true });
    const cli = result.records.find((r) => r.id === 'cli-id');
    expect(cli?.title).toBe('make the thing work');
  });

  it('reports the pre-cap candidate total', () => {
    const result = scanCodex(home, { ...CODEX_RESTORE_SCAN, maxFiles: 1 });
    expect(result.records).toHaveLength(1);
    expect(result.total).toBe(5);
  });
});

describe('scanClaude', () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'sessions-scan-claude-'));
    const project = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, '-work-repo');
    mkdirSync(project, { recursive: true });
    writeAt(
      path.join(project, `sid${TRANSCRIPT_EXTENSION}`),
      [
        JSON.stringify({ type: 'last-prompt', sessionId: 'sid' }),
        JSON.stringify({ type: 'mode', sessionId: 'sid' }),
        JSON.stringify({ type: 'system', sessionId: 'sid', cwd: '/work/repo' }),
        JSON.stringify({
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', content: 'not a prompt' }],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: 'ship the feature' },
        }),
      ].join('\n'),
      T0,
    );
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it('reads the session id from line one and the cwd from a later line', () => {
    const [record] = scanClaude(home, {
      maxFiles: 10,
      headBytes: 64 * 1024,
      headLines: 60,
      withTitle: false,
    }).records;
    expect(record.id).toBe('sid');
    expect(record.cwd).toBe('/work/repo');
    expect(record.sourcePath.endsWith(`sid${TRANSCRIPT_EXTENSION}`)).toBe(true);
  });

  it('skips tool_result user lines when picking a title', () => {
    const [record] = scanClaude(home, {
      maxFiles: 10,
      headBytes: 64 * 1024,
      headLines: 60,
      withTitle: true,
    }).records;
    expect(record.title).toBe('ship the feature');
  });
});
