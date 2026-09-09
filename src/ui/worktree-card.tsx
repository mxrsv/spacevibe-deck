import { Fragment } from "preact";
import { useRef, useState } from "preact/hooks";
import { CaretRight, GitBranch, Plus, TerminalWindow, X } from "@phosphor-icons/react";
import { DeckIcon, CHROME_ICON } from "./controls/deck-icon";
import { CardAgentRow, CardLoad, whereOf } from "./worktree-card-row";
import { CardStrip } from "./worktree-card-strip";
import { settings } from "../settings/settings-store";
import { worktreeColorStyle } from "../settings/worktree-colors";
import { CardActionsMenu, type CardActions } from "./worktree-card-menus";
import {
  checkoutBadge,
  checkoutLabel,
  subjectOf,
  type CheckoutBadge,
} from "./agent-rail-card-model";
import type { RailCardEntry, RailCardShell, RailWorktreeGroup } from "./agent-rail-model";

/**
 * The rail's worktree card (DL-27.23/DL-27.24, amended; design
 * `docs/internals/agent-rail.md`).
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
 * carries a PRESS (a single-pane segment focuses its pane; since 2026-09-02 a
 * merged one pins its menu open to choose from) and raises a menu, so the
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
 * The card head: mark, checkout label, badge and an always-visible disclosure
 * caret (DL-27.25). The whole button focuses and toggles the card; its context
 * menu offers colors. The caret keeps a fixed slot in both disclosure states.
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
      title={`${open ? "Collapse" : "Expand"} agents — ${where}`}
      onClick={onToggle}
    >
      <span class="asr-card__mark" data-live={group.live} aria-hidden="true" />
      <span class="asr-card__name">{checkoutLabel(group)}</span>
      <Badge className="asr-card__badge" badge={checkoutBadge(group)} />
      <DeckIcon icon={CaretRight} size={CHROME_ICON} class="asr-card__chevron" />
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
  actions,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly actions?: CardActions;
}) {
  const where = whereOf(project, group);
  const menu = useActionsMenu();
  const content = (
    <Fragment>
      <span class="asr-bare__mark" aria-hidden="true" />
      <span class="asr-bare__name">{checkoutLabel(group)}</span>
      <Badge className="asr-bare__badge" badge={checkoutBadge(group)} />
    </Fragment>
  );

  if (actions === undefined) {
    return (
      <div
        class="asr-bare-heading"
        style={worktreeColorStyle(settings.value.worktreeColors, group.path)}
      >
        <div class="asr-bare" data-shell="false">
          {content}
        </div>
      </div>
    );
  }
  // The row IS the checkout's one create control (`rail-create-consolidation`,
  // spec: "a checkout with nothing open is itself the control"), and since that
  // change a press OPENS the agent list rather than spawning a shell — the
  // press itself starts nothing. `aria-haspopup`/`aria-expanded` are DL-13.7's
  // (amended) words for a press-to-open trigger; no `title`, since one never
  // appears on focus (DL-23.10) and the accessible name already says it all.
  return (
    <div
      class="asr-bare-heading"
      style={worktreeColorStyle(settings.value.worktreeColors, group.path)}
      onContextMenu={(event) => {
        event.preventDefault();
        menu.openAt(event.currentTarget.getBoundingClientRect());
      }}
    >
      <button
        type="button"
        class="asr-bare"
        data-shell="false"
        aria-haspopup="menu"
        aria-expanded={menu.rect !== null}
        aria-label={`New agent in ${where}`}
        onClick={(event) => {
          menu.toggleAt(event.currentTarget.getBoundingClientRect(), event.currentTarget);
        }}
      >
        {content}
      </button>
      <CheckoutMenu project={project} group={group} actions={actions} menu={menu} />
    </div>
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
  actions,
  onFocusPane,
  onClosePane,
  onSelectTab,
  onCloseTab,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly actions?: CardActions;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  readonly onSelectTab: (tabIndex: number) => void;
  readonly onCloseTab: (tabIndex: number) => void;
}) {
  const menu = useActionsMenu();
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
      {/* The folder's one create control (`rail-create-consolidation`, design
          D5): with the project header's `+` gone, a folder git does not know
          would otherwise have NO create path. The same row the open card
          ends with, anchored to itself since there is no card box; the menu
          it raises drops every git-backed row (`labelled: false`). A remembered
          folder with no entries renders this row alone. */}
      {actions !== undefined && (
        <Fragment>
          <NewAgentRow
            where={whereOf(project, group)}
            open={menu.rect !== null}
            onPress={(row) => {
              menu.toggleAt(row.getBoundingClientRect(), row);
            }}
          />
          <CheckoutMenu project={project} group={group} actions={actions} menu={menu} />
        </Fragment>
      )}
    </Fragment>
  );
}

/**
 * The actions menu's open state and anchor, shared by every shape a checkout
 * renders as (`rail-create-consolidation`, design D3): the boxed card (its
 * strip `+`, its `New agent` row, a right-click), the bare row of a checkout
 * with nothing open, and the flat entries of a folder git does not know. One
 * hook rather than three copies of the same two fields, so the toggle contract
 * — a second press on the control that opened it CLOSES it, because that
 * control is exempt from `useDismiss`'s outside-press close — is stated once.
 *
 * The menu itself is `position: fixed` off `rect`, so the host's own box does
 * not matter and `CheckoutMenu` renders as a sibling of whatever pressed it.
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

/**
 * The `New agent` row — the open card's create control and the flat entries'
 * (design D5). Since `rail-create-consolidation` it OPENS the checkout's agent
 * list rather than spawning a shell: the label said "agent" and the press
 * started none. `aria-haspopup`/`aria-expanded` are DL-13.7's (amended) words
 * for a press-to-open trigger. `.asr-card__new` is its own leaf, not
 * `.asr-card__row` (review fix, 2026-08-26): it shares no press target or
 * accessible name with an agent row.
 */
function NewAgentRow({
  where,
  open,
  onPress,
}: {
  readonly where: string;
  readonly open: boolean;
  readonly onPress: (row: HTMLButtonElement) => void;
}) {
  return (
    <button
      type="button"
      class="asr-card__new"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`New agent in ${where}`}
      onClick={(event) => {
        onPress(event.currentTarget);
      }}
    >
      <span class="asr-card__glyph asr-card__glyph--new" aria-hidden="true">
        <DeckIcon icon={Plus} size={CHROME_ICON} />
      </span>
      <span class="asr-card__name">New agent</span>
    </button>
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
  /**
   * Reach a shell-only entry's tab. Agent entries use `onFocusPane`; a true
   * empty checkout's row opens the actions menu instead.
   */
  readonly onSelectTab: (tabIndex: number) => void;
  /**
   * The checkout's actions menu (spec §8) — since `rail-create-consolidation`
   * the ONE surface every create control on a checkout raises: the closed
   * card's strip `+`, the open card's `New agent` row, the bare row of a
   * checkout with nothing open, the flat entries' row, and a right-click on
   * the card. `onNewTabIn` is gone with that change: no press on this card
   * starts a process by itself any more. Omitted where nothing can wire it,
   * which takes every create control with it (DL-19.7) rather than leaving a
   * launcher that opens nothing.
   */
  readonly actions?: CardActions;
}

export function WorktreeCard(props: WorktreeCardProps) {
  const { group, project } = props;
  // The actions menu belongs to the CARD, not to the strip: a right-click
  // anywhere on the card raises the same surface the `+` does (spec §7.3), and
  // `worktree-agent-stack.tsx` already carried that gesture in the older rail.
  // Since `rail-create-consolidation` the open card's `New agent` row raises it
  // too, so the state is the shared hook's rather than this component's own.
  const menu = useActionsMenu();
  const cardRef = useRef<HTMLElement>(null);

  if (!group.labelled) {
    return (
      <FlatEntries
        project={project}
        group={group}
        actions={props.actions}
        onFocusPane={props.onFocusPane}
        onClosePane={props.onClosePane}
        onSelectTab={props.onSelectTab}
        onCloseTab={props.onCloseTab}
      />
    );
  }

  if (group.entries.length === 0) {
    return <BareCheckout project={project} group={group} actions={props.actions} />;
  }

  const actions = props.actions;
  const focusCard = (): void => {
    const entry =
      group.entries.find((candidate) =>
        candidate.kind === "agent" ? candidate.focused : candidate.active,
      ) ?? group.entries[0];
    if (entry.kind === "agent") {
      props.onFocusPane(entry.tabIndex, entry.paneId);
    } else {
      props.onSelectTab(entry.tabIndex);
    }
  };
  return (
    <article
      ref={cardRef}
      class="asr-card"
      style={worktreeColorStyle(settings.value.worktreeColors, group.path)}
      data-open={props.open}
      data-active={group.active}
      data-live={group.live}
      onClick={(event) => {
        // Only card whitespace and metadata: child controls and popovers
        // retain their own targets, including close and new-agent actions.
        const target = event.target;
        if (
          target === event.currentTarget ||
          (target instanceof Element && target.matches(".asr-card__meta, .asr-card__count"))
        ) {
          focusCard();
        }
      }}
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
        menu.openAt(card.getBoundingClientRect());
      }}
    >
      <CardHead
        project={project}
        group={group}
        open={props.open}
        onToggle={() => {
          focusCard();
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
          {/* The open card's create control: the closed strip's `+`, in row
              form. Off the CARD's rect, like the `+` and the right-click, so
              every entry point puts the menu in the same place (spec §8.2). */}
          {actions !== undefined && (
            <NewAgentRow
              where={whereOf(project, group)}
              open={menu.rect !== null}
              onPress={(row) => {
                const card = cardRef.current;
                menu.toggleAt(
                  card === null ? row.getBoundingClientRect() : card.getBoundingClientRect(),
                  row,
                );
              }}
            />
          )}
        </Fragment>
      ) : (
        <CardStrip
          project={project}
          group={group}
          onFocusPane={props.onFocusPane}
          onClosePane={props.onClosePane}
          actionsOpen={menu.rect !== null}
          onOpenActions={
            actions === undefined
              ? undefined
              : (trigger) => {
                  // Off the CARD's rect, not the `+`'s: both entry points must
                  // put the menu in the same place (spec §8.2).
                  const card = cardRef.current;
                  menu.toggleAt(
                    card === null ? trigger.getBoundingClientRect() : card.getBoundingClientRect(),
                    trigger,
                  );
                }
          }
        />
      )}
      {actions !== undefined && (
        <CheckoutMenu project={project} group={group} actions={actions} menu={menu} />
      )}
    </article>
  );
}
