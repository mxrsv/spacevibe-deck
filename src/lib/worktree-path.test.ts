import { describe, expect, it } from 'vitest';
import { suggestWorktreeDest } from './worktree-path';

describe('suggestWorktreeDest', () => {
  it('suggests <repo parent>/<repo name>-worktrees/<branch>', () => {
    expect(suggestWorktreeDest('/Users/x/deck', 'redesign')).toBe(
      '/Users/x/deck-worktrees/redesign',
    );
  });

  it('nests a slashed branch name rather than flattening it', () => {
    expect(suggestWorktreeDest('/Users/x/deck', 'feature/x')).toBe(
      '/Users/x/deck-worktrees/feature/x',
    );
  });

  it('strips a trailing slash on the repo path before deriving the name', () => {
    expect(suggestWorktreeDest('/Users/x/deck/', 'redesign')).toBe(
      '/Users/x/deck-worktrees/redesign',
    );
  });

  it('trims whitespace around the branch name', () => {
    expect(suggestWorktreeDest('/Users/x/deck', '  redesign  ')).toBe(
      '/Users/x/deck-worktrees/redesign',
    );
  });

  it('handles a repo directly under root', () => {
    expect(suggestWorktreeDest('/deck', 'redesign')).toBe('/deck-worktrees/redesign');
  });

  it('returns empty when the repo path is empty', () => {
    expect(suggestWorktreeDest('', 'redesign')).toBe('');
  });

  it('returns empty when the branch is empty or blank', () => {
    expect(suggestWorktreeDest('/Users/x/deck', '')).toBe('');
    expect(suggestWorktreeDest('/Users/x/deck', '   ')).toBe('');
  });
});
