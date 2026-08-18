import { CaretDown, GitFork, Plus } from '@phosphor-icons/react';
import { RepositoryRail } from '../ui/repository-rail';
import { AgentRail } from '../ui/agent-rail';
import { TabBar } from '../ui/tab-bar';
import { DeckToolbar } from '../ui/toolbar/deck-toolbar';
import { createFileSurfaceController } from '../files/file-surface-controller';
import type { PaneAgent } from '../lib/process-info';
import type { RailTab } from '../repositories/repository-model';
import { IDLE_ATTENTION_SUMMARY } from '../terminal/tabs-store';
import { activeTabIndex } from '../terminal/tabs-store';
import { CHROME_ICON, DeckIcon, RAIL_ICON } from '../ui/controls/deck-icon';
import { WorktreeAgentStack } from '../ui/worktree-agent-stack';
import { TabStrip } from '../ui/tab-strip';
import { SidebarBanner } from '../ui/sidebar-banner';
import { SIDEBAR_TOOLS_HIDDEN, SidebarActions } from '../ui/sidebar-actions';

/**
 * The chrome components wired up for a specimen, in one place.
 *
 * `TabBar` and `DeckToolbar` take a pile of callbacks, none of which a gallery
 * has anything to do. Two sections render the same shell, so before this
 * existed the bundles were typed out twice and the next prop added to `TabBar`
 * would have had to be added to both — a gallery drifting from itself, one
 * file at a time, which is the failure the whole harness exists to catch.
 *
 * Only the parts that are genuinely identical live here. How a section
 * assembles `DesktopChrome` around them is the section's own business: the
 * chrome and Open board pages share the Deck toolbar and AgentRail navigation,
 * while the matrix keeps the shipping toolbar needed by its state rows.
 */

export const NOOP = (): void => {};

/**
 * One shared controller for every specimen. The file tabs it projects are
 * seeded into the store by `main.tsx`, not by a specimen — `fileTabViews`
 * reads the ACTIVE workspace's tabs from the module store, so the chips
 * appear in every strip specimen without any of them owning the state.
 */
const fileControllerFixture = createFileSurfaceController();

function selectGalleryTab(index: number): void {
  activeTabIndex.value = index;
}

interface SpecimenOptions {
  /** No pane to paste into — the one unavailable control the chrome has. */
  readonly promptsDisabled?: boolean;
}

/** The shipping toolbar, exactly as both layouts mount it since phase 3. */
export function deckToolbarSpecimen({ promptsDisabled = false }: SpecimenOptions = {}) {
  return (
    <DeckToolbar
      browserActive={false}
      settingsOpen={false}
      expandActive={false}
      promptsOpen={false}
      promptsUnavailable={promptsDisabled ? 'no pane to paste into' : null}
      onToggleBrowser={NOOP}
      onSplitRow={NOOP}
      onSplitColumn={NOOP}
      onToggleExpand={NOOP}
      onClosePane={NOOP}
      onTogglePrompts={NOOP}
      onToggleSettings={NOOP}
    />
  );
}

export function tabBarSpecimen({ promptsDisabled = false }: SpecimenOptions = {}) {
  return (
    <TabBar
      onSelectTab={NOOP}
      onCloseTab={NOOP}
      onNewTab={NOOP}
      toolbar={deckToolbarSpecimen({ promptsDisabled })}
      onSelectBrowser={NOOP}
      onCloseBrowser={NOOP}
      fileController={fileControllerFixture}
    />
  );
}

export function chatGptToolbarSpecimen() {
  return (
    <>
      <button type="button" class="gx-deck-switcher" aria-label="Deck menu">
        <span class="gx-deck-switcher__mark">D</span>
        <span>Deck</span>
        <span class="gx-deck-switcher__chevron">⌄</span>
      </button>
      {deckToolbarSpecimen()}
    </>
  );
}

interface AgentRailSpecimenOptions {
  readonly onSelectTab?: (index: number) => void;
  readonly onFocusPane?: (index: number, paneId: number) => void;
  readonly showFooter?: boolean;
  readonly promptsDisabled?: boolean;
}

/**
 * The shipping sidebar navigation with seeded gallery stores underneath it.
 * Current shell specimens share this fixture so none can silently fall back
 * to the parked `RepositoryRail` or to a hand-built copy of the rail.
 */
export function agentRailNavigationSpecimen({
  onSelectTab = selectGalleryTab,
  onFocusPane = (index) => selectGalleryTab(index),
  // Follows the shipped rail: while `SIDEBAR_TOOLS_HIDDEN` is on, the target
  // shell has no footer, and a specimen that kept drawing one would be drift.
  // A specimen that wants the footer as a DL §28 record still passes `true`.
  showFooter = !SIDEBAR_TOOLS_HIDDEN,
  promptsDisabled = false,
}: AgentRailSpecimenOptions = {}) {
  return (
    <AgentRail
      onSelectTab={onSelectTab}
      onCloseTab={NOOP}
      onOpenWorkspace={NOOP}
      onFocusPane={onFocusPane}
      onResumeWorktree={NOOP}
      showAgentPresence
      fileController={fileControllerFixture}
      footer={
        showFooter ? (
          <SidebarActions
            sessionsAvailable
            promptsUnavailable={promptsDisabled ? 'no pane to paste into' : null}
            promptsOpen={false}
            onOpenBrowser={NOOP}
            onOpenUsage={NOOP}
            onOpenSessions={NOOP}
            onOpenPrompts={NOOP}
            onOpenSettings={NOOP}
          />
        ) : null
      }
    />
  );
}

/**
 * The real rail, not a fixture.
 *
 * It was a hand-built specimen tree until 2026-08-13, which meant the gallery
 * was reviewing a drawing of the rail rather than the rail. `host-stub.ts`
 * answers `git_repository` with a deliberately uneven set of worktrees, so the
 * states below — open, working, needs-attention, not-open, missing, locked,
 * and a folder that is not a repository — are the component's own rendering of
 * real data through the real model.
 */
export function repositorySidebarSpecimen({
  onSelectTab = NOOP,
}: {
  readonly onSelectTab?: (index: number) => void;
} = {}) {
  return (
    <RepositoryRail
      onSelectTab={onSelectTab}
      onCloseTab={NOOP}
      onOpenWorkspace={NOOP}
      onFocusAttention={NOOP}
      onResumeWorktree={NOOP}
      fileController={fileControllerFixture}
    />
  );
}

/** The real sidebar-mode strip, wired so gallery rail clicks change its scope. */
export function repositoryScopedTabStripSpecimen() {
  return (
    <TabStrip
      onSelectTab={selectGalleryTab}
      onCloseTab={NOOP}
      onNewTab={NOOP}
      onSelectBrowser={NOOP}
      onCloseBrowser={NOOP}
      fileController={fileControllerFixture}
      scopeToActiveRepository
    />
  );
}

interface WorktreeAgentPreview {
  readonly name: string;
  readonly path: string;
  readonly primary?: boolean;
  readonly active?: boolean;
  readonly working?: boolean;
  readonly agents: readonly PaneAgent[];
}

const AGENT_PREVIEW_ROWS: readonly WorktreeAgentPreview[] = [
  {
    name: 'main',
    path: '…/spacevibe-workspace/spacevibe-deck',
    primary: true,
    active: true,
    working: true,
    agents: ['claude', 'codex', 'opencode'],
  },
  {
    name: 'pr-11',
    path: '…-892c-10bc5d1733d6/scratchpad/pr-11',
    agents: [],
  },
  {
    name: 'electron-migration',
    path: '…/spacevibe-deck-worktrees/electron-migration',
    agents: ['codex'],
  },
  {
    name: 'redesign/phase-1-2',
    path: '…/spacevibe-deck-worktrees/redesign-phase-1-2',
    working: true,
    agents: ['claude'],
  },
  {
    name: 'feat/token-usage-dashboard',
    path: '…/spacevibe-deck-worktrees/token-usage-dashboard',
    agents: ['agy'],
  },
  {
    name: 'feat/workspace-recorder',
    path: '…/spacevibe-deck-worktrees/workspace-recorder',
    agents: [],
  },
  {
    name: 'refactor/deepen-architecture',
    path: '…/scratchpad-worktrees/deepen-architecture',
    working: true,
    agents: ['opencode', 'gemini', 'codex', 'claude'],
  },
];

function previewTabs(worktree: WorktreeAgentPreview): readonly RailTab[] {
  return worktree.agents.map((agent, index) => ({
    index,
    key: index,
    label: agent,
    customName: null,
    workspacePath: null,
    active: worktree.active === true && index === 0,
    agents: [agent],
    attention: IDLE_ATTENTION_SUMMARY,
    agentBusy: worktree.working === true,
    unread: false,
  }));
}

/**
 * Gallery fixture for the approved worktree agent marks.
 *
 * It renders the shipping `WorktreeAgentStack`, while keeping fixture rows so
 * every density case remains visible without depending on live PTYs. Presence
 * and working stay separate: the mark remains while an agent waits at prompt;
 * only the existing spinner/state treatment says work is happening.
 */
export function worktreeAgentPresenceSpecimen() {
  return (
    <nav
      class="wsbar wsbar--repos gx-agent-rail-preview"
      aria-label="Worktree agent presence preview"
    >
      <div class="wsbar__list">
        <section class="repogroup">
          <header class="repogroup__head">
            <div class="repogroup__toggle">
              <span class="repogroup__mark" aria-hidden="true">
                <DeckIcon icon={GitFork} size={RAIL_ICON} />
              </span>
              <span class="repogroup__name">spacevibe-deck</span>
              <DeckIcon icon={CaretDown} size={CHROME_ICON} />
            </div>
          </header>
          <div class="repogroup__worktrees">
            {AGENT_PREVIEW_ROWS.map((worktree) => (
              <div
                key={worktree.name}
                class={`wsitem ${worktree.active ? 'is-active' : ''}`}
                data-state={
                  worktree.working ? 'working' : worktree.agents.length > 0 ? 'ready' : 'idle'
                }
              >
                <span class="wsitem__state" aria-hidden="true" />
                <span class="wsitem__text">
                  <span class="wsitem__label">
                    <span class="wsitem__name">{worktree.name}</span>
                    {worktree.primary && <span class="wsitem__badge">primary</span>}
                  </span>
                  <span class="wsitem__path">{worktree.path}</span>
                </span>
                <WorktreeAgentStack tabs={previewTabs(worktree)} onSelectTab={NOOP} />
              </div>
            ))}
          </div>
        </section>
        <button type="button" class="wsbar__add">
          <span class="wsbar__add-glyph">
            <DeckIcon icon={Plus} size={CHROME_ICON} />
          </span>
          <span>Open workspace</span>
        </button>
      </div>
      <SidebarBanner />
    </nav>
  );
}

type WorktreeItemDirection = 'compact' | 'focus' | 'agent';

const WORKTREE_ITEM_DIRECTIONS = [
  {
    id: 'compact',
    index: 'A',
    label: 'Compact tree',
    note: 'One-line index · path on title · edge selection',
  },
  {
    id: 'focus',
    index: 'B',
    label: 'Focus expand',
    note: 'Compact at rest · selected context opens in place',
  },
  {
    id: 'agent',
    index: 'C',
    label: 'Agent lane',
    note: 'Full-width branch · terminal controls own row two',
  },
] as const satisfies readonly {
  readonly id: WorktreeItemDirection;
  readonly index: string;
  readonly label: string;
  readonly note: string;
}[];

const WORKTREE_VARIANT_ROWS = AGENT_PREVIEW_ROWS.filter(
  (worktree) =>
    worktree.name !== 'feat/token-usage-dashboard' && worktree.name !== 'feat/workspace-recorder',
);

function previewState(worktree: WorktreeAgentPreview): string {
  if (worktree.working) {
    return 'working';
  }
  return worktree.agents.length > 0 ? 'ready' : 'idle';
}

function WorktreeVariantRow({
  direction,
  worktree,
}: {
  readonly direction: WorktreeItemDirection;
  readonly worktree: WorktreeAgentPreview;
}) {
  return (
    <div
      class={`wsitem gx-worktree-row ${worktree.active ? 'is-active' : ''}`}
      data-state={previewState(worktree)}
      title={direction === 'compact' ? worktree.path : undefined}
    >
      <span
        class="wsitem__state"
        role="status"
        aria-label={`${worktree.name}: ${previewState(worktree)}`}
      />
      <span class="wsitem__text">
        <span class="wsitem__label">
          <span class="wsitem__name">{worktree.name}</span>
          {worktree.primary && <span class="wsitem__badge">primary</span>}
        </span>
        <span class="wsitem__path">{worktree.path}</span>
      </span>
      <WorktreeAgentStack tabs={previewTabs(worktree)} onSelectTab={NOOP} />
    </div>
  );
}

function WorktreeVariantRail({ direction }: { readonly direction: WorktreeItemDirection }) {
  return (
    <nav
      class={`gx-worktree-variant__rail gx-worktree-variant--${direction}`}
      aria-label={`${direction} worktree item direction`}
    >
      <header class="gx-worktree-variant__repo">
        <span class="repogroup__mark" aria-hidden="true">
          <DeckIcon icon={GitFork} size={RAIL_ICON} />
        </span>
        <span>spacevibe-deck</span>
        <DeckIcon icon={CaretDown} size={CHROME_ICON} />
      </header>
      <div class="gx-worktree-variant__rows">
        {WORKTREE_VARIANT_ROWS.map((worktree) => (
          <WorktreeVariantRow key={worktree.name} direction={direction} worktree={worktree} />
        ))}
      </div>
    </nav>
  );
}

/** Three gallery-only item compositions; no shipping rail behavior changes. */
export function worktreeItemVariantsSpecimen() {
  return (
    <div class="gx-worktree-variants">
      {WORKTREE_ITEM_DIRECTIONS.map((direction) => (
        <article
          key={direction.id}
          class={`gx-worktree-variant gx-worktree-variant--${direction.id}`}
        >
          <header class="gx-worktree-variant__head">
            <span class="gx-worktree-variant__index">{direction.index}</span>
            <span class="gx-worktree-variant__title">{direction.label}</span>
            <span class="gx-worktree-variant__note">{direction.note}</span>
          </header>
          <WorktreeVariantRail direction={direction.id} />
        </article>
      ))}
    </div>
  );
}
