import { CaretRight, CheckCircle, Plus, X } from '@phosphor-icons/react';
import { useSignal, useSignalEffect } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { activeTabIndex, statusInfo, tabViews } from '../terminal/tabs-store';
import { CHROME_ICON, DeckIcon, FEATURE_ICON, RAIL_ICON } from './controls/deck-icon';
import { AgentGlyph } from './controls/agent-glyph';
import { tildify } from '../lib/process-info';
import {
  ensureRepositoriesScanned,
  installRepositoryRescanOnFocus,
  repositoryScans,
} from '../repositories/repositories-store';
import { sessionArchive } from '../terminal/session-journal';
import { paneTails } from '../terminal/session-tail-store';
import { browserSurfaceActive } from '../browser/browser-store';
import { available as electronHostAvailable } from '../host/worktree-host';
import type { FileSurfaceController } from '../files/file-surface-controller';
import { workspacesData } from '../open-board/workspaces-store';
import { SidebarBanner } from './sidebar-banner';
import { createNewPaneDragController, type NewPaneDropDeps } from './new-pane-drag';
import {
  buildAgentRail,
  type RailArchivedRow,
  type RailState,
  type RailTabRow,
} from './agent-rail-model';

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
 * them, quiet archived resume rows at the bottom, and the `New` row last —
 * two controls in one, since clicking it opens the board while dragging it
 * onto a pane docks an agent pane there.
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
  onCloseTab(index: number): void;
  /**
   * The `New` row CLICKED: the Open board's full workspace/preset/agent flow,
   * distinct from the tab strip's `+` (AgentQuickPicker) because this row
   * opens a NEW workspace rather than a fast pick in the active one.
   */
  onOpenWorkspace(): void;
  /**
   * The same row DRAGGED onto a pane, which docks an agent pane there instead
   * of opening anything. Absent (gallery, tests) leaves it a plain button —
   * the drag only ever adds behaviour above the 5px threshold.
   */
  newPaneDrop?: NewPaneDropDeps;
  /** Focus one exact pane: activate its tab, focus that pane, ack it. */
  onFocusPane(index: number, paneId: number): void;
  /** A resumable archived row was pressed. */
  onResumeWorktree(path: string): void;
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
  failed: 'failed',
  asked: 'needs you',
  working: 'working',
  done: 'done',
  idle: 'idle',
};

/** `project` alone, or `project · worktree` outside the primary checkout. */
function whereOf(row: { project: string; worktree: string | null }): string {
  return row.worktree === null ? row.project : `${row.project} · ${row.worktree}`;
}

/**
 * DL-27.3: one mark carries the state, and it carries no word beside it.
 * `done` is the one mark drawn by the icon system — the owner chose the
 * library's check over a CSS drawing, DL-14.6's single scoped exception. The
 * wrapping span keeps the mark's grid placement identical across states.
 */
export function RailStatusMark({ state }: { readonly state: RailState }) {
  return (
    <span class="asr-row__mark" data-state={state} aria-hidden="true">
      {state === 'done' && (
        <DeckIcon icon={CheckCircle} size={FEATURE_ICON} class="asr-row__check" />
      )}
    </span>
  );
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
 * being trimmed hardest. Quiet rows dim instead of going blank — the CSS reads
 * `data-quiet` on the row above.
 */
function MessageLine({ text }: { readonly text: string }) {
  return <span class="asr-row__msg">{text}</span>;
}

/**
 * DL-27.15: `working`, `done` and `idle` are the states nobody has to act on,
 * so their rows recede — name, glyph and turn line all drop to the faint tone.
 * The state mark keeps its full colour in every state: state is meaning, not
 * emphasis, and dimming it would make the fast read the hardest one.
 */
function isQuiet(state: RailState): boolean {
  return state !== 'asked' && state !== 'failed';
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
    treed && (PANE_TREE_HIDDEN || (props.labelled ? row.identity : row.project) === '');
  const name = props.labelled ? row.identity : row.project;
  // Every state that has something to say says it (DL-27.15). The emptiness
  // check is the only gate left: a tab nobody renamed, whose panes have said
  // nothing, still has no turn to print.
  const showMessage = row.message !== '';
  // The turn TAKES the name's slot rather than adding a line under it — with
  // two exceptions, both of which would otherwise lose a word nothing else
  // says: a name the user typed, and an unlabelled row, whose project name has
  // no cluster header carrying it. In both the turn follows the name on the
  // same line.
  const showName = name !== '' && (row.named || !props.labelled || !showMessage);
  const title = [`${where} · ${row.title} — ${label}`, props.path, row.message]
    .filter((line) => line !== '')
    .join('\n');

  return (
    <div
      class="asr-item"
      data-active={props.active}
      data-headless={headless}
      data-key={headless ? row.key : undefined}
    >
      {!headless && (
        <div
          class="asr-row asr-row--tab"
          data-state={row.state}
          data-quiet={isQuiet(row.state)}
          data-key={row.key}
        >
          <button
            type="button"
            class="asr-row__hit"
            aria-label={`${where}, tab ${row.title}, ${row.panes.length} agents, ${label}, ${row.age}`}
            title={title}
            onClick={props.onSelect}
          />
          {/* One agent leads with its chip; several become leaves below, and the
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
          {row.age !== '' && <span class="asr-row__age">{row.age}</span>}
          <RailStatusMark state={row.state} />
          {/* DL-27.5: the hover action owns a fixed trailing column, so appearing
            never reflows the age or state. A real button, so the row's own
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
          focus that exact pane — carrying its own glyph, age and mark. */}
      {treed &&
        row.panes.map((pane) => (
          <button
            key={pane.paneId}
            type="button"
            class={PANE_TREE_HIDDEN ? 'asr-leaf asr-leaf--flat' : 'asr-leaf'}
            data-state={pane.state}
            data-quiet={isQuiet(pane.state)}
            aria-label={`Focus ${pane.agent} in ${where}, ${STATE_LABEL[pane.state]}`}
            title={`${pane.agent} — ${STATE_LABEL[pane.state]}`}
            onClick={() => {
              props.onFocusPane(pane.paneId);
            }}
          >
            <AgentGlyph agent={pane.agent} className="asr-leaf__logo" />
            {/* The leaf's own turn, in the slot its agent name held (DL-27.15,
                amended 2026-08-17). A leaf carries its PANE's tail, not the
                tab's fold: two agents in one tab are two conversations, and
                the model reads the tail per pane for the same reason. Until
                that pane says something the name stands in — a leaf is never
                a blank row. */}
            {pane.message === '' ? (
              <strong class="asr-leaf__agent">{pane.agent}</strong>
            ) : (
              <span class="asr-leaf__msg">{pane.message}</span>
            )}
            {pane.age !== '' && <span class="asr-leaf__age">{pane.age}</span>}
            <RailStatusMark state={pane.state} />
          </button>
        ))}
    </div>
  );
}

/**
 * Spec §8: a previously opened workspace with an archived session and no live
 * tab. Quiet, pressable, the idle mark and the last known project name — and
 * no message line, because no live pane has said anything. The title carries
 * no state word: `idle` is a live-pane claim, and an archived row is not one.
 */
function ArchivedRow({
  row,
  onResume,
}: {
  readonly row: RailArchivedRow;
  readonly onResume: () => void;
}) {
  const where = whereOf(row);
  return (
    <div class="asr-item">
      <div
        class="asr-row asr-row--archived"
        data-state="idle"
        role="button"
        tabIndex={0}
        aria-label={`Resume last session in ${where}`}
        title={where}
        onClick={onResume}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onResume();
          }
        }}
      >
        <span class="asr-row__name">
          <strong>{row.project}</strong>
          {row.worktree !== null && <span class="asr-row__worktree">{row.worktree}</span>}
        </span>
        <RailStatusMark state="idle" />
      </div>
    </div>
  );
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
    archivedPaths: new Set(Object.keys(sessionArchive.value)),
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

  // The `New` row as a drop source. Installed once and reading its deps
  // through a ref: the controller outlives every re-render, while the props it
  // calls are read at pointer time, so a drag can never act on a stale stage.
  const openRowRef = useRef<HTMLButtonElement | null>(null);
  const dropRef = useRef<NewPaneDropDeps | undefined>(props.newPaneDrop);
  dropRef.current = props.newPaneDrop;
  const fileControllerRef = useRef(props.fileController);
  fileControllerRef.current = props.fileController;
  useEffect(() => {
    const handle = openRowRef.current;
    if (handle === null) {
      return;
    }
    const controller = createNewPaneDragController(handle, {
      ghostLabel: 'New agent pane',
      slotRects() {
        // Inert while a browser or document surface covers the terminal grid:
        // those panes are behind a native view / another surface, so no rect
        // under the cursor belongs to anything droppable. Reported as "no
        // targets" rather than as a mode, so the drag stays one code path.
        const covered = fileControllerRef.current.activeIndex() >= 0 || browserSurfaceActive.peek();
        return covered ? [] : (dropRef.current?.slotRects() ?? []);
      },
      onDragStart() {
        dropRef.current?.onDragStart?.();
      },
      onDrop(targetPaneId, edge) {
        dropRef.current?.onDrop(targetPaneId, edge);
      },
    });
    return () => controller.dispose();
  }, []);
  useSignalEffect(() => {
    ensureRepositoriesScanned(
      tabViews.value
        .map((tab) => tab.workspacePath)
        .filter((path): path is string => path !== null),
    );
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
      path={row.workspacePath === null ? '' : tildify(row.workspacePath, home)}
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
        {/* First row of the list, above every project (owner, 2026-08-17).
            It was the LAST row from 2026-08-16 until now, on the reasoning
            that it belongs to the workspaces it adds to; the owner reads it
            as the rail's primary action instead, and a primary action does
            not sit at the bottom of a list whose length nobody controls.
            Still INSIDE the scrollport rather than pinned above it, so the
            rail keeps one scrolling body — pinning it would be a second
            structural row, not a reorder. */}
        <div class="asr-openrow">
          {/* Names what the list below holds (owner, 2026-08-17). Deliberately
              OUTSIDE the button: it is a caption, not a second way to open the
              board, so the button shrank to its own content and this sits at
              the LEADING edge with no interaction of its own (owner,
              2026-08-17: the caption reads as the list's heading, so it takes
              the same leading inset the cluster headers below it do, and the
              action moves to the trailing end). `aria-hidden` because the
              button's accessible name already says `New` and a screen reader
              reading a bare "Workspace" beside it would only suggest a control
              that is not there. */}
          <span class="asr-openrow__label" aria-hidden="true">
            Workspace
          </span>
          <button
            ref={openRowRef}
            type="button"
            class="asr-open"
            title="Open a workspace — or drag onto a pane to add an agent there"
            aria-label="New"
            onClick={props.onOpenWorkspace}
          >
            <span class="asr-open__glyph">
              <DeckIcon icon={Plus} size={RAIL_ICON} />
            </span>
            {/* Classed so the collapsed column can drop the words and keep the
                glyph (DL-18.9); `aria-label` above already carries the name. */}
            <span class="asr-open__label">New</span>
          </button>
        </div>

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
                  <button
                    type="button"
                    class="asr-cluster__head"
                    aria-expanded={!collapsed}
                    aria-label={`${collapsed ? 'Expand' : 'Collapse'} project ${group.project}`}
                    onClick={() => {
                      toggleGroup(group.key);
                    }}
                  >
                    <DeckIcon icon={CaretRight} size={CHROME_ICON} class="asr-cluster__caret" />
                    <span>{group.project}</span>
                  </button>
                )}
                {!collapsed && group.rows.map((row) => item(row, group.labelled))}
              </div>
            );
          })}
        </section>

        {view.archived.length > 0 && (
          <section class="asr-archive" aria-label="Archived workspaces">
            {view.archived.map((row) => (
              <ArchivedRow
                key={row.path}
                row={row}
                onResume={() => {
                  props.onResumeWorktree(row.path);
                }}
              />
            ))}
          </section>
        )}
      </div>

      {props.footer}
      <SidebarBanner />
    </nav>
  );
}
