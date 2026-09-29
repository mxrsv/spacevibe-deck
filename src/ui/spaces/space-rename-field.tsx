import { useEffect, useRef } from "preact/hooks";
import { MAX_TAB_NAME_LENGTH } from "../../terminal/tabs-store";

/**
 * The in-place rename field every space surface shares (DL-35.3): Enter saves,
 * Esc cancels, an empty name commits `null` — back to the default label. Blur
 * saves, so pressing elsewhere never loses a typed name.
 */
export interface SpaceRenameFieldProps {
  /** The current name; empty while the space is unnamed. */
  readonly initial: string;
  /** The default label, shown while the field is empty. */
  readonly placeholder: string;
  readonly onCommit: (name: string | null) => void;
  readonly onCancel: () => void;
  readonly class?: string;
}

export function SpaceRenameField(props: SpaceRenameFieldProps) {
  const field = useRef<HTMLInputElement>(null);
  /** Enter, Esc and the blur that follows them all end the edit; only the first counts. */
  const finished = useRef(false);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const finish = (commit: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    const value = field.current?.value.trim() ?? "";
    if (commit && value !== props.initial) props.onCommit(value === "" ? null : value);
    else props.onCancel();
  };
  return (
    <input
      ref={field}
      class={`text-input text-input--small space-rename ${props.class ?? ""}`}
      type="text"
      defaultValue={props.initial}
      placeholder={props.placeholder}
      maxLength={MAX_TAB_NAME_LENGTH}
      aria-label="Space name"
      spellcheck={false}
      // The field owns its keys and presses: a chord or a mark's own handler
      // behind it must not see them (Space would otherwise press the mark).
      onClick={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        else if (event.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
    />
  );
}
