import { CaretRight, Folder, PlusSquare, X } from "@phosphor-icons/react";
import { useSignal, useSignalEffect } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon, FEATURE_ICON } from "./controls/deck-icon";
import { WorkspaceSpinner } from "./workspace-spinner";
import {
  ensureRepositoriesScanned,
  installRepositoryRescanOnFocus,
  repositoryScans,
} from "../repositories/repositories-store";
import { paneTails } from "../terminal/session-tail-store";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { workspacesData } from "../open-board/workspaces-store";
import { settings, updateSettings } from "../settings/settings-store";
import { createRailClusterDragController } from "./rail-cluster-drag";
import { pinAt, sameRailOrder } from "./rail-order";
import { buildAgentRail, type RailState, type RailStreamGroup } from "./agent-rail-model";
import { checkoutLabel } from "./agent-rail-card-model";
import { WorktreeCard } from "./worktree-card";
import type { CardActions } from "./worktree-card-menus";
import { RepositoryRail } from "./repository-rail";
import { isTauriHost } from "../updater/migration-notice";

/**
 * The agent status rail.
 *
 * Design: `docs/specs/2026-08-16-agent-status-rail-design.md`; chrome rules
 * `DL §27`. It replaces `RepositoryRail` in `DesktopChrome`'s
 * `sidebarNavigation` slot and keeps that component's callback contract, so
 * reverting is one line in `app.tsx` — the rail changes what the list is ABOUT
 * (a live agent rather than a checkout), never what selecting or closing a tab
 * means (R4).
 *
 * One list, no mode switch: a cluster per project in the order the user opened
 * them. The `New` launcher moved to the frame beside `SidebarToggle` on
 * 2026-08-19. Since 2026-08-20 (owner) the rail is no longer live work only:
 * a REMEMBERED project — a workspace-history entry whose last tab has closed —
 * keeps a rowless header with its own `+`, so closing the work does not
 * remove the place it ran in.
 *
 * One `WorktreeCard` per checkout (DL-27.23/DL-27.24, amended 2026-08-26 —
 * design `docs/specs/2026-08-25-rail-worktree-card-design.md`): the tab tier
 * is gone from the rail entirely. A checkout is a boxed, pressable, expandable
 * card whose rows retain every agent PANE plus every shell-only tab, flattened
 * across whichever tabs hold them — `worktree-card.tsx` owns that render;
 * this file only decides which checkouts exist and hands each one off. A labelled
 * project can still collapse as a whole, one disclosure per cluster; a card's
 * own open/closed state is a separate, window-local disclosure one tier down
 * (`openCardKeys`).
 *
 * Ported from the owner-approved gallery specimen
 * `src/gallery/agent-status-rail.tsx`, whose `asr-` class names are kept 1:1 so
 * the shipped rail and the approved specimen cannot drift. The projection
 * itself is `agent-rail-model.ts`; this file and `worktree-card.tsx` only
 * render it.
 */

export interface AgentRailProps {
  /** Stable Tauri fallback callbacks; worktree cards are Electron-only. */
  readonly legacy: {
    readonly onOpenWorkspace: () => void;
    readonly openWorkspaceDisabled?: boolean;
    readonly onResumeWorktree: (path: string) => void;
    readonly onFocusAttention?: (index: number) => void;
  };
  /**
   * Select an already-open tab by its global index. Every shell-only card row
   * uses this path; agent rows remain pane-exact through `onFocusPane`.
   * `RepositoryRail` reads the same callback for Tauri's legacy tab rows.
   */
  onSelectTab(index: number): void;
  /**
   * Open `AgentQuickPicker` targeted at one project (DL-27.18).
   *
   * The tab strip's own `+` always opens it on the ACTIVE tab's workspace, so
   * launching an agent in a project that is on screen but not selected meant
   * switching tabs first. The header's `+` is the same panel with the
   * destination decided by which project was pressed. Omitted on hosts where
   * the picker is not wired (the gallery mounts the rail without it), in which
   * case no header carries the control.
   */
  onNewTabIn?(workspacePath: string): void;
  /** Keep every project launcher visible but inert during a shared handoff. */
  newTabDisabled?: boolean;
  /**
   * Forget a remembered project: drop EVERY history entry the rowless header
   * stands for (a repository folds several remembered worktrees into one
   * cluster, so one path would leave a sibling and the header would simply
   * re-derive). Omitted where nothing owns the history (the gallery), in
   * which case no header carries the control (DL-19.7).
   */
  onRemoveWorkspace?(workspacePaths: readonly string[]): void;
  /**
   * Close a tab by its global index. Shell-only card rows use it directly;
   * every agent row closes its PANE through `onClosePane` instead. The Tauri
   * `RepositoryRail` uses the same callback for its legacy tab rows.
   */
  onCloseTab(index: number): void;
  /**
   * Close ONE agent — the ✕ every agent row carries since the close model
   * (2026-08-22, table row 1). The same rule ⌘W follows: the pane goes, and
   * the tab goes with it only when that pane was its last one (row 2), which
   * is decided host-side by the tab's real pane count and not by how many
   * agent rows the rail drew.
   */
  onClosePane(index: number, paneId: number): void;
  /**
   * Close a whole project — every tab of it, secondary worktrees included —
   * and take it off the rail (table row 4). `historyPaths` is what has to be
   * forgotten for the second half: closing the tabs alone would only demote
   * the cluster to the remembered tier, leaving the header the user pressed
   * exactly where it was. Omitted where nothing owns the history (the
   * gallery), in which case a live header carries no close (DL-19.7).
   */
  onCloseProject?(tabIndexes: readonly number[], historyPaths: readonly string[]): void;
  /** Focus one exact pane: activate its tab, focus that pane, ack it. */
  onFocusPane(index: number, paneId: number): void;
  /**
   * The actions menu every worktree card raises from its strip's `+` or a
   * right-click (spec `docs/specs/2026-08-27-rail-card-strip-actions-design.md`
   * §8). Omitted where nothing owns those seams (the gallery), in which case no
   * card carries a `+` at all (DL-19.7) — a launcher that opens nothing is
   * worse than none.
   */
  readonly cardActions?: CardActions;
  /**
   * Pinned under the scrolling list and above the banner: the rail's own
   * footer of window actions (`SidebarActions`, DL §28). `App` builds it,
   * the same way it builds the toolbar once for both layouts.
   */
  footer?: ComponentChildren;
  /**
   * Optional prose block placed after the project stream inside the rail's
   * one vertical scrollport. `App` supplies Recent Activity here; keeping the
   * slot generic leaves session loading, navigation and resume behavior with
   * the Sessions feature rather than making the rail own them.
   */
  recentActivity?: ComponentChildren;
  /**
   * The same `SurfaceStrip` wired into `TabManager`. Unread by this file's
   * own render since the worktree card landed (2026-08-26): DL-27.22's
   * focused-pane wash is no longer gated by whether a file or browser
   * surface holds the stage (a stage surface does not change which pane
   * holds the WINDOW's keyboard), so nothing here reads
   * `fileController.activeIndex()` any more. Kept as a required prop because
   * `AgentRailProps` and `RepositoryRailProps` share one contract and `App`
   * passes it to both; the rail lists no file tabs and opens none regardless.
   */
  fileController: FileSurfaceController;
}

/**
 * DL-27.3, amended 2026-08-19 (owner, second pass): the slot draws THREE
 * shapes, not one static dot.
 *
 * `working` is the workspace rail's dot-ring, its ink running around a still
 * circle (`WorkspaceSpinner`) rather than a neutral dot — a run in progress is the
 * one state that changes on its own, and a still dot said the opposite. The
 * attention states keep the dot: red `failed`, and `asked` in
 * `--status-unread`, which is what "unread" meant in `AgentAttentionMark`
 * before the rail collapsed the vocabulary. `asked` covers BOTH a question
 * and a finished run nobody has read yet — `agent-rail-model` folds
 * `completed` into it, which is the owner's rule that a finished run you have
 * not checked is unread.
 *
 * `done` and `idle` stop painting nothing: both wear one quiet gray dot, so a
 * row that is simply quiet still says "an agent is here" instead of leaving
 * the column empty. Every state's word stays in `title` and the accessible
 * name either way.
 */
export function RailStatusMark({ state }: { readonly state: RailState }) {
  if (state === "working") {
    return (
      <span class="asr-row__mark asr-row__mark--spinner" data-state="working" aria-hidden="true">
        <WorkspaceSpinner />
      </span>
    );
  }

  return <span class="asr-row__mark" data-state={state} aria-hidden="true" />;
}

/**
 * The folder a cluster's `+` opens into: the project's own checkout, else the
 * remembered path a rowless cluster carries.
 *
 * `worktrees[0]` IS that checkout since 2026-08-25 — the groups are sorted
 * primary-first (DL-27.23) and git lists the main checkout first — where this
 * used to read the first ROW's workspace and could therefore answer with a
 * package directory below the root. A plain group's synthetic worktree carries
 * its one tab's path, which is the same answer as before; when that tab has no
 * workspace at all the path is empty and the launcher is omitted (DL-19.7).
 * Each worktree group carries its OWN `+` for the checkouts under this one.
 */
function groupPath(group: RailStreamGroup): string | null {
  const worktree = group.worktrees[0];
  if (worktree === undefined) {
    return group.path;
  }
  return worktree.path === "" ? (worktree.rows[0]?.workspacePath ?? null) : worktree.path;
}

/**
 * Where the project header's `+` actually opens into, as words (spec §7.4):
 * the project, then the primary checkout — which is what `groupPath` has
 * resolved to since 2026-08-25.
 *
 * **A word already said is not said again (2026-08-30).** This used to be
 * `${group.project} · ${worktrees[0].name}`, and a repository's primary
 * checkout sits at the repository root — so its basename IS the project name
 * and the control announced `New tab in spacevibe-deck · spacevibe-deck`: the
 * exact repetition `checkoutLabel` and `whereOf` remove one tier down. It asks
 * `checkoutLabel` for the checkout's word rather than reading `name`, so the
 * header and the card can never disagree about what a checkout is called.
 *
 * The empty check is not defensive: a project git could not scan has one
 * synthetic worktree whose `path` and `branch` are both `""`, and
 * `workspaceLabel("")` is `""` — not `undefined`, so `??` never fired and the
 * label read `New tab in myfolder · ` with a dangling separator.
 */
function headerDestination(group: RailStreamGroup): string {
  const worktree = group.worktrees[0];
  const checkout = worktree === undefined ? "" : checkoutLabel(worktree);
  return checkout === "" || checkout === group.project
    ? group.project
    : `${group.project} · ${checkout}`;
}

function WorktreeCardRail(props: AgentRailProps) {
  const tabs = tabViews.value;
  // Which labelled project groups are folded. A new Set each time rather than
  // a mutated one (C1), so the signal actually notifies.
  const collapsedGroupKeys = useSignal<ReadonlySet<string>>(new Set());
  // Which worktree cards are open, keyed by `RailWorktreeGroup.key` (the
  // worktree's own path) — the `toggleGroup` precedent, one tier down.
  // WINDOW-LOCAL and unpersisted, per the owner's 2026-08-26 answer (design
  // §11.6/§13.7): settings are app-level, so persisting would make every
  // window share one open/closed state.
  const openCardKeys = useSignal<ReadonlySet<string>>(new Set());

  const view = buildAgentRail({
    tabs,
    activeIndex: activeTabIndex.value,
    scans: repositoryScans.value,
    workspaceHistoryPaths: workspacesData.value.recents.map((recent) => recent.path),
    // Tier 3 (spec §5): the newest turn each agent pane has said, kept by
    // `session-tail-store`. Empty on Tauri and in the browser preview, where
    // the `session_tail` channel does not exist — the model then falls back
    // to the custom-name line it drew before this.
    tails: paneTails.value,
    // Per-pane model string (e.g. "claude-sonnet-5"), written alongside tails
    // by the session-tail IPC answer. Empty on Tauri and in the browser
    // preview — the card omits the pill when the string is absent.
    // Do not surface `paneModels` here: its pane→session pairing is ranked by
    // cwd/mtime and then pinned, not causally bound to the pane. Gallery/model
    // callers may still inject trusted model facts directly into the pure view.
    // The order the user dragged these projects into (DL-27.20). App-level,
    // so a drag in one window reorders the rail in every window.
    railOrder: settings.value.railOrder,
    // Read once per render and injected; the model never calls the clock.
    now: Date.now(),
  });

  // The stream the drag controller answers about. It is installed ONCE — a
  // controller re-created on every render would be disposed mid-drag, since a
  // rail row re-renders whenever an agent says something — so the list it
  // reorders has to reach it through a ref rather than a closure.
  const streamRef = useRef<readonly RailStreamGroup[]>(view.stream);
  // A LAYOUT effect, not a passive one, and the distinction is load-bearing: a
  // drop resolves its source index against the live DOM, then splices this
  // array. A passive effect flushes after paint, so a rail that re-rendered
  // mid-drag would leave the DOM one render ahead of this ref — and a release
  // landing in that window splices the wrong element out of a stale stream and
  // pins a project nobody dragged. A layout effect runs before the browser can
  // dispatch the next event, so the two can never disagree. Not written during
  // render either: a ref is not render state.
  useLayoutEffect(() => {
    streamRef.current = view.stream;
  });
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const controller = createRailClusterDragController(list, {
      onDrop(from, to) {
        const current = settings.value.railOrder;
        const next = pinAt({
          stream: streamRef.current,
          from,
          to,
          railOrder: current,
          scans: repositoryScans.value,
        });
        // One write per completed drop, and none at all for a drop that says
        // nothing new — including the canonicalisation pass being a no-op.
        if (!sameRailOrder(next, current)) {
          updateSettings({ railOrder: next });
        }
      },
    });
    return () => {
      controller.dispose();
    };
  }, []);

  // Repository scans: on demand for every open workspace, and again whenever
  // the window comes back. Without them every row degrades to a bare project
  // with no worktree knowledge.
  useEffect(() => installRepositoryRescanOnFocus(), []);

  useSignalEffect(() => {
    // The workspace history rides along (2026-08-20): a remembered cluster
    // needs the scan to fold two worktrees of one repository into one header,
    // and to name it after the repository's own checkout.
    ensureRepositoriesScanned([
      ...tabViews.value
        .map((tab) => tab.workspacePath)
        .filter((path): path is string => path !== null),
      ...workspacesData.value.recents.map((recent) => recent.path),
    ]);
  });

  function toggleGroup(key: string): void {
    const next = new Set(collapsedGroupKeys.value);
    if (!next.delete(key)) {
      next.add(key);
    }
    collapsedGroupKeys.value = next;
  }

  function toggleCard(key: string): void {
    const next = new Set(openCardKeys.value);
    if (!next.delete(key)) {
      next.add(key);
    }
    openCardKeys.value = next;
  }

  return (
    <nav class="asr-rail asr-rail--mounted" aria-label="Agents">
      {/* The scrolling half: the rows. The footer and the banner below stay
          pinned to the bottom of the column, which is the split `.wsbar__list`
          drew before this rail replaced it. */}
      <div class="asr-rail__list" ref={listRef}>
        <section class="asr-stream" aria-label="Open agents">
          {view.stream.map((group) => {
            const collapsed = collapsedGroupKeys.value.has(group.key);
            // A LIVE cluster is one with checkouts under it, and a remembered
            // one has none — the model gives a rowless project no worktree
            // groups at all (DL-27.23), so this is the same question the old
            // `rows.length > 0` asked and the answer cannot differ: a live
            // cluster is only built when at least one tab is open in it.
            const live = group.worktrees.length > 0;
            return (
              <div
                class="asr-cluster"
                key={group.key}
                // The project identity the manual order is stored against
                // (DL-27.20). Written on the block rather than on the header
                // because the whole block is what moves.
                data-order-key={group.orderKey}
                data-labelled={group.labelled}
                data-collapsed={collapsed}
              >
                {group.labelled && (
                  /* The header is a ROW of two controls since 2026-08-19
                     (DL-27.18), not one button: a `+` nested inside the
                     collapse button would be a button inside a button, which
                     no browser resolves the way either control means. The
                     collapse half keeps the whole label and the caret, and the
                     caret is the LAST thing on the line again since the same
                     day's re-amendment — the `+` is laid over the slot between
                     the name and the caret by the header's grid, so DOM order
                     here is unchanged while reading order is
                     folder → name → `+` → caret.

                     Since 2026-08-22 it is also the whole cluster's drag
                     handle (DL-27.20): no grip glyph is added, and the
                     collapse button shares the surface — below the 5px
                     threshold its `click` fires untouched. The two small
                     controls beside it never start a drag. */
                  <div class="asr-cluster__head">
                    {live ? (
                      <button
                        type="button"
                        class="asr-cluster__toggle"
                        aria-expanded={!collapsed}
                        aria-label={`${collapsed ? "Expand" : "Collapse"} project ${group.project}`}
                        onClick={() => {
                          toggleGroup(group.key);
                        }}
                      >
                        <span class="asr-cluster__folder" aria-hidden="true">
                          <DeckIcon icon={Folder} size={FEATURE_ICON} />
                        </span>
                        <span class="asr-cluster__name">{group.project}</span>
                        <span class="asr-cluster__caret" aria-hidden="true">
                          <DeckIcon icon={CaretRight} size={CHROME_ICON} />
                        </span>
                      </button>
                    ) : (
                      /* A REMEMBERED project (owner, 2026-08-20): nothing is
                         open here, so there are no rows to collapse and the
                         disclosure is omitted rather than disabled (DL-19.7).
                         The still label keeps the toggle's line; the `+`
                         beside it is the one action the header offers. */
                      <span class="asr-cluster__still">
                        <span class="asr-cluster__folder" aria-hidden="true">
                          <DeckIcon icon={Folder} size={FEATURE_ICON} />
                        </span>
                        <span class="asr-cluster__name">{group.project}</span>
                      </span>
                    )}
                    {/* A project the host could not place has no path to open
                        into — the control is omitted rather than shown inert
                        (DL-19.7). */}
                    {/* Spec §7.4: the header's `+` stays, and it now says WHICH
                        checkout it targets. `groupPath` resolves to
                        `worktrees[0]` — always the primary — and with every
                        checkout carrying its own launcher, the honest wording
                        is what keeps the two from reading as the same control.
                        Not removed: a project with one checkout would lose its
                        launcher whenever its card is open. */}
                    {props.onNewTabIn !== undefined && groupPath(group) !== null && (
                      <button
                        type="button"
                        class="asr-cluster__add"
                        disabled={props.newTabDisabled}
                        aria-label={`New tab in ${headerDestination(group)}`}
                        title={`New tab in ${headerDestination(group)}`}
                        onClick={() => {
                          const path = groupPath(group);
                          if (path !== null) {
                            props.onNewTabIn?.(path);
                          }
                        }}
                      >
                        {/* `PlusSquare`, not the bare `Plus` glyph (owner,
                              2026-08-20, second pass — the circled mark came
                              first and read too round beside the rail's
                              rectangular rows): the framed mark reads as a
                              drawn control rather than a stray cross floating
                              on the header line. */}
                        {/* One rung above the chrome size (owner ask,
                              2026-08-20): at 13px the framed mark read
                              smaller than the bare cross it replaced, since
                              the frame spends the outer pixels. 15 is the
                              folder glyph's own size on the same line. */}
                        <DeckIcon icon={PlusSquare} size={FEATURE_ICON} />
                      </button>
                    )}
                    {/* The header's close. It began (owner, 2026-08-20) as a
                        REMEMBERED project's only action — a rowless header has
                        no tab rows carrying a close, so it removed the FOLDER
                        from the rail, all of its history entries at once since
                        a repository folds several, and never closed work
                        because there was none.

                        Since the close model (2026-08-22, table row 4) a LIVE
                        header carries it too, and there it means the project:
                        every tab of it, secondary worktrees included, and then
                        the folder off the rail. The two halves are one act on
                        purpose — closing the tabs alone would demote the
                        cluster to the remembered tier and leave the header
                        standing, which reads as a control that did nothing.

                        It stands in the caret's track. A live header HAS a
                        caret, so on hover the two share that track the way the
                        `+` shares the slot before it; a still header leaves it
                        empty. Omitted rather than inert when nothing wires it
                        (DL-19.7). */}
                    {!live
                      ? props.onRemoveWorkspace !== undefined &&
                        group.historyPaths.length > 0 && (
                          <button
                            type="button"
                            class="asr-cluster__remove"
                            aria-label={`Remove ${group.project} from the rail`}
                            title={`Remove ${group.project} from the rail`}
                            onClick={() => {
                              props.onRemoveWorkspace?.(group.historyPaths);
                            }}
                          >
                            <DeckIcon icon={X} size={CHROME_ICON} />
                          </button>
                        )
                      : props.onCloseProject !== undefined && (
                          <button
                            type="button"
                            class="asr-cluster__remove asr-cluster__remove--live"
                            aria-label={`Close ${group.project} — ${group.tabIndexes.length} tabs — and remove it from the rail`}
                            title={`Close ${group.project} and remove it from the rail`}
                            onClick={() => {
                              props.onCloseProject?.(group.tabIndexes, group.historyPaths);
                            }}
                          >
                            <DeckIcon icon={X} size={CHROME_ICON} />
                          </button>
                        )}
                  </div>
                )}
                {/* The worktree tier (DL-27.23/DL-27.24, amended): each
                    checkout is a CARD now, not a sub-header plus a run of tab
                    rows — the tab tier is gone from the rail entirely (design
                    `2026-08-25-rail-worktree-card-design.md` §3). A card is a
                    sibling of every other card inside the cluster, for the
                    same reason the sub-header used to be: the cluster is the
                    grid that spaces every line in it, and a wrapper would
                    have to restate that rhythm. It keeps `.asr-cluster__head`
                    the only thing a drag can start from (DL-27.20) —
                    `WorktreeCard` renders its own `.asr-card__head`, which
                    `rail-cluster-drag.ts` never matches.

                    Collapse is still the PROJECT's, one disclosure per
                    cluster (DL-27.11/DL-27.24): a folded project hides its
                    cards with its rows. A card's own open/closed state is a
                    SEPARATE, window-local disclosure one tier down
                    (`openCardKeys`). */}
                {!collapsed &&
                  group.worktrees.map((worktree) => (
                    <WorktreeCard
                      key={worktree.key}
                      project={group.project}
                      group={worktree}
                      open={openCardKeys.value.has(worktree.key)}
                      onToggle={toggleCard}
                      onFocusPane={props.onFocusPane}
                      onClosePane={props.onClosePane}
                      onCloseTab={props.onCloseTab}
                      onNewTabIn={props.onNewTabIn}
                      newTabDisabled={props.newTabDisabled}
                      onSelectTab={props.onSelectTab}
                      actions={props.cardActions}
                    />
                  ))}
              </div>
            );
          })}
        </section>
        {props.recentActivity}
      </div>

      {props.footer}
    </nav>
  );
}

export function AgentRail(props: AgentRailProps) {
  if (isTauriHost()) {
    return (
      <RepositoryRail
        onSelectTab={props.onSelectTab}
        onCloseTab={props.onCloseTab}
        onOpenWorkspace={props.legacy.onOpenWorkspace}
        openWorkspaceDisabled={props.legacy.openWorkspaceDisabled}
        onFocusAttention={props.legacy.onFocusAttention}
        onResumeWorktree={props.legacy.onResumeWorktree}
        showAgentPresence={false}
        footer={props.footer}
        fileController={props.fileController}
      />
    );
  }
  return <WorktreeCardRail {...props} />;
}
