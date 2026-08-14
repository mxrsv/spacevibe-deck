import { RepositoryRail } from "../ui/repository-rail";
import { TabBar } from "../ui/tab-bar";
import { DeckToolbar } from "../ui/toolbar/deck-toolbar";
import { WorkspaceSidebar } from "../ui/workspace-sidebar";
import { createFileSurfaceController } from "../files/file-surface-controller";

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
      browserOpen={false}
      usageOpen={false}
      settingsOpen={false}
      expandActive={false}
      promptsOpen={false}
      promptsUnavailable={promptsDisabled ? "no pane to paste into" : null}
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
      onNewTab={NOOP}
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
      onNewTab={NOOP}
      onRenameTab={NOOP}
      onSetTabColor={NOOP}
      onFocusAttention={NOOP}
      fileController={fileControllerFixture}
    />
  );
}
