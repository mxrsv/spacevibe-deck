import { describe, expect, it } from 'vitest';
import {
  decideExternalChange,
  resolutionApplies,
  type ChangeEvent,
  type OpenFileState,
} from './external-change';

const state = (patch: Partial<OpenFileState> = {}): OpenFileState => ({
  dirty: false,
  gone: false,
  mtimeMs: 1000,
  size: 42,
  prompting: false,
  ...patch,
});

const changed = (patch: Partial<ChangeEvent> = {}): ChangeEvent => ({
  path: '/r/a.ts',
  kind: 'changed',
  mtimeMs: 2000,
  size: 50,
  ...patch,
});

const deleted: ChangeEvent = {
  path: '/r/a.ts',
  kind: 'deleted',
  mtimeMs: null,
  size: null,
};

describe('the spec §5 table', () => {
  const rows: [string, ChangeEvent, OpenFileState, string][] = [
    ['clean + changed reloads silently', changed(), state(), 'reload'],
    ['clean + deleted marks it gone', deleted, state(), 'mark-gone'],
    [
      'dirty + changed asks Reload / Keep mine',
      changed(),
      state({ dirty: true }),
      'prompt-changed',
    ],
    ['dirty + deleted asks Save again / Close', deleted, state({ dirty: true }), 'prompt-deleted'],
  ];

  for (const [name, event, open, expected] of rows) {
    it(name, () => {
      expect(decideExternalChange(event, open).kind).toBe(expected);
    });
  }

  it('never auto-decides for a dirty tab', () => {
    for (const event of [changed(), deleted]) {
      const action = decideExternalChange(event, state({ dirty: true })).kind;
      expect(action).not.toBe('reload');
      expect(action).not.toBe('mark-gone');
    }
  });
});

describe('the two rows the table implies', () => {
  it('drops an event for a file that is not open', () => {
    expect(decideExternalChange(changed(), undefined).kind).toBe('none');
    expect(decideExternalChange(deleted, undefined).kind).toBe('none');
  });

  it('is a no-op for a duplicate event carrying an unchanged mtime', () => {
    // fs.watch fires twice on macOS routinely; a second silent reload would
    // throw away the cursor the first one preserved.
    expect(
      decideExternalChange(changed({ mtimeMs: 1000, size: 42 }), state({ mtimeMs: 1000, size: 42 }))
        .kind,
    ).toBe('none');
  });

  it('still reloads when only the size moved within one mtime tick', () => {
    expect(
      decideExternalChange(changed({ mtimeMs: 1000, size: 43 }), state({ mtimeMs: 1000, size: 42 }))
        .kind,
    ).toBe('reload');
  });
});

describe('repeat events', () => {
  it('does not re-mark an already-gone file', () => {
    expect(decideExternalChange(deleted, state({ gone: true })).kind).toBe('none');
  });

  it('reloads a file that was deleted and then rewritten, even at the same mtime', () => {
    expect(
      decideExternalChange(
        changed({ mtimeMs: 1000, size: 42 }),
        state({ gone: true, mtimeMs: 1000, size: 42 }),
      ).kind,
    ).toBe('reload');
  });

  it('leaves an open bar alone rather than replacing it under the pointer', () => {
    expect(decideExternalChange(changed(), state({ dirty: true, prompting: true })).kind).toBe(
      'none',
    );
  });

  it('reloads when the tab has never had a recorded mtime', () => {
    expect(decideExternalChange(changed(), state({ mtimeMs: null })).kind).toBe('reload');
  });
});

describe('resolutionApplies', () => {
  it('pairs each bar with exactly its own two answers', () => {
    expect(resolutionApplies('prompt-changed', 'reload')).toBe(true);
    expect(resolutionApplies('prompt-changed', 'keep-mine')).toBe(true);
    expect(resolutionApplies('prompt-changed', 'save-again')).toBe(false);
    expect(resolutionApplies('prompt-deleted', 'save-again')).toBe(true);
    expect(resolutionApplies('prompt-deleted', 'close')).toBe(true);
    expect(resolutionApplies('prompt-deleted', 'reload')).toBe(false);
  });

  it('refuses every answer for a silent row', () => {
    for (const kind of ['none', 'reload', 'mark-gone'] as const) {
      expect(resolutionApplies(kind, 'reload')).toBe(false);
      expect(resolutionApplies(kind, 'close')).toBe(false);
    }
  });
});
