import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Plus } from "@phosphor-icons/react";
import { AgentGlyph } from "./controls/agent-glyph";
import { CHROME_ICON, DeckIcon } from "./controls/deck-icon";
import { CardLoad, CardMark, signalLabelOf, whereOf } from "./worktree-card-row";
import { SegmentMenu } from "./worktree-card-menus";
import {
  displayAgent,
  fitSegments,
  groupSegments,
  panesBehind,
  SEGMENT_ADD_WIDTH,
  SEGMENT_COUNT_WIDTH,
  SEGMENT_OVERFLOW_WIDTH,
  SEGMENT_WIDTH_FALLBACK,
  STRIP_BUDGET_FALLBACK,
  STRIP_OVERFLOW_KEY,
  type StripGroup,
} from "./agent-rail-card-model";
import type { RailWorktreeGroup } from "./agent-rail-model";

/**
 * A closed card's agent strip (spec
 * `docs/internals/agent-rail.md`).
 *
 * **This reverses the card spec's §4 and the comment that used to sit on
 * `CardStrip`: the strip is no longer a preview, it is a set of controls.** A
 * segment is one AGENT KIND rather than one pane, it is a `<button>`, hovering
 * or focusing it raises the panes behind it, and a trailing `+` opens the
 * checkout's actions menu. **What a press does depends on how many panes the
 * segment stands for (spec §16 §15.1, amended 2026-09-02):** a single-pane
 * segment focuses that pane and raises no hover/focus popover; a merged `×N` segment and the `+N` tail PIN the
 * menu open so the user can choose, because pressing the loudest pane on the
 * user's behalf was a guess they never asked for, and it closed the hover menu
 * under a pointer that could not re-raise it without leaving first.
 *
 * Three consequences of that reversal, each of which was a deliberate line in
 * the shipped card:
 *
 *  - The native `title` comes OFF every segment (DL-23.10 applied, not
 *    amended): a `title` never appears on keyboard focus, and a control that
 *    Tab reaches has to say its state in its accessible name instead.
 *  - `.asr-card__seg` was defined as "carries no press and no close", which is
 *    what kept it apart from `.asr-card__row`. It carries a press now; it
 *    still carries no close, and it is still not a row.
 *  - The fold is by measured WIDTH, not by `STRIP_VISIBLE`. `stripSegments`
 *    and its constant survive for the pane-per-segment gallery specimen.
 */

/** How long the pointer must rest before a segment raises its menu. */
const HOVER_OPEN_MS = 120;
/**
 * How long the menu survives after the pointer leaves. This IS the pointer
 * bridge across the 6px gap (spec §5.1) — the menu's own `pointerenter`
 * cancels the pending close, so travelling into it keeps it up.
 */
const HOVER_CLOSE_MS = 140;

/**
 * Measured segment widths, keyed by the shape that decides them. Module-level
 * and window-scoped (R5): every card in the rail draws the same segment
 * shapes, so the first card to render warms the cache for all of them, and a
 * shape nobody has drawn yet falls back to the spec's own Chrome measurements
 * — which run ~7px conservative, folding one segment early rather than late.
 */
const measuredSegments = new Map<string, number>();

function fitKey(agent: string, merged: boolean, busy: boolean): string {
  return `${agent}|${merged ? "n" : "1"}|${busy ? "busy" : "still"}`;
}

function estimateWidth(group: StripGroup): number {
  const key = fitKey(group.agent, group.panes.length > 1, group.state === "working");
  return (
    measuredSegments.get(key) ??
    SEGMENT_WIDTH_FALLBACK + (group.panes.length > 1 ? SEGMENT_COUNT_WIDTH : 0)
  );
}

interface StripMetrics {
  readonly budget: number;
  readonly add: number;
  readonly tail: number;
}

const FALLBACK_METRICS: StripMetrics = {
  budget: STRIP_BUDGET_FALLBACK,
  add: SEGMENT_ADD_WIDTH,
  tail: SEGMENT_OVERFLOW_WIDTH,
};

/**
 * The room the strip actually has, in pixels.
 *
 * **This was `parseFloat(getComputedStyle(strip).maxWidth)` until 2026-08-31,
 * and that never once returned a number** (code review, reproduced in Chrome):
 * `max-width` is not on CSSOM's used-value resolution list, so the getter
 * hands back the computed value — the literal string `"calc(100% - 22px)"` —
 * and `parseFloat` answers `NaN`. `Number.isFinite` then rejected it on every
 * render and the budget sat at `STRIP_BUDGET_FALLBACK` (220) forever. Since
 * `.asr-card` has no fixed width and the sidebar is drag-resizable (DL-18.9),
 * a wide sidebar folded segments away with room to spare and a narrow one let
 * the strip overrun the card, where `.asr-rail__list`'s `overflow-x: hidden`
 * cut it silently — the exact defect §9's `calc(100% - 22px)` was written to
 * close. The stylesheet's own claim to be the one source of truth was true
 * only because 220px happened to be the value at the default width.
 *
 * So the `calc` is reconstructed from boxes CSSOM does resolve: the parent's
 * content box (`clientWidth` less its own padding — `.asr-card` is
 * `border-box` with 9px sides, so `clientWidth` is 260px while the `100%` the
 * `calc` resolves against is 242px) minus the strip's own indent. Measured in
 * Chrome against the shipped rule: 260 − 9 − 9 − 22 = 220, equal to the real
 * `offsetWidth` of an overflowing strip. `offsetWidth` itself cannot be used —
 * the strip is `width: fit-content`, so it reports how wide the segments are,
 * never how wide they are ALLOWED to be.
 */
function stripBudget(strip: HTMLElement): number {
  const parent = strip.parentElement;
  if (parent === null) {
    return Number.NaN;
  }
  const parentStyle = window.getComputedStyle(parent);
  const content =
    parent.clientWidth -
    Number.parseFloat(parentStyle.paddingLeft) -
    Number.parseFloat(parentStyle.paddingRight);
  return content - Number.parseFloat(window.getComputedStyle(strip).marginLeft);
}

/**
 * Read the real boxes back out of the rendered strip and re-fold when they
 * disagree with what the last fold assumed (spec §6/§13: "a shipped version
 * should measure rather than estimate, or the estimate becomes a second source
 * of truth beside the stylesheet").
 *
 * The budget is `max-width`'s USED value, which is exactly `calc(100% - 22px)`
 * after §9's fix — the 22px indent the strip carries to align under the
 * checkout name, and the reason a `100%` cap let a wide strip hang 22px past
 * its card where `.asr-rail__list`'s `overflow-x: hidden` cut it silently.
 *
 * It converges: a segment's width depends on its own shape, never on how many
 * of them are shown, so re-folding cannot change a width it already read.
 */
function useStripMetrics(): {
  readonly ref: { current: HTMLDivElement | null };
  readonly metrics: StripMetrics;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<StripMetrics>(FALLBACK_METRICS);
  // Bumped whenever a segment width lands in the shared cache for the first
  // time (or changes). Without it a newly measured segment would sit in the
  // cache until some OTHER render happened to re-fold — in practice the rail
  // re-renders on every poll tick so it would converge anyway, but "converges
  // because something else re-rendered" is not a rule, it is a coincidence.
  const [measuredAt, setMeasuredAt] = useState(0);

  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Measure DOM changes on every render; state updates require a changed width or budget.
  useLayoutEffect(() => {
    const strip = ref.current;
    if (strip === null) {
      return;
    }
    let learned = false;
    for (const node of strip.querySelectorAll<HTMLElement>("[data-fit-key]")) {
      const key = node.dataset.fitKey;
      if (
        key !== undefined &&
        node.offsetWidth > 0 &&
        measuredSegments.get(key) !== node.offsetWidth
      ) {
        measuredSegments.set(key, node.offsetWidth);
        learned = true;
      }
    }
    if (learned) {
      setMeasuredAt((value) => value + 1);
    }
    const addBox = strip.querySelector<HTMLElement>('[data-fit-role="add"]');
    const tailBox = strip.querySelector<HTMLElement>('[data-fit-role="overflow"]');
    const capped = stripBudget(strip);
    const next: StripMetrics = {
      budget: Number.isFinite(capped) && capped > 0 ? capped : metrics.budget,
      add: addBox !== null && addBox.offsetWidth > 0 ? addBox.offsetWidth : metrics.add,
      tail: tailBox !== null && tailBox.offsetWidth > 0 ? tailBox.offsetWidth : metrics.tail,
    };
    if (next.budget !== metrics.budget || next.add !== metrics.add || next.tail !== metrics.tail) {
      setMetrics(next);
    }
  });

  // `measuredAt` is read so the fold above re-runs on the render this bump
  // causes; the value itself carries no meaning.
  void measuredAt;
  return { ref, metrics };
}

interface HoverTarget {
  readonly key: string;
  readonly rect: DOMRect;
  readonly element: HTMLElement;
}

export interface CardStripProps {
  readonly project: string;
  readonly group: RailWorktreeGroup;
  readonly onFocusPane: (tabIndex: number, paneId: number) => void;
  readonly onClosePane: (tabIndex: number, paneId: number) => void;
  /** Omitted where nothing can wire the actions menu — the `+` then goes
   * (DL-19.7), because a launcher that opens nothing is worse than none. */
  readonly onOpenActions?: (trigger: HTMLElement) => void;
  readonly actionsOpen: boolean;
}

export function CardStrip(props: CardStripProps) {
  const { group, project } = props;
  const { ref, metrics } = useStripMetrics();
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  /**
   * The key a PRESS opened the menu for (spec §16 §15.1, amended 2026-09-02).
   *
   * Until then every segment's press focused its loudest pane and closed the
   * menu — so a merged `×2` could never be CHOSEN from by clicking: the press
   * guessed a pane, the hover menu vanished under a pointer that had not
   * moved, and since `pointerenter` never fires again while the pointer stays
   * inside the segment, the menu could not come back until the pointer left
   * and returned. The owner read that as "click does nothing but blink".
   *
   * A pinned menu ignores the hover close: it survives the pointer leaving the
   * strip and the surface, and goes on Escape, an outside press, a second
   * press on its own segment, a pane chosen from it, or its segment leaving
   * the shown set. Hovering a DIFFERENT merged segment re-targets the menu and drops
   * the pin, so the strip never holds two intents at once.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const pendingKey = useRef<string | null>(null);

  const all = groupSegments(group.panes);
  const fit = fitSegments(
    all,
    group.panes,
    estimateWidth,
    metrics.budget,
    metrics.add,
    metrics.tail,
  );

  // Pinned by KEY, not by index: `groupSegments` re-ranks on every render, so a
  // state change mid-hover can reorder or evict the segment the menu belongs
  // to. When the key leaves the shown set the menu has nothing to describe and
  // `behind` is empty, which is what closes it (spec §5.1).
  const candidates = hovered === null ? [] : panesBehind(hovered.key, group.panes, fit.shown);
  // A single visible agent already has a direct focus button. The overflow
  // menu still exposes hidden panes even when only one pane is hidden.
  const behind = hovered?.key === STRIP_OVERFLOW_KEY || candidates.length > 1 ? candidates : [];
  const pendingCount =
    pendingKey.current === null
      ? 0
      : panesBehind(pendingKey.current, group.panes, fit.shown).length;
  const pendingAllowed =
    pendingKey.current === null ||
    pendingCount >= (pendingKey.current === STRIP_OVERFLOW_KEY ? 1 : 2);
  useLayoutEffect(() => {
    if (!pendingAllowed) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      pendingKey.current = null;
    }
    if (hovered !== null && behind.length === 0) {
      setHovered(null);
      setPinned(null);
    }
  }, [hovered, behind.length, pendingAllowed]);
  useLayoutEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const pinHolds = pinned !== null && hovered?.key === pinned && behind.length > 0;

  const clearTimer = (): void => {
    pendingKey.current = null;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const raise = (key: string, element: HTMLElement, delay: number): void => {
    clearTimer();
    pendingKey.current = key;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      pendingKey.current = null;
      setHovered({ key, element, rect: element.getBoundingClientRect() });
      setPinned((current) => (current === key ? current : null));
    }, delay);
  };
  const dismiss = (delay: number): void => {
    // Leaving cancels whatever hover intent was pending, pinned or not: a
    // `raise` scheduled by brushing a neighbouring segment must not fire after
    // the pointer has gone, or it would re-target an unpinned menu that nothing
    // is left to close.
    clearTimer();
    if (pinHolds) {
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setHovered(null);
    }, delay);
  };
  const close = (): void => {
    clearTimer();
    setHovered(null);
    setPinned(null);
  };
  /** A press on a segment that stands for several panes: open to choose, or
   * close what a previous press opened. */
  const togglePin = (key: string, element: HTMLElement): void => {
    if (pinned === key) {
      close();
      return;
    }
    clearTimer();
    setHovered({ key, element, rect: element.getBoundingClientRect() });
    setPinned(key);
  };

  return (
    <>
      <div
        ref={ref}
        class="asr-card__strip"
        onPointerLeave={() => {
          dismiss(HOVER_CLOSE_MS);
        }}
      >
        {fit.shown.map((segment) => {
          const merged = segment.panes.length > 1;
          const name = segment.panes[0]?.label ?? segment.agent;
          const where = whereOf(project, group);
          // A merged segment's press CHOOSES, a single one's FOCUSES — the
          // accessible name says which (DL-27.2), since nothing else on the
          // segment does.
          const stateWord = signalLabelOf(segment.state, segment.confidence);
          const word = merged
            ? `Choose from ${segment.panes.length} ${displayAgent(segment.agent)} agents, loudest ${stateWord} in ${where}`
            : `Focus ${name}, ${stateWord} in ${where}`;
          const loudest = segment.panes[0];
          return (
            <button
              key={segment.agent}
              type="button"
              class="asr-card__seg"
              data-fit-key={fitKey(segment.agent, merged, segment.state === "working")}
              data-origin={hovered?.key === segment.agent}
              // DL-23.10 applied: no native `title` on a control the keyboard
              // reaches. The state word lives in the accessible name (DL-27.2).
              aria-label={word}
              // Only a segment whose press opens something claims a popup; a
              // single-pane segment only focuses its pane.
              aria-haspopup={merged ? "dialog" : undefined}
              aria-expanded={
                merged ? hovered?.key === segment.agent && behind.length > 0 : undefined
              }
              onPointerEnter={(event) => {
                if (merged) raise(segment.agent, event.currentTarget, HOVER_OPEN_MS);
                else dismiss(HOVER_CLOSE_MS);
              }}
              onFocus={(event) => {
                if (merged) raise(segment.agent, event.currentTarget, 0);
                else dismiss(0);
              }}
              onClick={(event) => {
                // A merged segment stands for several panes, so its press opens
                // the choice rather than guessing the loudest (spec §16 §15.1,
                // amended 2026-09-02). A single-pane segment IS its pane.
                if (merged) {
                  togglePin(segment.agent, event.currentTarget);
                } else if (loudest !== undefined) {
                  props.onFocusPane(loudest.tabIndex, loudest.paneId);
                  close();
                }
              }}
            >
              <span class="asr-card__glyph">
                <AgentGlyph agent={segment.agent} className="asr-card__logo" />
                <CardMark state={segment.state} confidence={segment.confidence} />
              </span>
              {/* `--text-muted`, never `--accent`: `+N` already spends the
                  accent on a count of HIDDEN agents, and two counts in one bar
                  must not read as the same kind of number. This one names what
                  the segment IS; that one names what it is not showing. */}
              {merged && <span class="asr-card__count-n">×{segment.panes.length}</span>}
              <CardLoad state={segment.state} />
            </button>
          );
        })}
        {fit.overflow > 0 && (
          <button
            type="button"
            class="asr-card__seg"
            data-overflow="true"
            data-fit-role="overflow"
            data-origin={hovered?.key === STRIP_OVERFLOW_KEY}
            aria-label={`${fit.overflow} more agents in ${whereOf(project, group)}`}
            aria-haspopup="dialog"
            aria-expanded={hovered?.key === STRIP_OVERFLOW_KEY && behind.length > 0}
            onPointerEnter={(event) => {
              raise(STRIP_OVERFLOW_KEY, event.currentTarget, HOVER_OPEN_MS);
            }}
            onFocus={(event) => {
              raise(STRIP_OVERFLOW_KEY, event.currentTarget, 0);
            }}
            onClick={(event) => {
              // The tail stands for the panes the fold hid: a press opens them
              // to choose from, and a second press closes them, exactly as a
              // merged segment does. It had no press at all before 2026-09-02.
              togglePin(STRIP_OVERFLOW_KEY, event.currentTarget);
            }}
          >
            +{fit.overflow}
          </button>
        )}
        {/* The closed-state twin of the open card's `New agent` row, in the one
            place on a closed card that costs the checkout name nothing: the
            strip is `width: fit-content`, so a trailing segment spends strip
            width, never head width (spec §7.2, §10). It renders AFTER the `+N`
            tail so the bar reads agents → more agents → create, and the fold
            never drops it — a launcher that vanishes when a checkout gets busy
            is missing exactly when it is wanted. */}
        {props.onOpenActions !== undefined && (
          <button
            type="button"
            class="asr-card__seg asr-card__seg--add"
            data-fit-role="add"
            aria-haspopup="menu"
            aria-expanded={props.actionsOpen}
            aria-label={`Actions for ${whereOf(project, group)}`}
            onClick={(event) => {
              close();
              props.onOpenActions?.(event.currentTarget);
            }}
          >
            <DeckIcon icon={Plus} size={CHROME_ICON} />
          </button>
        )}
      </div>
      {hovered !== null && behind.length > 0 && !props.actionsOpen && (
        <SegmentMenu
          project={project}
          group={group}
          panes={behind}
          rect={hovered.rect}
          trigger={hovered.element}
          agent={hovered.key === STRIP_OVERFLOW_KEY ? null : hovered.key}
          onFocusPane={props.onFocusPane}
          onClosePane={props.onClosePane}
          onClose={close}
          onPointerEnter={clearTimer}
          onPointerLeave={() => {
            dismiss(HOVER_CLOSE_MS);
          }}
        />
      )}
    </>
  );
}
