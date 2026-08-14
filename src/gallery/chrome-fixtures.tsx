import { ChevronDown, FolderGit2, Plus } from "lucide-preact";
import { RepositoryRail } from "../ui/repository-rail";
import { TabBar } from "../ui/tab-bar";
import { DeckToolbar } from "../ui/toolbar/deck-toolbar";
import { WorkspaceSidebar } from "../ui/workspace-sidebar";
import { createFileSurfaceController } from "../files/file-surface-controller";
import type { PaneAgent } from "../lib/process-info";
import { CHROME_ICON, DeckIcon, RAIL_ICON } from "../ui/controls/deck-icon";
import { WorktreeAgentStack } from "../ui/worktree-agent-stack";

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
 * chrome and Open board pages share the Deck toolbar and repository tree,
 * while the matrix keeps the shipping toolbar needed by its state rows.
 */

export const NOOP = (): void => {};

/**
 * No specimen opens a file, so a single shared controller with no file tabs
 * ever open is a faithful stand-in — `fileTabViews` projects an empty strip
 * segment, and neither renderer calls anything on it beyond that read.
 */
const fileControllerFixture = createFileSurfaceController();

interface SpecimenOptions {
  /** No pane to paste into — the one unavailable control the chrome has. */
  readonly promptsDisabled?: boolean;
}

/** The shipping toolbar, exactly as both layouts mount it since phase 3. */
export function deckToolbarSpecimen({
  promptsDisabled = false,
}: SpecimenOptions = {}) {
  return (
    <DeckToolbar
      explorerOpen={false}
      browserOpen={false}
      usageOpen={false}
      settingsOpen={false}
      expandActive={false}
      promptsOpen={false}
      promptsUnavailable={promptsDisabled ? "no pane to paste into" : null}
      onToggleExplorer={NOOP}
      onToggleBrowser={NOOP}
      onToggleUsage={NOOP}
      onSplitRow={NOOP}
      onSplitColumn={NOOP}
      onToggleExpand={NOOP}
      onClosePane={NOOP}
      onTogglePrompts={NOOP}
      onToggleSettings={NOOP}
    />
  );
}

export function tabBarSpecimen({
  promptsDisabled = false,
}: SpecimenOptions = {}) {
  return (
    <TabBar
      onSelectTab={NOOP}
      onCloseTab={NOOP}
      onNewTab={NOOP}
      onRenameTab={NOOP}
      onSetTabColor={NOOP}
      toolbar={deckToolbarSpecimen({ promptsDisabled })}
      onFocusAttention={NOOP}
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

export function workspaceSidebarSpecimen() {
  return (
    <WorkspaceSidebar
      onSelectTab={NOOP}
      onCloseTab={NOOP}
      onOpenWorkspace={NOOP}
      onRenameTab={NOOP}
      onSetTabColor={NOOP}
      onFocusAttention={NOOP}
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
export function repositorySidebarSpecimen() {
  return (
    <RepositoryRail
      onSelectTab={NOOP}
      onCloseTab={NOOP}
      onOpenWorkspace={NOOP}
      onRenameTab={NOOP}
      onSetTabColor={NOOP}
      onFocusAttention={NOOP}
      fileController={fileControllerFixture}
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
    name: "main",
    path: "…/spacevibe-workspace/spacevibe-deck",
    primary: true,
    active: true,
    working: true,
    agents: ["claude", "codex"],
  },
  {
    name: "pr-11",
    path: "…-892c-10bc5d1733d6/scratchpad/pr-11",
    agents: [],
  },
  {
    name: "electron-migration",
    path: "…/spacevibe-deck-worktrees/electron-migration",
    agents: ["codex"],
  },
  {
    name: "redesign/phase-1-2",
    path: "…/spacevibe-deck-worktrees/redesign-phase-1-2",
    working: true,
    agents: ["claude"],
  },
  {
    name: "feat/token-usage-dashboard",
    path: "…/spacevibe-deck-worktrees/token-usage-dashboard",
    agents: ["agy"],
  },
  {
    name: "feat/workspace-recorder",
    path: "…/spacevibe-deck-worktrees/workspace-recorder",
    agents: [],
  },
  {
    name: "refactor/deepen-architecture",
    path: "…/scratchpad-worktrees/deepen-architecture",
    working: true,
    agents: ["opencode", "gemini", "codex", "claude"],
  },
];

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
                <DeckIcon icon={FolderGit2} size={RAIL_ICON} />
              </span>
              <span class="repogroup__name">spacevibe-deck</span>
              <DeckIcon icon={ChevronDown} size={CHROME_ICON} />
            </div>
          </header>
          <div class="repogroup__worktrees">
            {AGENT_PREVIEW_ROWS.map((worktree) => (
              <div
                key={worktree.name}
                class={`wsitem ${worktree.active ? "is-active" : ""}`}
                data-state={
                  worktree.working
                    ? "working"
                    : worktree.agents.length > 0
                      ? "ready"
                      : "idle"
                }
              >
                <span class="wsitem__state" aria-hidden="true" />
                <span class="wsitem__text">
                  <span class="wsitem__label">
                    <span class="wsitem__name">{worktree.name}</span>
                    {worktree.primary && (
                      <span class="wsitem__badge">primary</span>
                    )}
                  </span>
                  <span class="wsitem__path">{worktree.path}</span>
                </span>
                <WorktreeAgentStack agents={worktree.agents} />
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
    </nav>
  );
}
