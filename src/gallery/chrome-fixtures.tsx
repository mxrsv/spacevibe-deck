import { useSignal } from "@preact/signals";
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  MoreHorizontal,
  Plus,
} from "lucide-preact";
import { ChromeActions } from "../ui/chrome-actions";
import {
  CHROME_ICON,
  DeckIcon,
  RAIL_ICON,
} from "../ui/controls/deck-icon";
import { TabBar } from "../ui/tab-bar";
import { WorkspaceSidebar } from "../ui/workspace-sidebar";

/**
 * The chrome components wired up for a specimen, in one place.
 *
 * `TabBar` takes fifteen callbacks and `ChromeActions` takes eight, none of
 * which a gallery has anything to do. Two sections render the same shell, so
 * before this existed the bundles were typed out twice and the next prop added
 * to `TabBar` would have had to be added to both — a gallery drifting from
 * itself, one file at a time, which is the failure the whole harness exists to
 * catch.
 *
 * Only the parts that are genuinely identical live here. How a section
 * assembles `DesktopChrome` around them is the section's own business: the
 * chrome and Open board pages share the Deck toolbar and repository tree,
 * while the matrix keeps the generic app actions needed by its state rows.
 */

export const NOOP = (): void => {};

interface SpecimenOptions {
  /** No pane to paste into — the one disabled control the chrome has. */
  readonly promptsDisabled?: boolean;
}

type WorktreeState = "ready" | "working" | "attention" | "idle";

interface WorktreeFixture {
  readonly id: string;
  readonly name: string;
  readonly branch: string;
  readonly detail: string;
  readonly primary?: boolean;
  readonly state: WorktreeState;
}

interface RepositoryFixture {
  readonly id: string;
  readonly name: string;
  readonly worktrees: readonly WorktreeFixture[];
}

const REPOSITORY_FIXTURES: readonly RepositoryFixture[] = [
  {
    id: "deck",
    name: "spacevibe-deck",
    worktrees: [
      {
        id: "deck-main",
        name: "main",
        branch: "main",
        detail: "~/Development/spacevibe-deck",
        primary: true,
        state: "ready",
      },
      {
        id: "deck-electron",
        name: "electron-migration",
        branch: "electron-migration",
        detail: "~/spacevibe-deck-worktrees/electron-migration",
        state: "working",
      },
    ],
  },
  {
    id: "bench",
    name: "spacevibe-bench",
    worktrees: [
      {
        id: "bench-main",
        name: "main",
        branch: "main",
        detail: "~/Development/spacevibe-bench",
        primary: true,
        state: "idle",
      },
      {
        id: "bench-larvacean",
        name: "larvacean",
        branch: "mxrsv/larvacean",
        detail: "~/spacevibe-bench-worktrees/larvacean",
        state: "attention",
      },
    ],
  },
];

const LOADING_TICK_COUNT = 12;
const LOADING_CYCLE_MS = 1_080;

const LOADING_TICKS = Array.from(
  { length: LOADING_TICK_COUNT },
  (_, index) => ({
    index,
    rotate: (index / LOADING_TICK_COUNT) * 360,
  }),
);

function WorktreeLoadingRing() {
  const tickStepMs = LOADING_CYCLE_MS / LOADING_TICK_COUNT;
  return (
    <span class="gx-worktree-loading" aria-hidden="true">
      {LOADING_TICKS.map((tick) => (
        <span
          key={tick.index}
          class="gx-worktree-loading__tick"
          style={{
            animationDelay: `${-tick.index * tickStepMs}ms`,
            transform: `translate(-50%, -50%) rotate(${tick.rotate}deg) translateY(-7.1px)`,
          }}
        />
      ))}
    </span>
  );
}

function WorktreeActivity({
  state,
  label,
}: {
  state: WorktreeState;
  label: string;
}) {
  if (state === "working") {
    return (
      <span
        class="gx-worktree__activity gx-worktree__activity--working"
        role="status"
        aria-label={`${label}: agents working`}
      >
        <WorktreeLoadingRing />
      </span>
    );
  }
  if (state === "attention") {
    return (
      <span
        class="gx-worktree__activity gx-worktree__activity--attention"
        role="status"
        aria-label={`${label}: needs attention`}
      >
        <span class="gx-worktree__attention-dot" aria-hidden="true" />
      </span>
    );
  }
  return <span class="gx-worktree__activity" aria-hidden="true" />;
}

interface WorktreeRowProps {
  readonly selected: boolean;
  readonly worktree: WorktreeFixture;
  readonly onSelect: () => void;
}

function WorktreeRow({ selected, worktree, onSelect }: WorktreeRowProps) {
  return (
    <button
      type="button"
      class={`gx-worktree ${selected ? "is-selected" : ""}`}
      data-state={worktree.state}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span class="gx-worktree__state" aria-hidden="true" />
      <span class="gx-worktree__copy">
        <span class="gx-worktree__titleline">
          <span class="gx-worktree__name">{worktree.name}</span>
          {worktree.primary && <span class="gx-worktree__badge">primary</span>}
        </span>
        <span class="gx-worktree__branch">{worktree.branch}</span>
        <span class="gx-worktree__path">{worktree.detail}</span>
      </span>
      <WorktreeActivity state={worktree.state} label={worktree.name} />
    </button>
  );
}

interface RepositoryGroupProps {
  readonly collapsed: boolean;
  readonly repository: RepositoryFixture;
  readonly selectedWorktreeId: string;
  readonly onSelectWorktree: (worktreeId: string) => void;
  readonly onToggle: () => void;
}

function RepositoryGroup(props: RepositoryGroupProps) {
  const { collapsed, repository, selectedWorktreeId } = props;
  return (
    <section class="gx-repository">
      <header class="gx-repository__header">
        <button
          type="button"
          class="gx-repository__toggle"
          aria-expanded={!collapsed}
          onClick={props.onToggle}
        >
          <span class="gx-repository__mark">
            <DeckIcon icon={FolderGit2} size={RAIL_ICON} />
          </span>
          <span class="gx-repository__name">{repository.name}</span>
          <DeckIcon
            icon={collapsed ? ChevronRight : ChevronDown}
            size={CHROME_ICON}
          />
        </button>
        <span class="gx-repository__actions">
          <button type="button" aria-label={`More actions for ${repository.name}`}>
            <DeckIcon icon={MoreHorizontal} size={CHROME_ICON} />
          </button>
          <button type="button" aria-label={`Add worktree to ${repository.name}`}>
            <DeckIcon icon={Plus} size={CHROME_ICON} />
          </button>
        </span>
      </header>
      {!collapsed && (
        <div class="gx-repository__worktrees">
          {repository.worktrees.map((worktree) => (
            <WorktreeRow
              key={worktree.id}
              worktree={worktree}
              selected={selectedWorktreeId === worktree.id}
              onSelect={() => props.onSelectWorktree(worktree.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RepositorySidebarSpecimen() {
  const selectedWorktree = useSignal("deck-electron");
  const collapsedRepos = useSignal<ReadonlySet<string>>(new Set());

  function toggleRepository(repositoryId: string): void {
    const current = collapsedRepos.value;
    const ids = current.has(repositoryId)
      ? [...current].filter((id) => id !== repositoryId)
      : [...current, repositoryId];
    collapsedRepos.value = new Set(ids);
  }

  return (
    <nav class="gx-workspace-tree" aria-label="Repositories and worktrees">
      <div class="gx-workspace-tree__eyebrow">Repositories</div>
      {REPOSITORY_FIXTURES.map((repository) => (
        <RepositoryGroup
          key={repository.id}
          repository={repository}
          collapsed={collapsedRepos.value.has(repository.id)}
          selectedWorktreeId={selectedWorktree.value}
          onSelectWorktree={(id) => {
            selectedWorktree.value = id;
          }}
          onToggle={() => toggleRepository(repository.id)}
        />
      ))}
      <button type="button" class="gx-workspace-tree__add">
        <DeckIcon icon={Plus} size={CHROME_ICON} />
        <span>Open repository</span>
      </button>
    </nav>
  );
}

export function tabBarSpecimen({
  promptsDisabled = false,
}: SpecimenOptions = {}) {
  return (
    <TabBar
      settingsOpen={false}
      expandActive={false}
      promptsOpen={false}
      promptsDisabled={promptsDisabled}
      onSelectTab={NOOP}
      onCloseTab={NOOP}
      onNewTab={NOOP}
      onSplitRow={NOOP}
      onSplitColumn={NOOP}
      onClosePane={NOOP}
      onRenameTab={NOOP}
      onSetTabColor={NOOP}
      onToggleSettings={NOOP}
      onTogglePrompts={NOOP}
      onToggleExpand={NOOP}
      onFocusAttention={NOOP}
    />
  );
}

export function chromeActionsSpecimen({
  promptsDisabled = false,
}: SpecimenOptions = {}) {
  return (
    <ChromeActions
      settingsOpen={false}
      expandActive={false}
      promptsOpen={false}
      promptsDisabled={promptsDisabled}
      onSplitRow={NOOP}
      onSplitColumn={NOOP}
      onClosePane={NOOP}
      onToggleExpand={NOOP}
      onTogglePrompts={NOOP}
      onToggleSettings={NOOP}
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
      {chromeActionsSpecimen()}
    </>
  );
}

export function workspaceSidebarSpecimen() {
  return (
    <WorkspaceSidebar
      onSelectTab={NOOP}
      onCloseTab={NOOP}
      onNewTab={NOOP}
      onRenameTab={NOOP}
      onSetTabColor={NOOP}
      onFocusAttention={NOOP}
    />
  );
}

export function repositorySidebarSpecimen() {
  return <RepositorySidebarSpecimen />;
}
