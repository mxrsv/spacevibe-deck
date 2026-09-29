import { useEffect, useRef, useState } from "preact/hooks";
import {
  needsTone,
  spaceAddress,
  spaceCounts,
  spaceLabel,
  type Space,
} from "../spaces/space-model";
import { SpaceMini } from "../spaces/space-mini";
import { SpaceRenameField } from "../spaces/space-rename-field";

/**
 * One thumbnail on Mission Control's shelf (DL-35.1): the space's miniature,
 * then its name — its index while unnamed — and its needs-you count. A
 * double-click on the name renames it in place.
 *
 * A `div` with the button role rather than a `<button>`: the rename field is a
 * text input, and a `<button>` may not contain one. It keeps a button's
 * keyboard contract (Enter and Space enter the space) by hand.
 */
export interface ShelfSpaceProps {
  readonly space: Space;
  readonly previewed: boolean;
  readonly onPreview: (space: Space) => void;
  readonly onEnter: (space: Space) => void;
  readonly onRename: (space: Space, name: string | null) => void;
}

export function ShelfSpace({ space, previewed, onPreview, onEnter, onRename }: ShelfSpaceProps) {
  const thumb = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const wasEditing = useRef(false);

  // Unmounting the field drops focus to <body>, where Mission Control's own
  // keys still work but no thumbnail is reachable; hand it back to this one.
  // A press elsewhere that ended the edit has already moved focus, so it stays.
  useEffect(() => {
    if (wasEditing.current && !editing && document.activeElement === document.body) {
      thumb.current?.focus({ preventScroll: true });
    }
    wasEditing.current = editing;
  }, [editing]);

  return (
    <div
      ref={thumb}
      class="mc-space"
      role="button"
      tabIndex={0}
      aria-current={space.current ? "true" : undefined}
      data-previewed={previewed ? "true" : undefined}
      aria-label={`${spaceLabel(space)} · ${spaceCounts(space)}`}
      onMouseEnter={() => onPreview(space)}
      onFocus={() => onPreview(space)}
      onClick={() => onEnter(space)}
      onKeyDown={(event) => {
        // Only the thumbnail's own keys: the rename field's bubble up here.
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEnter(space);
        }
      }}
    >
      <SpaceMini panes={space.panes} class="mc-space__mini" />
      <span class="mc-space__label">
        {editing ? (
          <SpaceRenameField
            class="mc-space__rename"
            initial={space.name ?? ""}
            placeholder={spaceAddress(space)}
            onCommit={(name) => {
              setEditing(false);
              onRename(space, name);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          // A press on the name does not enter the space, or the first click
          // of a double-click would leave Mission Control before it renamed.
          <span
            class={space.name === null ? "mc-space__name mc-space__index" : "mc-space__name"}
            aria-hidden="true"
            onClick={(event) => event.stopPropagation()}
            onDblClick={() => setEditing(true)}
          >
            {space.name ?? (space.index === null ? "" : space.index)}
          </span>
        )}
        {!editing && space.needsCount > 0 && (
          <span
            class="mc-space__needs"
            data-tone={needsTone(space) ?? undefined}
            aria-hidden="true"
          >
            {space.needsCount}
          </span>
        )}
      </span>
    </div>
  );
}
