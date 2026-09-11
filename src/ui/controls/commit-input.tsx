import { useEffect, useRef, useState } from "preact/hooks";

interface CommitInputProps {
  /** The committed value from the store. */
  value: string;
  placeholder: string;
  ariaLabel: string;
  /** Called with the trimmed draft on blur or Enter — never per keystroke. */
  onCommit: (value: string) => boolean | void;
  /** Opt in when clearing the field is a valid edit. False preserves legacy callers. */
  allowEmpty?: boolean;
  invalid?: boolean;
  describedBy?: string;
  spellcheck?: boolean;
  onDraftChange?: () => void;
  /** An explicit reset also discards a draft when the saved value did not change. */
  resetRevision?: number;
  /**
   * Focus on mount. For a field that only exists while editing (DL-12.5): the
   * click that revealed it landed on the pill, not on the input, so without
   * this the user has to click twice.
   */
  autoFocus?: boolean;
}

/**
 * Text field that owns the in-progress draft locally.
 *
 * A store-controlled `value={...}` input inside this panel is a data-loss trap:
 * the panel never unmounts, so ANY app re-render (closing the panel, switching
 * tab, a signal update) makes Preact rewrite the DOM value back to the stored
 * one — wiping what the user was typing before `change` ever fires. Keeping the
 * draft in local state and committing on blur/Enter closes that hole.
 */
export function CommitInput({
  value,
  placeholder,
  ariaLabel,
  onCommit,
  autoFocus = false,
  allowEmpty = false,
  invalid,
  describedBy,
  spellcheck,
  onDraftChange,
  resetRevision = 0,
}: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const committed = useRef(value);
  const lastReset = useRef(resetRevision);

  // Adopt changes made elsewhere (e.g. restore defaults) without clobbering a
  // draft the user is still typing — our own commits already match `committed`.
  useEffect(() => {
    if (value !== committed.current || resetRevision !== lastReset.current) {
      committed.current = value;
      lastReset.current = resetRevision;
      draftRef.current = value;
      setDraft(value);
    }
  }, [value, resetRevision]);

  const commit = (): void => {
    const next = draftRef.current.trim();
    if ((!allowEmpty && next === "") || next === committed.current) {
      return;
    }
    // A rejected edit stays a draft; Escape must still restore the last accepted value.
    if (onCommit(next) === false) return;
    committed.current = next;
    draftRef.current = next;
    setDraft(next);
  };

  return (
    <input
      type="text"
      class="text-input text-input--small"
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      spellcheck={spellcheck}
      autofocus={autoFocus}
      value={draft}
      onInput={(event) => {
        draftRef.current = event.currentTarget.value;
        setDraft(event.currentTarget.value);
        onDraftChange?.();
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          return;
        }
        // Escape belongs to the draft while there IS one. It restores the
        // saved value and goes no further, so the surface holding this field
        // (Settings) does not also close on the same press — losing the edit
        // and the screen to one key was the failure the design spec named.
        // A clean field claims nothing: the event bubbles and Escape means
        // what it means everywhere else.
        if (event.key === "Escape" && draftRef.current !== committed.current) {
          event.preventDefault();
          event.stopPropagation();
          draftRef.current = committed.current;
          setDraft(committed.current);
          onDraftChange?.();
        }
      }}
    />
  );
}
