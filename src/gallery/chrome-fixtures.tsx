import { ChromeActions } from "../ui/chrome-actions";
import { RepositoryRail } from "../ui/repository-rail";
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
    />
  );
}
