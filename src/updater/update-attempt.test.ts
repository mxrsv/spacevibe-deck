import { describe, expect, it } from 'vitest';
import {
  attemptMessage,
  isUpdateAttempt,
  resolveAttemptOutcome,
  type UpdateAttempt,
} from './update-attempt';

const attempt: UpdateAttempt = {
  targetVersion: '0.11.0',
  fromVersion: '0.10.0',
  startedAt: 1_785_785_577_000,
};

describe('resolveAttemptOutcome', () => {
  it('reports success when the running version is the one we installed', () => {
    expect(resolveAttemptOutcome(attempt, '0.11.0')).toEqual({
      kind: 'succeeded',
      version: '0.11.0',
    });
  });

  it('reports incomplete when still on the version we started from', () => {
    // This is the Windows case: the installer exited the process without ever
    // telling Deck whether it ran, so the only evidence is the version.
    expect(resolveAttemptOutcome(attempt, '0.10.0')).toEqual({
      kind: 'incomplete',
      attempt,
    });
  });

  it('reports superseded when a third version is running', () => {
    // Someone downloaded a build by hand, or rolled back. The record describes
    // a world that no longer exists.
    expect(resolveAttemptOutcome(attempt, '0.12.0')).toEqual({
      kind: 'superseded',
      attempt,
      version: '0.12.0',
    });
  });

  it('never claims the origin version is running when it is not', () => {
    const outcome = resolveAttemptOutcome(attempt, '0.9.0');
    expect(outcome.kind).toBe('superseded');
    expect(attemptMessage(outcome)).toContain('0.9.0');
    expect(attemptMessage(outcome)).not.toContain('still running 0.10.0');
  });

  it('treats a missing record as an ordinary launch', () => {
    expect(resolveAttemptOutcome(undefined, '0.10.0')).toEqual({
      kind: 'none',
    });
    expect(resolveAttemptOutcome(null, '0.10.0').kind).toBe('none');
  });

  it('treats a malformed record as no attempt rather than a failure', () => {
    // Warning on garbage would train people to dismiss the warning.
    for (const junk of [
      {},
      { targetVersion: '0.11.0' },
      { targetVersion: '', fromVersion: '0.10.0', startedAt: 1 },
      { targetVersion: '0.11.0', fromVersion: '0.10.0', startedAt: 'soon' },
      { targetVersion: '0.11.0', fromVersion: '0.10.0', startedAt: NaN },
      '0.11.0',
      42,
    ]) {
      expect(resolveAttemptOutcome(junk, '0.10.0').kind).toBe('none');
    }
  });
});

describe('isUpdateAttempt', () => {
  it('accepts a well-formed record', () => {
    expect(isUpdateAttempt(attempt)).toBe(true);
  });

  it('rejects anything missing a field', () => {
    expect(isUpdateAttempt({ ...attempt, fromVersion: '' })).toBe(false);
  });
});

describe('attemptMessage', () => {
  it('names both versions on an incomplete install, without guessing why', () => {
    const message = attemptMessage({ kind: 'incomplete', attempt })!;
    expect(message).toContain('0.11.0');
    expect(message).toContain('0.10.0');
    expect(message).toContain('Download it manually');
    // Deck never saw the installer, so it must not claim a cause.
    expect(message).not.toMatch(/because|failed to|error/i);
  });

  it('reports the version actually running when the record was superseded', () => {
    const message = attemptMessage({
      kind: 'superseded',
      attempt,
      version: '0.12.0',
    })!;
    expect(message).toContain('0.12.0');
    expect(message).not.toContain('still running');
  });

  it('says nothing on success or on an ordinary launch', () => {
    expect(attemptMessage({ kind: 'succeeded', version: '0.11.0' })).toBeNull();
    expect(attemptMessage({ kind: 'none' })).toBeNull();
  });
});
