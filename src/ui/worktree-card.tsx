import { Fragment } from "preact";
import { useRef, useState } from "preact/hooks";
import { GitBranch, Plus, TerminalWindow, X } from "@phosphor-icons/react";
import { DeckIcon, CHROME_ICON } from "./controls/deck-icon";
import { CardAgentRow, CardLoad, whereOf } from "./worktree-card-row";
import { CardStrip } from "./worktree-card-strip";
import { CardActionsMenu, type CardActions } from "./worktree-card-menus";
import { checkoutBadge, checkoutLabel, type CheckoutBadge } from "./agent-rail-card-model";
import type { RailCardEntry, RailCardShell, RailWorktreeGroup } from "./agent-rail-model";

/**
 * The rail's worktree card (DL-27.23/DL-27.24, amended; design
 * `docs/specs/2026-08-25-rail-worktree-card-design.md`).
 *
 * The tab tier is gone: `agent-rail.tsx` used to render a sub-header
 * (`.asr-wt__head`) followed by one row per TAB, each optionally expanding
 * into agent leaves. This component collapses that into one unit — a
 * checkout is a card, and its rows are every agent PANE in it, flattened
 * across tabs (spec §3). `RailTabRow` still exists and is still walked by
 * the model to produce `RailWorktreeGroup.panes`; nothing on screen
 * corresponds to a tab any more.
 *
 * Class vocabulary: `.asr-card` (a checkout with panes) and `.asr-bare` (a
 * checkout with none), both under the rail's existing `.asr-` prefix — no
 * second vocabulary. `__head`, `__name`, `__badge`, `__meta`, `__strip`,
 * `__row` and `__pill` are the anchors Task 7's stylesheet targets by name.
 * A handful of finer parts are unavoidable additions under the same prefix
 * (`AgentGlyph` requires a `className`; DL-27.21 forces a hit-layer + a real
 * close button, so a leaf needs a `__hit`): `__mark`, `__dot`, `__glyph`,
 * `__logo`, `__hit`, `__load`, `__count`, `__seg` — the closed strip's
 * segment, deliberately NOT `__row`. **Amended 2026-08-27**: a segment now
 * carries a PRESS (it focuses its loudest pane) and raises a menu, so the
 * original wording — "carries no press and no close" — is no longer the
 * distinction. It still carries no CLOSE and is still not a full row, and the
 * selector reason stands unchanged: sharing one class made "how many rows are
 * open" indistinguishable from "how wide is the strip" by selector alone,
 * caught as a real bug in review. The strip itself moved to
 * `worktree-card-strip.tsx` with that change. Also `__new`, the
 * `New agent` row's OWN leaf for the identical reason: it shares no press
 * target or accessible name with an agent row, either, and briefly sharing
 * `__row` there too made a `rows()`-style test selector need a `:not()` to
 * stay correct. The close button itself reuses the rail's EXISTING
 * `asr-row__actions` / `asr-row__action` / `asr-row__action--close`
 * vocabulary rather than inventing a card-local one — the exact pattern
 * DL-27.21 is quoted from (`agent-rail.tsx`'s old tab row and leaf).
 *
 * Deliberately NOT reused: `RailStatusMark`. Its `working` case draws
 * `WorkspaceSpinner`, and its `idle`/`done` cases both draw a dot — this
 * card's own state badge draws NOTHING for `idle` (design §9.4 point 2) and
 * never spins (busy motion is the trailing loading track, `CardLoad`, not
 * the corner badge). Reusing it would mean overriding two of its five
 * branches from outside, which is not reuse.
 *
 * **Host parity, decided (review, 2026-08-26): the card draws its strip and
 * its agent rows on BOTH hosts, labelled and unlabelled paths alike — there
 * is no `showAgentPresence` gate anywhere in this file.** A gate was tried
 * and reversed: the OLD `TabItem` gated its per-agent chip/leaf rendering on
 * `electronHostAvailable` because a TAB ROW still existed underneath to fall
 * back to. That fallback is gone — the tab tier no longer renders at all —
 * so a gate here could only choose between "pane rows" and "nothing", never
 * restore the old picture. And because `git_repository` is Electron-only,
 * REAL Tauri renders almost entirely through `FlatPanes` (`!group.labelled`
 * below): gating the labelled path alone would have been cosmetic, and
 * gating both would leave Tauri with a cluster header over a blank space —
 * worse than what it draws today.
 *
 * This is a DELIBERATE, NAMED parity change, not an accident: Tauri gains
 * per-pane rows and a per-pane close it never had before (DL-27.13's tree
 * was itself `electronHostAvailable`-gated). A Tauri row is honestly
 * incomplete rather than silently wrong — `paneTails` and `paneModels` are
 * both Electron-only stores, so `pane.message`/`pane.model` arrive empty on
 * every Tauri pane, and `CardAgentRow` already omits the model pill when
 * `pane.model === ""` (§9.1's own reversal already dropped `pane.message`
 * from the row everywhere, so that half costs nothing extra). The state
 * badge, the glyph and the close button all still work, because none of
 * those read an Electron-only store.
 */

/**
 * The trailing badge beside the checkout label (design §4).
 * Takes its class from the caller rather than hardcoding `.asr-card__badge`:
 * a card and a bare row are two different prefixes (`.asr-card`/`.asr-bare`)
 * and each needs its OWN `__badge` leaf, not one root's leaf borrowed by the
 * other.
 *
 * What it says is `checkoutBadge`'s answer, not the branch unconditionally: a
 * head whose LABEL is already the branch would otherwise print that word
 * twice, which is the defect this badge sits beside. `data-kind` carries the
 * distinction to CSS, since a `role` word takes the ink of a category and a
 * branch takes DL-14.1's glyph.
 */
function Badge({
  className,
  badge,
}: {
  readonly className: string;
  readonly badge: CheckoutBadge;
}) {
  return (
    <span class={className} data-kind={badge.kind} title={badge.text}>
      {badge.kind === "branch" && <DeckIcon icon={GitBranch} size={CHROME_ICON} />}
      <span>{badge.text}</span>
    </span>
  );
}

/**
 * The card head: `mark · checkout label · badge`, and nothing else.
 * No caret, no age (design §4 — the head has 213px for a name and a branch
 * at 275px, and a caret's 19px was almost exactly the deficit). The whole
 * head is the toggle.
 *
 * The label is `checkoutLabel`, not `group.name`: the primary checkout's
 * folder name IS the project name the cluster header printed directly above,
 * so it is named by its branch instead (DL-27.25, amended).
 */
function CardHead({
  project,
  group,
  open,
  onToggle,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const where = whereOf(project, group);
  return (
    <button
      type="button"
      class="asr-card__head"
      aria-expanded={open}
      aria-label={`${open ? "Collapse" : "Expand"} ${where}${group.live ? ", working" : ""}`}
      title={where}
      onClick={onToggle}
    >
      <span class="asr-card__mark" data-live={group.live} aria-hidden="true" />
      <span class="asr-card__name">{checkoutLabel(group)}</span>
      <Badge className="asr-card__badge" badge={checkoutBadge(group)} />
    </button>
  );
}

/** A shell-only tab retained as a first-class selectable row inside the card. */
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
}) {
  return entry.kind === "agent" ? (
    <CardAgentRow
      project={props.project}
      group={props.group}
      pane={entry}
      onFocusPane={props.onFocusPane}
      onClosePane={props.onClosePane}
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
 * A checkout with no agent panes to show as a card (design §6): the head row
 * alone — mark, name, badge — no box, no meta, no strip. Column alignment
 * under the project is all that places it; it shares the card head's mark
 * track and gap.
 *
 * `group.panes.length === 0` folds two different facts together, and this
 * component is what tells them apart (review, 2026-08-26): a checkout with
 * NOTHING open at all (`group.rows.length === 0`) is an honest absence, and
 * pressing it starts something new (`onNewTabIn`); a checkout whose only
 * open tab is a plain shell (`group.rows.length > 0`, still no agent panes)
 * is a checkout IN USE, and pressing it must reach that tab (`onSelectTab`)
 * rather than spawn a second, redundant agent — with the tab tier gone, a
 * shell tab has no other way to be reached from the rail at all. Before this
 * fix the two cases rendered byte-identical, which routed a press on a live
 * shell into `onNewTabIn`. `data-shell` carries the distinction for CSS and
 * tests; the accessible name states it in words too, since DL-27.2 never
 * lets a mark or a data attribute be the only reader of a state.
 *
 * DL-19.7: a control the host cannot wire is omitted, never shown inert.
 * Here the whole row IS the control (spec §6 — "stays reachable with
 * nothing running" is behaviour, not a label), so without the matching
 * callback it degrades to a static, non-interactive row rather than
 * disappearing — the project header above still needs this line for column
 * alignment even when nothing can be pressed.
 */
function BareCheckout({
  project,
  group,
  onNewTabIn,
  newTabDisabled,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly onNewTabIn?: (workspacePath: string) => void;
  readonly newTabDisabled?: boolean;
}) {
  const where = whereOf(project, group);
  const content = (
    <Fragment>
      <span class="asr-bare__mark" aria-hidden="true" />
      <span class="asr-bare__name">{checkoutLabel(group)}</span>
      <Badge className="asr-bare__badge" badge={checkoutBadge(group)} />
    </Fragment>
  );

  if (onNewTabIn === undefined) {
    return (
      <div class="asr-bare" data-shell="false">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      class="asr-bare"
      data-shell="false"
      disabled={newTabDisabled}
      aria-label={`New agent in ${where}`}
      title={`New agent in ${where}`}
      onClick={() => {
        onNewTabIn(group.path);
      }}
    >
      {content}
    </button>
  );
}

/**
 * A project git does not know (Tauri, or a plain folder): `group.labelled`
 * is false for the ONE synthetic worktree such a project has — the model's
 * own field, unchanged since the worktree-tier spec, meaning "the cluster
 * header above already names this folder, so no card head repeats it". Its
 * entries still need somewhere to render, since the tab tier that used to
 * carry them is gone (spec §3): they print as plain agent/shell rows with no
 * card box, head or toggle around them.
 */
function FlatEntries({
  project,
  group,
  onFocusPane,
  onClosePane,
  onSelectTab,
  onCloseTab,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  readonly onSelectTab: (tabIndex: number) => void;
  readonly onCloseTab: (tabIndex: number) => void;
}) {
  return (
    <Fragment>
      {group.entries.map((entry) => (
        <CardEntryRow
          key={entry.kind === "agent" ? entry.paneId : entry.key}
          project={project}
          group={group}
          entry={entry}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
        />
      ))}
    </Fragment>
  );
}

export interface WorktreeCardProps {
  /** The project name above this checkout — `RailStreamGroup.project`. */
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly open: boolean;
  readonly onToggle: (key: string) => void;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  /**
   * DL-27.21, kept: every agent row closes its own pane. The shipped rail
   * had this on both its leaf and its single-agent row; dropping it with the
   * tab tier would delete a mandated affordance rather than carry it over.
   */
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  readonly onCloseTab: (tabIndex: number) => void;
  readonly onNewTabIn?: (workspacePath: string) => void;
  readonly newTabDisabled?: boolean;
  /**
   * Reach a shell-only entry's tab. Agent entries use `onFocusPane`; a true
   * empty checkout still goes through `onNewTabIn` instead.
   */
  readonly onSelectTab: (tabIndex: number) => void;
  /**
   * The checkout's actions menu (spec §8), raised by the strip's `+` or by a
   * right-click on the card. Omitted where nothing can wire it, which takes
   * the `+` with it (DL-19.7) rather than leaving a launcher that opens
   * nothing.
   */
  readonly actions?: CardActions;
}

export function WorktreeCard(props: WorktreeCardProps) {
  const { group, project } = props;
  // The actions menu belongs to the CARD, not to the strip: a right-click
  // anywhere on the card raises the same surface the `+` does (spec §7.3), and
  // `worktree-agent-stack.tsx` already carried that gesture in the older rail.
  const [actionsAt, setActionsAt] = useState<DOMRect | null>(null);
  const actionsTrigger = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  const closeActions = (): void => {
    setActionsAt(null);
    actionsTrigger.current = null;
  };

  if (!group.labelled) {
    return (
      <FlatEntries
        project={project}
        group={group}
        onFocusPane={props.onFocusPane}
        onClosePane={props.onClosePane}
        onSelectTab={props.onSelectTab}
        onCloseTab={props.onCloseTab}
      />
    );
  }

  if (group.entries.length === 0) {
    return (
      <BareCheckout
        project={project}
        group={group}
        onNewTabIn={props.onNewTabIn}
        newTabDisabled={props.newTabDisabled}
      />
    );
  }

  const actions = props.actions;
  return (
    <article
      ref={cardRef}
      class="asr-card"
      data-open={props.open}
      data-active={group.active}
      data-live={group.live}
      onContextMenu={(event) => {
        if (actions === undefined) {
          return;
        }
        // The menu hangs off the CARD, not the cursor (spec §8.2): it is a
        // surface about this checkout, and anchoring it to a pointer position
        // would place it differently for the `+` and for a right-click.
        event.preventDefault();
        const card = cardRef.current;
        if (card === null) {
          return;
        }
        actionsTrigger.current = null;
        setActionsAt(card.getBoundingClientRect());
      }}
    >
      <CardHead
        project={project}
        group={group}
        open={props.open}
        onToggle={() => {
          props.onToggle(group.key);
        }}
      />
      {/* The meta line: the age alone (design §4), indented under the name
          by Task 7's CSS. Rendered in both card states — only a `compact`
          sibling (an open question this task does not build, spec §13.2)
          would drop it. */}
      {group.age !== "" && <p class="asr-card__meta">{group.age}</p>}
      {props.open ? (
        <Fragment>
          {/* The count alone, no `Agents` label (design §5, §8.4: the
              owner-dropped label would also reopen DL-4.3's closed
              uppercase exception). */}
          <div class="asr-card__count">{group.entries.length} active</div>
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
            />
          ))}
          {props.onNewTabIn !== undefined && (
            <button
              type="button"
              class="asr-card__new"
              disabled={props.newTabDisabled}
              aria-label={`New agent in ${whereOf(project, group)}`}
              onClick={() => {
                props.onNewTabIn?.(group.path);
              }}
            >
              <span class="asr-card__glyph asr-card__glyph--new" aria-hidden="true">
                <DeckIcon icon={Plus} size={CHROME_ICON} />
              </span>
              <span class="asr-card__name">New agent</span>
            </button>
          )}
        </Fragment>
      ) : (
        <CardStrip
          project={project}
          group={group}
          onFocusPane={props.onFocusPane}
          onClosePane={props.onClosePane}
          actionsOpen={actionsAt !== null}
          onOpenActions={
            actions === undefined
              ? undefined
              : (trigger) => {
                  if (actionsAt !== null) {
                    closeActions();
                    return;
                  }
                  actionsTrigger.current = trigger;
                  // Off the CARD's rect, not the `+`'s: both entry points must
                  // put the menu in the same place (spec §8.2).
                  const card = cardRef.current;
                  setActionsAt(
                    card === null ? trigger.getBoundingClientRect() : card.getBoundingClientRect(),
                  );
                }
          }
        />
      )}
      {actions !== undefined && actionsAt !== null && (
        <CardActionsMenu
          project={project}
          group={group}
          actions={actions}
          rect={actionsAt}
          trigger={actionsTrigger.current}
          onClose={closeActions}
        />
      )}
    </article>
  );
}
