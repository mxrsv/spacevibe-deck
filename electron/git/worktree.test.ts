import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { addWorktree } from './worktree';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

const execFileMock = vi.mocked(execFile);

/** Queues the next `execFile` call to resolve with this error/stderr pair. */
function mockNextRun(error: (Error & { code?: string }) | null, stderr = ''): void {
  execFileMock.mockImplementationOnce((...args: unknown[]) => {
    const callback = args[args.length - 1] as (
      error: (Error & { code?: string }) | null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(error, '', stderr);
    return {} as ReturnType<typeof execFile>;
  });
}

describe('addWorktree', () => {
  afterEach(() => {
    execFileMock.mockReset();
  });

  it('resolves ok with the destination path on success', async () => {
    mockNextRun(null);
    const result = await addWorktree({
      repoPath: '/repo',
      branch: 'feature/x',
      destPath: '/repo-worktrees/feature-x',
    });
    expect(result).toEqual({ ok: true, path: '/repo-worktrees/feature-x' });
  });

  it('runs `git -C <repoPath> worktree add <destPath> -b <branch>`', async () => {
    mockNextRun(null);
    await addWorktree({
      repoPath: '/repo',
      branch: 'feature/x',
      destPath: '/repo-worktrees/feature-x',
    });
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['-C', '/repo', 'worktree', 'add', '/repo-worktrees/feature-x', '-b', 'feature/x'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("classifies 'not a git repository' as not-a-repository", async () => {
    mockNextRun(
      new Error('Command failed'),
      'fatal: not a git repository (or any of the parent directories): .git\n',
    );
    const result = await addWorktree({
      repoPath: '/not-a-repo',
      branch: 'x',
      destPath: '/dest',
    });
    expect(result).toEqual({ ok: false, error: 'not-a-repository' });
  });

  it('classifies an existing branch as branch-exists', async () => {
    mockNextRun(new Error('Command failed'), "fatal: a branch named 'feature' already exists\n");
    const result = await addWorktree({
      repoPath: '/repo',
      branch: 'feature',
      destPath: '/dest',
    });
    expect(result).toEqual({ ok: false, error: 'branch-exists' });
  });

  it('classifies an existing destination as destination-exists', async () => {
    mockNextRun(new Error('Command failed'), "fatal: '/dest' already exists\n");
    const result = await addWorktree({
      repoPath: '/repo',
      branch: 'x',
      destPath: '/dest',
    });
    expect(result).toEqual({ ok: false, error: 'destination-exists' });
  });

  it('classifies a missing git binary as git-not-found', async () => {
    const enoent = Object.assign(new Error('spawn git ENOENT'), {
      code: 'ENOENT',
    });
    mockNextRun(enoent, '');
    const result = await addWorktree({
      repoPath: '/repo',
      branch: 'x',
      destPath: '/dest',
    });
    expect(result).toEqual({ ok: false, error: 'git-not-found' });
  });

  it('falls back to unknown for an unrecognized failure', async () => {
    mockNextRun(new Error('Command failed'), 'fatal: something else entirely\n');
    const result = await addWorktree({
      repoPath: '/repo',
      branch: 'x',
      destPath: '/dest',
    });
    expect(result).toEqual({ ok: false, error: 'unknown' });
  });

  it('never leaks stderr text back to the caller', async () => {
    mockNextRun(
      new Error('Command failed'),
      'fatal: not a git repository (or any of the parent directories): .git\n',
    );
    const result = await addWorktree({
      repoPath: '/not-a-repo',
      branch: 'x',
      destPath: '/dest',
    });
    expect(JSON.stringify(result)).not.toContain('fatal:');
  });
});
