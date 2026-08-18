/**
 * Tier 3 of the agent rail: the newest assistant sentence per pane.
 *
 * Two halves are covered here. The parsers are pure — lines in, one clipped
 * line out — and the resolver is the resume machinery again, so its tests
 * mirror `resolve.test.ts`'s fixtures deliberately: the same corpus that
 * resolves to an id must resolve to that id's OWN sentence, dedup included.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { claudeTailFromLines, codexTailFromLines, resolveSessionTails } from './session-tail';
import { tailBytes } from './head';
import { validateResumeRequests } from './resolve';
import {
  CLAUDE_DIR,
  CLAUDE_PROJECTS_DIR,
  CODEX_DIR,
  CODEX_ROLLOUT_PREFIX,
  CODEX_SESSIONS_DIR,
  TRANSCRIPT_EXTENSION,
} from '../usage/model';

const T0 = Date.parse('2026-08-01T00:00:00Z');
const T1 = T0;
const T2 = T0 + 120_000;

function writeAt(filePath: string, contents: string, mtimeMs: number): void {
  writeFileSync(filePath, contents);
  const seconds = mtimeMs / 1000;
  utimesSync(filePath, seconds, seconds);
}

function claudeAssistantLine(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });
}

function opencodeStorage(home: string): string {
  return path.join(home, '.local', 'share', 'opencode', 'storage');
}

/** One session object in a bucket — what `candidates` reads. */
function writeOpencodeSession(home: string, id: string, directory: string, updated: number): void {
  const bucket = path.join(opencodeStorage(home), 'session', 'bucket1');
  mkdirSync(bucket, { recursive: true });
  writeAt(
    path.join(bucket, `${id}.json`),
    JSON.stringify({ id, directory, time: { updated } }),
    T1,
  );
}

/** One turn: role and timing, no words — exactly what opencode writes. */
function writeOpencodeMessage(
  home: string,
  sessionId: string,
  id: string,
  role: string,
  mtimeMs: number,
): void {
  const dir = path.join(opencodeStorage(home), 'message', sessionId);
  mkdirSync(dir, { recursive: true });
  writeAt(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      sessionID: sessionId,
      role,
      time: { created: mtimeMs },
    }),
    mtimeMs,
  );
}

/** One part of a turn, under its message id rather than its session id. */
function writeOpencodePart(
  home: string,
  messageId: string,
  id: string,
  node: Record<string, unknown>,
  mtimeMs: number,
): void {
  const dir = path.join(opencodeStorage(home), 'part', messageId);
  mkdirSync(dir, { recursive: true });
  writeAt(
    path.join(dir, `${id}.json`),
    JSON.stringify({ id, messageID: messageId, ...node }),
    mtimeMs,
  );
}

describe('claudeTailFromLines', () => {
  it('returns the newest assistant text, skipping tool-use-only turns', () => {
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'run the tests' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Running the vitest suite — 214 of 2619' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] },
      }),
    ];
    expect(claudeTailFromLines(lines)).toBe('Running the vitest suite — 214 of 2619');
  });

  it('answers null on empty or unparseable input', () => {
    expect(claudeTailFromLines([])).toBeNull();
    expect(claudeTailFromLines(['not json', '{}'])).toBeNull();
  });

  it('caps at 160 chars and collapses newlines to one line', () => {
    const long = 'a'.repeat(200) + '\nsecond line';
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: long }] },
      }),
    ];
    const tail = claudeTailFromLines(lines);
    expect(tail).toHaveLength(160);
    expect(tail).not.toContain('\n');
  });
});

describe('codexTailFromLines', () => {
  it('walks past trailing event records to the newest assistant message', () => {
    const lines = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Plan ready — approve the R4 fork?' }],
        },
      }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } }),
    ];
    expect(codexTailFromLines(lines)).toBe('Plan ready — approve the R4 fork?');
  });

  it('ignores a user turn and answers null when no assistant message exists', () => {
    const lines = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'ship it' }],
        },
      }),
    ];
    expect(codexTailFromLines(lines)).toBeNull();
  });
});

describe('tailBytes', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'session-tail-bytes-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the LAST bytes, not the first', () => {
    const filePath = path.join(dir, 'log.txt');
    writeFileSync(filePath, 'first-half|second-half');
    expect(tailBytes(filePath, 11)?.toString('utf8')).toBe('second-half');
  });

  it('reads a whole file smaller than the cap', () => {
    const filePath = path.join(dir, 'small.txt');
    writeFileSync(filePath, 'tiny');
    expect(tailBytes(filePath, 4096)?.toString('utf8')).toBe('tiny');
  });

  it('refuses a symlink rather than following it, and answers null when missing', () => {
    const target = path.join(dir, 'target.txt');
    writeFileSync(target, 'secret');
    const link = path.join(dir, 'link.txt');
    symlinkSync(target, link);
    expect(tailBytes(link, 4096)).toBeNull();
    expect(tailBytes(path.join(dir, 'absent.txt'), 4096)).toBeNull();
  });
});

describe('resolveSessionTails', () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(path.join(tmpdir(), 'session-tail-resolve-'));

    // --- claude: one matched session, plus two same-cwd sessions for dedup.
    // The identity lines come first exactly as a real transcript writes them,
    // so the tail window's dropped first line is never the assistant turn.
    const claudeProject = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, '-tmp-w');
    mkdirSync(claudeProject, { recursive: true });
    writeAt(
      path.join(claudeProject, 'aaaa.jsonl'),
      [
        '{"sessionId":"aaaa","type":"mode"}',
        '{"sessionId":"aaaa","cwd":"/tmp/w","type":"attachment"}',
        claudeAssistantLine('Suite is green — 2619 passing.'),
      ].join('\n'),
      T1,
    );

    const dedupProject = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, '-tmp-two');
    mkdirSync(dedupProject, { recursive: true });
    writeAt(
      path.join(dedupProject, 's1.jsonl'),
      [
        '{"sessionId":"s1","type":"mode"}',
        '{"sessionId":"s1","cwd":"/tmp/two","type":"attachment"}',
        claudeAssistantLine('Pane one is waiting on approval.'),
      ].join('\n'),
      T1,
    );
    writeAt(
      path.join(dedupProject, 's2.jsonl'),
      [
        '{"sessionId":"s2","type":"mode"}',
        '{"sessionId":"s2","cwd":"/tmp/two","type":"attachment"}',
        claudeAssistantLine('Pane two finished the refactor.'),
      ].join('\n'),
      T2,
    );

    // A matched session whose newest turn is tool use only: resolvable, but
    // there is no sentence to show.
    const silentProject = path.join(home, CLAUDE_DIR, CLAUDE_PROJECTS_DIR, '-tmp-silent');
    mkdirSync(silentProject, { recursive: true });
    writeAt(
      path.join(silentProject, 'quiet.jsonl'),
      [
        '{"sessionId":"quiet","type":"mode"}',
        '{"sessionId":"quiet","cwd":"/tmp/silent","type":"attachment"}',
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Bash', input: {} }],
          },
        }),
      ].join('\n'),
      T1,
    );

    // --- codex: session_meta head line, then the assistant turn, then the
    // trailing event records every real rollout ends with.
    const codexSessions = path.join(home, CODEX_DIR, CODEX_SESSIONS_DIR);
    mkdirSync(codexSessions, { recursive: true });
    writeAt(
      path.join(codexSessions, `${CODEX_ROLLOUT_PREFIX}test${TRANSCRIPT_EXTENSION}`),
      [
        JSON.stringify({
          type: 'session_meta',
          payload: { id: 'cx1', cwd: '/tmp/codex' },
        }),
        JSON.stringify({
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Plan ready — approve?' }],
          },
        }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'token_count' } }),
      ].join('\n'),
      T1,
    );

    // --- opencode: no transcript file at all. The session object names the
    // cwd, `message/<sessionID>/` names the turns, and only
    // `part/<messageID>/` carries words — so these three fixtures exercise the
    // whole two-step walk.
    //
    // oc1: the newest turn is the USER's, and the newest assistant turn ends
    // with a `reasoning` part that is newer than its `text` part. Both must be
    // stepped over, or the rail prints a question back at its asker, or private
    // thinking.
    writeOpencodeSession(home, 'oc1', '/tmp/oc', T2);
    writeOpencodeMessage(home, 'oc1', 'm_oc1_user', 'user', T2 + 2000);
    writeOpencodePart(
      home,
      'm_oc1_user',
      'p_oc1_ask',
      { type: 'text', text: 'and now?' },
      T2 + 2000,
    );
    writeOpencodeMessage(home, 'oc1', 'm_oc1_new', 'assistant', T2 + 1000);
    writeOpencodePart(
      home,
      'm_oc1_new',
      'p_oc1_step',
      { type: 'step-start', snapshot: '0437bfac' },
      T2 + 100,
    );
    writeOpencodePart(
      home,
      'm_oc1_new',
      'p_oc1_text',
      { type: 'text', text: 'Working tree clean — nothing staged.' },
      T2 + 500,
    );
    writeOpencodePart(
      home,
      'm_oc1_new',
      'p_oc1_reason',
      { type: 'reasoning', text: 'PRIVATE: the diff looked empty to me.' },
      T2 + 900,
    );
    writeOpencodeMessage(home, 'oc1', 'm_oc1_old', 'assistant', T1);
    writeOpencodePart(
      home,
      'm_oc1_old',
      'p_oc1_older',
      { type: 'text', text: 'An older answer.' },
      T1,
    );

    // oc2: the newest assistant turn only ran a tool, so the walk continues to
    // the turn before it rather than answering null.
    writeOpencodeSession(home, 'oc2', '/tmp/oc2', T2);
    writeOpencodeMessage(home, 'oc2', 'm_oc2_tool', 'assistant', T2);
    writeOpencodePart(
      home,
      'm_oc2_tool',
      'p_oc2_tool',
      { type: 'tool', tool: 'bash', state: { status: 'completed' } },
      T2,
    );
    writeOpencodeMessage(home, 'oc2', 'm_oc2_said', 'assistant', T1);
    writeOpencodePart(
      home,
      'm_oc2_said',
      'p_oc2_said',
      { type: 'text', text: 'Ran the migration.' },
      T1,
    );

    // oc3: resolvable, but its conversation was never written — the tail must
    // be null, not a throw and not another session's sentence.
    writeOpencodeSession(home, 'oc3', '/tmp/oc3', T2);
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("(a) answers a claude pane with its own session's newest sentence", () => {
    expect(resolveSessionTails(home, [{ agent: 'claude', cwd: '/tmp/w', lastSeenAt: T1 }])).toEqual(
      ['Suite is green — 2619 passing.'],
    );
  });

  it('(b) two same-cwd claude panes wear DIFFERENT sentences', () => {
    // The greedy `takenByAgent` dedup `resolveOne` uses, mirrored: without it
    // both panes resolve to the newest file and repeat one line.
    expect(
      resolveSessionTails(home, [
        { agent: 'claude', cwd: '/tmp/two', lastSeenAt: T2 },
        { agent: 'claude', cwd: '/tmp/two', lastSeenAt: T2 },
      ]),
    ).toEqual(['Pane two finished the refactor.', 'Pane one is waiting on approval.']);
  });

  it('(c) answers a codex pane past its trailing event records', () => {
    expect(
      resolveSessionTails(home, [{ agent: 'codex', cwd: '/tmp/codex', lastSeenAt: T1 }]),
    ).toEqual(['Plan ready — approve?']);
  });

  it('(d) a resolvable session with no assistant text answers null', () => {
    expect(
      resolveSessionTails(home, [{ agent: 'claude', cwd: '/tmp/silent', lastSeenAt: T1 }]),
    ).toEqual([null]);
  });

  it('(e) every agent without a reader answers null', () => {
    // `gemini` has no candidate scan at all; `agy`'s `{ kind: "latest" }`
    // resume fallback has no tail equivalent; a custom CLI is unknown by
    // definition. `opencode` is NOT in this list any more — see (j).
    expect(
      resolveSessionTails(home, [
        { agent: 'gemini', cwd: '/tmp/w', lastSeenAt: T1 },
        { agent: 'agy', cwd: '/tmp/w', lastSeenAt: T1 },
        { agent: 'some-future-cli', cwd: null, lastSeenAt: T1 },
      ]),
    ).toEqual([null, null, null]);
  });

  it('(j) answers an opencode pane past its user turn and its reasoning', () => {
    expect(
      resolveSessionTails(home, [{ agent: 'opencode', cwd: '/tmp/oc', lastSeenAt: T2 }]),
    ).toEqual(['Working tree clean — nothing staged.']);
  });

  it('(k) an opencode turn that only ran a tool falls back to the one before', () => {
    expect(
      resolveSessionTails(home, [{ agent: 'opencode', cwd: '/tmp/oc2', lastSeenAt: T2 }]),
    ).toEqual(['Ran the migration.']);
  });

  it('(l) an opencode session with no messages on disk answers null', () => {
    expect(
      resolveSessionTails(home, [{ agent: 'opencode', cwd: '/tmp/oc3', lastSeenAt: T2 }]),
    ).toEqual([null]);
  });

  it('(f) a malformed request answers null at its own position, not shifted', () => {
    expect(
      resolveSessionTails(
        home,
        validateResumeRequests([
          { agent: 'claude', cwd: '/tmp/w', lastSeenAt: T1 },
          { agent: 'claude' }, // malformed: missing cwd/lastSeenAt
          { agent: 'codex', cwd: '/tmp/codex', lastSeenAt: T1 },
        ]),
      ),
    ).toEqual(['Suite is green — 2619 passing.', null, 'Plan ready — approve?']);
  });

  it('(g) a stale session outside the 30-day window answers null', () => {
    const staleSeenAt = T1 + 40 * 24 * 60 * 60 * 1000;
    expect(
      resolveSessionTails(home, [{ agent: 'claude', cwd: '/tmp/w', lastSeenAt: staleSeenAt }]),
    ).toEqual([null]);
  });

  it('(h) missing state dirs answer null positionally without throwing', () => {
    const emptyHome = mkdtempSync(path.join(tmpdir(), 'session-tail-empty-'));
    try {
      expect(() =>
        resolveSessionTails(emptyHome, [{ agent: 'claude', cwd: '/tmp/w', lastSeenAt: T1 }]),
      ).not.toThrow();
      expect(
        resolveSessionTails(emptyHome, [
          { agent: 'claude', cwd: '/tmp/w', lastSeenAt: T1 },
          { agent: 'codex', cwd: '/tmp/codex', lastSeenAt: T1 },
        ]),
      ).toEqual([null, null]);
    } finally {
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('(i) an empty batch answers an empty list', () => {
    expect(resolveSessionTails(home, [])).toEqual([]);
  });
});
