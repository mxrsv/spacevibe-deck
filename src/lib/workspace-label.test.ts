import { describe, expect, it } from 'vitest';
import { normalizeWorkspacePath, workspaceLabel } from './workspace-label';

describe('normalizeWorkspacePath', () => {
  it('gives one spelling to paths that differ only by a trailing slash', () => {
    expect(normalizeWorkspacePath('/Users/k/dev/x')).toBe('/Users/k/dev/x');
    expect(normalizeWorkspacePath('/Users/k/dev/x/')).toBe('/Users/k/dev/x');
    expect(normalizeWorkspacePath('  /Users/k/dev/x//  ')).toBe('/Users/k/dev/x');
  });

  it('keeps the root and rejects an empty path', () => {
    expect(normalizeWorkspacePath('/')).toBe('/');
    expect(normalizeWorkspacePath('')).toBeNull();
    expect(normalizeWorkspacePath('   ')).toBeNull();
  });
});

describe('workspaceLabel', () => {
  it('returns the basename of a workspace path', () => {
    expect(workspaceLabel('/Users/k/dev/stackgrid')).toBe('stackgrid');
  });

  it('ignores a trailing slash', () => {
    expect(workspaceLabel('/Users/k/dev/stackgrid/')).toBe('stackgrid');
    expect(workspaceLabel('/Users/k/dev/stackgrid///')).toBe('stackgrid');
  });

  it('keeps the root as-is', () => {
    expect(workspaceLabel('/')).toBe('/');
    expect(workspaceLabel('///')).toBe('/');
  });

  it('falls back to Unknown on an empty path', () => {
    expect(workspaceLabel('')).toBe('Unknown');
    expect(workspaceLabel('   ')).toBe('Unknown');
  });
});
