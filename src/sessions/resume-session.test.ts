import { describe, expect, it, vi } from 'vitest';
import { resumeSession } from './resume-session';
import type { SessionEntry } from '../lib/session-history';
import type { MaterializeIntent } from '../terminal/tab-materialize';

function entry(over: Partial<SessionEntry> = {}): SessionEntry {
  return {
    agent: 'claude',
    sessionId: '8f0f0e2c-1111-2222-3333-444455556666',
    cwd: '/work/repo',
    lastActivityMs: 1,
    title: 't',
    sourcePath: '/p',
    ...over,
  };
}

function deps(over: Partial<Parameters<typeof resumeSession>[1]> = {}) {
  return {
    materialize: vi.fn<(intent: MaterializeIntent) => Promise<boolean>>().mockResolvedValue(true),
    customAgents: [],
    isDead: () => false,
    ...over,
  };
}

describe('resumeSession', () => {
  it("materializes one pane in the session's own cwd with its resume command", async () => {
    const d = deps();
    await expect(resumeSession(entry(), d)).resolves.toBe(true);
    const intent = vi.mocked(d.materialize).mock.calls[0][0];
    expect(intent.cwds).toEqual(['/work/repo']);
    expect(intent.paneCommands).toEqual(['claude --resume 8f0f0e2c-1111-2222-3333-444455556666']);
    expect(intent.workspacePath).toBe('/work/repo');
    expect(intent.agent).toBeUndefined();
  });

  it("uses codex's own resume form", async () => {
    const d = deps();
    await resumeSession(entry({ agent: 'codex', sessionId: 'abc123' }), d);
    expect(vi.mocked(d.materialize).mock.calls[0][0].paneCommands).toEqual(['codex resume abc123']);
  });

  // A dead cwd landing in $HOME is worse than not resuming (spec §4).
  it('refuses to spawn when the recorded directory is gone', async () => {
    const d = deps({ isDead: () => true });
    await expect(resumeSession(entry(), d)).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });

  it('refuses a session id that fails the PTY-safe pattern', async () => {
    const d = deps();
    await expect(resumeSession(entry({ sessionId: 'a; rm -rf /' }), d)).resolves.toBe(false);
    // An empty id degrades the same way, and every string `.includes("")`, so
    // the "did the id survive into the command" guard cannot catch it alone.
    await expect(resumeSession(entry({ sessionId: '' }), d)).resolves.toBe(false);
    expect(d.materialize).not.toHaveBeenCalled();
  });
});
