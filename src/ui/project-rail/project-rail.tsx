import { useEffect, useMemo, useState } from "preact/hooks";
import type { AgentRailView } from "../agent-rail-model";
import { Button } from "../controls/button";
import { buildRailView } from "../rail-view-model";
import {
  forgetRailFocus,
  RAIL_STOPS,
  recoverRailFocus,
  rememberRailFocus,
} from "./project-rail-focus";
import { isRailItemFocused, type RailSelection } from "./project-rail-model";
import { ArchivedSection, HiddenSection } from "./project-rail-parked";
import { projectCommandsFor, type ProjectDeps } from "./project-rail-project-commands";
import { FlatSection, ProjectSection, type RailRowEnv } from "./project-rail-sections";
import {
  foldedProjects,
  railNow,
  railViewState,
  runRailClock,
  setRailQuery,
  showArchived,
} from "./project-rail-state";

/** While a search is set no project is folded: every one with a match shows it. */
const NO_FOLDS: ReadonlySet<string> = new Set();

export interface ProjectRailProps extends RailSelection, ProjectDeps {
  /** The view `AgentRail` already builds, so the two rails cannot disagree about it. */
  readonly view: AgentRailView;
}

/**
 * Up and down walk the list (Home and End jump to its ends), and Enter presses a row; on a
 * header or a section head it is the button's own press. Local to the list on purpose: a
 * bare key is the terminal's, so nothing here listens on the window.
 */
function onListKeyDown(event: KeyboardEvent): void {
  const target = event.target;
  // A chord is the keymap's (⌘⌥↑ focuses a pane, ⌘⇧↵ is a binding): only the bare key walks.
  if (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    !(target instanceof HTMLElement) ||
    !target.matches(RAIL_STOPS)
  ) {
    return;
  }
  if (event.key === "Enter" && target.matches("[data-rail-row]")) {
    // The press below is the one selection; the click Enter would add is cancelled.
    event.preventDefault();
    target.click();
    return;
  }
  if (!(event.currentTarget instanceof HTMLElement)) {
    return;
  }
  const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(RAIL_STOPS)];
  const at = stops.indexOf(target);
  const next =
    event.key === "ArrowDown"
      ? stops[at + 1]
      : event.key === "ArrowUp"
        ? stops[at - 1]
        : event.key === "Home"
          ? stops[0]
          : event.key === "End"
            ? stops[stops.length - 1]
            : undefined;
  if (next !== undefined) {
    event.preventDefault();
    next.focus();
  }
}

/**
 * The project-first rail's list (spec LAY-1..LAY-4), mounted by `AgentRail` behind the
 * `projectRail` release switch in place of its cluster list.
 */
export function ProjectRail({ view, onFocusPane, onSelectTab, ...deps }: ProjectRailProps) {
  useEffect(() => runRailClock(), []);
  const state = railViewState.value;
  const searching = state.query.trim() !== "";
  const byProject = state.grouping === "project";
  // The user's folds are kept aside, so clearing a search brings them back.
  const folded = searching || !byProject ? NO_FOLDS : foldedProjects.value;
  // The row the keyboard last stood on: it keeps the Tab stop (and its buttons) while it lives.
  const [activeId, setActiveId] = useState<string | null>(null);
  // The memo reads the clock once, as the shipped rail's does. Only time buckets age, so only
  // that grouping follows the ticking clock; the others never rebuild on a tick.
  const clock = state.grouping === "time" ? railNow.value : 0;
  const model = useMemo(
    () => buildRailView(view, state, clock === 0 ? Date.now() : clock),
    [view, state, clock],
  );
  const rows = model.groups
    .filter((group) => !folded.has(group.key))
    .flatMap((group) => group.items);
  // One Tab stop for all rows: where the keyboard last was (an archived row included), else the
  // focused row, else the first.
  const tabStopId = (
    [...rows, ...(showArchived.value ? model.archived : [])].find((item) => item.id === activeId) ??
    rows.find(isRailItemFocused) ??
    rows[0]
  )?.id;
  const env: RailRowEnv = {
    tabStopId,
    activeId,
    pinned: state.pinned,
    selection: { onFocusPane, onSelectTab },
    deps,
    projects: byProject ? projectCommandsFor(model.groups, view.stream, deps) : new Map(),
  };
  // A row that archived, hid or closed took the keyboard with it: hand it to a neighbour.
  useEffect(recoverRailFocus);
  return (
    <section
      aria-label="Open agents"
      onKeyDown={onListKeyDown}
      onBlurCapture={(event: FocusEvent) => {
        // Focus that went to an element of its own (the terminal, another field) is not lost,
        // and a later close must not pull it back here. A popup of the rail's keeps the memory,
        // and so does a removal, which leaves no related target.
        const { relatedTarget: next, currentTarget } = event;
        if (
          next instanceof Element &&
          currentTarget instanceof Node &&
          !currentTarget.contains(next) &&
          next.closest('[role="menu"],[role="dialog"],[role="listbox"]') === null
        ) {
          forgetRailFocus();
        }
      }}
      onFocusCapture={(event: FocusEvent) => {
        const { target, currentTarget } = event;
        if (!(target instanceof Element) || !(currentTarget instanceof HTMLElement)) {
          return;
        }
        rememberRailFocus(currentTarget, target);
        const owner = target.closest("[data-rail-item]");
        if (owner !== null) {
          setActiveId(owner.getAttribute("data-rail-item"));
        }
      }}
      className="ui-preset min-w-0 bg-transparent pb-3"
    >
      {model.groups.map((group) =>
        byProject ? (
          <ProjectSection key={group.key} group={group} folded={folded.has(group.key)} env={env} />
        ) : (
          <FlatSection key={group.key} group={group} env={env} />
        ),
      )}
      {model.groups.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-muted-foreground">
          <p>{searching ? "No sessions match" : "Nothing here"}</p>
          {searching ? (
            <Button variant="outline" size="sm" onClick={() => setRailQuery("")}>
              Clear search
            </Button>
          ) : null}
        </div>
      ) : null}
      <ArchivedSection items={model.archived} env={env} />
      <HiddenSection projects={model.hidden} />
    </section>
  );
}
