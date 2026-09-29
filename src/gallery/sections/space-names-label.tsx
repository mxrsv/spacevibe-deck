import { useEffect, useRef } from "preact/hooks";
import { spaceLabel, type Space } from "../../ui/spaces/space-model";
import {
  cardText,
  shelfParts,
  stripParts,
  type NameParts,
  type NameVariant,
} from "./space-names-data";

/**
 * The label a space name is drawn with, and its in-place rename field. Shared
 * by the strip and the shelf so the two surfaces of one candidate cannot tone
 * the same words differently.
 */

export type LabelSurface = "strip" | "shelf";

/** The folder that leads a name, and the dot that separates them. */
function Lead({ folder }: { folder: string | null }) {
  if (folder === null) return null;
  return (
    <>
      <span class="spn-lead">{folder}</span>
      <span class="spn-sep" aria-hidden="true">
        ·
      </span>
    </>
  );
}

function PartsView({ parts }: { parts: NameParts }) {
  return (
    <>
      <span class="spn-line">
        <Lead folder={parts.lead} />
        <span class={parts.named ? "spn-main" : "spn-main spn-main--unnamed"}>{parts.main}</span>
      </span>
      {parts.trail !== null && <span class="spn-trail">{parts.trail}</span>}
    </>
  );
}

export interface RenameInputProps {
  readonly initial: string;
  readonly placeholder: string;
  /** A static specimen frame: draw the focus ring but never steal focus. */
  readonly forced: boolean;
  readonly onCommit: (name: string | null) => void;
  readonly onCancel: () => void;
}

export function RenameInput({
  initial,
  placeholder,
  forced,
  onCommit,
  onCancel,
}: RenameInputProps) {
  const field = useRef<HTMLInputElement>(null);
  /** Enter, Esc and blur all end the edit; only the first one counts. */
  const finished = useRef(false);
  useEffect(() => {
    if (forced) return;
    field.current?.focus();
    field.current?.select();
  }, [forced]);
  const finish = (commit: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    const value = field.current?.value.trim() ?? "";
    if (commit) onCommit(value === "" ? null : value);
    else onCancel();
  };
  return (
    <input
      ref={field}
      class="text-input text-input--small spn-input"
      type="text"
      defaultValue={initial}
      placeholder={placeholder}
      aria-label="Space name"
      spellcheck={false}
      data-focused={forced ? "true" : undefined}
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}

export interface EditableLabelProps {
  readonly variant: NameVariant;
  readonly surface: LabelSurface;
  readonly space: Space;
  readonly name: string | null;
  readonly editing: boolean;
  readonly forced: boolean;
  readonly onEdit: () => void;
  readonly onCommit: (name: string | null) => void;
  readonly onCancel: () => void;
}

export function EditableLabel(props: EditableLabelProps) {
  const { variant, surface, space, name, editing } = props;
  const parts = (surface === "strip" ? stripParts : shelfParts)(variant, space, name);
  if (!editing) {
    return (
      <span class="spn-label" onDblClick={props.onEdit}>
        <PartsView parts={parts} />
      </span>
    );
  }
  return (
    <span class="spn-label spn-label--editing">
      <span class="spn-line">
        <Lead folder={parts.lead} />
        <RenameInput
          initial={name ?? ""}
          placeholder={spaceLabel(space)}
          forced={props.forced}
          onCommit={props.onCommit}
          onCancel={props.onCancel}
        />
      </span>
    </span>
  );
}

/**
 * The hover card, drawn inline with the shipping classes (`.space-card` is
 * `position: fixed` and portalled in the app; `space-names.css` lays it flat).
 */
export function StaticCard({
  variant,
  space,
  name,
}: {
  variant: NameVariant;
  space: Space;
  name: string | null;
}) {
  const text = cardText(variant, space, name);
  return (
    <div class="space-card spn-card" role="tooltip">
      <span class="space-card__text">
        <span class="space-card__name">{text.title}</span>
        <span class="space-card__meta">{text.meta}</span>
      </span>
    </div>
  );
}
