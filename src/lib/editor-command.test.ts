import { describe, expect, it } from 'vitest';
import { buildOpenEditorRequest, editorTemplate, isEditorId } from './editor-command';

describe('editorTemplate', () => {
  it('returns the preset template', () => {
    expect(editorTemplate('vscode', '')).toBe('code -g {file}:{line}:{col}');
  });

  it('returns the trimmed custom command', () => {
    expect(editorTemplate('custom', '  vim {file}  ')).toBe('vim {file}');
  });
});

describe('isEditorId', () => {
  it('accepts known ids and rejects anything else', () => {
    expect(isEditorId('zed')).toBe(true);
    expect(isEditorId('emacs')).toBe(false);
    expect(isEditorId(null)).toBe(false);
  });
});

describe('buildOpenEditorRequest', () => {
  it('builds an immutable request without constructing a shell command', () => {
    const request = buildOpenEditorRequest('vscode', '', '/a b/日本語.ts', 12, 3);

    expect(request).toEqual({
      editor: 'vscode',
      template: '',
      file: '/a b/日本語.ts',
      line: 12,
      column: 3,
    });
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('defaults a missing line and column to 1', () => {
    expect(buildOpenEditorRequest('zed', '', '/a/b.ts', null, null)).toEqual({
      editor: 'zed',
      template: '',
      file: '/a/b.ts',
      line: 1,
      column: 1,
    });
  });

  it('sends the trimmed custom template without substituting placeholders', () => {
    expect(
      buildOpenEditorRequest(
        'custom',
        '  vim +{line} {file}  ',
        String.raw`\\server\share\a b.ts`,
        9,
        null,
      ),
    ).toEqual({
      editor: 'custom',
      template: 'vim +{line} {file}',
      file: String.raw`\\server\share\a b.ts`,
      line: 9,
      column: 1,
    });
  });

  it('does not leak the custom setting into a built-in editor request', () => {
    expect(buildOpenEditorRequest('cursor', 'malicious {file}', '/a/b.ts', 1, 1)?.template).toBe(
      '',
    );
  });

  it('returns null for an empty custom template', () => {
    expect(buildOpenEditorRequest('custom', '   ', '/a/b.ts', 1, 1)).toBeNull();
  });
});
