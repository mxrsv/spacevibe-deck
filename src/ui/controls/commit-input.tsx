import { useEffect, useRef, useState } from "preact/hooks";

interface CommitInputProps {
  /** The committed value from the store. */
  value: string;
  placeholder: string;
  ariaLabel: string;
  /** Called with the trimmed draft on blur or Enter — never per keystroke. */
  onCommit: (value: string) => void;
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
}: CommitInputProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  // Adopt changes made elsewhere (e.g. restore defaults) without clobbering a
  // draft the user is still typing — our own commits already match `committed`.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  const commit = (): void => {
    const next = draft.trim();
    if (next === "" || next === committed.current) {
      return;
    }
    committed.current = next;
    onCommit(next);
  };

  return (
    <input
      type="text"
      class="text-input text-input--small"
      placeholder={placeholder}
      aria-label={ariaLabel}
      autofocus={autoFocus}
      value={draft}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}
