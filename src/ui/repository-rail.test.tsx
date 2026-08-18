// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same stubs the flat sidebar's suite installs: the rail reaches the host for
// logo persistence, favicon scanning and the native dialog through its
// imports, none of which a jsdom tree can provide.
vi.mock('../host/store-host', () => ({
  Store: {
    load: vi.fn(async () => ({
      get: vi.fn(async () => undefined),
      set: vi.fn(async () => {}),
      save: vi.fn(async () => {}),
    })),
  },
}));
vi.mock('../host/dialog-host', () => ({ open: vi.fn(async () => null) }));
vi.mock('../host/bridge', () => ({ invoke: vi.fn(async () => null) }));
vi.mock('../terminal/file-drop', () => ({
  installFileDrop: vi.fn(async () => () => {}),
}));

import { activeTabIndex, tabViews, type TabView } from '../terminal/tabs-store';
import { RepositoryRail } from './repository-rail';
import { TabStrip } from './tab-strip';
import {
  collapsedRepositories,
  configureRepositoryClient,
  invalidateRepositoryScans,
} from '../repositories/repositories-store';
import type { RepositoryScan } from '../repositories/repository-client';
import { initializeDesktopEnvironment, resetDesktopEnvironmentForTests } from '../lib/platform';
import {
  createFileSurfaceController,
  type FileSurfaceController,
} from '../files/file-surface-controller';
import { resetFileSurfaces } from '../files/file-surface-store';
import type { FileClient } from '../files/file-client';
import { workspacesData } from '../open-board/workspaces-store';
import { WORKSPACES_VERSION } from '../lib/workspace-recents';
import { sessionArchive } from '../terminal/session-journal';

const fileClient: FileClient = {
  listDir: async () => [],
  readFile: async () => ({ kind: 'refused', reason: 'unused in this test' }),
  writeFile: async (_root, path) => ({ path, mtimeMs: 1, size: 1 }),
  statFiles: async (_root, paths) =>
    paths.map((path) => ({ path, exists: true, mtimeMs: 1, size: 1 })),
  watchPaths: async () => {},
  setDirtyFiles: async () => {},
  listenFileChanged: async () => () => {},
};

const SCAN: RepositoryScan = {
  kind: 'repository',
  key: '/r/.git',
  root: '/r/main',
  worktrees: [
    {
      path: '/r/main',
      head: 'a',
      branch: 'main',
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    },
    {
      path: '/r/side',
      head: 'b',
      branch: 'side',
      bare: false,
      detached: false,
      locked: null,
      prunable: null,
    },
  ],
};

function tab(overrides: Partial<TabView> = {}): TabView {
  return {
    key: 1,
    process: 'node',
    name: null,
    dotColor: null,
    workspacePath: '/r/main',
    agents: [],
    agentBusy: false,
    unread: false,
    ...overrides,
  };
}

let host: HTMLDivElement;
let fileController: FileSurfaceController;

const NOOP = (): void => {};

function mount(props: Partial<Parameters<typeof RepositoryRail>[0]> = {}): void {
  act(() => {
    render(
      <RepositoryRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        fileController={fileController}
        onOpenWorkspace={NOOP}
        onResumeWorktree={NOOP}
        showAgentPresence
        {...props}
      />,
      host,
    );
  });
}

/**
 * Sidebar layout as `App` actually assembles it since 2026-08-14: the rail in
 * the navigation column AND the tab strip on the stage, alive at the same
 * time. Everything else in this file mounts the rail alone, which is exactly
 * the blind spot that let a chord fire twice.
 */
function mountSidebarLayout(): void {
  act(() => {
    render(
      <>
        <RepositoryRail
          onSelectTab={NOOP}
          onCloseTab={NOOP}
          fileController={fileController}
          onOpenWorkspace={NOOP}
          onResumeWorktree={NOOP}
        />
        <div class="stage__strip">
          <TabStrip
            onSelectTab={NOOP}
            onCloseTab={NOOP}
            fileController={fileController}
            onNewTab={NOOP}
            onSelectBrowser={NOOP}
            onCloseBrowser={NOOP}
            scopeToActiveRepository
          />
        </div>
      </>,
      host,
    );
  });
}

/** Let the scan promise and the signal update it triggers both settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  initializeDesktopEnvironment({ platform: 'macos', homeDir: '/Users/dev' });
  host = document.createElement('div');
  document.body.appendChild(host);
  invalidateRepositoryScans();
  collapsedRepositories.value = new Set();
  configureRepositoryClient({ scan: async () => SCAN });
  workspacesData.value = {
    version: WORKSPACES_VERSION,
    recents: [
      { path: '/r/main', lastOpenedAt: 2 },
      { path: '/r/side', lastOpenedAt: 1 },
    ],
  };
  tabViews.value = [tab()];
  activeTabIndex.value = 0;
  resetFileSurfaces();
  fileController = createFileSurfaceController({ client: fileClient });
  sessionArchive.value = {};
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  invalidateRepositoryScans();
  resetDesktopEnvironmentForTests();
  workspacesData.value = { version: WORKSPACES_VERSION, recents: [] };
  fileController.dispose();
  resetFileSurfaces();
  sessionArchive.value = {};
  vi.restoreAllMocks();
});

describe('RepositoryRail', () => {
  it('groups the open tab under its repository and lists the sibling worktree', async () => {
    mount();
    await settle();
    expect(host.querySelector('.repogroup__name')?.textContent).toBe('main');
    // One interactive row for the open tab, one readout for a previously
    // opened worktree with no current session.
    expect(host.querySelectorAll('.wsitem').length).toBe(2);
    expect(host.querySelectorAll('.wsitem--readout').length).toBe(1);
  });

  it('hides discovered worktrees that have never appeared in Deck recents', async () => {
    workspacesData.value = {
      version: WORKSPACES_VERSION,
      recents: [{ path: '/r/main', lastOpenedAt: 1 }],
    };
    mount();
    await settle();

    expect(host.querySelectorAll('.wsitem')).toHaveLength(1);
    expect(host.textContent).toContain('main');
    expect(host.textContent).not.toContain('side');
  });

  it('uses a hollow state dot instead of a workspace avatar for every row', async () => {
    mount();
    await settle();

    const rows = host.querySelectorAll('.wsitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector('.wsitem__state')).not.toBeNull();
      expect(row.querySelector('.wsitem__logo')).toBeNull();
    }
    expect(rows[0].querySelector('.wsitem__state')?.getAttribute('aria-label')).toBe('main: open');
    expect(rows[1].querySelector('.wsitem__state')?.getAttribute('aria-label')).toBe(
      'side: not open',
    );
  });

  it('keeps an attention state dot actionable without selecting its row', async () => {
    tabViews.value = [
      tab({
        attention: {
          kind: 'error',
          actionableCount: 1,
          workingCount: 0,
          unreadCount: 0,
        },
      }),
    ];
    const onFocusAttention = vi.fn();
    const onSelectTab = vi.fn();
    mount({ onFocusAttention, onSelectTab });
    await settle();

    const dot = host.querySelector('button.wsitem__state') as HTMLButtonElement;
    expect(dot).not.toBeNull();
    expect(dot.getAttribute('aria-label')).toBe('main: needs attention');

    act(() => {
      dot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onFocusAttention).toHaveBeenCalledWith(0);
    expect(onSelectTab).not.toHaveBeenCalled();
    expect(host.querySelector('.tab-popover')).toBeNull();
  });

  it("shows the worktree's recognized agents independently from activity", async () => {
    tabViews.value = [
      tab({ key: 1, agents: ['claude'], agentBusy: false }),
      tab({ key: 2, agents: ['codex'], agentBusy: false }),
    ];
    mount();
    await settle();

    expect(host.querySelectorAll('.worktree-agents__logo')).toHaveLength(2);
    expect(host.querySelector('.worktree-agents')?.getAttribute('aria-label')).toBe(
      '2 agent tabs in this worktree',
    );
  });

  it('renders one worktree row with one focusable agent button per tab', async () => {
    const onSelectTab = vi.fn();
    tabViews.value = [
      tab({ key: 1, agents: ['claude'] }),
      tab({ key: 2, agents: ['claude'] }),
      tab({ key: 3, agents: ['codex'] }),
    ];
    activeTabIndex.value = 1;
    mount({ onSelectTab });
    await settle();

    expect(host.querySelectorAll('.wsitem:not(.wsitem--readout)')).toHaveLength(1);
    const agentButtons = host.querySelectorAll<HTMLButtonElement>('.worktree-agents__item');
    expect(agentButtons).toHaveLength(3);
    expect(agentButtons[1].getAttribute('aria-current')).toBe('page');

    act(() => {
      agentButtons[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(2);
  });

  it('keeps agent presence out of a host that does not enable it', async () => {
    tabViews.value = [tab({ agents: ['claude'] })];
    mount({ showAgentPresence: false });
    await settle();

    expect(host.querySelector('.worktree-agents')).toBeNull();
  });

  it('selects a tab through the same callback the flat sidebar used', async () => {
    const onSelectTab = vi.fn();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: '/r/side' })];
    activeTabIndex.value = 0;
    mount({ onSelectTab });
    await settle();
    const rows = host.querySelectorAll<HTMLElement>('.wsitem:not(.wsitem--readout)');
    expect(rows.length).toBe(2);
    act(() => {
      rows[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenCalledWith(1);
  });

  it('restores the last selected tab when returning to a worktree', async () => {
    const onSelectTab = vi.fn((index: number) => {
      activeTabIndex.value = index;
    });
    tabViews.value = [
      tab({ key: 1, agents: ['claude'] }),
      tab({ key: 2, agents: ['codex'] }),
      tab({ key: 3, workspacePath: '/r/side', agents: ['opencode'] }),
    ];
    activeTabIndex.value = 1;
    mount({ onSelectTab });
    await settle();

    act(() => {
      host
        .querySelector<HTMLElement>('[data-workspace="/r/side"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
    expect(onSelectTab).toHaveBeenLastCalledWith(2);

    act(() => {
      host
        .querySelector<HTMLElement>('[data-workspace="/r/main"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectTab).toHaveBeenLastCalledWith(1);
  });

  it('closes only the active tab in an aggregated worktree row', async () => {
    const onCloseTab = vi.fn();
    tabViews.value = [tab(), tab({ key: 2 }), tab({ key: 3 })];
    activeTabIndex.value = 1;
    mount({ onCloseTab });
    await settle();
    const closers = host.querySelectorAll<HTMLElement>('.wsitem__close');
    expect(closers).toHaveLength(1);
    act(() => {
      closers[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCloseTab).toHaveBeenCalledWith(1);
  });

  it('does not make the not-open worktree a button (DL-17.3 readout)', async () => {
    mount();
    await settle();
    const readout = host.querySelector('.wsitem--readout');
    expect(readout?.tagName).toBe('DIV');
    expect(readout?.querySelector('button')).toBeNull();
    expect(readout?.getAttribute('aria-label')).toContain('not open');
  });

  it('renders an archived empty worktree as a focusable resume row, not a readout', async () => {
    sessionArchive.value = { '/r/side': { savedAt: 1, tabs: [] } };
    const onResumeWorktree = vi.fn();
    mount({ onResumeWorktree });
    await settle();

    expect(host.querySelector('.wsitem--readout')).toBeNull();
    const resumeRow = host.querySelector<HTMLElement>('.wsitem[role="button"]');
    expect(resumeRow).not.toBeNull();
    expect(resumeRow?.getAttribute('tabindex')).toBe('0');
    expect(resumeRow?.getAttribute('aria-label')).toBe('Resume last session in side');

    act(() => {
      resumeRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onResumeWorktree).toHaveBeenCalledWith('/r/side');

    onResumeWorktree.mockClear();
    act(() => {
      resumeRow?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onResumeWorktree).toHaveBeenCalledWith('/r/side');
  });

  it('keeps a non-archived empty worktree a readout, not focusable', async () => {
    mount();
    await settle();

    expect(host.querySelector('.wsitem[role="button"]')).toBeNull();
    const readout = host.querySelector<HTMLElement>('.wsitem--readout');
    expect(readout?.getAttribute('tabindex')).toBeNull();
  });

  it('names every state in the accessible label, not only in colour', async () => {
    configureRepositoryClient({
      scan: async () => ({
        ...SCAN,
        worktrees: [
          SCAN.worktrees[0],
          { ...SCAN.worktrees[1], prunable: 'gitdir file points to nowhere' },
        ],
      }),
    });
    invalidateRepositoryScans();
    mount();
    await settle();
    expect(host.querySelector('.wsitem--readout')?.getAttribute('aria-label')).toContain(
      'missing from disk',
    );
  });

  it('collapses a repository and hides its worktrees', async () => {
    mount();
    await settle();
    const toggle = host.querySelector<HTMLElement>('.repogroup__toggle');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.querySelector('.repogroup__toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelectorAll('.wsitem').length).toBe(0);
  });

  it('still renders every tab when the scan refuses', async () => {
    // Navigation must not be able to fail: a machine without git, or a folder
    // that is not a repository, gets the flat list Deck has always shown.
    configureRepositoryClient({
      scan: async () => ({ kind: 'plain', reason: 'not a git repository' }),
    });
    invalidateRepositoryScans();
    tabViews.value = [tab(), tab({ key: 2, workspacePath: '/elsewhere' })];
    mount();
    await settle();
    expect(host.querySelectorAll('.repogroup--plain').length).toBe(2);
    expect(host.querySelectorAll('.wsitem').length).toBe(2);
    expect(host.querySelectorAll('.wsitem--readout').length).toBe(0);
    // No repository header and no `primary` badge: the rail adds a tier where
    // git says there is one, and claims nothing where git said nothing.
    expect(host.querySelector('.repogroup__head')).toBeNull();
    expect(host.querySelector('.wsitem__badge')).toBeNull();
  });

  it('still renders when the scan rejects outright', async () => {
    configureRepositoryClient({
      scan: async () => {
        throw new Error('bridge is gone');
      },
    });
    invalidateRepositoryScans();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount();
    await settle();
    expect(host.querySelectorAll('.wsitem').length).toBe(1);
  });
});

/**
 * The rail answers "which repository and worktree is this session in", and
 * nothing else. "Which documents are open" is the stage strip's question
 * since 2026-08-14, and only `TabStrip` answers it — the rail's file rows are
 * gone, not moved.
 */
describe('RepositoryRail and file tabs', () => {
  it('renders no file rows, however many files the active workspace has open', async () => {
    tabViews.value = [tab()]; // /r/main, the open tab
    activeTabIndex.value = 0;
    await fileController.openFile('/r/main', '/r/main/a.ts', true); // kept
    await fileController.openFile('/r/main', '/r/main/b.ts', false); // preview
    mount();
    await settle();

    expect(host.querySelector('.wsitem--file')).toBeNull();
    // The open tab's own row, and only it.
    expect(host.querySelectorAll('.wsitem:not(.wsitem--readout)')).toHaveLength(1);
  });

  it("renders no rail rows at all once the window's last terminal tab is gone, file tabs open or not", async () => {
    tabViews.value = [tab()];
    activeTabIndex.value = 0;
    await fileController.openFile('/r/main', '/r/main/a.ts', true);
    // The window's only terminal tab closed — `activeWorkspace` survives that
    // (file-surface-store.ts's own doc comment), and the file tab with it, but
    // the rail is not where that tab is listed anymore. `buildRail` derives
    // every row from open tabs, so with zero tabs it returns no groups, and
    // there is no longer a fallback section adding any.
    tabViews.value = [];
    activeTabIndex.value = -1;
    mount();
    await settle();

    expect(host.querySelector('.repogroup__name')).toBeNull();
    expect(host.querySelector('.wsitem')).toBeNull();
  });

  it("clicking the terminal row that's still 'active' takes the stage back while a file surface is on top", async () => {
    // Regression guard for the popover-vs-reselect fork: `tab.active` alone
    // used to open the rename popover, which would leave the file surface on
    // the stage forever with no way back via that row. The popover was removed
    // on 2026-08-16, so every row press is a plain select now — the assertion
    // below stays as the guard that no third behaviour crept back in.
    tabViews.value = [tab()];
    activeTabIndex.value = 0;
    await fileController.openFile('/r/main', '/r/main/a.ts', true); // activates the file surface
    const onSelectTab = vi.fn();
    mount({ onSelectTab });
    await settle();

    const terminalRow = host.querySelector(
      '.wsitem:not(.wsitem--readout):not(.wsitem--file)',
    ) as HTMLElement;
    expect(terminalRow.classList.contains('is-active')).toBe(false);

    act(() => {
      terminalRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onSelectTab).toHaveBeenCalledWith(0);
    expect(host.querySelector('.tab-popover')).toBeNull();
  });

  it('raises no popover from a row press or a right-click', async () => {
    // `TabPopover`, the `open-tab-options` action and the shared popover slot
    // were all removed on 2026-08-16 with the rename and workspace-logo
    // features they carried. Both gestures that used to raise one are covered
    // here, in the layout where the strip is mounted beside the rail — the
    // configuration that once had two surfaces trading a single slot.
    mountSidebarLayout();
    await settle();

    const row = host.querySelector('.wsitem:not(.wsitem--readout)') as HTMLElement;
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });
    expect(host.querySelector('.tab-popover')).toBeNull();

    act(() => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.querySelector('.tab-popover')).toBeNull();
  });
});
