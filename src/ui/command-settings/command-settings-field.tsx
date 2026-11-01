import type { ComponentProps } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Input } from "../controls/input";

type FieldProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "onInput" | "onBlur" | "onKeyDown" | "aria-invalid"
>;

interface CommitFieldProps extends FieldProps {
  /** The saved value. */
  readonly value: string;
  /** Receives the trimmed draft; `false` refuses it and the field shows the saved value again. */
  readonly onCommit: (value: string) => boolean | void;
  /** Commit every accepted keystroke too (a number), not only on blur and Enter (an address). */
  readonly live?: boolean;
}

/**
 * A field that owns its draft, the contract of `commit-input.tsx` on the shared
 * `Input`: Enter and blur commit, and Escape belongs to the draft while there is
 * one. It restores the saved value and stops the event, so the surface holding
 * the field does not also leave; a clean field claims nothing and the key
 * bubbles to the surface's own Escape (`command-settings-keys.ts`).
 */
export function CommitField({ value, onCommit, live = false, ...input }: CommitFieldProps) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  // Adopt a change made elsewhere (a reset, another window) without touching a draft in progress:
  // our own commits already match `committed`.
  useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  const commit = (raw: string): boolean => {
    const next = raw.trim();
    if (next === committed.current) {
      return true;
    }
    if (next === "" || onCommit(next) === false) {
      return false;
    }
    committed.current = next;
    return true;
  };

  return (
    <Input
      {...input}
      value={draft}
      onInput={(event: Event) => {
        const raw = (event.target as HTMLInputElement).value;
        setDraft(raw);
        if (live) {
          commit(raw);
        }
      }}
      onBlur={() => {
        if (!commit(draft)) {
          setDraft(committed.current);
        }
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (!commit(draft)) {
            setDraft(committed.current);
          }
        } else if (event.key === "Escape" && draft !== committed.current) {
          event.preventDefault();
          event.stopPropagation();
          setDraft(committed.current);
        }
      }}
    />
  );
}
