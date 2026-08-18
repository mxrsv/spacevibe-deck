// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The editor's own boot is Gate M's concern (and file-editor.test.tsx's) —
// this suite is about the pipe from a tree click to a mounted `.fileview`,
// not about Monaco. A promise that never resolves keeps the editor in its
// permanent "loading" state without pulling in the full stub.
vi.mock('../editor-host', async () => {
  const actual = await vi.importActual<typeof import('../editor-host')>('../editor-host');
  return {
    ...actual,
    loadMonaco: () => new Promise(() => {}),
  };
});

import { ExplorerTab } from './explorer-tab';
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from '../file-surface-controller';
import { activeFileTab, documentFor, resetFileSurfaces, setListing } from '../file-surface-store';
import type { FileClient } from '../file-client';

const WS = '/r';
const FILE = `${WS}/a.ts`;

const client: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: 'refused', reason: 'unused in this test' }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  listenFileChanged: async () => () => {},
};

let host: HTMLDivElement;
let controller: FileSurfaceController;

beforeEach(() => {
  resetFileSurfaces();
  controller = createFileSurfaceController({ client });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  controller.dispose();
});

describe('ExplorerTab', () => {
  it('selecting a file creates the preview surface and supplies its editor document', async () => {
    act(() => {
      setListing(WS, WS, [{ name: 'a.ts', path: FILE, directory: false, outOfRoot: false }]);
    });
    act(() => {
      render(<ExplorerTab controller={controller} workspacePath={WS} />, host);
    });

    await act(async () => {
      host.querySelector<HTMLElement>('.file-tree__row')!.click();
    });

    // The preview surface: the tab is active and its document exists
    // (spec §4.1) — the read itself resolves to "refused" here on purpose.
    expect(activeFileTab.value).toBe(FILE);
    expect(documentFor(FILE)).toBeDefined();
    // …and the tab renders NO editor. The document goes to the stage
    // (`.stage__surface`, mounted by `App`) since 2026-08-14; a click here
    // opens the tab and stops there.
    expect(host.querySelector('.fileview')).toBeNull();
  });

  it('shows an empty state instead of a tree when the tab has no workspace', () => {
    act(() => {
      render(<ExplorerTab controller={controller} workspacePath={null} />, host);
    });

    expect(host.querySelector('.file-tree')).toBeNull();
    expect(host.querySelector('.explorer-tab__empty')).not.toBeNull();
  });
});
