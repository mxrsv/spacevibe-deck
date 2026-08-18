import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from './bridge';

vi.mock('./bridge', () => ({ invoke: vi.fn() }));

describe('worktree-host', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.unstubAllGlobals();
  });

  it('available is false when no __deckHost bridge is present (Tauri, browser dev)', async () => {
    vi.stubGlobal('__deckHost', undefined);
    vi.resetModules();
    const { available } = await import('./worktree-host');
    expect(available).toBe(false);
  });

  it('available is true when the Electron preload has installed __deckHost', async () => {
    vi.stubGlobal('__deckHost', { invoke: vi.fn(), listen: vi.fn() });
    vi.resetModules();
    const { available } = await import('./worktree-host');
    expect(available).toBe(true);
  });

  it('addWorktree sends the flat { repoPath, branch, destPath } payload', async () => {
    vi.resetModules();
    const bridge = await import('./bridge');
    vi.mocked(bridge.invoke).mockResolvedValue({ ok: true, path: '/dest' });
    const { addWorktree } = await import('./worktree-host');

    const result = await addWorktree({
      repoPath: '/repo',
      branch: 'feature/x',
      destPath: '/dest',
    });

    expect(bridge.invoke).toHaveBeenCalledWith('worktree_add', {
      repoPath: '/repo',
      branch: 'feature/x',
      destPath: '/dest',
    });
    expect(result).toEqual({ ok: true, path: '/dest' });
  });
});
