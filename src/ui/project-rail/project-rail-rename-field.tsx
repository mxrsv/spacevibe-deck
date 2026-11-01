import { useEffect, useRef } from "preact/hooks";
import { Input } from "../controls/input";
import { MAX_TAB_NAME_LENGTH } from "../../terminal/tabs-store";

export interface ProjectRailRenameFieldProps {
  /** The tab's own name; empty while it is unnamed. */
  readonly initial: string;
  /** What the row shows while the tab has no name. */
  readonly placeholder: string;
  readonly onCommit: (name: string | null) => void;
  readonly onCancel: () => void;
}

/**
 * The in-place rename field (LAY-2), the shipped one's contract on the `Input` control:
 * Enter commits, Esc cancels, an empty name commits `null` (back to the default title) and
 * blur commits, so pressing elsewhere never loses a typed name. Its keys stop here: Esc and
 * Enter must reach neither the terminal nor a global handler.
 */
export function ProjectRailRenameField({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: ProjectRailRenameFieldProps) {
  const field = useRef<HTMLInputElement>(null);
  /** Enter, Esc and the blur that follows either all end the edit; only the first counts. */
  const finished = useRef(false);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const finish = (commit: boolean): void => {
    if (finished.current) {
      return;
    }
    finished.current = true;
    const value = field.current?.value.trim() ?? "";
    if (commit && value !== initial) {
      onCommit(value === "" ? null : value);
    } else {
      onCancel();
    }
  };
  return (
    <Input
      ref={field}
      defaultValue={initial}
      placeholder={placeholder}
      maxLength={MAX_TAB_NAME_LENGTH}
      aria-label="Session name"
      spellcheck={false}
      className="h-6 text-sm"
      onKeyDown={(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          finish(true);
        } else if (event.key === "Escape") {
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}
