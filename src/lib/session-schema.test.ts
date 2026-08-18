import { describe, expect, it } from 'vitest';
import {
  pushArchiveEntry,
  validateArchive,
  validateWindowRecord,
  MAX_ARCHIVE_WORKSPACES,
} from './session-schema';

const LEAF = { type: 'leaf' } as const;
const PANE = { cwd: '/tmp/x', agent: 'claude' };
const TAB = {
  workspacePath: '/tmp/x',
  layout: LEAF,
  panes: [PANE],
  name: null,
  dotColor: null,
};
const RECORD = {
  savedAt: 111,
  activeTabIndex: 0,
  tabs: [TAB],
  files: [],
  activeFileTab: null,
};

describe('validateWindowRecord', () => {
  it('accepts a well-formed record', () => {
    expect(validateWindowRecord(RECORD)).toEqual(RECORD);
  });
  it('rejects non-objects', () => {
    expect(validateWindowRecord(null)).toBeNull();
    expect(validateWindowRecord('x')).toBeNull();
  });
  it('drops a tab whose pane count does not match its layout leaves', () => {
    const bad = { ...TAB, panes: [PANE, PANE] }; // leaf layout = 1 leaf
    const result = validateWindowRecord({ ...RECORD, tabs: [bad, TAB] });
    expect(result?.tabs).toEqual([TAB]);
  });
  it('drops a tab with an invalid layout but keeps the rest', () => {
    const bad = { ...TAB, layout: { type: 'nope' } };
    expect(validateWindowRecord({ ...RECORD, tabs: [bad, TAB] })?.tabs).toEqual([TAB]);
  });
  it('clamps activeTabIndex into the surviving tab range', () => {
    expect(validateWindowRecord({ ...RECORD, activeTabIndex: 99 })?.activeTabIndex).toBe(0);
  });
  it('coerces malformed file surfaces away without rejecting the record', () => {
    const result = validateWindowRecord({
      ...RECORD,
      files: [
        {
          workspacePath: '/w',
          tabs: [{ path: '/w/a.ts', preview: false }],
          activePath: null,
        },
        42,
      ],
    });
    expect(result?.files).toHaveLength(1);
  });
});

describe('archive', () => {
  it('validates entries individually', () => {
    const archive = validateArchive({
      '/w': { savedAt: 1, tabs: [TAB] },
      '/bad': 'x',
    });
    expect(Object.keys(archive)).toEqual(['/w']);
  });
  it('caps at MAX_ARCHIVE_WORKSPACES, dropping oldest savedAt', () => {
    let archive: Readonly<Record<string, never[]>> | Record<string, unknown> = {};
    let out = {} as ReturnType<typeof validateArchive>;
    for (let i = 0; i <= MAX_ARCHIVE_WORKSPACES; i += 1) {
      out = pushArchiveEntry(out, `/w${i}`, { savedAt: i, tabs: [TAB] });
    }
    expect(Object.keys(out)).toHaveLength(MAX_ARCHIVE_WORKSPACES);
    expect(out['/w0']).toBeUndefined();
    void archive;
  });

  it('validateArchive over the cap keeps the newest savedAt entries, not a first-N key-order slice (L1)', () => {
    // Insertion/key order deliberately puts the newest entry FIRST and the
    // oldest LAST — the opposite of append order — so a first-N-in-key-order
    // slice would keep the wrong ones (it would drop the newest instead of
    // the oldest).
    const raw: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_ARCHIVE_WORKSPACES; i += 1) {
      const savedAt = MAX_ARCHIVE_WORKSPACES - i; // newest key first, oldest key last
      raw[`/w${i}`] = { savedAt, tabs: [TAB] };
    }
    const out = validateArchive(raw);
    expect(Object.keys(out)).toHaveLength(MAX_ARCHIVE_WORKSPACES);
    // The oldest entry (savedAt 0, key "/w{MAX}") must be the one dropped.
    expect(out[`/w${MAX_ARCHIVE_WORKSPACES}`]).toBeUndefined();
    // The newest entry (savedAt MAX, key "/w0") must survive.
    expect(out['/w0']).toBeDefined();
  });
});
