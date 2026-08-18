// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Host stubs the rail's import graph still reaches under jsdom. The logo,
// favicon-scan, native-dialog and file-drop paths left the rail on 2026-08-16
// with `TabPopover`; these stay because the repositories store and the session
// journal below it still talk to the host.
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
// Phosphor components are React `forwardRef` objects. The production Vite
// pipeline aliases them through `preact/compat`, but Vitest externalises the
// package before that alias and jsdom tries to use the object as a tag name.
// The rail tests exercise the controls around the icon, not Phosphor itself.
vi.mock('./controls/deck-icon', () => ({
  CHROME_ICON: 13,
  // The `done` status mark draws at feature size since 2026-08-16 (+2px).
  FEATURE_ICON: 15,
  // The `New` row draws at rail size (DL-27.14), not chrome size.
  RAIL_ICON: 16,
  DeckIcon: () => null,
}));

import { activeTabIndex, tabViews } from '../terminal/tabs-store';
import type { PaneView, TabView } from '../terminal/tabs-store';
import { AgentRail } from './agent-rail';
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
import { paneTails } from '../terminal/session-tail-store';
import { browserSurfaceActive } from '../browser/browser-store';

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

/** A quiet agent pane; every test names only the fields it cares about. */
function pane(overrides: Partial<PaneView> = {}): PaneView {
  return {
    paneId: 11,
    agent: 'claude',
    attention: 'none',
    phase: 'idle',
    // Never ran: the default quiet pane reads `idle`; a test wanting the
    // checked-run `done` says `hasRun: true` itself.
    hasRun: false,
    changedAt: 1_000,
    ...overrides,
  };
}

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
    panes: [pane()],
    ...overrides,
  };
}

let host: HTMLDivElement;
let fileController: FileSurfaceController;

const NOOP = (): void => {};

function mount(props: Partial<Parameters<typeof AgentRail>[0]> = {}): void {
  act(() => {
    render(
      <AgentRail
        onSelectTab={NOOP}
        onCloseTab={NOOP}
        onOpenWorkspace={NOOP}
        onFocusPane={NOOP}
        onResumeWorktree={NOOP}
        fileController={fileController}
        showAgentPresence
        {...props}
      />,
      host,
    );
  });
}

/**
 * Sidebar layout as `App` assembles it: the rail in the navigation column AND
 * the stage's tab strip, alive at the same time. Only that shape can show
 * whether the ⌘⇧R chord still reaches exactly one surface.
 */
function mountSidebarLayout(): void {
  act(() => {
    render(
      <>
        <AgentRail
          onSelectTab={NOOP}
          onCloseTab={NOOP}
          onOpenWorkspace={NOOP}
          onFocusPane={NOOP}
          onResumeWorktree={NOOP}
          fileController={fileController}
          showAgentPresence
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

function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function rows(): NodeListOf<HTMLElement> {
  return host.querySelectorAll<HTMLElement>('.asr-row--tab');
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
  paneTails.value = new Map();
  browserSurfaceActive.value = false;
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
  paneTails.value = new Map();
  browserSurfaceActive.value = false;
  vi.restoreAllMocks();
});

describe('AgentRail attention rows', () => {
  it('keeps every tab in the one stream, whatever its state', async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, attention: 'requested' }),
          pane({ paneId: 12, agent: 'codex', attention: 'completed' }),
          pane({ paneId: 13, agent: 'gemini', phase: 'working' }),
        ],
      }),
    ];
    mount();
    await settle();

    // The pinned `Needs you` block was removed on 2026-08-16: nothing lifts a
    // row out of its project, so the project is printed exactly once. An
    // unnamed multi-agent tab is HEADLESS (DL-27.13) — one item, no parent
    // row, every pane a leaf.
    expect(host.querySelector('.asr-block')).toBeNull();
    expect(host.querySelectorAll('.asr-stream .asr-item')).toHaveLength(1);
    expect(host.querySelectorAll('.asr-stream .asr-row--tab')).toHaveLength(0);
    expect(host.querySelectorAll('.asr-leaf')).toHaveLength(3);
  });

  it('never reorders a row by its state', async () => {
    tabViews.value = [
      tab({
        key: 1,
        panes: [pane({ paneId: 11, attention: 'requested', changedAt: 9_000 })],
      }),
      tab({
        key: 2,
        panes: [pane({ paneId: 21, attention: 'error', changedAt: 1_000 })],
      }),
    ];
    mount();
    await settle();

    const listed = host.querySelectorAll<HTMLElement>('.asr-stream .asr-row--tab');
    expect(listed).toHaveLength(2);
    // Open order, not severity: the marks differ, the positions do not move.
    expect(listed[0].dataset.state).toBe('asked');
    expect(listed[1].dataset.state).toBe('failed');
  });
});

describe('AgentRail click contract', () => {
  it('selects the tab by its GLOBAL index when the row body is pressed', async () => {
    const onSelectTab = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, changedAt: 9_000 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, changedAt: 1_000 })] }),
    ];
    mount({ onSelectTab });
    await settle();

    // Keyed lookup, not positional: the stream is ordered by recency, so the
    // second tab is not the second row.
    click(host.querySelector('[data-key="2"] .asr-row__hit'));
    expect(onSelectTab).toHaveBeenCalledWith(1);
  });

  it('focuses the exact pane behind a leaf row', async () => {
    const onFocusPane = vi.fn();
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: 'claude' }), pane({ paneId: 12, agent: 'codex' })],
      }),
    ];
    mount({ onFocusPane });
    await settle();

    // A multi-agent tab lists its panes as leaf rows (DL-27.13); each leaf is
    // the chip's contract at row width — press to focus that exact pane.
    const leaves = host.querySelectorAll<HTMLElement>('.asr-leaf');
    expect(leaves).toHaveLength(2);
    click(leaves[1]);
    expect(onFocusPane).toHaveBeenCalledWith(0, 12);
  });

  it('lists every pane of a multi-agent tab as a leaf, with no overflow count', async () => {
    tabViews.value = [
      tab({
        panes: [
          pane({ paneId: 11, agent: 'claude' }),
          pane({ paneId: 12, agent: 'codex' }),
          pane({ paneId: 13, agent: 'gemini' }),
          pane({ paneId: 14, agent: 'opencode' }),
        ],
      }),
    ];
    mount();
    await settle();

    // The chip budget and its `+N` died with the tree (DL-27.13): every agent
    // is a visible leaf, so there is nothing left to count or disclose.
    expect(host.querySelectorAll('.asr-leaf')).toHaveLength(4);
    expect(host.querySelector('.asr-chip--more')).toBeNull();
    expect(host.querySelector('.asr-chips')).toBeNull();
    expect(host.querySelector('button.asr-disclose')).toBeNull();
  });

  it("closes only the row's own tab from the hover action", async () => {
    const onCloseTab = vi.fn();
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, changedAt: 9_000 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21, changedAt: 1_000 })] }),
    ];
    mount({ onCloseTab });
    await settle();

    click(host.querySelector('[data-key="2"] .asr-row__action--close'));
    expect(onCloseTab).toHaveBeenCalledWith(1);
    expect(onCloseTab).toHaveBeenCalledTimes(1);
  });

  it('has no options control left on the row', async () => {
    // `TabPopover` and the rename/colour/logo features it carried were removed
    // on 2026-08-16; close is the only hover action a row has now.
    mount();
    await settle();

    expect(host.querySelector('.asr-row__action--options')).toBeNull();
    expect(host.querySelector('.tab-popover')).toBeNull();
    expect(host.querySelectorAll('.asr-row__action')).toHaveLength(rows().length);
  });
});

describe('AgentRail pane tree', () => {
  it('goes headless even for a NAMED multi-agent tab while the tree is hidden', async () => {
    // `PANE_TREE_HIDDEN` (owner, 2026-08-16, temporary): only agents and
    // projects show, so a named multi-agent tab also drops its parent row and
    // its panes stand as plain full-width rows. This test pins the temporary
    // state; when the constant flips back, a named tab regains its parent row
    // and the leaves become its siblings again (DL-27.13).
    tabViews.value = [
      tab({
        name: 'pair',
        panes: [pane({ paneId: 11, agent: 'claude' }), pane({ paneId: 12, agent: 'codex' })],
      }),
    ];
    mount();
    await settle();

    const item = host.querySelector<HTMLElement>('.asr-item');
    expect(host.querySelectorAll('.asr-item')).toHaveLength(1);
    expect(item?.querySelector('.asr-row--tab')).toBeNull();
    const leaves = item?.querySelectorAll(':scope > .asr-leaf.asr-leaf--flat');
    expect(leaves).toHaveLength(2);
    // The old expanded-pane machinery stays dead: no disclosure, no nested
    // pane list.
    expect(host.querySelector('.asr-disclose')).toBeNull();
    expect(host.querySelector('.asr-panes')).toBeNull();
  });

  it('renders an unnamed multi-agent tab headless: no parent row at all', async () => {
    // With the count label gone the parent row held only its trailing meta,
    // and the owner ruled the empty stretch out (DL-27.13): the tree alone is
    // the tab, and the rail offers no close for it — the strip's ✕ and ⌘W do.
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: 'claude' }), pane({ paneId: 12, agent: 'codex' })],
      }),
    ];
    mount();
    await settle();

    const item = host.querySelector<HTMLElement>('.asr-item');
    expect(item?.dataset.headless).toBe('true');
    expect(item?.querySelector('.asr-row--tab')).toBeNull();
    expect(item?.querySelector('.asr-row__action--close')).toBeNull();
    expect(item?.querySelectorAll(':scope > .asr-leaf')).toHaveLength(2);
  });

  it('gives each flat leaf its own turn and its own quiet mark', async () => {
    // DL-27.15: a leaf is a row in its own right, so it carries its PANE's
    // state and its PANE's turn — one agent asking beside another working
    // must not read as one mood.
    tabViews.value = [
      tab({
        name: 'pair',
        panes: [
          pane({ paneId: 11, agent: 'claude', attention: 'requested' }),
          pane({ paneId: 12, agent: 'codex', phase: 'working' }),
        ],
      }),
    ];
    paneTails.value = new Map([
      [11, 'Permission needed: prisma migrate dev'],
      [12, 'Running the suite'],
    ]);
    mount();
    await settle();

    const leaves = [...host.querySelectorAll<HTMLElement>('.asr-leaf')];
    expect(leaves.map((leaf) => leaf.dataset.quiet)).toEqual(['false', 'true']);
    expect(leaves.map((leaf) => leaf.querySelector('.asr-leaf__msg')?.textContent)).toEqual([
      'Permission needed: prisma migrate dev',
      'Running the suite',
    ]);
  });

  it("puts a leaf's turn where its agent name was, not on a second line", async () => {
    // DL-27.15 amended (2026-08-17): one line per row. The glyph beside the
    // turn is the agent's name, so the sentence takes that word's slot — and
    // a pane that has said nothing keeps the name rather than going blank.
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: 'claude' }), pane({ paneId: 12, agent: 'codex' })],
      }),
    ];
    paneTails.value = new Map([[11, 'Wrote the migration']]);
    mount();
    await settle();

    const leaves = [...host.querySelectorAll<HTMLElement>('.asr-leaf')];
    expect(leaves[0].querySelector('.asr-leaf__agent')).toBeNull();
    expect(leaves[0].querySelector('.asr-leaf__msg')?.textContent).toBe('Wrote the migration');
    expect(leaves[1].querySelector('.asr-leaf__agent')?.textContent).toBe('codex');
    expect(leaves[1].querySelector('.asr-leaf__msg')).toBeNull();
  });

  it('leaves a flat leaf with nothing to say showing its agent alone', async () => {
    tabViews.value = [
      tab({
        panes: [pane({ paneId: 11, agent: 'claude' }), pane({ paneId: 12, agent: 'codex' })],
      }),
    ];
    mount();
    await settle();

    expect(host.querySelector('.asr-leaf__msg')).toBeNull();
    expect([...host.querySelectorAll('.asr-leaf__agent')].map((name) => name.textContent)).toEqual([
      'claude',
      'codex',
    ]);
  });

  it('puts the agent glyph before the tab name and age on the same line', async () => {
    tabViews.value = [
      tab({
        name: 'api handoff',
        panes: [pane({ paneId: 11, agent: 'claude', changedAt: 1_000 })],
      }),
    ];
    mount();
    await settle();

    const row = rows()[0];
    const directClasses = [...row.children].map((child) => child.className);
    expect(directClasses.indexOf('asr-chips')).toBeLessThan(directClasses.indexOf('asr-row__name'));
    expect(row.querySelector('.asr-row__age')?.parentElement).toBe(row);
  });

  it('gives every row that has a turn its sentence, quiet or not', async () => {
    tabViews.value = [
      tab({
        key: 1,
        // A checked run: quiet. (`completed` is no longer quiet — it reads
        // as `asked` under the owner's 2026-08-16 merge.)
        panes: [pane({ paneId: 11, hasRun: true })],
      }),
      tab({
        key: 2,
        panes: [pane({ paneId: 21, attention: 'requested' })],
      }),
    ];
    paneTails.value = new Map([
      [11, 'Wrote the migration'],
      [21, 'Permission needed: prisma migrate dev'],
    ]);
    mount();
    await settle();

    // DL-27.15 (2026-08-17): the turn stopped being the asked/failed row's
    // privilege. Every row that has something to say says it, and the quiet
    // ones recede instead of going blank — a list where only the loud rows
    // carried a sentence read as two kinds of thing.
    expect(rows()[0].querySelector('.asr-row__msg')?.textContent).toBe('Wrote the migration');
    expect(rows()[1].querySelector('.asr-row__msg')?.textContent).toBe(
      'Permission needed: prisma migrate dev',
    );
    expect(rows()[0].dataset.quiet).toBe('true');
    expect(rows()[1].dataset.quiet).toBe('false');
  });

  it("spends the row's one line on the turn, not on the agent's name", async () => {
    // The one-line amendment (2026-08-17): three `claude` rows in a project
    // were told apart by nothing but their sentence, which was also the text
    // being trimmed hardest. The glyph still says which agent this is.
    tabViews.value = [tab({ key: 1, panes: [pane({ paneId: 11 })] })];
    paneTails.value = new Map([[11, 'Reading the rail model']]);
    mount();
    await settle();

    expect(rows()[0].querySelector('.asr-row__name strong')).toBeNull();
    expect(rows()[0].querySelector('.asr-row__msg')?.textContent).toBe('Reading the rail model');
  });

  it('keeps a name the user typed even when its agent has spoken', async () => {
    // A derived label is a word the glyph or the cluster header already says;
    // a typed one exists nowhere else, so the turn follows it on the same
    // line instead of replacing it.
    tabViews.value = [tab({ key: 1, name: 'release cut', panes: [pane({ paneId: 11 })] })];
    paneTails.value = new Map([[11, 'Reading the rail model']]);
    mount();
    await settle();

    expect(rows()[0].querySelector('.asr-row__name strong')?.textContent).toBe('release cut');
    expect(rows()[0].querySelector('.asr-row__msg')?.textContent).toBe('Reading the rail model');
  });

  it("falls back to the tab's own identity when nothing has been said", async () => {
    // Nobody renamed this tab and no session tail reaches it, so the row
    // spends its line on what the tab is: its one agent.
    tabViews.value = [tab({ key: 1, panes: [pane({ paneId: 11 })] })];
    mount();
    await settle();

    expect(rows()[0].querySelector('.asr-row__msg')).toBeNull();
    expect(rows()[0].querySelector('.asr-row__name strong')?.textContent).toBe('claude');
    expect(rows()[0].dataset.quiet).toBe('true');
  });

  it('lets a project header collapse and restore its tab rows', async () => {
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11 })] }),
      tab({ key: 2, panes: [pane({ paneId: 21 })] }),
    ];
    mount();
    await settle();

    const header = host.querySelector<HTMLElement>('button.asr-cluster__head');
    expect(header?.getAttribute('aria-expanded')).toBe('true');
    expect(rows()).toHaveLength(2);

    click(header);
    expect(header?.getAttribute('aria-expanded')).toBe('false');
    expect(rows()).toHaveLength(0);

    click(header);
    expect(header?.getAttribute('aria-expanded')).toBe('true');
    expect(rows()).toHaveLength(2);
  });
});

describe('AgentRail clusters (DL-27.9/DL-27.12)', () => {
  it('prints the project once and names each row by its tab', async () => {
    tabViews.value = [
      tab({ key: 1, panes: [pane({ paneId: 11, agent: 'claude' })] }),
      tab({
        key: 2,
        workspacePath: '/r/side',
        panes: [pane({ paneId: 21, agent: 'codex' })],
      }),
    ];
    mount();
    await settle();

    const heads = host.querySelectorAll<HTMLElement>('.asr-cluster__head');
    expect(heads).toHaveLength(1);
    expect(heads[0].textContent).toBe('main');
    // Both tabs belong to one repository, so neither row repeats its name.
    expect([...rows()].map((row) => row.querySelector('strong')?.textContent)).toEqual([
      'claude',
      'codex',
    ]);
    // The worktree suffix survives the change — it is the only thing telling
    // two tabs of one project apart.
    expect(rows()[1].querySelector('.asr-row__worktree')?.textContent).toBe('side');
  });

  it('keeps project → tab for a project with one tab', async () => {
    mount();
    await settle();

    expect(host.querySelector('.asr-cluster__head')?.textContent).toBe('main');
    expect(rows()[0].querySelector('strong')?.textContent).toBe('claude');
  });

  it('keeps a tab that wants the user under its own project header', async () => {
    tabViews.value = [
      tab({
        key: 1,
        panes: [pane({ paneId: 11, attention: 'requested' })],
      }),
      tab({ key: 2, panes: [pane({ paneId: 21 })] }),
      tab({
        key: 3,
        workspacePath: '/r/side',
        panes: [pane({ paneId: 31 })],
      }),
    ];
    mount();
    await settle();

    // Two tabs of one project, one of them asking: one header, both rows under
    // it, and the asking row names the TAB like every other row in a cluster.
    const heads = host.querySelectorAll('.asr-stream .asr-cluster__head');
    expect(heads).toHaveLength(1);
    expect(host.querySelectorAll('.asr-stream .asr-row--tab')).toHaveLength(3);
    const asking = host.querySelector<HTMLElement>('.asr-stream .asr-row--tab[data-state="asked"]');
    expect(asking?.querySelector('strong')?.textContent).toBe('claude');
  });
});

describe('AgentRail state wording (DL-27.2)', () => {
  it('keeps the status word out of the row while title and aria still say it', async () => {
    tabViews.value = [tab({ panes: [pane({ attention: 'error' })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe('failed');
    // The mark is the fast read; the word is never painted in the row.
    expect(row.textContent).not.toContain('failed');
    expect(row.querySelector('.asr-row__mark')?.getAttribute('data-state')).toBe('failed');

    const hit = row.querySelector<HTMLElement>('.asr-row__hit');
    expect(hit?.getAttribute('aria-label')).toContain('failed');
    expect(hit?.getAttribute('title')).toContain('failed');
  });
});

describe('AgentRail archived rows', () => {
  it('resumes a workspace with an archived session and no live tab', async () => {
    sessionArchive.value = { '/r/side': { savedAt: 1, tabs: [] } };
    const onResumeWorktree = vi.fn();
    mount({ onResumeWorktree });
    await settle();

    const archived = host.querySelector<HTMLElement>('.asr-row--archived');
    expect(archived).not.toBeNull();
    expect(archived?.getAttribute('role')).toBe('button');
    expect(archived?.getAttribute('tabindex')).toBe('0');
    expect(archived?.getAttribute('aria-label')).toBe('Resume last session in main · side');
    // No live pane has said anything, so the row carries no message line.
    expect(archived?.querySelector('.asr-row__msg')).toBeNull();

    click(archived);
    expect(onResumeWorktree).toHaveBeenCalledWith('/r/side');

    onResumeWorktree.mockClear();
    act(() => {
      archived?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onResumeWorktree).toHaveBeenCalledWith('/r/side');
  });

  it('still draws a tab that runs no agent, without a message line or chips', async () => {
    // The rail is the sidebar's only list, so a shell-only tab it declines to
    // draw is a tab the user cannot reach from there. `voice` is null here and
    // every agent-shaped part of the row has to stand down on its own.
    tabViews.value = [tab({ panes: [pane({ agent: null })] })];
    mount();
    await settle();

    const row = rows()[0];
    expect(row.dataset.state).toBe('idle');
    expect(row.querySelector('.asr-row__msg')).toBeNull();
    expect(row.querySelector('.asr-chips')).toBeNull();
    expect(host.querySelector('.asr-disclose')).toBeNull();
  });

  it('lists no archived row for a worktree with no recorded session', async () => {
    mount();
    await settle();

    expect(host.querySelector('.asr-row--archived')).toBeNull();
  });
});

describe('AgentRail carried-over jobs', () => {
  it('raises no popover in sidebar layout, with the strip mounted beside it', async () => {
    // Both surfaces used to consume the ⌘⇧R chord; the action, the signal and
    // the popover all went on 2026-08-16, so neither can raise one.
    mountSidebarLayout();
    await settle();

    expect(host.querySelector('.tab-popover')).toBeNull();
  });

  it("keeps the row's identity dataset on the row element", async () => {
    mount();
    await settle();

    expect(rows()[0].dataset.key).toBe('1');
  });

  it('drops the active wash while a browser surface holds the stage', async () => {
    // DL-27.8: the wash is carried by the ITEM, not by the row inside it.
    // Asserted on the wrapper for that reason.
    mount();
    await settle();
    const items = () => host.querySelectorAll<HTMLElement>('.asr-item');
    expect(items()[0].dataset.active).toBe('true');
    expect(rows()[0].classList.contains('is-active')).toBe(false);

    act(() => {
      browserSurfaceActive.value = true;
    });
    expect(items()[0].dataset.active).toBe('false');
  });

  it('opens the Open board from the New row', async () => {
    const onOpenWorkspace = vi.fn();
    mount({ onOpenWorkspace });
    await settle();

    click(host.querySelector('.asr-open'));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it('puts New above every project (owner, 2026-08-17)', async () => {
    // It was the LAST row of the list until this date, so the assertion is the
    // decision: a reorder inside `.asr-rail__list` is invisible to every other
    // test here, and nothing else would notice it sliding back down.
    mount();
    await settle();

    const list = host.querySelector('.asr-rail__list');
    expect(list?.firstElementChild?.classList.contains('asr-openrow')).toBe(true);
    // …and the projects are genuinely below it, not merely absent.
    const order = [...(list?.querySelectorAll('.asr-openrow, .asr-cluster') ?? [])];
    expect(order.length).toBeGreaterThan(1);
    expect(order[0].classList.contains('asr-openrow')).toBe(true);
  });

  it('captions the New row with Workspace, outside the button', async () => {
    // The caption is not a second way to open the board: if it ever moves
    // inside `.asr-open`, clicking it fires `onOpenWorkspace` and this fails.
    // `aria-hidden` keeps the button's own name the only one announced.
    mount();
    await settle();

    const caption = host.querySelector('.asr-openrow__label');
    expect(caption?.textContent).toBe('Workspace');
    expect(caption?.getAttribute('aria-hidden')).toBe('true');
    expect(caption?.closest('.asr-open')).toBeNull();
    expect(host.querySelector('.asr-open')?.textContent).toBe('New');
  });
});

/**
 * The rail's shell contract, read off the stylesheet rather than off a render.
 *
 * `DesktopChrome` puts `sidebarNavigation` straight into `.window`'s grid, so
 * the rail has to place ITSELF; a rail with no placement auto-flows into the
 * next free cell, lands under the stage on top of the status row, and leaves
 * the navigation column empty. That shipped once, on 2026-08-16, and no test
 * saw it: jsdom loads no stylesheet, so every render assertion above passed
 * against a rail nobody could see. These read the declarations directly, which
 * is the only layer where this class of defect is visible to a suite at all.
 */
describe('AgentRail shell contract', () => {
  // Repo-root relative, the way `scripts/electron-ipc-contract.test.ts` reads
  // its own source of truth: `import.meta.url` is not a file URL under the
  // jsdom environment this file runs in. `src/styles.css` is an `@import`
  // index since the 2026-08-16 partial split, itself sub-split into
  // `04a`/`04b` once `04-agent-rail.css` crossed the 800-line ceiling; every
  // selector below (`.asr-rail`, `.asr-rail__list`, both collapsed-column
  // rules) lives in the shell half, `04a-agent-rail.css`.
  const stylesheet = readFileSync('src/styles/04a-agent-rail.css', 'utf8');

  /**
   * The declarations of the rule whose selector is exactly `selector`.
   *
   * Matched on the literal `\n<selector> {` rather than by regex: the
   * stylesheet is Prettier-formatted, so a selector always owns its own line,
   * and an exact string keeps `.asr-rail` from answering for
   * `.asr-rail--mounted`.
   */
  function ruleBody(selector: string): string {
    const start = stylesheet.indexOf(`\n${selector} {`);
    expect(start, `no \`${selector} {\` rule in src/styles/04a-agent-rail.css`).toBeGreaterThan(-1);
    const open = stylesheet.indexOf('{', start);
    return stylesheet.slice(open + 1, stylesheet.indexOf('}', open));
  }

  it("places itself in the window grid's navigation cell", () => {
    const body = ruleBody('.asr-rail');
    expect(body).toContain('grid-column: 1');
    expect(body).toContain('grid-row: 2');
  });

  it('paints the recessed side surface rather than letting the stage through', () => {
    // DL-18.7: the frame and the rail are one continuous recessed surface.
    expect(ruleBody('.asr-rail')).toContain('background: var(--sidebar-bg)');
  });

  it('scrolls its rows inside a box that can shrink', () => {
    // `min-height: 0` is what lets a flex child shrink to its scrollport
    // instead of stretching to its content and pushing the footer out.
    const body = ruleBody('.asr-rail__list');
    expect(body).toContain('overflow-y: auto');
    expect(body).toContain('min-height: 0');
  });

  it("answers the collapsed column instead of inheriting the old rail's rules", () => {
    // Every DL-18.9 collapse rule is `.wsbar`/`.wsitem`-scoped, so replacing
    // the rail silently dropped them all. These are the rail's own.
    expect(stylesheet).toContain('[data-sidebar-collapsed="true"] .asr-rail');
    expect(stylesheet).toContain('[data-sidebar-collapsed="true"] .asr-open__label');
  });
});
