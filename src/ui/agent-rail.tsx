import { CaretRight, Folder, X } from "@phosphor-icons/react";
import { untracked, useSignal, useSignalEffect } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { activeTabIndex, tabViews } from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon, FEATURE_ICON } from "./controls/deck-icon";
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
import { buildAgentRail, type RailStreamGroup } from "./agent-rail-model";
import { sessionTitlesFor, untitledSessionIds } from "./agent-rail-card-model";
import { requestSessionTitles, sessionEntries } from "../sessions/sessions-store";
import { focusCheckout, WorktreeCard } from "./worktree-card";
import { needsUser } from "./worktree-card-row";
import type { CardActions } from "./worktree-card-menus";
import { RepositoryRail } from "./repository-rail";
import { SidebarNewButton } from "./sidebar-toggle";
import type { NewPaneDropDeps } from "./new-pane-drag";
import { isTauriHost } from "../updater/migration-notice";
import { invoke } from "../host/bridge";
import { validateLogoDataUrl } from "../settings/logo-store";

/**
 * The agent status rail.
 *
 * See `docs/internals/agent-rail.md`; chrome rules `DL §27`. It replaces
 * `RepositoryRail` in `DesktopChrome`'s `sidebarNavigation` slot and keeps
 * that component's callback contract, so reverting is one line in `app.tsx`
 * — the rail changes what the list is ABOUT (a live agent rather than a
 * checkout), never what selecting or closing a tab means (R4).
 *
 * One list, no mode switch: a cluster per project in the order the user opened
 * them. The `New` launcher stays above the scrolling list, beneath the
 * sidebar identity row (DL-27.14). Since 2026-08-20 (owner) the rail is no longer live work only:
 * a REMEMBERED project — a workspace-history entry whose last tab has closed —
 * keeps its header, so closing the work does not remove the place it ran in.
 * Since `rail-create-consolidation` (2026-09-02) that header carries no `+`;
 * the project's remembered checkouts print as rowless groups under it, and
 * their label lines' `+` is the way back in.
 *
 * One `WorktreeCard` per checkout (DL-27.28 — `docs/internals/agent-rail.md`):
 * the rail is a flat tree of project, checkout and session. A checkout is a
 * label line and its rows — every agent PANE plus every shell-only tab,
 * flattened across whichever tabs hold them — and `worktree-card.tsx` owns
 * that render; this file only decides which checkouts exist and hands each
 * one off. A labelled project collapses as a whole, the one disclosure left.
 *
 * Ported from the owner-approved gallery specimen
 * `src/gallery/agent-status-rail.tsx`, whose `asr-` class names are kept 1:1 so
 * the shipped rail and the approved specimen cannot drift. The projection
 * itself is `agent-rail-model.ts`; this file and `worktree-card.tsx` only
 * render it.
 */

export { RailStatusMark } from "./controls/rail-status-mark";

export interface AgentRailProps {
  readonly newPaneDrop?: NewPaneDropDeps;
  /** Stable Tauri fallback callbacks; worktree cards are Electron-only. */
  readonly legacy: {
    readonly onOpenWorkspace: () => void;
    readonly openWorkspaceDisabled?: boolean;
    readonly onResumeWorktree: (path: string) => void;
    /**
     * Focus the pane that needs the user. With an index it targets that tab
     * (the legacy rail's rows); without one it is ⌘⇧A's own preflight and
     * picks the loudest pane in the window.
     */
    readonly onFocusAttention?: (index?: number) => void;
  };
  /**
   * Select an already-open tab by its global index. Every shell-only card row
   * uses this path; agent rows remain pane-exact through `onFocusPane`.
   * `RepositoryRail` reads the same callback for Tauri's legacy tab rows.
   */
  onSelectTab(index: number): void;
  /**
   * Name (or, with `null`, unname) a tab from its agent rows (DL-27.15). The
   * Tauri `RepositoryRail` has no such gesture; its legacy rows already print
   * the name.
   */
  onRenameTab?(index: number, name: string | null): void;
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
   * What every checkout's label-line `+` and right-click raise
   * (`docs/internals/agent-rail.md`). Omitted where nothing owns those seams
   * (the gallery), in which case no checkout carries a `+` at all (DL-19.7) —
   * a launcher that opens nothing is worse than none.
   */
  readonly cardActions?: CardActions;
  /**
   * Pinned under the scrolling list and above the banner: the rail's own
   * footer of window actions (`SidebarActions`, DL §28). `App` builds it,
   * the same way it builds the toolbar once for both layouts.
   */
  footer?: ComponentChildren;
  /**
   * Content-sized usage summary below the project scrollport. The Usage feature
   * owns its data and navigation; the rail only places the supplied surface.
   */
  usageSummary?: ComponentChildren;
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

/** Keep the project identity in the existing DL-27.17 icon slot. */
function WorkspaceIcon({ path }: { readonly path: string | null }) {
  const favicon = useSignal("");
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await invoke<unknown>("scan_workspace_favicon", { dir: path });
        if (!cancelled) favicon.value = validateLogoDataUrl(result);
      } catch (error) {
        console.warn("Failed to load workspace favicon:", path, error);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `favicon` is a signal whose identity never changes, so listing it would
    // add a dependency that cannot vary. The path is the whole input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return (
    <span class="asr-cluster__folder" aria-hidden="true">
      {favicon.value ? (
        <img
          src={favicon.value}
          alt=""
          width={FEATURE_ICON}
          height={FEATURE_ICON}
          draggable={false}
          style={{ objectFit: "contain" }}
          onError={() => {
            favicon.value = "";
          }}
        />
      ) : (
        <DeckIcon icon={Folder} size={FEATURE_ICON} filled />
      )}
    </span>
  );
}

function WorktreeCardRail(props: AgentRailProps) {
  const tabs = tabViews.value;
  // Which labelled project groups are folded. A new Set each time rather than
  // a mutated one (C1), so the signal actually notifies.
  const collapsedGroupKeys = useSignal<ReadonlySet<string>>(new Set());

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
    // DL-27.28: an unnamed row's first line is its session's first prompt,
    // joined on the contract-layer session id only.
    titles: sessionTitlesFor(tabs, sessionEntries.value),
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

  // A2: a session the list does not know yet is scanned for, throttled in the
  // store. Only the tabs are tracked; the store's own signals are its business.
  useSignalEffect(() => {
    const ids = untitledSessionIds(tabViews.value);
    untracked(() => {
      requestSessionTitles(ids, Date.now());
    });
  });

  function toggleGroup(key: string): void {
    const next = new Set(collapsedGroupKeys.value);
    if (!next.delete(key)) {
      next.add(key);
    }
    collapsedGroupKeys.value = next;
  }

  return (
    <nav class="asr-rail asr-rail--mounted" aria-label="Agents">
      <div class="sidebar-launcher">
        <SidebarNewButton
          disabled={props.legacy.openWorkspaceDisabled}
          onOpenWorkspace={props.legacy.onOpenWorkspace}
          newPaneDrop={props.newPaneDrop}
        />
      </div>
      {/* The scrolling half: the rows. The footer and the banner below stay
          pinned to the bottom of the column, which is the split `.wsbar__list`
          drew before this rail replaced it. */}
      <div class="asr-rail__list" ref={listRef}>
        <section class="asr-stream" aria-label="Open agents">
          {view.stream.map((group) => {
            const collapsed = collapsedGroupKeys.value.has(group.key);
            const iconPath =
              group.worktrees[0]?.repositoryPath ?? group.worktrees[0]?.path ?? group.path;
            // A LIVE cluster is one with something OPEN in it — the old
            // `rows.length > 0` question, asked of the tab indexes the header's
            // ✕ would close. Not `worktrees.length`: since
            // `rail-create-consolidation` (2026-09-02) a remembered cluster
            // carries its checkouts as rowless groups too, so that its way back
            // in is the same bare row a history-only sibling already had.
            const live = group.tabIndexes.length > 0;
            // DL-27.27 (amended 2026-10-07): how many of the project's panes
            // need the user — `asked` or `failed` — so a folded cluster still
            // says where to look. Red when any of them failed.
            const needing = group.worktrees.flatMap((worktree) =>
              worktree.panes.filter((pane) => needsUser(pane.state)),
            );
            const needCount = needing.length;
            const failedCount = needing.filter((pane) => pane.state === "failed").length;
            const needWords =
              failedCount > 0
                ? `${needCount} need you, ${failedCount} failed`
                : `${needCount} need you`;
            const activeCheckout = group.worktrees.find((worktree) => worktree.active);
            // Like a checkout's label line (DL-27.28): the project's active
            // checkout, else its first with rows. A rowless one has nothing to focus.
            const focusProject = (): void => {
              const target =
                activeCheckout ?? group.worktrees.find((worktree) => worktree.entries.length > 0);
              if (target !== undefined) {
                focusCheckout(target, props.onFocusPane, props.onSelectTab);
              }
            };
            return (
              <div
                class="asr-cluster"
                key={group.key}
                // The frame's padding and the head row's spare width focus
                // without toggling. Controls keep their targets.
                // A FOLDED project also opens: the frame is then just the
                // header, and focusing an already-focused project would leave
                // the press with no visible effect.
                onClick={(event) => {
                  const target = event.target;
                  if (
                    live &&
                    (target === event.currentTarget ||
                      (target instanceof Element && target.matches(".asr-cluster__head")))
                  ) {
                    focusProject();
                    if (collapsed) {
                      toggleGroup(group.key);
                    }
                  }
                }}
                // The project identity the manual order is stored against
                // (DL-27.20). Written on the block rather than on the header
                // because the whole block is what moves.
                data-order-key={group.orderKey}
                data-labelled={group.labelled}
                data-collapsed={collapsed}
              >
                {group.labelled && (
                  /* The header is a ROW of controls since 2026-08-19, not one
                     button: a control nested inside the collapse button would
                     be a button inside a button, which no browser resolves the
                     way either control means. The collapse half keeps the
                     whole label and the caret, and the caret is the LAST thing
                     on the line. DL-27.18's `+` stood in the slot before the
                     caret until `openspec/changes/rail-create-consolidation`
                     (2026-09-02) removed it: every checkout carries its own
                     create control on its card, and the header's silently
                     resolved to the primary one.

                     Since 2026-08-22 it is also the whole cluster's drag
                     handle (DL-27.20): no grip glyph is added, and the
                     collapse button shares the surface — below the 5px
                     threshold its `click` fires untouched. The small close
                     beside it never starts a drag. */
                  <div class="asr-cluster__head">
                    {live ? (
                      <button
                        type="button"
                        class="asr-cluster__toggle"
                        aria-expanded={!collapsed}
                        // DL-27.2: the count's words reach the accessible name too.
                        aria-label={`${collapsed ? "Expand" : "Collapse"} project ${group.project}${needCount > 0 ? `, ${needWords}` : ""}`}
                        onClick={() => {
                          focusProject();
                          toggleGroup(group.key);
                        }}
                      >
                        <WorkspaceIcon key={iconPath} path={iconPath} />
                        <span class="asr-cluster__name">{group.project}</span>
                        {/* DL-27.27 (amended 2026-10-04): the count and the
                            caret share ONE slot — the count at rest, the
                            caret on hover or keyboard focus. */}
                        <span class="asr-cluster__tail">
                          {needCount > 0 && (
                            <span
                              class="asr-cluster__count"
                              data-tone={failedCount > 0 ? "failed" : "asked"}
                              title={needWords}
                            >
                              {needCount} need you
                            </span>
                          )}
                          <span class="asr-cluster__caret" aria-hidden="true">
                            <DeckIcon icon={CaretRight} size={CHROME_ICON} />
                          </span>
                        </span>
                      </button>
                    ) : (
                      /* A REMEMBERED project (owner, 2026-08-20): nothing is
                         open here, so there are no rows to collapse and the
                         disclosure is omitted rather than disabled (DL-19.7).
                         The still label keeps the toggle's line; the forget
                         control beside it is the one action the header offers
                         — the checkouts under it carry the create control. */
                      <span class="asr-cluster__still">
                        <WorkspaceIcon key={iconPath} path={iconPath} />
                        <span class="asr-cluster__name">{group.project}</span>
                      </span>
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
                        caret, so on hover the two share that track — the
                        pin-to-overlap idiom the rows' close uses over the agent
                        glyph; a still header leaves it empty. Omitted rather
                        than inert when nothing wires it (DL-19.7). */}
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
                {/* The checkout tier (DL-27.28): each checkout is a label
                    line and its session rows, a sibling of every other
                    checkout inside the cluster — the cluster is the grid that
                    spaces every line in it. `.asr-cluster__head` stays the
                    only thing a drag can start from (DL-27.20);
                    `rail-cluster-drag.ts` never matches a checkout's line.

                    The project header's caret is the only fold
                    (DL-27.11/DL-27.28): a folded project hides its checkouts
                    with their rows, and a checkout has no disclosure of its own. */}
                {!collapsed &&
                  group.worktrees.map((worktree) => (
                    <WorktreeCard
                      key={worktree.key}
                      project={group.project}
                      group={worktree}
                      onFocusPane={props.onFocusPane}
                      onClosePane={props.onClosePane}
                      onCloseTab={props.onCloseTab}
                      onSelectTab={props.onSelectTab}
                      onRenameTab={props.onRenameTab}
                      actions={props.cardActions}
                    />
                  ))}
              </div>
            );
          })}
        </section>
      </div>

      {props.usageSummary}
      {props.footer}
    </nav>
  );
}

export function AgentRail(props: AgentRailProps) {
  if (isTauriHost()) {
    return (
      <RepositoryRail
        header={
          <div class="sidebar-launcher">
            <SidebarNewButton
              disabled={props.legacy.openWorkspaceDisabled}
              onOpenWorkspace={props.legacy.onOpenWorkspace}
              newPaneDrop={props.newPaneDrop}
            />
          </div>
        }
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
