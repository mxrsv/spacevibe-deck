import { Fragment } from "preact";
import { GitBranch, Plus, X } from "@phosphor-icons/react";
import { AgentGlyph } from "./controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import {
  stripSegments,
  type RailCardPane,
  type RailState,
  type RailWorktreeGroup,
} from "./agent-rail-model";

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
 * segment, deliberately NOT `__row` (a segment carries no press and no
 * close, where a row is a full button with both — sharing one class made
 * "how many rows are open" indistinguishable from "how wide is the strip"
 * by selector alone, caught as a real bug in review) — and `__new`, the
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
 * DL-27.2: the mark is the fast read and never the only read — every state
 * says its name in `title` and the row's accessible name. Duplicated from
 * `agent-rail.tsx`'s copy on purpose: that copy's only consumer was
 * `TabItem`, which this component replaces, so exporting it from there to
 * import it back here would be a one-consumer cycle over a five-line object.
 */
const STATE_LABEL: Readonly<Record<RailState, string>> = {
  failed: "failed",
  asked: "needs you",
  working: "working",
  done: "done",
  idle: "idle",
};

/** The one state that means "the machine is busy" (spec §11.3: `thinking` was dropped). */
const BUSY_STATE: RailState = "working";

/**
 * `project · checkout · branch` — the accessible-name prefix every control
 * on a card carries, matching what the shipped rail's `whereOf` produced
 * before the tab tier's removal took the project name out of this
 * component's reach. `WorktreeCard` only ever received the checkout
 * (`RailWorktreeGroup`) until this fix; `project` is threaded down from
 * `agent-rail.tsx`'s own `RailStreamGroup.project`, one call site, so every
 * control composes the same three-part string rather than each inventing
 * its own subset of it.
 */
function whereOf(project: string, group: RailWorktreeGroup): string {
  return `${project} · ${group.name} · ${group.branch}`;
}

/**
 * The per-pane state indicator, badged on the glyph's corner (design §5).
 * Diverges from the rail's shared `RailStatusMark` on purpose: `idle` paints
 * NOTHING here rather than a gray dot (design §9.4 point 2), and `working`
 * never draws the spinner — busy motion is `CardLoad`'s trailing track, not
 * this dot. Task 7 positions and colours it; this only decides which states
 * draw one at all.
 */
function CardMark({ state }: { readonly state: RailState }) {
  if (state === "idle") {
    return null;
  }
  return <span class="asr-card__dot" data-state={state} aria-hidden="true" />;
}

/**
 * The trailing loading track (design §5, §8.2): three bars while the pane is
 * working, nothing otherwise — but the ELEMENT always renders, so an idle
 * row's model pill lands on the same right edge a busy row's does. The
 * design's own measurement (§10) is that an `auto`-width track pulled a
 * still row's pill 12px off that edge; an element that is always present is
 * what lets Task 7's fixed-width CSS reserve against it.
 */
function CardLoad({ state }: { readonly state: RailState }) {
  const busy = state === BUSY_STATE;
  return (
    <span class="asr-card__load" data-busy={busy} aria-hidden="true">
      {busy && (
        <>
          <i />
          <i />
          <i />
        </>
      )}
    </span>
  );
}

/**
 * The branch, as a trailing badge beside the checkout name (design §4).
 * Takes its class from the caller rather than hardcoding `.asr-card__badge`:
 * a card and a bare row are two different prefixes (`.asr-card`/`.asr-bare`)
 * and each needs its OWN `__badge` leaf, not one root's leaf borrowed by the
 * other.
 */
function Badge({ className, branch }: { readonly className: string; readonly branch: string }) {
  return (
    <span class={className} title={branch}>
      <DeckIcon icon={GitBranch} size={CHROME_ICON} />
      <span>{branch}</span>
    </span>
  );
}

/**
 * The card head: `mark · checkout name · branch badge`, and nothing else.
 * No caret, no age (design §4 — the head has 213px for a name and a branch
 * at 275px, and a caret's 19px was almost exactly the deficit). The whole
 * head is the toggle.
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
      <span class="asr-card__name">{group.name}</span>
      <Badge className="asr-card__badge" branch={group.branch} />
    </button>
  );
}

/**
 * One agent, as a list row (design §5): `glyph · name · model pill ·
 * loading mark`. The whole row is the button — DL-27.21 still requires its
 * own close, so the row is a container with a full-bleed hit layer
 * (DL-27.1's shape) rather than a literal `<button>`, which could not also
 * hold a real closable ✕.
 */
function CardAgentRow({
  project,
  group,
  pane,
  onFocusPane,
  onClosePane,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly pane: RailCardPane;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
}) {
  const label = STATE_LABEL[pane.state];
  const where = whereOf(project, group);

  return (
    <div
      class="asr-card__row"
      data-state={pane.state}
      data-focused={pane.focused}
      data-pane-id={pane.paneId}
    >
      <button
        type="button"
        class="asr-card__hit"
        aria-current={pane.focused ? "true" : undefined}
        aria-label={`Focus ${pane.label} in ${where}, ${label}`}
        title={`${pane.label} — ${label}`}
        onClick={() => {
          onFocusPane(pane.tabIndex, pane.paneId);
        }}
      />
      <span class="asr-card__glyph">
        <AgentGlyph agent={pane.agent} className="asr-card__logo" />
        <CardMark state={pane.state} />
      </span>
      <span class="asr-card__name">{pane.label}</span>
      {/* The loading mark sits BEFORE the model pill (owner, 2026-08-26): it
          reads as "this model is working" rather than as a mark stranded past
          the pill at the row's trailing edge, which is also where the close ✕
          swaps in. DOM order follows visual order so the two agree — the
          stylesheet pins the track to column 3 and the pill to column 4. The
          cost, named: the bars now start at each pill's own left edge, so a
          list of differently-sized pills gives them a ragged x. The pills
          themselves still share one right edge, since column 4 is the row's
          trailing column. */}
      <CardLoad state={pane.state} />
      {pane.model !== "" && <span class="asr-card__pill">{pane.model}</span>}
      {/* DL-27.21, kept: every agent row closes its own pane — the same
          `asr-row__actions` / `asr-row__action--close` vocabulary the old
          tab row and its leaves both used (`agent-rail.tsx`, formerly
          around L378/L446), not a card-local reinvention of it. */}
      <div class="asr-row__actions">
        <button
          type="button"
          class="asr-row__action asr-row__action--close"
          aria-label={`Close ${pane.label} in ${where}`}
          onClick={() => {
            onClosePane(pane.tabIndex, pane.paneId);
          }}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    </div>
  );
}

/**
 * A closed card's agents, as one segmented strip (design §4): the three
 * loudest panes (`stripSegments`, DL-27.3's own precedence), glyph plus a
 * live mark per segment, no name and no close — the strip is a preview, not
 * a set of controls. The name survives in each segment's `title` beside the
 * state word (DL-27.2).
 *
 * A segment is `.asr-card__seg`, deliberately NOT `.asr-card__row`: a strip
 * segment carries no press, no close and no accessible name of its own,
 * where a row (the open list) is a full button with both — sharing one class
 * would make "how many agent ROWS are open" indistinguishable from "how wide
 * is the closed strip" by selector alone.
 */
function CardStrip({ panes }: { readonly panes: readonly RailCardPane[] }) {
  const { shown, overflow } = stripSegments(panes);
  return (
    <div class="asr-card__strip">
      {shown.map((pane) => (
        <span
          key={pane.paneId}
          class="asr-card__seg"
          title={`${pane.label} — ${STATE_LABEL[pane.state]}`}
        >
          <span class="asr-card__glyph">
            <AgentGlyph agent={pane.agent} className="asr-card__logo" />
            <CardMark state={pane.state} />
          </span>
          <CardLoad state={pane.state} />
        </span>
      ))}
      {overflow > 0 && (
        <span
          class="asr-card__seg"
          data-overflow="true"
          title={`${overflow} more in this checkout`}
        >
          +{overflow}
        </span>
      )}
    </div>
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
  onSelectTab,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly onNewTabIn?: (workspacePath: string) => void;
  readonly onSelectTab?: (tabIndex: number) => void;
}) {
  const where = whereOf(project, group);
  const content = (
    <Fragment>
      <span class="asr-bare__mark" aria-hidden="true" />
      <span class="asr-bare__name">{group.name}</span>
      <Badge className="asr-bare__badge" branch={group.branch} />
    </Fragment>
  );

  // A shell tab is already open in this checkout (spec §9: shell panes are
  // not agent rows, so it never produced a card) — reach it rather than
  // claim the checkout is empty. Only the first matters in practice: two
  // shell tabs sharing one worktree with no agent between them is an edge
  // the design never asked this row to distinguish.
  const openTab = group.rows[0];
  if (openTab !== undefined) {
    if (onSelectTab === undefined) {
      return (
        <div class="asr-bare" data-shell="true">
          {content}
        </div>
      );
    }
    return (
      <button
        type="button"
        class="asr-bare"
        data-shell="true"
        aria-label={`Open shell tab in ${where}`}
        title={`Open shell tab in ${where}`}
        onClick={() => {
          onSelectTab(openTab.index);
        }}
      >
        {content}
      </button>
    );
  }

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
 * panes still need somewhere to render, since the tab tier that used to
 * carry them is gone (spec §3): they print as plain agent rows with no card
 * box, head or toggle around them.
 */
function FlatPanes({
  project,
  group,
  onFocusPane,
  onClosePane,
}: {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
}) {
  return (
    <Fragment>
      {group.panes.map((pane) => (
        <CardAgentRow
          key={pane.paneId}
          project={project}
          group={group}
          pane={pane}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
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
  readonly onNewTabIn?: (workspacePath: string) => void;
  /**
   * Reach a checkout's own open tab when it has no agent panes to show as a
   * card — a plain shell tab (item 1 fix, review 2026-08-26). `BareCheckout`
   * is the only reader; a checkout with nothing open at all still goes
   * through `onNewTabIn` instead. Omitted where nothing wires it, in which
   * case that row degrades like `onNewTabIn`'s own (DL-19.7).
   */
  readonly onSelectTab?: (tabIndex: number) => void;
}

export function WorktreeCard(props: WorktreeCardProps) {
  const { group, project } = props;

  if (!group.labelled) {
    return (
      <FlatPanes
        project={project}
        group={group}
        onFocusPane={props.onFocusPane}
        onClosePane={props.onClosePane}
      />
    );
  }

  if (group.panes.length === 0) {
    return (
      <BareCheckout
        project={project}
        group={group}
        onNewTabIn={props.onNewTabIn}
        onSelectTab={props.onSelectTab}
      />
    );
  }

  return (
    <article
      class="asr-card"
      data-open={props.open}
      data-active={group.active}
      data-live={group.live}
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
          <div class="asr-card__count">{group.panes.length} active</div>
          {group.panes.map((pane) => (
            <CardAgentRow
              key={pane.paneId}
              project={project}
              group={group}
              pane={pane}
              onFocusPane={props.onFocusPane}
              onClosePane={props.onClosePane}
            />
          ))}
          {props.onNewTabIn !== undefined && (
            <button
              type="button"
              class="asr-card__new"
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
        <CardStrip panes={group.panes} />
      )}
    </article>
  );
}
