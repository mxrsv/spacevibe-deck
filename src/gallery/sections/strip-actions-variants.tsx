import { Fragment } from "preact";
import { useSignal } from "@preact/signals";
import {
  ArrowElbowDownRight,
  ColumnsPlusRight,
  FolderOpen,
  GitBranch,
  Info,
  Plus,
  TerminalWindow,
  X,
} from "@phosphor-icons/react";
import { AgentGlyph } from "../../ui/controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { STRIP_VISIBLE } from "../../ui/agent-rail-card-model";
import { stripSegments, type RailCardPane, type RailState } from "../../ui/agent-rail-model";
import {
  ACTION_AGENTS,
  ACTION_OS,
  ACTION_WORK,
  CROWDED,
  PANES,
  SPREAD,
  type ActionRow,
  STATE_LABEL,
  displayAgent,
  fitSegments,
  groupSegments,
  type StripGroup,
} from "./strip-actions-model";
import { SectionHead, Specimen } from "../specimen";
import "./strip-actions-variants.css";

/**
 * Closed-strip direction review (2026-08-27, owner-asked in two passes: first
 * "mỗi item phải click được, và có thể cần hover để hiện popover có actions",
 * then "chia theo agents — Claude có 2 agent trở lên thì gộp lại để hiển
 * thị").
 *
 * PROPOSAL-STAGE DRAWING, not shipping chrome. `worktree-card.tsx` renders a
 * closed card's strip as one `<span role="img">` PER PANE, carrying no press
 * and no close — its own comment says "the strip is a preview, not a set of
 * controls". Both questions below reverse part of that, and neither can be
 * drawn by overriding the production sheet the way `unread-mark-variants.tsx`
 * could: the candidates differ in DOM and in model, not in colour. So this
 * file mirrors the closed card on the PRODUCTION classes (`.asr-card`,
 * `__head`, `__meta`, `__strip`, `__seg`, `__glyph`, `__logo`, `__dot`,
 * `__row`, `__new`, `asr-row__actions`) and adds only what the candidates
 * invent, under its own `gxsa-` prefix.
 *
 * Park it the moment a candidate ships — the `unread-mark-variants`
 * precedent: a `current` column beside the thing that replaced it stops being
 * current and the comparison starts lying.
 *
 * TWO questions, drawn as two rows, because they are independent:
 *
 * 1. WHAT IS A SEGMENT — one pane (today) or one AGENT KIND? Grouping is the
 *    owner's ask. It costs one honest thing, drawn rather than argued: a
 *    merged segment can only wear ONE state mark, so a checkout running a
 *    failed Claude beside a working one shows `failed` and says nothing about
 *    the other until the popover opens. It buys the width back — five agents
 *    fit where three did — and it makes `+N` rarer.
 *
 * 2. WHAT A SEGMENT RAISES — the checkout's whole list, the panes behind that
 *    one segment, or nothing at all. Drawn on GROUPED strips, since question
 *    1 is the owner's decision rather than a candidate.
 *
 * Click is NOT one of the questions: pressing a segment focuses its pane
 * through the existing `onFocusPane(tabIndex, paneId)` seam in every
 * candidate, and a merged segment presses its loudest one. The gallery draws
 * only what is being chosen, so its buttons do nothing.
 */

const PROJECT = "spacevibe-bench";
const CHECKOUT = "spacevibe-bench";
const BRANCH = "main";
const WHERE = `${PROJECT} · ${CHECKOUT} · ${BRANCH}`;

/** "one pane per segment" (today) or "one agent kind per segment" (asked for). */
type StripShape = "per-pane" | "grouped";

/**
 * What a segment raises. SETTLED 2026-08-27 (owner: "chốt options này", on the
 * segment menu): `segment` — the panes behind the segment you pointed at.
 * `none` is what ships today, kept for the control column.
 *
 * The two rejected candidates, with the reason each lost, because that is what
 * makes re-proposing one a decision rather than an accident:
 *
 *  - `checkout` — ONE popover listing every pane in the checkout, raised from
 *    any segment. It read the same whichever segment you pointed at, so the
 *    strip's segmentation bought nothing at the moment it was used.
 *  - `inline` — no floating surface: the segment grew in place to
 *    `glyph · name · ✕`. Cheapest by far (no DL amendment, no fixed
 *    positioning, no hover bridge, no scroll-close) and it lost on two things
 *    it can never do: reach the panes folded into `+N`, and offer a ✕ on a
 *    merged segment, since one control cannot close two panes without asking
 *    which and the strip has no room to ask.
 */
type RaiseShape = "none" | "segment";

/**
 * Where a CLOSED card offers "start an agent in this checkout" —
 * SETTLED 2026-08-27 (owner: "chọn B"): the strip's last segment.
 *
 * The gap it closes: a closed card that HAS agents had no create path pinned
 * to its own checkout at all. The open card's `New agent` row does not exist
 * while the card is closed, and `BareCheckout` (the whole row is the button)
 * only covers a checkout with NOTHING running — so the nearest control was the
 * project header's `+`, which resolves through `groupPath` to `worktrees[0]`,
 * i.e. always the PRIMARY checkout, silently.
 *
 * The rejected alternative was a reserved 15px `PlusSquare` in the card head,
 * after the branch badge. It lost on one measurement, kept here because it is
 * the reason and re-proposing the head is how it comes back: the fourth track
 * takes 23px out of the name column (166px → 143px). An ordinary name does not
 * notice — `spacevibe-bench` is 106px of text — but the design's own failing
 * case does. `bench.ai-terminal` (109px) beside `feature/ai-terminal` was
 * ALREADY clipped by 14px with no `+` at all (spec §10); the head slot cut its
 * column to 72px, clipping it by 37px. The strip is `width: fit-content`, so
 * the same `+` there leaves that column at 95px — byte-identical to today at
 * every name length.
 */

/**
 * Which segment is raised. A segment's identity differs by shape — a pane id
 * when segments are panes, an agent id when they are groups — so one string
 * key covers both rather than a union every consumer has to narrow.
 */
type Raised = string | null;

const OVERFLOW_KEY = "overflow";

/** The corner badge, `idle` drawing nothing — `CardMark`'s own rule. */
function Dot({ state }: { readonly state: RailState }) {
  return state === "idle" ? null : (
    <span class="asr-card__dot" data-state={state} aria-hidden="true" />
  );
}

/** The trailing pulse, always present so an idle row keeps the same tracks. */
function Load({ state }: { readonly state: RailState }) {
  const busy = state === "working";
  return (
    <span class="asr-card__load" data-busy={busy} aria-hidden="true">
      {busy && <i />}
    </span>
  );
}

/**
 * One popover row (DL-13.3: a popover is made of rows, not a new widget
 * genre). Press = `onFocusPane(tabIndex, paneId)`; the trailing ✕ =
 * `onClosePane` — both seams already exist, which is the whole point of
 * proposing this shape rather than a new one. The model pill is CONDITIONAL,
 * mirroring `CardAgentRow`: production withholds `pane.model` wherever the
 * pane/session pairing is heuristic.
 */
function PopRow({ item, origin }: { readonly item: RailCardPane; readonly origin: boolean }) {
  return (
    <div
      class="asr-card__row gxsa-pop__row"
      data-kind="agent"
      data-state={item.state}
      data-origin={origin}
    >
      <button
        type="button"
        class="asr-card__hit"
        aria-label={`Focus ${item.label} in ${WHERE}, ${STATE_LABEL[item.state]}`}
        title={`${item.label} — ${STATE_LABEL[item.state]}`}
      />
      <span class="asr-card__glyph">
        <AgentGlyph agent={item.agent} className="asr-card__logo" />
        <Dot state={item.state} />
      </span>
      <span class="asr-card__name">{item.label}</span>
      <Load state={item.state} />
      {item.model !== "" && <span class="asr-card__pill">{item.model}</span>}
      <div class="asr-row__actions">
        <button
          type="button"
          class="asr-row__action asr-row__action--close"
          aria-label={`Close ${item.label} in ${WHERE}`}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
    </div>
  );
}

const ACTION_GLYPHS = {
  split: ColumnsPlusRight,
  branch: GitBranch,
  finder: FolderOpen,
  terminal: TerminalWindow,
} as const;

/**
 * One actions-menu row: glyph, what it does, and what will happen. The second
 * line is why this is a NEW genre rather than `ToolbarOverflowMenu`'s row —
 * that one carries icon, label and chord on a single line (DL-23), and DL-13.3
 * says a popover is made of §5 rows, which are single-line too. A two-line
 * menu row has to be written down before it ships.
 */
function ActionMenuRow({ row }: { readonly row: ActionRow }) {
  const glyph = row.glyph === undefined ? undefined : ACTION_GLYPHS[row.glyph];
  return (
    <button type="button" class="gxsa-act" role="menuitem">
      <span class="gxsa-act__glyph" aria-hidden="true">
        {row.agent !== undefined ? (
          <AgentGlyph agent={row.agent} className="gxsa-act__logo" />
        ) : (
          glyph !== undefined && <DeckIcon icon={glyph} size={CHROME_ICON} />
        )}
      </span>
      <span class="gxsa-act__title">{row.title}</span>
      <span class="gxsa-act__detail">{row.detail}</span>
    </button>
  );
}

/**
 * The actions menu (owner's reference, 2026-08-27), raised by pressing the
 * strip's `+` or by right-clicking the card.
 *
 * Two departures from the reference, both named rather than slipped in:
 *
 * 1. The reference states the checkout name TWICE — `Actions for X` over
 *    `Runs in: X · Worktree`. The menu is anchored to that card, so the second
 *    line spends its width on the fact the card does NOT already show: the
 *    branch. The badge keeps saying whether this is a worktree or the primary
 *    checkout, which is `group.primary` and nothing new.
 * 2. An agent row's detail line is its default MODEL where settings carry one
 *    and the command it will run where they do not. The reference mixes a
 *    model (`Claude Sonnet 3.7`), a vendor (`OpenAI Codex`) and a restatement
 *    of the scope (`Cursor in this worktree`) — only the first is a fact the
 *    row can promise, and the third is what the footer already says.
 *
 * `bothHosts` is what the Tauri column reads: `worktree_add` and `open_in_app`
 * are Electron-only, so those rows are OMITTED there rather than shown inert
 * (DL-19.7), which is the same rule `BareCheckout` already follows.
 */
function ActionsMenu({ host }: { readonly host: "electron" | "tauri" }) {
  const keep = (rows: readonly ActionRow[]): readonly ActionRow[] =>
    host === "electron" ? rows : rows.filter((row) => row.bothHosts);
  const groups = [ACTION_AGENTS, ACTION_WORK, ACTION_OS].map(keep).filter((g) => g.length > 0);
  return (
    <div class="gxsa-pop gxsa-pop--actions" role="menu" aria-label={`Actions for ${CHECKOUT}`}>
      <div class="gxsa-act__head">
        <p class="gxsa-act__for">
          Actions for <strong>{CHECKOUT}</strong>
        </p>
        <p class="gxsa-act__scope">
          Runs in <span class="gxsa-act__branch">{BRANCH}</span>
          <span class="gxsa-act__badge">Worktree</span>
        </p>
      </div>
      {groups.map((rows, index) => (
        <Fragment key={rows[0]?.id ?? index}>
          <div class="gxsa-pop__sep" />
          {rows.map((row) => (
            <ActionMenuRow key={row.id} row={row} />
          ))}
        </Fragment>
      ))}
      <div class="gxsa-pop__sep" />
      <p class="gxsa-act__foot">
        <DeckIcon icon={Info} size={CHROME_ICON} />
        <span>Everything here runs in this worktree</span>
      </p>
    </div>
  );
}

/** Every pane the raised segment stands for. */
function panesBehind(
  raised: Raised,
  panes: readonly RailCardPane[],
  shown: readonly StripGroup[],
  shape: StripShape,
): readonly RailCardPane[] {
  if (raised === null) {
    return [];
  }
  if (raised === OVERFLOW_KEY) {
    const seen =
      shape === "grouped" ? shown.flatMap((group) => group.panes) : stripSegments(panes).shown;
    return panes.filter((item) => !seen.includes(item));
  }
  return shape === "grouped"
    ? (shown.find((group) => group.agent === raised)?.panes ?? [])
    : panes.filter((item) => String(item.paneId) === raised);
}

/**
 * The closed card, mirrored on production classes (see the file header for
 * why it is mirrored rather than mounted): mark · name · branch badge, the
 * age alone, then the strip.
 */
function CandidateCard({
  shape,
  raise,
  pin = null,
  cap = STRIP_VISIBLE,
  create = true,
  actions = null,
  long = false,
  panes = PANES,
}: {
  readonly shape: StripShape;
  readonly raise: RaiseShape;
  /**
   * Which segment starts raised, by key — so a column can document one case of
   * the settled shape without a pointer. Hovering overrides it.
   */
  readonly pin?: Raised;
  /**
   * How the strip folds: a NUMBER is a fixed cap (`STRIP_VISIBLE` today),
   * `"fit"` folds by measured width so the `+` always survives.
   */
  readonly cap?: number | "fit";
  readonly panes?: readonly RailCardPane[];
  /** Draw the settled `+` segment. False only for the pre-grouping control. */
  readonly create?: boolean;
  /**
   * Draw the actions menu this card's `+` raises. `null` keeps the `+` inert,
   * which is every column that is not about the menu.
   */
  readonly actions?: "electron" | "tauri" | null;
  /**
   * The design's own failing case (§4, §10): a checkout named after its
   * project beside a long branch, which spec §10 measured as "both truncate"
   * BEFORE any `+` existed. A create slot has to be judged here, not on
   * `spacevibe-bench` — that name is 106px of text in a 166px column and
   * would not notice a fourth track.
   */
  readonly long?: boolean;
}) {
  const hovered = useSignal<Raised>(pin);
  // The actions menu is a PRESS, not a hover — `+` and a right-click on the
  // card both raise it, and both are drawn live here.
  const menuOpen = useSignal(false);
  const all = groupSegments(panes, Number.MAX_SAFE_INTEGER);
  const grouped = cap === "fit" ? fitSegments(all.shown, panes) : groupSegments(panes, cap);
  const flat = stripSegments(panes);
  const live = raise !== "none";
  const checkout = long ? "bench.ai-terminal" : CHECKOUT;
  const branch = long ? "feature/ai-terminal" : BRANCH;

  const raised: Raised = hovered.value;
  const behind = panesBehind(raised, panes, grouped.shown, shape);

  const segments =
    shape === "grouped"
      ? grouped.shown.map((group) => ({
          key: group.agent,
          agent: group.agent,
          state: group.state,
          count: group.panes.length,
          name: group.panes[0]?.label ?? group.agent,
        }))
      : flat.shown.map((item) => ({
          key: String(item.paneId),
          agent: item.agent,
          state: item.state,
          count: 1,
          name: item.label,
        }));
  const overflow = shape === "grouped" ? grouped.overflow : flat.overflow;

  return (
    <div class="gxsa-anchor">
      <article
        class="asr-card"
        data-open="false"
        data-live="true"
        data-active="false"
        onContextMenu={(event) => {
          if (actions === null) {
            return;
          }
          event.preventDefault();
          menuOpen.value = !menuOpen.value;
        }}
      >
        <div class="asr-card__head" role="presentation">
          <span class="asr-card__mark" data-live="true" aria-hidden="true" />
          <span class="asr-card__name">{checkout}</span>
          <span class="asr-card__badge" title={branch}>
            <DeckIcon icon={GitBranch} size={CHROME_ICON} />
            <span>{branch}</span>
          </span>
        </div>
        <p class="asr-card__meta">now</p>
        <div
          class="asr-card__strip"
          onPointerLeave={() => {
            hovered.value = null;
          }}
        >
          {segments.map((segment) => {
            const merged = segment.count > 1;
            const word = merged
              ? `${segment.count} ${displayAgent(segment.agent)} agents, loudest ${STATE_LABEL[segment.state]}`
              : `${segment.name}, ${STATE_LABEL[segment.state]}`;
            const body = (
              <>
                <span class="asr-card__glyph">
                  <AgentGlyph agent={segment.agent} className="asr-card__logo" />
                  <Dot state={segment.state} />
                </span>
                {merged && <span class="gxsa-seg__count">×{segment.count}</span>}
                <Load state={segment.state} />
              </>
            );
            return live ? (
              <button
                key={segment.key}
                type="button"
                class="asr-card__seg gxsa-seg"
                data-origin={raised === segment.key}
                aria-label={`Focus ${word}`}
                title={word}
                onPointerEnter={() => {
                  hovered.value = segment.key;
                }}
                onFocus={() => {
                  hovered.value = segment.key;
                }}
              >
                {body}
              </button>
            ) : (
              <span
                key={segment.key}
                class="asr-card__seg"
                role="img"
                aria-label={word}
                title={word}
              >
                {body}
              </span>
            );
          })}
          {overflow > 0 &&
            (live ? (
              <button
                type="button"
                class="asr-card__seg gxsa-seg"
                data-overflow="true"
                data-origin={raised === OVERFLOW_KEY}
                aria-label={`${overflow} more agents in this checkout`}
                title={`${overflow} more in this checkout`}
                onPointerEnter={() => {
                  hovered.value = OVERFLOW_KEY;
                }}
                onFocus={() => {
                  hovered.value = OVERFLOW_KEY;
                }}
              >
                +{overflow}
              </button>
            ) : (
              <span
                class="asr-card__seg"
                data-overflow="true"
                role="img"
                aria-label={`${overflow} more agents in this checkout`}
              >
                +{overflow}
              </span>
            ))}
          {/* The closed-state twin of the open card's `New agent` row, in the
              one place on a closed card that costs the checkout name nothing:
              the strip is `width: fit-content`, so a trailing segment spends
              strip width, never head width.

              It renders AFTER the `+N` tail, so the bar reads agents → more
              agents → create. With it between the two, the count folded away
              from the things it counts. */}
          {create && (
            <button
              type="button"
              class="asr-card__seg gxsa-seg gxsa-seg--add"
              aria-label={`Actions for ${WHERE}`}
              title={`Actions for ${WHERE}`}
              aria-expanded={actions === null ? undefined : menuOpen.value}
              onClick={() => {
                menuOpen.value = !menuOpen.value;
              }}
            >
              <DeckIcon icon={Plus} size={CHROME_ICON} />
            </button>
          )}
        </div>
      </article>
      {actions !== null && menuOpen.value && <ActionsMenu host={actions} />}
      {raised !== null && raise === "segment" && behind.length > 0 && (
        <div class="gxsa-pop gxsa-pop--chip" role="dialog" aria-label={`${behind.length} agents`}>
          {behind.length > 1 && (
            <p class="gxsa-pop__cap">
              {behind.length}{" "}
              {raised === OVERFLOW_KEY ? "more in this checkout" : `${displayAgent(raised)} agents`}
            </p>
          )}
          {behind.map((item) => (
            <PopRow key={item.paneId} item={item} origin={false} />
          ))}
          {/* A one-pane segment would otherwise raise a one-row popover, which
              is a menu that says nothing the segment did not. The explicit
              `Focus pane` row is what it has instead — and needing it is this
              shape's own accepted cost. */}
          {behind.length === 1 && (
            <>
              <div class="gxsa-pop__sep" />
              <button type="button" class="asr-card__new" aria-label="Focus pane">
                <span class="asr-card__glyph asr-card__glyph--new" aria-hidden="true">
                  <DeckIcon icon={ArrowElbowDownRight} size={CHROME_ICON} />
                </span>
                <span class="asr-card__name">Focus pane</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Column({
  title,
  note,
  shape,
  raise,
  pin,
  cap,
  create,
  panes,
  second,
  actions,
  stress = false,
}: {
  readonly title: string;
  readonly note: string;
  readonly shape: StripShape;
  readonly raise: RaiseShape;
  readonly pin?: Raised;
  readonly create?: boolean;
  readonly cap?: number | "fit";
  readonly panes?: readonly RailCardPane[];
  /** A second card beneath the first, on a different fixture. */
  readonly second?: readonly RailCardPane[];
  readonly actions?: "electron" | "tauri" | null;
  /** Draw the long-name card beneath the ordinary one. */
  readonly stress?: boolean;
}) {
  return (
    <div class="gxsa-col">
      <p class="gxsa-col__title">{title}</p>
      <p class="gxsa-col__note">{note}</p>
      <div class="gxsa-stage">
        <CandidateCard
          shape={shape}
          raise={raise}
          pin={pin}
          cap={cap}
          create={create}
          panes={panes}
          actions={actions}
        />
      </div>
      {second !== undefined && (
        <div class="gxsa-stage">
          <CandidateCard
            shape={shape}
            raise={raise}
            pin={pin}
            cap={cap}
            create={create}
            panes={second}
          />
        </div>
      )}
      {stress && (
        <div class="gxsa-stage">
          <CandidateCard
            shape={shape}
            raise={raise}
            pin={pin}
            cap={cap}
            create={create}
            panes={panes}
            long
          />
        </div>
      )}
    </div>
  );
}

export function StripActionsVariantsSection() {
  return (
    <>
      <SectionHead
        title="closed-strip: grouping and actions"
        blurb="Two independent questions on one surface. First: is a segment a pane or an agent kind? Second: what does pressing or hovering one raise? Hover any segment to drive a candidate, or pin them to compare the surfaces side by side."
      />
      <Specimen
        name="1 · what a segment IS"
        note="six panes, two of them Claude; no popover in this row"
      >
        <div class="gxsa-row gxsa-row--triple">
          <Column
            title="per-pane — what ships"
            note="one segment per PANE, capped at three by loudest-wins, the rest folded into `+N`, and no create action anywhere — this column is today, so it carries neither of the settled changes. Two Claudes take two segments that look identical, and three of the six agents are behind a number."
            shape="per-pane"
            raise="none"
            create={false}
          />
          <Column
            title="grouped by agent — asked for"
            note="one segment per AGENT KIND, `×N` when it holds several panes. Five agents now fit where three did and `+N` gets rarer. Cost: a merged segment wears ONE mark — the loudest — so a failed Claude beside a working one shows `failed` and stays silent about the other until it is opened."
            shape="grouped"
            raise="none"
          />
          <Column
            title="grouped, no cap"
            note="the same grouping with `STRIP_VISIBLE` lifted: all five agents and the `+`, no `+N` at all — and it does NOT fit. 236px against a 220px budget, because the strip is indented 22px under the name. It looks fine only because `max-width: 100%` clamps it and the rail clips the rest without saying so. Question 3 is that measurement."
            shape="grouped"
            raise="none"
            cap={99}
          />
        </div>
      </Specimen>
      <Specimen
        name="2 · the segment menu — SETTLED"
        note="Hovering a segment raises the panes BEHIND that segment (owner, 2026-08-27). One shape covers all three cases below; hover any segment to move the menu."
      >
        <div class="gxsa-row gxsa-row--triple gxsa-row--menus">
          <Column
            title="a merged segment"
            note="`Claude ×2` raises exactly its two panes. This is the case grouping created and the one the menu exists for: the strip says HOW MANY, the menu says WHICH — press a row to focus that pane, ✕ to close it, both on seams that already exist."
            shape="grouped"
            raise="segment"
            cap="fit"
            pin="claude"
          />
          <Column
            title="a single-pane segment"
            note="one row, plus an explicit `Focus pane`. The accepted cost: without that row the menu would say nothing the segment did not, since a one-row list IS the segment. Pressing the segment itself still focuses the pane directly — the menu is for the ✕ and for the model line."
            shape="grouped"
            raise="segment"
            cap="fit"
            pin="codex"
          />
          <Column
            title="the `+N` tail"
            note="raises exactly the panes it hides — the same shape, no second design. This is what killed the inline candidate: a segment that grows in place can never reach anything behind a number."
            shape="grouped"
            raise="segment"
            cap="fit"
            pin="overflow"
          />
        </div>
      </Specimen>
      <Specimen
        name="3 · the fold, now that the strip carries a `+`"
        note="SETTLED: the create action is the strip's last segment (owner, 2026-08-27). What is still open is how the strip folds around it. Two cards per column: six kinds with a merged `Claude ×2` (60px), then six kinds with no merge at all (39px each) — the fixed cap cannot tell those apart and a width-aware fold can."
      >
        <div class="gxsa-row gxsa-row--triple">
          <Column
            title="cap 3 — `STRIP_VISIBLE` today"
            note="three segments, everything else into `+N`, then the `+`. Always fits, and always hides — with grouping the fold now costs whole AGENTS, not extra panes of an agent already on screen."
            shape="grouped"
            raise="none"
            panes={CROWDED}
            second={SPREAD}
          />
          <Column
            title="no cap — every kind"
            note="six kinds and the `+` on one line, against a 220px budget. Nothing here looks broken — the strip clamps and the rail clips — which is exactly the danger: measure `card.scrollWidth - card.clientWidth` and it is 44px of content simply gone."
            shape="grouped"
            raise="none"
            panes={CROWDED}
            second={SPREAD}
            cap={99}
          />
          <Column
            title="fold by fit — the `+` never folds"
            note="folds agents until the strip, its `+N` tail and the `+` all fit the 220px the 22px indent leaves. The `+` is never the segment that goes: a launcher that vanishes when a checkout gets busy is missing exactly when it is wanted. Widths here are ESTIMATED from measured constants (39px a segment, +21px for `×N`, 30px the `+`, 31px the tail); a shipped version should measure."
            shape="grouped"
            raise="none"
            panes={CROWDED}
            second={SPREAD}
            cap="fit"
          />
        </div>
      </Specimen>
      <Specimen
        name="4 · the actions menu"
        note="raised by PRESSING the `+`, or by right-clicking the card — both are live here, so press a `+` below. This is the reference menu mapped onto seams that already exist: `openQuickAgent` for the agent rows, `worktree_add` for the branch row, and `open_in_app` with the catalog's own `finder`/`terminal` entries for the last two — NO new IPC."
      >
        <div class="gxsa-row gxsa-row--pair">
          <Column
            title="Electron — every row"
            note="the full menu. One row is not settled: `New split here` — `split-row`/`split-column` act on the ACTIVE pane, and this card's checkout may not own it, so doing it honestly is materialize-then-split, which belongs to `TabManager` (the `launchTask` precedent) and is a fork."
            shape="grouped"
            raise="none"
            cap="fit"
            actions="electron"
          />
          <Column
            title="Tauri — what it can actually do"
            note="`worktree_add` and `open_in_app` are Electron-only, so the branch row and both OS rows are OMITTED rather than shown inert (DL-19.7, the rule `BareCheckout` already follows). What is left still works, because launching an agent into a destination needs no Electron-only host."
            shape="grouped"
            raise="none"
            cap="fit"
            actions="tauri"
          />
        </div>
      </Specimen>
    </>
  );
}
