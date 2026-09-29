import { useLayoutEffect, useRef } from "preact/hooks";
import {
  CHECKOUTS,
  membersOf,
  needsYouCount,
  spaceName,
  spaceText,
  type MockAgent,
  type MockGroup,
  type SpaceName,
} from "./agent-overview-data";
import { CwdLabel } from "./agent-overview-pane";

/**
 * Mission Control's spaces bar, grouped under each cwd — the name a user
 * actually tells spaces apart by. One thumbnail per space, drawn as its
 * pane layout in miniature with each pane tinted by state. Hovering or
 * focusing a space previews its windows below; pressing it enters the space.
 */

/** A space's pane layout in miniature, each pane tinted by its state. */
export function MiniLayout({ members }: { members: readonly MockAgent[] }) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(members.length)));
  return (
    <span class="aog-space__mini" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {members.map((agent) => (
        <i key={agent.key} data-state={agent.state} />
      ))}
    </span>
  );
}

/** Room left beside the current thumbnail when the shelf scrolls to it. */
const SCROLL_MARGIN = 14;

interface SpaceThumbProps {
  readonly group: MockGroup;
  readonly name: SpaceName;
  readonly members: readonly MockAgent[];
  readonly current: boolean;
  readonly previewed: boolean;
  readonly onPreview: (groupId: string) => void;
  readonly onEnter: (groupId: string) => void;
}

function SpaceThumb({
  group,
  name,
  members,
  current,
  previewed,
  onPreview,
  onEnter,
}: SpaceThumbProps) {
  const needs = needsYouCount(members);
  return (
    <button
      type="button"
      class="aog-space"
      data-group={group.id}
      aria-current={current ? "true" : undefined}
      data-previewed={previewed ? "true" : undefined}
      aria-label={`${spaceText(name)} · ${members.length} agents${needs > 0 ? ` · ${needs} need you` : ""}`}
      onMouseEnter={() => onPreview(group.id)}
      onFocus={() => onPreview(group.id)}
      onClick={() => onEnter(group.id)}
    >
      <MiniLayout members={members} />
      <span class="aog-space__label">
        {/* The set's caption already names the cwd; a thumb adds only its index. */}
        {name.index !== null && <span class="aog-cwd__index">{name.index}</span>}
        {needs > 0 && (
          <span class="aog-chip__needs" aria-hidden="true">
            {needs}
          </span>
        )}
      </span>
    </button>
  );
}

interface SpacesBarProps {
  readonly groups: readonly MockGroup[];
  readonly agents: readonly MockAgent[];
  readonly currentId: string | null;
  readonly previewId: string | null;
  readonly onPreview: (groupId: string) => void;
  readonly onEnter: (groupId: string) => void;
}

export function SpacesBar({
  groups,
  agents,
  currentId,
  previewId,
  onPreview,
  onEnter,
}: SpacesBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  // Keep the current space in view when the shelf is wider than the frame.
  useLayoutEffect(() => {
    // Horizontal only: `scrollIntoView` would also scroll the gallery page.
    const root = rootRef.current;
    const thumb = root?.querySelector('.aog-space[aria-current="true"]');
    if (root === null || root === undefined || thumb === null || thumb === undefined) return;
    const frame = root.getBoundingClientRect();
    const box = thumb.getBoundingClientRect();
    if (box.left < frame.left) root.scrollLeft -= frame.left - box.left + SCROLL_MARGIN;
    else if (box.right > frame.right) root.scrollLeft += box.right - frame.right + SCROLL_MARGIN;
  }, [currentId]);
  return (
    <div ref={rootRef} class="aog-spaces" role="group" aria-label="Spaces">
      {CHECKOUTS.map((checkout) => {
        const inCheckout = groups.filter((group) => group.checkoutId === checkout.id);
        if (inCheckout.length === 0) return null;
        return (
          <div key={checkout.id} class="aog-spaces__set" title={checkout.path}>
            <span class="aog-spaces__checkout">
              <CwdLabel name={{ checkout, index: null }} />
            </span>
            <div class="aog-spaces__row">
              {inCheckout.map((group) => (
                <SpaceThumb
                  key={group.id}
                  group={group}
                  name={spaceName(group, groups)}
                  members={membersOf(agents, group.id)}
                  current={group.id === currentId}
                  previewed={group.id === previewId}
                  onPreview={onPreview}
                  onEnter={onEnter}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
