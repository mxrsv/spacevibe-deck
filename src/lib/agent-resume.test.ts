import { describe, expect, it } from 'vitest';
import { buildResumeCommand } from './agent-resume';
import type { CustomAgent } from './agent-catalog';

const NO_CUSTOM: readonly CustomAgent[] = [];

describe('buildResumeCommand — claude', () => {
  it('id ref', () => {
    expect(buildResumeCommand('claude', { kind: 'id', id: 'abc123' }, NO_CUSTOM)).toBe(
      'claude --resume abc123',
    );
  });
  it('latest ref', () => {
    expect(buildResumeCommand('claude', { kind: 'latest' }, NO_CUSTOM)).toBe('claude --continue');
  });
  it('null ref', () => {
    expect(buildResumeCommand('claude', null, NO_CUSTOM)).toBe('claude');
  });
});

describe('buildResumeCommand — codex', () => {
  it('id ref', () => {
    expect(buildResumeCommand('codex', { kind: 'id', id: 'abc123' }, NO_CUSTOM)).toBe(
      'codex resume abc123',
    );
  });
  it('latest ref', () => {
    expect(buildResumeCommand('codex', { kind: 'latest' }, NO_CUSTOM)).toBe('codex resume --last');
  });
  it('null ref', () => {
    expect(buildResumeCommand('codex', null, NO_CUSTOM)).toBe('codex');
  });
});

describe('buildResumeCommand — opencode', () => {
  it('id ref', () => {
    expect(buildResumeCommand('opencode', { kind: 'id', id: 'abc123' }, NO_CUSTOM)).toBe(
      'opencode -s abc123',
    );
  });
  it('latest ref', () => {
    expect(buildResumeCommand('opencode', { kind: 'latest' }, NO_CUSTOM)).toBe('opencode -c');
  });
  it('null ref', () => {
    expect(buildResumeCommand('opencode', null, NO_CUSTOM)).toBe('opencode');
  });
});

describe('buildResumeCommand — gemini', () => {
  it('latest ref', () => {
    expect(buildResumeCommand('gemini', { kind: 'latest' }, NO_CUSTOM)).toBe(
      'gemini --resume latest',
    );
  });
  it('null ref', () => {
    expect(buildResumeCommand('gemini', null, NO_CUSTOM)).toBe('gemini');
  });
  it('id ref falls back to the latest form (id never produced for gemini)', () => {
    expect(buildResumeCommand('gemini', { kind: 'id', id: 'abc123' }, NO_CUSTOM)).toBe(
      'gemini --resume latest',
    );
  });
});

describe('buildResumeCommand — agy', () => {
  it('id ref', () => {
    expect(buildResumeCommand('agy', { kind: 'id', id: 'abc123' }, NO_CUSTOM)).toBe(
      'agy --conversation abc123',
    );
  });
  it('latest ref', () => {
    expect(buildResumeCommand('agy', { kind: 'latest' }, NO_CUSTOM)).toBe('agy --continue');
  });
  it('null ref', () => {
    expect(buildResumeCommand('agy', null, NO_CUSTOM)).toBe('agy');
  });
});

describe('buildResumeCommand — degradation', () => {
  it('refuses an unsafe session id', () => {
    expect(buildResumeCommand('claude', { kind: 'id', id: 'x; rm -rf ~' }, [])).toBe('claude');
  });
  it('refuses an id over the length cap', () => {
    const tooLong = 'a'.repeat(129);
    expect(buildResumeCommand('claude', { kind: 'id', id: tooLong }, NO_CUSTOM)).toBe('claude');
  });
  it('accepts an id at the length cap', () => {
    const atCap = 'a'.repeat(128);
    expect(buildResumeCommand('claude', { kind: 'id', id: atCap }, NO_CUSTOM)).toBe(
      `claude --resume ${atCap}`,
    );
  });
  it('matches a custom agent by label and ignores the ref', () => {
    const custom: readonly CustomAgent[] = [
      { id: 'custom:mybot', label: 'MyBot', command: 'mybot --flag' },
    ];
    expect(buildResumeCommand('MyBot', { kind: 'id', id: 'abc' }, custom)).toBe('mybot --flag');
  });
  it('matches a custom agent by label even with a null ref', () => {
    const custom: readonly CustomAgent[] = [
      { id: 'custom:mybot', label: 'MyBot', command: 'mybot --flag' },
    ];
    expect(buildResumeCommand('MyBot', null, custom)).toBe('mybot --flag');
  });
  it('returns null for an unknown agent string', () => {
    expect(buildResumeCommand('not-a-real-agent', null, NO_CUSTOM)).toBeNull();
  });
  it('returns null for an unknown agent string even with a ref', () => {
    expect(buildResumeCommand('not-a-real-agent', { kind: 'id', id: 'abc' }, NO_CUSTOM)).toBeNull();
  });
});
