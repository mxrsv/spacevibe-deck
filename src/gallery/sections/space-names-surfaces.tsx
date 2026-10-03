import { useState } from "preact/hooks";
import {
  needsTone,
  runsByGroup,
  spaceCounts,
  spaceLabel,
  type Space,
} from "../../ui/spaces/space-model";
import { SpaceMini } from "../../ui/spaces/space-mini";
import { SPACES, withCurrent, type NameVariant, type SpaceNames } from "./space-names-data";
import { EditableLabel } from "./space-names-label";

/**
 * The two surfaces a name appears on, built from the shipping classes:
 * DL-35.3's strip (`.tabbar` > `.space-bar`) and Mission Control's shelf
 * (`.mc-shelf`). Neither is the shipping component — `SpaceBar` has no name
 * to draw and `Shelf` is not exported — so this copies their markup and adds
 * only the label.
 */

interface SurfaceProps {
  readonly variant: NameVariant;
  readonly names: SpaceNames;
  readonly onRename: (key: number, name: string | null) => void;
  /** A space whose label starts in the rename state, for static frames. */
  readonly editKey?: number;
}

function useEditing(initial: number | undefined) {
  const [editing, setEditing] = useState<number | null>(initial ?? null);
  const stop = (): void => setEditing(null);
  return { editing, edit: setEditing, stop };
}

function labelFor(
  props: SurfaceProps,
  surface: "strip" | "shelf",
  space: Space,
  state: ReturnType<typeof useEditing>,
) {
  const name = props.names[space.key] ?? null;
  return (
    <EditableLabel
      variant={props.variant}
      surface={surface}
      space={space}
      name={name}
      editing={state.editing === space.key}
      forced={props.editKey !== undefined}
      onEdit={() => state.edit(space.key)}
      onCommit={(value) => {
        props.onRename(space.key, value);
        state.stop();
      }}
      onCancel={state.stop}
    />
  );
}

export interface StripRowProps extends SurfaceProps {
  readonly currentKey: number;
}

/** One strip with `currentKey` as the current space (DL-35.3). */
export function StripRow(props: StripRowProps) {
  const spaces = withCurrent(SPACES, props.currentKey);
  const state = useEditing(props.editKey);
  const current = spaces.find((space) => space.current) ?? spaces[0];
  const distributed = props.variant === "C";
  return (
    <div class={`tabbar spn-tabbar spn-tabbar--${props.variant}`}>
      <div class="space-bar">
        {!distributed && (
          <span class="space-bar__name spn-name">{labelFor(props, "strip", current, state)}</span>
        )}
        <div class="space-bar__marks" role="tablist" aria-label="Spaces">
          {runsByGroup(spaces).map((run) => (
            <span key={run[0].key} class="space-bar__run">
              {run.map((space) => {
                const named = (props.names[space.key] ?? null) !== null;
                // A and B draw one label, for the current space; C draws a tag
                // beside every named mark and the current one.
                const tagged = distributed && (named || space.current);
                return (
                  <span key={space.key} class="spn-markwrap" data-current={space.current}>
                    <button
                      type="button"
                      role="tab"
                      class="space-mark"
                      aria-selected={space.current}
                      aria-label={`${spaceLabel(space)} · ${spaceCounts(space)}`}
                      data-needs={needsTone(space) ?? undefined}
                      onDblClick={() => {
                        if (space.current || tagged) state.edit(space.key);
                      }}
                    >
                      <span class="space-mark__pill" aria-hidden="true" />
                    </button>
                    {tagged && (
                      <span class="spn-tag" data-current={space.current}>
                        {labelFor(props, "strip", space, state)}
                      </span>
                    )}
                  </span>
                );
              })}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export interface ShelfRowProps extends SurfaceProps {
  readonly currentKey: number;
  /** Keys of the spaces to show; the whole fixture when omitted. */
  readonly only?: readonly number[];
}

function ShelfThumb({
  props,
  space,
  state,
}: {
  props: ShelfRowProps;
  space: Space;
  state: ReturnType<typeof useEditing>;
}) {
  return (
    // A div, not the shipping `<button>`: a text field cannot live inside one.
    <div
      class="mc-space spn-thumb"
      role="button"
      tabIndex={0}
      aria-current={space.current ? "true" : undefined}
      aria-label={`${spaceLabel(space)} · ${spaceCounts(space)}`}
    >
      <SpaceMini panes={space.panes} class="mc-space__mini" />
      <span class="mc-space__label">
        {labelFor(props, "shelf", space, state)}
        {space.needsCount > 0 && (
          <span class="mc-space__needs" data-tone={needsTone(space) ?? undefined}>
            {space.needsCount}
          </span>
        )}
      </span>
    </div>
  );
}

/** Mission Control's shelf (DL-35.1): spaces grouped by workspace. */
export function ShelfRow(props: ShelfRowProps) {
  const state = useEditing(props.editKey);
  const spaces = withCurrent(SPACES, props.currentKey).filter(
    (space) => props.only === undefined || props.only.includes(space.key),
  );
  const sets = runsByGroup(spaces);
  return (
    <div class={`mc-shelf spn-shelf spn-shelf--${props.variant}`} role="group" aria-label="Spaces">
      {sets.map((set) => (
        <div key={set[0].key} class="mc-shelf__set">
          {props.variant === "A" && <span class="mc-shelf__folder">{set[0].folder}</span>}
          <div class="mc-shelf__row">
            {set.map((space) => (
              <ShelfThumb key={space.key} props={props} space={space} state={state} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
