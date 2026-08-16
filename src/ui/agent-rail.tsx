import { ChevronRight, Plus, X } from "lucide-preact";
import { useSignal, useSignalEffect } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { activeTabIndex, statusInfo, tabViews } from "../terminal/tabs-store";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { AgentGlyph } from "./controls/agent-glyph";
import { tildify } from "../lib/process-info";
import {
  ensureRepositoriesScanned,
  installRepositoryRescanOnFocus,
  repositoryScans,
} from "../repositories/repositories-store";
import { sessionArchive } from "../terminal/session-journal";
import { browserSurfaceActive } from "../browser/browser-store";
import { available as electronHostAvailable } from "../host/worktree-host";
import type { FileSurfaceController } from "../files/file-surface-controller";
import { workspacesData } from "../open-board/workspaces-store";
import { SidebarBanner } from "./sidebar-banner";
import {
  buildAgentRail,
  type RailArchivedRow,
  type RailPaneRow,
  type RailState,
  type RailTabRow,
} from "./agent-rail-model";

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
 * them, quiet archived resume rows at the bottom, and the `Open workspace`
 * footer row. One row per tab, agents as chips inside it, a disclosure that
 * unfolds them into rows of their own. A tab waiting on the user stays under
 * its own project — the pinned `Needs you` block was removed on 2026-08-16
 * because it printed a project twice; ⌘⇧A still walks to the next one.
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
   * Footer "Open workspace" row: the Open board's full workspace/preset/agent
   * flow, distinct from the tab strip's `+` (AgentQuickPicker) because this row
   * opens a NEW workspace rather than a fast pick in the active one.
   */
  onOpenWorkspace(): void;
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
  failed: "failed",
  asked: "needs you",
  done: "done",
  working: "working",
  resting: "resting",
};

/** Agent marks a tab row shows before it starts counting (spec §2.1). */
const CHIP_BUDGET = 3;

/** `project` alone, or `project · worktree` outside the primary checkout. */
function whereOf(row: { project: string; worktree: string | null }): string {
  return row.worktree === null
    ? row.project
    : `${row.project} · ${row.worktree}`;
}

/** DL-27.3: one mark carries the state, and it carries no word beside it. */
function StatusMark({ state }: { readonly state: RailState }) {
  return <span class="asr-row__mark" data-state={state} aria-hidden="true" />;
}

/**
 * DL-27.4: the newest turn, trimmed by layout rather than by slicing — the
 * full sentence stays in the DOM for the tooltip and for a screen reader.
 */
function MessageLine({ text }: { readonly text: string }) {
  return <span class="asr-row__msg">{text}</span>;
}

/** The pane's state in words, plus its turn when there is one to add. */
function paneTitle(pane: RailPaneRow): string {
  const head = `${pane.agent} — ${STATE_LABEL[pane.state]}`;
  return pane.message === "" ? head : `${head}\n${pane.message}`;
}

/** One agent inside an expanded tab: its own turn, its own state. */
function PaneDetailRow({
  pane,
  where,
  onFocus,
}: {
  readonly pane: RailPaneRow;
  readonly where: string;
  readonly onFocus: () => void;
}) {
  return (
    <button
      type="button"
      class="asr-pane"
      data-state={pane.state}
      onClick={onFocus}
      aria-label={`Focus ${pane.agent} in ${where}, ${STATE_LABEL[pane.state]}`}
      title={paneTitle(pane)}
    >
      <AgentGlyph agent={pane.agent} className="asr-pane__logo" />
      <strong class="asr-pane__agent">{pane.agent}</strong>
      <StatusMark state={pane.state} />
      {pane.message !== "" && <span class="asr-pane__msg">{pane.message}</span>}
    </button>
  );
}

interface TabItemProps {
  readonly row: RailTabRow;
  /**
   * True when a cluster header above this row has already named the project,
   * so the row names the TAB instead (DL-27.9). False for a lone row, whose
   * cluster prints no header.
   */
  readonly labelled: boolean;
  readonly open: boolean;
  readonly active: boolean;
  readonly showAgentPresence: boolean;
  /** Tildified workspace path for the tooltip; empty when there is none. */
  readonly path: string;
  readonly onToggle: () => void;
  readonly onSelect: () => void;
  readonly onFocusPane: (paneId: number) => void;
  readonly onClose: () => void;
}

/**
 * The rail's one row shape. DL-27.1: the row is a container with a full-bleed
 * hit layer behind it, not a `<button>` — an agent chip inside it has to be its
 * own control, and a button nested in a button is not operable. The disclosure
 * is a SIBLING in the left gutter for the same reason; the gutter stays
 * reserved when there is nothing to disclose so every project name starts on
 * one line (spec §2.3).
 *
 * DL-27.8: the selection wash is carried by the ITEM, not by the row inside
 * it. A tab is one thing even when it is unfolded into several lines, so
 * `data-active` sits on the wrapper and the row itself stays transparent.
 */
function TabItem(props: TabItemProps) {
  const { row } = props;
  const where = whereOf(row);
  const label = STATE_LABEL[row.state];
  const shown = row.panes.slice(0, CHIP_BUDGET);
  const overflow = row.panes.length - shown.length;
  const expandable = row.panes.length > 1;
  const title = [`${where} · ${row.title} — ${label}`, props.path, row.message]
    .filter((line) => line !== "")
    .join("\n");

  return (
    <div class="asr-item" data-open={props.open} data-active={props.active}>
      {expandable && props.showAgentPresence ? (
        <button
          type="button"
          class="asr-disclose"
          aria-expanded={props.open}
          aria-label={`${props.open ? "Hide" : "Show"} the ${row.panes.length} agents in ${where}`}
          onClick={props.onToggle}
        >
          <DeckIcon icon={ChevronRight} size={CHROME_ICON} />
        </button>
      ) : (
        <span class="asr-disclose asr-disclose--empty" aria-hidden="true" />
      )}

      <div class="asr-row asr-row--tab" data-state={row.state} data-key={row.key}>
        <button
          type="button"
          class="asr-row__hit"
          aria-label={`${where}, tab ${row.title}, ${row.panes.length} agents, ${label}, ${row.age}`}
          title={title}
          onClick={props.onSelect}
        />
        <span class="asr-row__name">
          {/* Inside a labelled cluster the project name is already printed
              above, so the row spends its one strong word on which tab this
              is (DL-27.9). */}
          <strong>{props.labelled ? row.identity : row.project}</strong>
          {/* Named only outside the primary checkout — otherwise 46 of 51
              repositories would carry a word that says nothing (spec §2.1). */}
          {row.worktree !== null && (
            <span class="asr-row__worktree">{row.worktree}</span>
          )}
        </span>
        {props.showAgentPresence && row.panes.length > 0 && (
          <span class="asr-chips">
            {shown.map((pane) => (
              <button
                key={pane.paneId}
                type="button"
                class="asr-chip"
                data-state={pane.state}
                aria-label={`Focus ${pane.agent} in ${where}, ${STATE_LABEL[pane.state]}`}
                title={`${pane.agent} — ${STATE_LABEL[pane.state]}\n${pane.message}`}
                onClick={() => {
                  props.onFocusPane(pane.paneId);
                }}
              >
                <AgentGlyph agent={pane.agent} className="asr-chip__logo" />
              </button>
            ))}
            {/* `+N` is the disclosure's second face: it says "there is more in
                here", so pressing it opens the same list. */}
            {overflow > 0 && (
              <button
                type="button"
                class="asr-chip asr-chip--more"
                aria-label={`Show all ${row.panes.length} agents in ${where}`}
                onClick={props.onToggle}
              >
                +{overflow}
              </button>
            )}
          </span>
        )}
        <StatusMark state={row.state} />
        {/* DL-27.5: the hover action sits at the trailing end of the meta
            line, in space that line reserves whether or not the pointer is
            there. A real button, so the row's own focus order reaches it; the
            row's accessible name is unchanged because it lives on the hit
            layer, not here. Close is the only one left — the options button
            beside it opened `TabPopover`, removed on 2026-08-16 with the
            rename and workspace-logo features it carried.

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
        {/* The meta line (DL-27.10, 2026-08-16): the age dropped out of the
            name line, where it sat between the agent chips and the mark and
            split them with a number. Here it leads a line of its own, and the
            turn — when there is one, and only while the row is folded, since
            the per-agent rows carry their own (spec §2.3) — follows it. */}
        {(row.age !== "" || (!props.open && row.message !== "")) && (
          <span class="asr-row__meta">
            <span class="asr-row__age">{row.age}</span>
            {!props.open && row.message !== "" && (
              <MessageLine text={row.message} />
            )}
          </span>
        )}
      </div>

      {props.open && props.showAgentPresence && (
        <div class="asr-panes">
          {row.panes.map((pane) => (
            <PaneDetailRow
              key={pane.paneId}
              pane={pane}
              where={where}
              onFocus={() => {
                props.onFocusPane(pane.paneId);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Spec §8: a previously opened workspace with an archived session and no live
 * tab. Quiet, pressable, a resting mark and the last known project name — and
 * no message line, because no live pane has said anything.
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
      <span class="asr-disclose asr-disclose--empty" aria-hidden="true" />
      <div
        class="asr-row asr-row--archived"
        data-state="resting"
        role="button"
        tabIndex={0}
        aria-label={`Resume last session in ${where}`}
        title={`${where} — ${STATE_LABEL.resting}`}
        onClick={onResume}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onResume();
          }
        }}
      >
        <span class="asr-row__name">
          <strong>{row.project}</strong>
          {row.worktree !== null && (
            <span class="asr-row__worktree">{row.worktree}</span>
          )}
        </span>
        <StatusMark state="resting" />
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
  const surfaceActive =
    props.fileController.activeIndex() >= 0 || browserSurfaceActive.value;
  // Which rows are unfolded. A new Set each time rather than a mutated one
  // (C1), so the signal actually notifies.
  const openKeys = useSignal<ReadonlySet<number>>(new Set());

  const view = buildAgentRail({
    tabs,
    activeIndex: activeTabIndex.value,
    scans: repositoryScans.value,
    archivedPaths: new Set(Object.keys(sessionArchive.value)),
    workspaceHistoryPaths: workspacesData.value.recents.map(
      (recent) => recent.path,
    ),
    // Read once per render and injected; the model never calls the clock.
    now: Date.now(),
  });

  // Repository scans: on demand for every open workspace, and again whenever
  // the window comes back. Without them every row degrades to a bare project
  // with no worktree knowledge.
  useEffect(() => installRepositoryRescanOnFocus(), []);
  useSignalEffect(() => {
    ensureRepositoriesScanned(
      tabViews.value
        .map((tab) => tab.workspacePath)
        .filter((path): path is string => path !== null),
    );
  });

  function toggle(key: number): void {
    const next = new Set(openKeys.value);
    if (!next.delete(key)) {
      next.add(key);
    }
    openKeys.value = next;
  }

  const item = (row: RailTabRow, labelled: boolean) => (
    <TabItem
      key={row.key}
      row={row}
      labelled={labelled}
      open={openKeys.value.has(row.key)}
      active={row.active && !surfaceActive}
      showAgentPresence={showAgentPresence}
      path={row.workspacePath === null ? "" : tildify(row.workspacePath, home)}
      onToggle={() => {
        toggle(row.key);
      }}
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
          {view.stream.map((group) => (
            <div
              class="asr-cluster"
              key={group.key}
              data-labelled={group.labelled}
            >
              {/* DL-27.9: the project name once, above its tabs. A label, not
                  a control — it has no state, no age and nothing to press, so
                  it is not a row genre and does not reinstate the tree the
                  rail replaced (spec §9). */}
              {group.labelled && (
                <span class="asr-cluster__head">{group.project}</span>
              )}
              {group.rows.map((row) => item(row, group.labelled))}
            </div>
          ))}
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
        {/* Last row of the list, not a pinned footer: it belongs to the
            workspaces it adds to, so it follows the final one and scrolls
            with them (2026-08-16). */}
        <button
          type="button"
          class="asr-open"
          title="Open a workspace, worktree, or layout preset"
          aria-label="Open workspace"
          onClick={props.onOpenWorkspace}
        >
          <span class="asr-open__glyph">
            <DeckIcon icon={Plus} size={CHROME_ICON} />
          </span>
          {/* Classed so the collapsed column can drop the words and keep the
              glyph (DL-18.9); `aria-label` above already carries the name. */}
          <span class="asr-open__label">Open workspace</span>
        </button>
      </div>

      {props.footer}
      <SidebarBanner />
    </nav>
  );
}
