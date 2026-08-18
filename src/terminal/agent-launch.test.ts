import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopPlatform } from '../lib/platform';
import { createMemoryPtyClient } from './pty-client';
import {
  AGENT_LAUNCH_TIMEOUT_MS,
  createAgentLauncher,
  WINDOWS_AGENT_LAUNCH_TIMEOUT_MS,
} from './agent-launch';

function setup(platform: DesktopPlatform = 'macos', onTimeout: (id: number) => void = () => {}) {
  const pty = createMemoryPtyClient();
  const launcher = createAgentLauncher(pty, { platform, onTimeout });
  return { pty, launcher };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAgentLauncher', () => {
  it.each(['windows', 'macos'] as const)(
    'types the OpenCode command unchanged on %s',
    (platform) => {
      const pty = createMemoryPtyClient();
      const launcher = createAgentLauncher(pty, { platform, timeoutMs: 1000 });
      launcher.arm([{ id: 1, command: 'opencode' }]);
      if (platform === 'windows') {
        launcher.notePromptReady(1);
      } else {
        launcher.noteOutput(1);
      }
      expect(pty.writes).toEqual([{ id: 1, data: 'opencode\r' }]);
      launcher.dispose();
    },
  );
  it('types the agent once the pane emits its first output', () => {
    const { pty, launcher } = setup();
    launcher.arm([{ id: 1, command: 'claude' }]);
    expect(pty.writes).toEqual([]);

    launcher.noteOutput(1);

    expect(pty.writes).toEqual([{ id: 1, data: 'claude\r' }]);
  });

  it('fires on the 3s timeout when a pane stays silent', () => {
    const { pty, launcher } = setup();
    launcher.arm([{ id: 1, command: 'codex' }]);

    vi.advanceTimersByTime(AGENT_LAUNCH_TIMEOUT_MS);

    expect(pty.writes).toEqual([{ id: 1, data: 'codex\r' }]);
  });

  it('types each pane exactly once even after later output', () => {
    const { pty, launcher } = setup();
    launcher.arm([{ id: 1, command: 'claude' }]);
    launcher.noteOutput(1);
    launcher.noteOutput(1);
    vi.advanceTimersByTime(AGENT_LAUNCH_TIMEOUT_MS);

    expect(pty.writes).toEqual([{ id: 1, data: 'claude\r' }]);
  });

  it('types once when output arrives only after the timeout already fired', () => {
    const { pty, launcher } = setup();
    launcher.arm([{ id: 1, command: 'claude' }]);
    vi.advanceTimersByTime(AGENT_LAUNCH_TIMEOUT_MS);
    launcher.noteOutput(1);

    expect(pty.writes).toEqual([{ id: 1, data: 'claude\r' }]);
  });

  it('never types anything for a Shell-only choice', () => {
    const { pty, launcher } = setup();
    launcher.arm([
      { id: 1, command: null },
      { id: 2, command: null },
    ]);
    launcher.noteOutput(1);
    vi.advanceTimersByTime(AGENT_LAUNCH_TIMEOUT_MS);

    expect(pty.writes).toEqual([]);
  });

  it('fires immediately when output was already seen before arm', () => {
    const { pty, launcher } = setup();
    launcher.noteOutput(1);
    launcher.arm([{ id: 1, command: 'gemini' }]);

    expect(pty.writes).toEqual([{ id: 1, data: 'gemini\r' }]);
  });

  it('arms every pane in the list independently', () => {
    const { pty, launcher } = setup();
    launcher.arm([
      { id: 1, command: 'claude' },
      { id: 2, command: 'claude' },
      { id: 3, command: 'claude' },
    ]);
    launcher.noteOutput(2);
    expect(pty.writes).toEqual([{ id: 2, data: 'claude\r' }]);
    vi.advanceTimersByTime(AGENT_LAUNCH_TIMEOUT_MS);
    expect(pty.writes).toEqual([
      { id: 2, data: 'claude\r' },
      { id: 1, data: 'claude\r' },
      { id: 3, data: 'claude\r' },
    ]);
  });

  it('arms different commands per pane', () => {
    const { pty, launcher } = setup();
    launcher.arm([
      { id: 1, command: 'claude --resume abc' },
      { id: 2, command: null },
    ]);
    launcher.noteOutput(1);
    launcher.noteOutput(2);
    expect(pty.writes).toEqual([{ id: 1, data: 'claude --resume abc\r' }]);
  });

  it("prune cancels a pending pane's timer", () => {
    const { pty, launcher } = setup();
    launcher.arm([{ id: 1, command: 'claude' }]);
    launcher.prune([]);
    vi.advanceTimersByTime(AGENT_LAUNCH_TIMEOUT_MS);
    launcher.noteOutput(1);

    expect(pty.writes).toEqual([]);
  });

  it('dispose cancels every pending pane', () => {
    const { pty, launcher } = setup();
    launcher.arm([
      { id: 1, command: 'claude' },
      { id: 2, command: 'claude' },
    ]);
    launcher.dispose();
    vi.advanceTimersByTime(AGENT_LAUNCH_TIMEOUT_MS);

    expect(pty.writes).toEqual([]);
  });

  it('does not launch Windows agents from banner or prompt-start output', () => {
    const { pty, launcher } = setup('windows');
    launcher.arm([{ id: 1, command: 'claude' }]);

    launcher.noteOutput(1);
    launcher.noteOutput(1);

    expect(pty.writes).toEqual([]);
  });

  it('launches a Windows agent only from structured prompt readiness', () => {
    const { pty, launcher } = setup('windows');
    launcher.arm([{ id: 1, command: 'codex' }]);

    launcher.notePromptReady(1);

    expect(pty.writes).toEqual([{ id: 1, data: 'codex\r' }]);
  });

  it('launches a Windows agent once after duplicate readiness', () => {
    const { pty, launcher } = setup('windows');
    launcher.arm([{ id: 1, command: 'gemini' }]);

    launcher.notePromptReady(1);
    launcher.notePromptReady(1);
    vi.advanceTimersByTime(WINDOWS_AGENT_LAUNCH_TIMEOUT_MS);

    expect(pty.writes).toEqual([{ id: 1, data: 'gemini\r' }]);
  });

  it('cancels a Windows launch on timeout without writing', () => {
    const onTimeout = vi.fn();
    const { pty, launcher } = setup('windows', onTimeout);
    launcher.arm([{ id: 1, command: 'claude' }]);

    vi.advanceTimersByTime(WINDOWS_AGENT_LAUNCH_TIMEOUT_MS);
    launcher.notePromptReady(1);
    launcher.arm([{ id: 1, command: 'claude' }]);
    launcher.notePromptReady(1);

    expect(pty.writes).toEqual([]);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onTimeout).toHaveBeenCalledWith(1);
  });

  it('prune cancels a Windows timeout message', () => {
    const onTimeout = vi.fn();
    const { pty, launcher } = setup('windows', onTimeout);
    launcher.arm([{ id: 1, command: 'claude' }]);

    launcher.prune([]);
    vi.advanceTimersByTime(WINDOWS_AGENT_LAUNCH_TIMEOUT_MS);

    expect(pty.writes).toEqual([]);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
