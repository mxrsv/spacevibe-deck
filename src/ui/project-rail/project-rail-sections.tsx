import type { RailWorktreeGroup } from "../agent-rail-model";
import type { RailGroup, RailItem } from "../rail-view-model";
import { focusCheckout } from "../worktree-card";
import { ProjectRailCheckout } from "./project-rail-checkout";
import { rowCommands } from "./project-rail-commands";
import { ProjectRailHeader } from "./project-rail-header";
import { selectRailItem, type RailSelection } from "./project-rail-model";
import { ProjectRailRow } from "./project-rail-row";
import type { ProjectCommands, ProjectDeps } from "./project-rail-project-commands";
import { toggleProjectFolded } from "./project-rail-state";
import { RememberedRailRow } from "./remembered-row";
import { rememberedRowMatches, type RememberedRowModel } from "./remembered-rows";
import type { RememberedPane } from "../../lib/session-schema";

const noop = (): void => {};

/** What every row of the list needs besides its own item. */
export interface RailRowEnv {
  /** The one row Tab reaches. */
  readonly tabStopId: string | undefined;
  /** The wrapper the keyboard last stood on: its hover buttons are in the Tab order too. */
  readonly activeId: string | null;
  readonly pinned: ReadonlySet<string>;
  readonly selection: RailSelection;
  readonly deps: ProjectDeps;
  /** Each shown project's header commands, by project key. */
  readonly projects: ReadonlyMap<string, ProjectCommands>;
  /** Each project's checkouts in the order the shipped rail drew them, rowless ones included. */
  readonly checkouts: ReadonlyMap<string, readonly RailWorktreeGroup[]>;
  /** While a search is set the list shows matches only: no checkout line stands in for none. */
  readonly searching: boolean;
  /** `stageLauncher` only: the remembered rows of each project, with what their presses do. */
  readonly remembered?: {
    readonly rows: ReadonlyMap<string, readonly RememberedRowModel[]>;
    readonly query: string;
    readonly onResume: (pane: RememberedPane) => void;
    readonly onForget: (pane: RememberedPane) => void;
  };
}

export function RailRows({
  items,
  env,
  named,
  archived = false,
}: {
  readonly items: readonly RailItem[];
  readonly env: RailRowEnv;
  /** Outside By project a row names its own project (LAY-3). */
  readonly named: boolean;
  /** The rows of the Archived section: no pin, "Unarchive" for archive. */
  readonly archived?: boolean;
}) {
  return (
    <>
      {items.map((item) => (
        <ProjectRailRow
          key={item.id}
          item={item}
          tabStop={item.id === env.tabStopId}
          pinned={env.pinned.has(item.id)}
          archived={archived}
          commands={rowCommands(item, env.deps, archived)}
          projectName={named ? item.project : undefined}
          onSelect={() => selectRailItem(item, env.selection)}
        />
      ))}
    </>
  );
}

/**
 * Checkouts with nothing open, in a project that has several. Their rows would be the only
 * way to see them, so each gets a line under the list (a project with one checkout, or a
 * search, shows none).
 */
function rowlessCheckouts(group: RailGroup, env: RailRowEnv): readonly RailWorktreeGroup[] {
  const all = env.checkouts.get(group.key) ?? [];
  return env.searching || all.length < 2
    ? []
    : all.filter((checkout) => checkout.entries.length === 0);
}

/** One project: its header, then its rows unless it is folded. */
export function ProjectSection({
  group,
  folded,
  env,
}: {
  readonly group: RailGroup;
  readonly folded: boolean;
  readonly env: RailRowEnv;
}) {
  const { onFocusPane, onSelectTab } = env.selection;
  const rowless = rowlessCheckouts(group, env);
  const remembered = (env.remembered?.rows.get(group.key) ?? []).filter((row) =>
    rememberedRowMatches(row, group.label, env.remembered?.query ?? ""),
  );
  const firstCheckout = env.checkouts.get(group.key)?.[0];
  // As the shipped header: a press focuses the project (its active checkout, else the first
  // with something open) and then folds or unfolds it.
  const focusProject = (): void => {
    const owned = env.checkouts.get(group.key) ?? [];
    const target =
      owned.find((checkout) => checkout.active) ??
      owned.find((checkout) => checkout.entries.length > 0);
    // `stageLauncher`: a launcher that is up aims itself at the pressed project instead of
    // moving focus to one of its panes, which would dismiss the launcher.
    const aim = target ?? owned[0];
    if (aim !== undefined && env.deps.cardActions?.onRetargetLauncher?.(aim.path) === true) return;
    if (target !== undefined) {
      focusCheckout(target, onFocusPane, onSelectTab);
    }
  };
  return (
    <section aria-label={group.label}>
      <ProjectRailHeader
        group={group}
        markPath={firstCheckout?.repositoryPath ?? firstCheckout?.path ?? null}
        folded={folded}
        commands={env.projects.get(group.key) as ProjectCommands}
        active={env.activeId === `project:${group.key}`}
        agentDisabled={env.deps.agentDisabled}
        onToggle={() => {
          focusProject();
          toggleProjectFolded(group.key);
        }}
      />
      {folded ? null : <RailRows items={group.items} env={env} named={false} />}
      {folded || env.remembered === undefined
        ? null
        : remembered.map((row) => (
            <RememberedRailRow
              key={row.pane.id}
              row={row}
              onResume={env.remembered?.onResume ?? noop}
              onForget={env.remembered?.onForget ?? noop}
            />
          ))}
      {folded
        ? null
        : rowless.map((checkout) => (
            <ProjectRailCheckout
              key={checkout.key}
              project={group.label}
              checkout={checkout}
              active={env.activeId === `checkout:${checkout.key}`}
              actions={env.deps.cardActions}
              onFocusPane={onFocusPane}
              onSelectTab={onSelectTab}
            />
          ))}
      {!folded && group.items.length === 0 && rowless.length === 0 && remembered.length === 0 ? (
        <p className="px-6 py-2 text-xs text-muted-foreground">No sessions</p>
      ) : null}
    </section>
  );
}

/** A status or time bucket: a plain head with its count over rows that name their project. */
export function FlatSection({
  group,
  env,
}: {
  readonly group: RailGroup;
  readonly env: RailRowEnv;
}) {
  return (
    <section aria-label={group.label}>
      <h3 className="mx-3 mt-3 mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {group.label}
        <span className="tabular-nums">{group.count}</span>
      </h3>
      <RailRows items={group.items} env={env} named />
    </section>
  );
}
