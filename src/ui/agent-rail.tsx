import { CaretRight, Folder, PlusSquare, TerminalWindow, X } from "@phosphor-icons/react";
import { useSignal, useSignalEffect } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { activeTabIndex, statusInfo, tabViews } from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon, FEATURE_ICON } from "./controls/deck-icon";
import { AgentGlyph } from "./controls/agent-glyph";
import { WorkspaceSpinner } from "./workspace-spinner";
import { tildify } from "../lib/process-info";
import {
  ensureRepositoriesScanned,
  installRepositoryRescanOnFocus,
  repositoryScans,
} from "../repositories/repositories-store";
import { paneTails } from "../terminal/session-tail-store";
import { browserSurfaceActive } from "../browser/browser-store";
import { available as electronHostAvailable } from "../host/worktree-host";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { workspacesData } from "../open-board/workspaces-store";
import { SidebarBanner } from "./sidebar-banner";
import { buildAgentRail, type RailState, type RailTabRow } from "./agent-rail-model";

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
 * One row per tab; a tab running ONE agent leads with that agent's
 * chip, and a tab running several lists each agent as a leaf row joined to the
 * tab by a hairline elbow (DL-27.13) — this REVERSES the same-day "exactly two
 * navigation levels" decision, on the owner's ask: the folded
 * `claude + codex + agy` identity hid which agent was in which state, and the
 * leaves are always visible rather than behind a disclosure. A labelled
 * project can collapse as a whole. A tab waiting on the user stays under its
 * own project — the pinned `Needs you` block was removed on 2026-08-16 because
 * it printed a project twice; ⌘⇧A still walks to the next one.
 *
 * Ported from the owner-approved gallery specimen
 * `src/gallery/agent-status-rail.tsx`, whose `asr-` class names are kept 1:1 so
 * the shipped rail and the approved specimen cannot drift. The projection
 * itself is `agent-rail-model.ts`; this file only renders it.
 */

export interface AgentRailProps {
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
  /**
   * Forget a remembered project: drop EVERY history entry the rowless header
   * stands for (a repository folds several remembered worktrees into one
   * cluster, so one path would leave a sibling and the header would simply
   * re-derive). Omitted where nothing owns the history (the gallery), in
   * which case no header carries the control (DL-19.7).
   */
  onRemoveWorkspace?(workspacePaths: readonly string[]): void;
  onCloseTab(index: number): void;
  /** Focus one exact pane: activate its tab, focus that pane, ack it. */
  onFocusPane(index: number, paneId: number): void;
  /** Test/gallery override; production defaults to the Electron host marker. */
  showAgentPresence?: boolean;
  /**
   * Pinned under the scrolling list and above the banner: the rail's own
   * footer of window actions (`SidebarActions`, DL §28). `App` builds it,
   * the same way it builds the toolbar once for both layouts.
   */
  footer?: ComponentChildren;
  /**
   * The same `SurfaceStrip` wired into `TabManager`, read for one thing only:
   * whether a file surface holds the stage, which decides whether a tab row
   * still draws as the active one. The rail lists no file tabs and opens none.
   */
  fileController: FileSurfaceController;
}

/**
 * DL-27.2: the mark is the fast read and never the only read — every state
 * says its name in `title` and in the row's accessible name, including the
 * `failed` state the gallery specimen never had.
 */
const STATE_LABEL: Readonly<Record<RailState, string>> = {
  failed: "failed",
  asked: "needs you",
  working: "working",
  done: "done",
  idle: "idle",
};

/** `project` alone, or `project · worktree` outside the primary checkout. */
function whereOf(row: { project: string; worktree: string | null }): string {
  return row.worktree === null ? row.project : `${row.project} · ${row.worktree}`;
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
 * DL-27.4: the newest turn, trimmed by layout rather than by slicing — the
 * full sentence stays in the DOM for the tooltip and for a screen reader.
 *
 * Every row that has a turn to report spends its ONE line on it (DL-27.15,
 * amended 2026-08-17): the turn stands where the agent's name stood, rather
 * than on a second line under it. The name it replaces was the word the glyph
 * beside it already says — and with three `claude` rows in one project, the
 * only word that told them apart was the sentence, which was also the one
 * being trimmed hardest. Every row keeps the same legibility; the status slot
 * alone distinguishes the states that need scanning.
 */
function MessageLine({ text }: { readonly text: string }) {
  return <span class="asr-row__msg">{text}</span>;
}

interface TabItemProps {
  readonly row: RailTabRow;
  /**
   * True when a cluster header above this row has already named the project,
   * so the row names the TAB instead (DL-27.9/DL-27.12). Every live project
   * is labelled now, including a project with one tab.
   */
  readonly labelled: boolean;
  readonly active: boolean;
  readonly showAgentPresence: boolean;
  /** Tildified workspace path for the tooltip; empty when there is none. */
  readonly path: string;
  readonly onSelect: () => void;
  readonly onFocusPane: (paneId: number) => void;
  readonly onClose: () => void;
}

/**
 * The rail's one row shape. DL-27.1: the row is a container with a full-bleed
 * hit layer behind it, not a `<button>` — an agent chip inside it has to be its
 * own control, and a button nested in a button is not operable.
 *
 * A tab running SEVERAL agents lists them as leaf rows under the tab row
 * (DL-27.13, owner 2026-08-16) — always visible, never behind a disclosure.
 * This reverses the same-day two-levels decision: the folded
 * `claude + codex + agy` identity and its chip budget hid which agent was in
 * which state. The leaves are SIBLINGS of `.asr-row--tab` inside the item, on
 * purpose: `.asr-row--tab > span` makes row text inert so clicks fall through
 * to the hit layer, and a leaf nested there would lose its own click.
 *
 * DL-27.8: the selection wash is carried by the ITEM, not by the row inside
 * it. `data-active` sits on the wrapper and the row itself stays transparent.
 */
/**
 * The pane TREE is hidden for now (owner, 2026-08-16, "temporarily"): every
 * multi-agent tab — named or not — renders its panes as plain full-width
 * agent rows, no parent row, no elbow guides, so the rail shows only agents
 * and projects. The tree's markup, CSS and DL-27.13 all stand; restoring it
 * is flipping this one constant, the same revert seam `GRAB_PASTE_DISABLED`
 * established.
 */
const PANE_TREE_HIDDEN = true;

function TabItem(props: TabItemProps) {
  const { row } = props;
  const where = whereOf(row);
  const label = STATE_LABEL[row.state];
  const treed = props.showAgentPresence && row.panes.length > 1;
  // An UNNAMED multi-agent tab renders no parent row at all (DL-27.13, owner
  // 2026-08-16): with the count label gone the row held only its trailing
  // meta, and the owner ruled the empty stretch out. The tree alone is the
  // tab — pressing any leaf activates it — and the rail deliberately offers
  // no close for such a tab (the strip's ✕ and ⌘W do). It marks selection
  // with nothing: the accent bar drawn here at first was hidden on the
  // owner's ask the same day. While the tree is hidden, NAMED multi-agent
  // tabs go headless too: only agents and projects are shown.
  const headless =
    treed && (PANE_TREE_HIDDEN || (props.labelled ? row.identity : row.project) === "");
  const name = props.labelled ? row.identity : row.project;
  // Every state that has something to say says it (DL-27.15). The emptiness
  // check is the only gate left: a tab nobody renamed, whose panes have said
  // nothing, still has no turn to print.
  const showMessage = row.message !== "";
  // The turn TAKES the name's slot rather than adding a line under it — with
  // two exceptions, both of which would otherwise lose a word nothing else
  // says: a name the user typed, and an unlabelled row, whose project name has
  // no cluster header carrying it. In both the turn follows the name on the
  // same line.
  const showName = name !== "" && (row.named || !props.labelled || !showMessage);
  const title = [`${where} · ${row.title} — ${label}`, props.path, row.message]
    .filter((line) => line !== "")
    .join("\n");

  return (
    <div
      class="asr-item"
      data-active={props.active}
      data-headless={headless}
      data-key={headless ? row.key : undefined}
    >
      {!headless && (
        <div class="asr-row asr-row--tab" data-state={row.state} data-key={row.key}>
          <button
            type="button"
            class="asr-row__hit"
            aria-label={`${where}, tab ${row.title}, ${row.panes.length} agents, ${label}, ${row.age}`}
            title={title}
            onClick={props.onSelect}
          />
          <RailStatusMark state={row.state} />
          {/* One agent ends with its chip; several become leaves below, and the
            parent spends its slot on the name — a count or the custom name —
            rather than on a chip stack the leaves would repeat. */}
          {props.showAgentPresence && row.panes.length === 1 && (
            <span class="asr-chips">
              <button
                type="button"
                class="asr-chip"
                aria-label={`Focus ${row.panes[0].agent} in ${where}, ${STATE_LABEL[row.panes[0].state]}`}
                title={`${row.panes[0].agent} — ${STATE_LABEL[row.panes[0].state]}`}
                onClick={() => {
                  props.onFocusPane(row.panes[0].paneId);
                }}
              >
                <AgentGlyph agent={row.panes[0].agent} className="asr-chip__logo" />
              </button>
            </span>
          )}
          {/* A tab running NO agent is a plain shell, and it wore nothing in
            the glyph slot at all — the strip's chip has said `TerminalWindow`
            for one since 2026-08-16 (DL-18.10), so the rail said less than the
            chip it stands beside. Static, not a button: there is no agent pane
            to focus, and the row's own hit layer already selects the tab. */}
          {props.showAgentPresence && row.panes.length === 0 && (
            <span class="asr-chips">
              <span class="asr-chip asr-chip--static" aria-hidden="true">
                <DeckIcon icon={TerminalWindow} size={CHROME_ICON} />
              </span>
            </span>
          )}
          <span class="asr-row__name">
            {/* The project name is already printed in every cluster header,
              above, so the row spends its one strong word on which tab this
              is (DL-27.9/DL-27.12). An unnamed multi-agent tab has NO word:
              the tree below is the identity, and its count was declared
              noise (DL-27.13); `title` and the accessible name still carry
              the number. A row whose agent has spoken gives the word up
              entirely (DL-27.15) — the glyph is the agent's name. */}
            {showName && <strong>{name}</strong>}
            {/* Named only outside the primary checkout — otherwise 46 of 51
              repositories would carry a word that says nothing (spec §2.1). */}
            {row.worktree !== null && <span class="asr-row__worktree">{row.worktree}</span>}
            {showMessage && <MessageLine text={row.message} />}
          </span>
          {row.age !== "" && <span class="asr-row__age">{row.age}</span>}
          {/* DL-27.5: the hover action owns a fixed trailing column, so appearing
            never reflows the age or agent glyph. A real button, so the row's own
            focus order reaches it; the row's accessible name is unchanged
            because it lives on the hit layer, not here. Close is the only one
            left — the options button beside it opened `TabPopover`, removed
            on 2026-08-16 with the rename and workspace-logo features it
            carried.

            A `div`, deliberately: `.asr-row--tab > span` is the rule that
            makes the row's text inert so its clicks fall through to the hit
            layer, and a span wrapper here would silently inherit it. Like
            `.asr-chip`, it needs `position: relative` to paint above that
            absolutely-positioned layer. */}
          <div class="asr-row__actions">
            <button
              type="button"
              class="asr-row__action asr-row__action--close"
              aria-label={`Close tab ${row.title}`}
              onClick={props.onClose}
            >
              <DeckIcon icon={X} size={CHROME_ICON} />
            </button>
          </div>
        </div>
      )}
      {/* The pane tree (DL-27.13): one leaf per agent, joined to the tab by a
          hairline elbow. A leaf is the chip's contract at row width — press to
          focus that exact pane — carrying its leading mark, age and trailing
          glyph. */}
      {treed &&
        row.panes.map((pane) => (
          <button
            key={pane.paneId}
            type="button"
            class={PANE_TREE_HIDDEN ? "asr-leaf asr-leaf--flat" : "asr-leaf"}
            data-state={pane.state}
            aria-label={`Focus ${pane.agent} in ${where}, ${STATE_LABEL[pane.state]}`}
            title={`${pane.agent} — ${STATE_LABEL[pane.state]}`}
            onClick={() => {
              props.onFocusPane(pane.paneId);
            }}
          >
            <RailStatusMark state={pane.state} />
            {/* The leaf's own turn, in the slot its agent name held (DL-27.15,
                amended 2026-08-17). A leaf carries its PANE's tail, not the
                tab's fold: two agents in one tab are two conversations, and
                the model reads the tail per pane for the same reason. Until
                that pane says something the name stands in — a leaf is never
                a blank row. */}
            {pane.message === "" ? (
              <strong class="asr-leaf__agent">{pane.agent}</strong>
            ) : (
              <span class="asr-leaf__msg">{pane.message}</span>
            )}
            {pane.age !== "" && <span class="asr-leaf__age">{pane.age}</span>}
            <AgentGlyph agent={pane.agent} className="asr-leaf__logo" />
          </button>
        ))}
    </div>
  );
}

/**
 * The folder a cluster's `+` opens into: its first row's workspace, else the
 * remembered path a rowless cluster carries.
 *
 * Every row in a cluster belongs to the same project, so the first one answers
 * for all of them. Null when the tab carries no workspace path at all — a bare
 * shell opened outside any folder.
 */
function groupPath(group: {
  readonly rows: readonly RailTabRow[];
  readonly path: string | null;
}): string | null {
  return group.rows[0]?.workspacePath ?? group.path;
}

export function AgentRail(props: AgentRailProps) {
  const tabs = tabViews.value;
  const home = statusInfo.value.home;
  const showAgentPresence = props.showAgentPresence ?? electronHostAvailable;
  // A file surface OR the browser surface can hold the stage while
  // `activeTabIndex` still names whichever terminal tab it sits on top of
  // (selecting a surface never touches `TabManager`'s own `active` index) — so
  // a row is only the VISIBLE active row when neither is true.
  const surfaceActive = props.fileController.activeIndex() >= 0 || browserSurfaceActive.value;
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
    // Read once per render and injected; the model never calls the clock.
    now: Date.now(),
  });

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

  const item = (row: RailTabRow, labelled: boolean) => (
    <TabItem
      key={row.key}
      row={row}
      labelled={labelled}
      active={row.active && !surfaceActive}
      showAgentPresence={showAgentPresence}
      path={row.workspacePath === null ? "" : tildify(row.workspacePath, home)}
      onSelect={() => {
        props.onSelectTab(row.index);
      }}
      onFocusPane={(paneId) => {
        props.onFocusPane(row.index, paneId);
      }}
      onClose={() => {
        props.onCloseTab(row.index);
      }}
    />
  );

  return (
    <nav class="asr-rail asr-rail--mounted" aria-label="Agents">
      {/* The scrolling half: the rows. The footer and the banner below stay
          pinned to the bottom of the column, which is the split `.wsbar__list`
          drew before this rail replaced it. */}
      <div class="asr-rail__list">
        <section class="asr-stream" aria-label="Open agents">
          {view.stream.map((group) => {
            const collapsed = collapsedGroupKeys.value.has(group.key);
            return (
              <div
                class="asr-cluster"
                key={group.key}
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
                     folder → name → `+` → caret. */
                  <div class="asr-cluster__head">
                    {group.rows.length > 0 ? (
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
                    {props.onNewTabIn !== undefined && groupPath(group) !== null && (
                      <button
                        type="button"
                        class="asr-cluster__add"
                        aria-label={`New tab in ${group.project}`}
                        title={`New tab in ${group.project}`}
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
                    {/* A remembered project's close (owner, 2026-08-20): a
                        rowless header has no tab rows carrying a close, so
                        the header keeps one of its own — removing the FOLDER
                        from the rail (all of its history entries at once,
                        since a repository folds several), never closing work,
                        because there is none. It stands in the caret's track,
                        which a still header leaves empty; omitted rather than
                        inert when nothing wires it (DL-19.7). */}
                    {props.onRemoveWorkspace !== undefined &&
                      group.rows.length === 0 &&
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
                      )}
                  </div>
                )}
                {!collapsed && group.rows.map((row) => item(row, group.labelled))}
              </div>
            );
          })}
        </section>
      </div>

      {props.footer}
      <SidebarBanner />
    </nav>
  );
}
