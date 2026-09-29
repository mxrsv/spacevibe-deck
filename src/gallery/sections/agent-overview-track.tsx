import { Plus } from "@phosphor-icons/react";
import { useRef } from "preact/hooks";
import { CHROME_ICON, DeckIcon } from "../../ui/controls/deck-icon";
import { membersOf, type MockAgent, type MockGroup } from "./agent-overview-data";
import { ZOOM_MS } from "./agent-overview-flip";
import { PaneGrid } from "./agent-overview-pane";

/**
 * Spaces laid side by side and slid horizontally, the way macOS moves between
 * desktops. Every space is in the DOM here because the mock is cheap; in the
 * app only the current space could hold live terminals, and the neighbours a
 * slide reveals would be snapshots (see the performance note in the plan).
 */

/** Horizontal wheel travel that counts as one swipe. */
const SWIPE_THRESHOLD = 60;
/** A pause longer than this starts a new gesture. */
const SWIPE_IDLE_MS = 200;

export type SlideDirection = -1 | 1;

interface SpaceTrackProps {
  readonly spaces: readonly MockGroup[];
  readonly agents: readonly MockAgent[];
  readonly currentId: string | null;
  readonly selectedKey: string | null;
  readonly expand: boolean;
  /** False for one render when a zoom already carries the change. */
  readonly slide: boolean;
  readonly onSelectPane: (key: string) => void;
  readonly onSwipe: (direction: SlideDirection) => void;
  readonly onNew: () => void;
}

function useSwipe(onSwipe: (direction: SlideDirection) => void) {
  const travel = useRef(0);
  const lastAt = useRef(0);
  const lockedUntil = useRef(0);
  return (event: WheelEvent) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = event.timeStamp;
    if (now < lockedUntil.current) return;
    if (now - lastAt.current > SWIPE_IDLE_MS) travel.current = 0;
    lastAt.current = now;
    travel.current += event.deltaX;
    if (Math.abs(travel.current) < SWIPE_THRESHOLD) return;
    onSwipe(travel.current > 0 ? 1 : -1);
    travel.current = 0;
    lockedUntil.current = now + ZOOM_MS;
  };
}

export function SpaceTrack(props: SpaceTrackProps) {
  const { spaces, agents, currentId } = props;
  const index = Math.max(
    0,
    spaces.findIndex((space) => space.id === currentId),
  );
  const onWheel = useSwipe(props.onSwipe);
  return (
    <div class="aog-track-view" onWheel={onWheel}>
      <div
        class={`aog-track ${props.slide ? "" : "is-instant"}`}
        style={{ transform: `translateX(calc(${-index} * (100% + var(--aog-space-gap))))` }}
      >
        {spaces.map((space) => {
          const current = space.id === currentId;
          const members = membersOf(agents, space.id);
          return (
            <div
              key={space.id}
              class="aog-track__space"
              data-current={current ? "true" : undefined}
              inert={!current}
              aria-hidden={!current}
            >
              {members.length === 0 ? (
                <div class="aog-empty">
                  <button type="button" class="aog-empty__new" onClick={props.onNew}>
                    <DeckIcon icon={Plus} size={CHROME_ICON} /> New agent
                  </button>
                </div>
              ) : (
                <PaneGrid
                  agents={members}
                  selectedKey={props.selectedKey}
                  expand={props.expand && current}
                  onSelect={props.onSelectPane}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
