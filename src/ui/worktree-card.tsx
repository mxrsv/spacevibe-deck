import { useRef, useState } from "preact/hooks";
import { Folder, GitBranch, Plus, TerminalWindow, X } from "@phosphor-icons/react";
import { DeckIcon, CHROME_ICON } from "./controls/deck-icon";
import { CardAgentRow, CardLoad, whereOf } from "./worktree-card-row";
import { CardActionsMenu, type CardActions } from "./worktree-card-menus";
import { checkoutLine, subjectOf } from "./agent-rail-card-model";
import type { RailCardEntry, RailCardShell, RailWorktreeGroup } from "./agent-rail-model";

/**
 * One checkout in the rail tree (DL-27.28; design `docs/internals/agent-rail.md`).
 *
 * A checkout is a LABEL LINE — branch, `worktree` tag, a trailing `+` — and
 * then its session rows, indented one step. No frame, border or fill groups
 * them: the card DL-27.25 drew (head, disclosure, folded strip, `New agent`
 * row) retired on Electron with this rule, and the project header's caret is
 * the only fold left. DL-27.25 stays in the design language as the record.
 *
 * Class vocabulary: `.asr-checkout` is the checkout, `__line` its label line
 * (a row of controls, not one button, for the same reason the cluster header
 * is one: the `+` cannot live inside the focus button), `__focus`, `__glyph`,
 * `__name`, `__tag` and `__add` its parts. The rows keep the `.asr-card__row`
 * family unchanged — hit layer, logo badge, bars and close are
 * DL-27.21's — so the rows did not move when the box around them went.
 *
 * Mounted on Electron only: `AgentRail` routes Tauri to `RepositoryRail`.
 */

/**
 * The actions menu's open state and anchor. One hook rather than two copies
 * of the same two fields, so the toggle contract — a second press on the
 * control that opened it CLOSES it, because that control is exempt from
 * `useDismiss`'s outside-press close — is stated once.
 *
 * The menu is `position: fixed` off `rect`, so the host's own box does not
 * matter and `CheckoutMenu` renders as a sibling of whatever pressed it.
 */
interface ActionsMenuState {
  readonly rect: DOMRect | null;
  readonly trigger: { readonly current: HTMLElement | null };
  /** Open at `rect`, exempting `trigger` from the outside-press close; close
   *  instead if already open — the press came from the control that opened it. */
  readonly toggleAt: (rect: DOMRect, trigger: HTMLElement | null) => void;
  /** Open (or re-anchor) without toggling — the right-click path, which has no
   *  trigger element and must not close a menu it was asked to raise. */
  readonly openAt: (rect: DOMRect) => void;
  readonly close: () => void;
}

function useActionsMenu(): ActionsMenuState {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const close = (): void => {
    setRect(null);
    trigger.current = null;
  };
  return {
    rect,
    trigger,
    toggleAt: (at, from) => {
      if (rect !== null) {
        close();
        return;
      }
      trigger.current = from;
      setRect(at);
    },
    openAt: (at) => {
      trigger.current = null;
      setRect(at);
    },
    close,
  };
}

/** The checkout's actions menu, mounted while its state says it is open. */
function CheckoutMenu({
  project,
  group,
  actions,
  menu,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly actions: CardActions;
  readonly menu: ActionsMenuState;
}) {
  if (menu.rect === null) {
    return null;
  }
  return (
    <CardActionsMenu
      subject={subjectOf(project, group)}
      actions={actions}
      rect={menu.rect}
      trigger={menu.trigger.current}
      onClose={menu.close}
    />
  );
}

/** A shell-only tab retained as a first-class selectable row under its checkout. */
function CardShellRow({
  project,
  group,
  shell,
  onSelectTab,
  onCloseTab,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly shell: RailCardShell;
  readonly onSelectTab: (tabIndex: number) => void;
  readonly onCloseTab: (tabIndex: number) => void;
}) {
  const where = whereOf(project, group);
  return (
    <div class="asr-card__row" data-kind="shell" data-focused={shell.active}>
      <button
        type="button"
        class="asr-card__hit"
        aria-current={shell.active ? "true" : undefined}
        aria-label={`Open ${shell.label} in ${where}`}
        title={`${shell.label} — shell`}
        onClick={() => {
          onSelectTab(shell.tabIndex);
        }}
      />
      <span class="asr-card__glyph" aria-hidden="true">
        <DeckIcon icon={TerminalWindow} size={CHROME_ICON} />
      </span>
      <span class="asr-card__name">{shell.label}</span>
      <CardLoad state="idle" />
      <div class="asr-row__actions">
        <button
          type="button"
          class="asr-row__action asr-row__action--close"
          aria-label={`Close ${shell.label} in ${where}`}
          onClick={() => {
            onCloseTab(shell.tabIndex);
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    </div>
  );
}

function CardEntryRow({
  entry,
  ...props
}: {
  readonly entry: RailCardEntry;
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  readonly onSelectTab: (tabIndex: number) => void;
  readonly onCloseTab: (tabIndex: number) => void;
  readonly onRenameTab?: (tabIndex: number, name: string | null) => void;
}) {
  return entry.kind === "agent" ? (
    <CardAgentRow
      project={props.project}
      group={props.group}
      pane={entry}
      onFocusPane={props.onFocusPane}
      onClosePane={props.onClosePane}
      onRenameTab={props.onRenameTab}
    />
  ) : (
    <CardShellRow
      project={props.project}
      group={props.group}
      shell={entry}
      onSelectTab={props.onSelectTab}
      onCloseTab={props.onCloseTab}
    />
  );
}

/**
 * The label line's text: a branch glyph (DL-14.1) or a folder's, the branch
 * name, and the `worktree` tag on a linked worktree (DL-27.28).
 */
function LineLabel({ group }: { readonly group: RailWorktreeGroup }) {
  const line = checkoutLine(group);
  return (
    <>
      <span class="asr-checkout__glyph" aria-hidden="true">
        <DeckIcon icon={group.labelled ? GitBranch : Folder} size={CHROME_ICON} />
      </span>
      <span class="asr-checkout__name">{line.name}</span>
      {line.tag !== null && <span class="asr-checkout__tag">{line.tag}</span>}
    </>
  );
}

export interface WorktreeCardProps {
  /** The project name above this checkout — `RailStreamGroup.project`. */
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  /** DL-27.21, kept: every agent row closes its own pane. */
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  readonly onCloseTab: (tabIndex: number) => void;
  /** Reach a shell-only entry's tab. Agent entries use `onFocusPane`. */
  readonly onSelectTab: (tabIndex: number) => void;
  /**
   * Name (or unname) the tab behind an agent row: a double-click on the row.
   * Omitted where nothing owns tab names (the gallery), which takes the
   * gesture with it.
   */
  readonly onRenameTab?: (tabIndex: number, name: string | null) => void;
  /**
   * What the label line's `+` and a right-click raise: the agent launch page
   * on that checkout when `onOpenAgentLauncher` is wired, the checkout
   * actions menu otherwise. Omitted where nothing can wire it, which takes
   * the `+` with it (DL-19.7) rather than leaving a launcher that opens nothing.
   */
  readonly actions?: CardActions;
}

/**
 * Focus a checkout: keep its selected entry when present, otherwise the first
 * in opening order. A checkout with no entries has nothing to focus.
 */
export function focusCheckout(
  group: RailWorktreeGroup,
  onFocusPane: (tabIndex: number, paneId: number) => void,
  onSelectTab: (tabIndex: number) => void,
): void {
  const entry =
    group.entries.find((candidate) =>
      candidate.kind === "agent" ? candidate.focused : candidate.active,
    ) ?? group.entries[0];
  if (entry === undefined) {
    return;
  }
  if (entry.kind === "agent") {
    onFocusPane(entry.tabIndex, entry.paneId);
  } else {
    onSelectTab(entry.tabIndex);
  }
}

export function WorktreeCard(props: WorktreeCardProps) {
  const { group, project, actions } = props;
  const menu = useActionsMenu();
  const rootRef = useRef<HTMLDivElement>(null);
  const where = whereOf(project, group);
  // The menu hangs off the CHECKOUT, not the cursor or the `+` (spec §8.2),
  // so every entry point puts it in the same place.
  const anchor = (fallback: HTMLElement): DOMRect =>
    (rootRef.current ?? fallback).getBoundingClientRect();

  return (
    <div
      ref={rootRef}
      class="asr-checkout"
      data-current={group.active}
      data-primary={group.primary}
      onContextMenu={(event) => {
        if (actions === undefined) {
          return;
        }
        event.preventDefault();
        menu.openAt(anchor(event.currentTarget));
      }}
    >
      <div class="asr-checkout__line">
        {/* A checkout with nothing open has nothing to focus, so its label is
            text; the `+` beside it is the way in (DL-27.26, amended). */}
        {group.entries.length > 0 ? (
          <button
            type="button"
            class="asr-checkout__focus"
            aria-current={group.active ? "true" : undefined}
            aria-label={`Focus ${where}`}
            title={where}
            onClick={() => {
              focusCheckout(group, props.onFocusPane, props.onSelectTab);
            }}
          >
            <LineLabel group={group} />
          </button>
        ) : (
          <span class="asr-checkout__focus" title={where}>
            <LineLabel group={group} />
          </span>
        )}
        {actions !== undefined && (
          // DL-27.26 (amended 2026-10-07): the one create control per
          // checkout. No `title` — one never appears on focus (DL-23.10) and
          // the accessible name already says it all.
          <button
            type="button"
            class="asr-checkout__add"
            aria-haspopup={actions.onOpenAgentLauncher ? undefined : "menu"}
            aria-expanded={actions.onOpenAgentLauncher ? undefined : menu.rect !== null}
            aria-label={`New agent in ${where}`}
            onClick={(event) => {
              if (actions.onOpenAgentLauncher) {
                actions.onOpenAgentLauncher(group.path);
                return;
              }
              menu.toggleAt(anchor(event.currentTarget), event.currentTarget);
            }}
          >
            <DeckIcon icon={Plus} size={CHROME_ICON} />
          </button>
        )}
      </div>
      {group.entries.map((entry) => (
        <CardEntryRow
          key={entry.kind === "agent" ? entry.paneId : entry.key}
          project={project}
          group={group}
          entry={entry}
          onFocusPane={props.onFocusPane}
          onClosePane={props.onClosePane}
          onSelectTab={props.onSelectTab}
          onCloseTab={props.onCloseTab}
          onRenameTab={props.onRenameTab}
        />
      ))}
      {actions !== undefined && (
        <CheckoutMenu project={project} group={group} actions={actions} menu={menu} />
      )}
    </div>
  );
}
