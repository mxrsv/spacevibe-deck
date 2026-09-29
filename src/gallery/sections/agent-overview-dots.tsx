import { useSignal } from "@preact/signals";
import { useRef } from "preact/hooks";
import {
  cwdName,
  membersOf,
  needsYouCount,
  spaceName,
  spaceText,
  type MockAgent,
  type MockGroup,
} from "./agent-overview-data";
import { CwdLabel } from "./agent-overview-pane";
import { MiniLayout } from "./agent-overview-spaces";

/**
 * Where the tab strip was: the current space's cwd, then one mark per space in
 * slide order, grouped by cwd. Miniatures were tried in the bar and as a
 * standing shelf on 2026-09-27 and turned down for the room they take; they
 * return here only inside the hover card, which costs no room at rest.
 */

/**
 * Treatments for the strip, compared on the same frame (owner asked for
 * directions on 2026-09-27). `dots` is the reviewed baseline; the others
 * group each cwd's spaces by spacing rather than hairlines and let position
 * carry the index, so the name drops its ① badge.
 */
export type DotStyle = "dots" | "pill" | "capsule" | "ticks";

export const DOT_STYLES: readonly { value: DotStyle; label: string }[] = [
  { value: "dots", label: "Dots" },
  { value: "pill", label: "Pill" },
  { value: "capsule", label: "Capsule" },
  { value: "ticks", label: "Ticks" },
];

/** Keeps the card's centre far enough from the strip's left edge to fit. */
const TIP_MIN_CENTRE = 96;

interface SpaceDotsProps {
  readonly spaces: readonly MockGroup[];
  readonly agents: readonly MockAgent[];
  readonly currentId: string | null;
  readonly dotStyle: DotStyle;
  readonly onGo: (groupId: string) => void;
}

interface Hover {
  readonly id: string;
  /** Centre of the mark, in px from the strip's left edge. */
  readonly centre: number;
}

/** Consecutive spaces on one cwd, in slide order. */
function runsByCwd(spaces: readonly MockGroup[]): readonly (readonly MockGroup[])[] {
  return spaces.reduce<readonly (readonly MockGroup[])[]>((runs, space) => {
    const last = runs[runs.length - 1];
    return last !== undefined && last[0].checkoutId === space.checkoutId
      ? [...runs.slice(0, -1), [...last, space]]
      : [...runs, [space]];
  }, []);
}

function countText(members: readonly MockAgent[]): string {
  const needs = needsYouCount(members);
  const agents = `${members.length} ${members.length === 1 ? "agent" : "agents"}`;
  return needs > 0 ? `${agents} · ${needs} need you` : agents;
}

/**
 * The hover card: which cwd this mark is, where it lives, and what is in it.
 * Rendered outside the scrolling row, which would otherwise clip it.
 */
function SpaceTip({
  space,
  spaces,
  agents,
  centre,
}: {
  space: MockGroup;
  spaces: readonly MockGroup[];
  agents: readonly MockAgent[];
  centre: number;
}) {
  const name = spaceName(space, spaces);
  const members = membersOf(agents, space.id);
  return (
    <div
      id={`aog-tip-${space.id}`}
      class="aog-tip"
      role="tooltip"
      style={{ left: `${Math.max(centre, TIP_MIN_CENTRE)}px` }}
    >
      <MiniLayout members={members} />
      <span class="aog-tip__text">
        <span class="aog-tip__name">
          <b>{cwdName(name.checkout)}</b>
          {name.index !== null && <small class="aog-cwd__index">{name.index}</small>}
        </span>
        <span class="aog-tip__path">{name.checkout.path}</span>
        <span class="aog-tip__meta">
          {name.checkout.branch} · {countText(members)}
        </span>
      </span>
    </div>
  );
}

export function SpaceDots({ spaces, agents, currentId, dotStyle, onGo }: SpaceDotsProps) {
  const hover = useSignal<Hover | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hovered = spaces.find((space) => space.id === hover.value?.id);

  const show = (id: string, mark: HTMLElement) => {
    const root = rootRef.current;
    if (root === null) return;
    const box = mark.getBoundingClientRect();
    hover.value = { id, centre: box.left + box.width / 2 - root.getBoundingClientRect().left };
  };
  const hide = () => {
    hover.value = null;
  };

  return (
    <div ref={rootRef} class={`aog-dots aog-dots--${dotStyle}`} role="group" aria-label="Spaces">
      {/* Every space's name shares one grid cell and only the current one is
          visible, so the cell is as wide as the longest name and the marks
          never shift when the name changes. */}
      <span class="aog-dots__name">
        {spaces.map((space) => (
          <span
            key={space.id}
            class="aog-dots__name-slot"
            aria-hidden={space.id === currentId ? undefined : "true"}
            data-current={space.id === currentId ? "true" : undefined}
          >
            <CwdLabel name={spaceName(space, spaces)} />
          </span>
        ))}
      </span>
      <div class="aog-dots__row">
        {runsByCwd(spaces).map((run) => (
          <span
            key={run[0].checkoutId}
            class="aog-dots__group"
            data-current={run.some((space) => space.id === currentId) ? "true" : undefined}
          >
            {run.map((space) => {
              const members = membersOf(agents, space.id);
              return (
                <button
                  type="button"
                  key={space.id}
                  class="aog-dot"
                  aria-label={`${spaceText(spaceName(space, spaces))} · ${countText(members)}`}
                  aria-describedby={
                    hover.value?.id === space.id ? `aog-tip-${space.id}` : undefined
                  }
                  aria-current={space.id === currentId ? "true" : undefined}
                  data-needs={needsYouCount(members) > 0 ? "true" : undefined}
                  onMouseEnter={(event) => show(space.id, event.currentTarget)}
                  onFocus={(event) => show(space.id, event.currentTarget)}
                  onMouseLeave={hide}
                  onBlur={hide}
                  onClick={() => onGo(space.id)}
                />
              );
            })}
          </span>
        ))}
      </div>
      {hovered !== undefined && hover.value !== null && (
        <SpaceTip space={hovered} spaces={spaces} agents={agents} centre={hover.value.centre} />
      )}
    </div>
  );
}
