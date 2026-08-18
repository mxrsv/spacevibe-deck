import { describe, expect, it } from 'vitest';
import {
  activeAfterFileClose,
  closeFileTab,
  hasTab,
  openKept,
  openPreview,
  previewTab,
  promoteTab,
  type FileTabEntry,
  type OpenTabOptions,
} from './preview-slot';

const tab = (path: string, preview = false, openedAt = 0): FileTabEntry => ({
  path,
  preview,
  openedAt,
});

/** The store spends one order key per open attempt; tests name it explicitly
 * so an assertion about POSITION in the strip cannot pass by accident. */
const opening = (openedAt = 0, dirtyPaths?: ReadonlySet<string>): OpenTabOptions => ({
  openedAt,
  dirtyPaths,
});

describe('openPreview', () => {
  it('opens the first click into a new preview slot', () => {
    expect(openPreview([], '/r/a.ts', opening())).toEqual([tab('/r/a.ts', true)]);
  });

  it('replaces the preview slot in place, so the tab does not jump', () => {
    const tabs = [tab('/r/kept.ts'), tab('/r/a.ts', true), tab('/r/other.ts')];
    expect(openPreview(tabs, '/r/b.ts', opening())).toEqual([
      tab('/r/kept.ts'),
      tab('/r/b.ts', true),
      tab('/r/other.ts'),
    ]);
  });

  it("keeps the replaced slot's place in the strip's open order", () => {
    // "Does not jump" is about the strip as a whole since 2026-08-16: a fresh
    // order key would move the chip past every terminal tab opened since,
    // which is the same jump this branch has always existed to prevent.
    const tabs = [tab('/r/a.ts', true, 4)];
    expect(openPreview(tabs, '/r/b.ts', opening(9))[0].openedAt).toBe(4);
  });

  it('gives an appended tab the key it was opened with', () => {
    expect(openPreview([tab('/r/kept.ts')], '/r/a.ts', opening(7))[1]).toEqual(
      tab('/r/a.ts', true, 7),
    );
  });

  it('leaves the list untouched when the file is already open', () => {
    const tabs = [tab('/r/kept.ts'), tab('/r/a.ts', true)];
    expect(openPreview(tabs, '/r/kept.ts', opening())).toEqual(tabs);
    expect(openPreview(tabs, '/r/a.ts', opening())).toEqual(tabs);
  });

  it('never demotes a kept tab back to a preview', () => {
    const tabs = [tab('/r/kept.ts')];
    expect(openPreview(tabs, '/r/kept.ts', opening())[0].preview).toBe(false);
  });

  it('appends beside kept tabs when there is no preview slot', () => {
    expect(openPreview([tab('/r/kept.ts')], '/r/a.ts', opening())).toEqual([
      tab('/r/kept.ts'),
      tab('/r/a.ts', true),
    ]);
  });
});

describe('promoteTab', () => {
  it('promotes on intent and is idempotent for a kept tab', () => {
    const promoted = promoteTab([tab('/r/a.ts', true)], '/r/a.ts');
    expect(promoted).toEqual([tab('/r/a.ts')]);
    expect(promoteTab(promoted, '/r/a.ts')).toEqual(promoted);
  });

  it('ignores a path it does not hold', () => {
    const tabs = [tab('/r/a.ts', true)];
    expect(promoteTab(tabs, '/r/missing.ts')).toEqual(tabs);
  });
});

describe('openKept', () => {
  it('opens a double-click straight to a kept tab', () => {
    expect(openKept([], '/r/a.ts', opening())).toEqual([tab('/r/a.ts')]);
  });

  it('promotes the existing preview when it is the same file', () => {
    expect(openKept([tab('/r/a.ts', true)], '/r/a.ts', opening())).toEqual([tab('/r/a.ts')]);
  });
});

describe('replacing a preview never discards unsaved work', () => {
  // The property is stated directly rather than inferred from "the first edit
  // promotes", because that inference is exactly what a later change could
  // break silently.
  it('promotes a dirty preview instead of replacing it', () => {
    const tabs = [tab('/r/dirty.ts', true)];
    const next = openPreview(tabs, '/r/new.ts', opening(0, new Set(['/r/dirty.ts'])));
    expect(next).toEqual([tab('/r/dirty.ts'), tab('/r/new.ts', true)]);
    expect(hasTab(next, '/r/dirty.ts')).toBe(true);
  });

  it('keeps every dirty path open across any single click, in every arrangement', () => {
    const arrangements: FileTabEntry[][] = [
      [tab('/r/dirty.ts', true)],
      [tab('/r/kept.ts'), tab('/r/dirty.ts', true)],
      [tab('/r/dirty.ts'), tab('/r/preview.ts', true)],
      [],
    ];
    for (const tabs of arrangements) {
      const dirty = new Set(['/r/dirty.ts']);
      const next = openPreview(tabs, '/r/clicked.ts', opening(0, dirty));
      for (const path of dirty) {
        if (hasTab(tabs, path)) {
          expect(hasTab(next, path)).toBe(true);
        }
      }
    }
  });
});

describe('previewTab', () => {
  it('finds the one replaceable slot, or nothing', () => {
    expect(previewTab([tab('/r/a.ts'), tab('/r/b.ts', true)])?.path).toBe('/r/b.ts');
    expect(previewTab([tab('/r/a.ts')])).toBeUndefined();
  });
});

describe('closeFileTab', () => {
  it('removes exactly the named tab', () => {
    expect(closeFileTab([tab('/r/a.ts'), tab('/r/b.ts')], '/r/a.ts')).toEqual([tab('/r/b.ts')]);
  });
});

describe('activeAfterFileClose', () => {
  it("moves to the tab that takes the closed one's slot", () => {
    const tabs = [tab('/r/a.ts'), tab('/r/b.ts'), tab('/r/c.ts')];
    expect(activeAfterFileClose(tabs, '/r/b.ts', '/r/b.ts')).toBe('/r/c.ts');
  });

  it('falls back to the new last tab when the last one closes', () => {
    const tabs = [tab('/r/a.ts'), tab('/r/b.ts')];
    expect(activeAfterFileClose(tabs, '/r/b.ts', '/r/b.ts')).toBe('/r/a.ts');
  });

  it('keeps the active tab when a different one closes', () => {
    const tabs = [tab('/r/a.ts'), tab('/r/b.ts')];
    expect(activeAfterFileClose(tabs, '/r/b.ts', '/r/a.ts')).toBe('/r/a.ts');
  });

  it('has nothing to activate once the last tab is gone', () => {
    expect(activeAfterFileClose([tab('/r/a.ts')], '/r/a.ts', '/r/a.ts')).toBeNull();
  });
});
