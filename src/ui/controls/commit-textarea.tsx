import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Ceiling before the field scrolls instead of growing (DL-13.5). */
const MAX_HEIGHT_PX = 220;

interface CommitTextareaProps {
  /** The committed value from the store. */
  value: string;
  placeholder: string;
  ariaLabel: string;
  /**
   * Called with the draft on blur or ⌘/Ctrl+Enter — never per keystroke, and
   * never trimmed: a prompt body's own whitespace is content. The caller
   * validates and may refuse; refusing leaves the draft in place so nothing
   * the user typed is lost.
   */
  onCommit: (value: string) => void;
  /** Focus on mount — the click that revealed it landed on the row, not here. */
  autoFocus?: boolean;
}

/**
 * Multi-line sibling of `CommitInput` (DL-6.3, DL-13.5). Same reason for
 * existing: a store-controlled `value={…}` field inside a surface that never
 * unmounts is a data-loss trap, because any app re-render rewrites the DOM
 * value out from under whatever is being typed.
 *
 * Enter is deliberately NOT a commit — it inserts a newline, which is the
 * whole point of a multi-line body. ⌘/Ctrl+Enter commits, Escape reverts.
 */
export function CommitTextarea({
  value,
  placeholder,
  ariaLabel,
  onCommit,
  autoFocus = false,
}: CommitTextareaProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // Adopt changes made elsewhere (restore defaults, another edit) without
  // clobbering a draft still being typed.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  // Grow with the content up to the ceiling, then scroll. Layout effect, not
  // a rAF loop: one synchronous measure per change (DL-1.3).
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (field === null) {
      return;
    }
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [draft]);

  const commit = (): void => {
    if (draft === committed.current) {
      return;
    }
    onCommit(draft);
  };

  return (
    <textarea
      ref={fieldRef}
      class="text-input prompt-textarea"
      rows={3}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autofocus={autoFocus}
      value={draft}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setDraft(committed.current);
        }
      }}
    />
  );
}
