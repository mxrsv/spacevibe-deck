// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The board pulls Tauri-backed stores and IPC in through its imports; stub
// them so the tree mounts under jsdom, mirroring workspace-sidebar.test.tsx.
// `missingPaths` steers the dirs_exist answer per test.
const missingPaths = new Set<string>();
let pickedFolder: string | null = null;
vi.mock('../host/store-host', () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock('../host/dialog-host', () => ({
  open: vi.fn(async () => pickedFolder),
}));
vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(async () => {
    throw new Error('OpenBoard must use the initialized desktop environment');
  }),
}));
vi.mock('../host/bridge', () => ({
  invoke: vi.fn(async (cmd: string, args?: { paths?: string[] }) => {
    if (cmd === 'dirs_exist') {
      return (args?.paths ?? []).map((path) => !missingPaths.has(path));
    }
    return null;
  }),
}));
vi.mock('../terminal/pty-client', () => ({
  defaultPtyClient: { detectAgents: vi.fn(async () => []) },
}));

import { WORKSPACES_VERSION } from '../lib/workspace-recents';
import type { RecentWorkspace } from '../lib/workspace-recents';
import { PRESETS_VERSION } from '../lib/preset-schema';
import { presetsData } from '../presets/presets-store';
import { workspacesData } from './workspaces-store';
import { OpenBoard } from './open-board';
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from '../lib/platform';
import { resetAgentDetectionForTests } from '../terminal/agent-detection-store';

const NOW = 1_800_000_000_000;

function seed(paths: readonly string[]): void {
  const recents: RecentWorkspace[] = paths.map((path, index) => ({
    path,
    lastOpenedAt: NOW - index,
  }));
  workspacesData.value = { version: WORKSPACES_VERSION, recents };
}

/**
 * Drain the open path's awaits before asserting.
 *
 * One click opens, and `openWorkspace` awaits the agent probe AND the
 * `dirs_exist` liveness pass before it reaches `onOpen`. A bare `act` returns
 * while those are still in flight, so an assertion could read the board
 * mid-click.
 */
const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('OpenBoard removal flow', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    // The probe is cached in a module store now, so a list one test detected
    // would otherwise answer for the next one.
    resetAgentDetectionForTests();
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: 'macos',
      homeDir: '/Users/dev',
    });
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    missingPaths.clear();
    pickedFolder = null;
  });

  afterEach(() => {
    act(() => {
      render(null, host);
    });
    workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
    presetsData.value = { version: PRESETS_VERSION, presets: [] };
    resetDesktopEnvironmentForTests();
  });

  const mount = async (onOpen: () => Promise<boolean> = async () => true): Promise<void> => {
    await act(async () => {
      render(
        <OpenBoard
          canCancel={false}
          onCancel={() => {}}
          onOpen={onOpen}
          recentSessions={[]}
          onResumeSession={() => {}}
        />,
        host,
      );
    });
  };

  const rowNames = (): string[] =>
    [...host.querySelectorAll('.row .row__name')].map((el) => el.textContent ?? '');

  const removeButton = (name: string): HTMLButtonElement | null => {
    const row = [...host.querySelectorAll('.row')].find(
      (el) => el.querySelector('.row__name')?.textContent === name,
    );
    return row?.querySelector<HTMLButtonElement>('.row__x') ?? null;
  };

  it('draws the folder and remove actions as icons', async () => {
    seed(['/w/alpha']);
    await mount();

    expect(host.querySelector('.row__ico.deck-icon--folder-open')).not.toBeNull();
    expect(host.querySelector('.home-action .deck-icon--folder-plus')).not.toBeNull();

    const x = removeButton('alpha');
    // Removing a recent forgets a pointer; it deletes nothing on disk, so it
    // is a dismissal (X), not a trash can.
    expect(x?.querySelector('.deck-icon--x')).not.toBeNull();
    expect(x?.textContent).toBe('');
  });

  it('removing a recent drops just that row', async () => {
    seed(['/w/alpha', '/w/beta', '/w/gamma']);
    await mount();
    expect(rowNames()).toEqual(['alpha', 'beta', 'gamma']);

    const x = removeButton('beta');
    expect(x).not.toBeNull();
    await act(async () => {
      x?.click();
    });

    expect(rowNames()).toEqual(['alpha', 'gamma']);
  });

  it('uses the initialized Windows home directory for display', async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: 'windows',
      homeDir: 'C:/Users/dev',
    });
    seed(['C:/Users/dev/repo']);

    await mount();

    expect(host.querySelector('.row__path')?.textContent).toBe('~/repo');
  });

  it('remove-all missing clears the group', async () => {
    seed(['/w/ghost', '/w/wraith']);
    missingPaths.add('/w/ghost').add('/w/wraith');
    await mount();

    const removeAll = host.querySelector<HTMLButtonElement>('.gsep button');
    expect(removeAll?.textContent).toBe('Remove 2');
    await act(async () => {
      removeAll?.click();
    });

    expect(host.querySelector('.gsep')).toBeNull();
    expect(host.querySelectorAll('.row')).toHaveLength(0);
  });

  it("double-clicking a row's × removes without opening the workspace", async () => {
    seed(['/w/alpha', '/w/beta']);
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    const x = removeButton('alpha');
    await act(async () => {
      x?.click();
    });
    // Second rapid click on the same spot fires a dblclick on the × of the
    // row that took its place — it must not bubble into the row's open
    // handler.
    const nextX = removeButton('beta');
    await act(async () => {
      nextX?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the folder picker with Ctrl+Shift+O on Windows and opens what it picks', async () => {
    resetDesktopEnvironmentForTests();
    initializeDesktopEnvironment({
      platform: 'windows',
      homeDir: String.raw`C:\Users\dev`,
    });
    pickedFolder = 'C:/work';
    const onOpen = vi.fn(async () => true);
    await mount(onOpen);

    const openAction = host.querySelector<HTMLButtonElement>('.home-action');
    expect(openAction?.querySelector('kbd')?.textContent).toBe('Ctrl+Shift+O');

    const board = host.querySelector<HTMLDivElement>('.open-board');
    await act(async () => {
      board?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'o',
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    // Plain Ctrl+O is the Windows new-tab binding, not Deck's — no pick.
    expect(onOpen).not.toHaveBeenCalled();

    await act(async () => {
      board?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'O',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      );
    });

    await settle();

    // A picked folder has no remembered combo, so it opens with the default
    // preset and whatever the probe found (nothing here → Shell).
    expect(onOpen).toHaveBeenCalledWith('C:/work', expect.anything(), null);
  });
});
