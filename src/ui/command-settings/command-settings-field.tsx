import type { ComponentProps } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Input } from "../controls/input";

/**
 * What a field's draft was when its row unmounted (an agent row folded), by the key its owner
 * gave it. Memory only, never persisted: it lives from one opening of Settings to the next
 * (`clearFieldDrafts`), so a half-typed command survives folding the row and nothing else.
 */
const drafts = new Map<string, string>();

export function clearFieldDrafts(): void {
  drafts.clear();
}

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
  /** Clearing the field is a valid edit (a launch command, a list of models). */
  readonly allowEmpty?: boolean;
  /** Bumped by an explicit reset: it drops a draft even when the saved value did not change. */
  readonly resetRevision?: number;
  /** Called on every keystroke, so the owner can clear a stale error. */
  readonly onDraft?: () => void;
  /** The last commit was refused: the field reads as invalid until the next edit. */
  readonly invalid?: boolean;
  /** A refused draft stays on screen beside its reason; Escape then restores the saved value. */
  readonly keepRefused?: boolean;
  /** Keep an unsaved draft while this field is unmounted, under this key. */
  readonly draftKey?: string;
}

/**
 * A field that owns its draft, the contract of `commit-input.tsx` on the shared
 * `Input`: Enter and blur commit, and Escape belongs to the draft while there is
 * one. It restores the saved value and stops the event, so the surface holding
 * the field does not also leave; a clean field claims nothing and the key
 * bubbles to the surface's own Escape (`command-settings-keys.ts`).
 */
export function CommitField({
  value,
  onCommit,
  live = false,
  allowEmpty = false,
  resetRevision = 0,
  onDraft,
  invalid,
  keepRefused = false,
  draftKey,
  ...input
}: CommitFieldProps) {
  const [draft, setDraft] = useState(
    () => (draftKey === undefined ? undefined : drafts.get(draftKey)) ?? value,
  );
  const committed = useRef(value);
  const latest = useRef(draft);
  latest.current = draft;
  const lastReset = useRef(resetRevision);

  // Adopt a change made elsewhere (a reset, another window) without touching a draft in progress:
  // our own commits already match `committed`.
  useEffect(() => {
    if (value !== committed.current || resetRevision !== lastReset.current) {
      committed.current = value;
      lastReset.current = resetRevision;
      setDraft(value);
    }
  }, [value, resetRevision]);

  useEffect(
    () => () => {
      if (draftKey === undefined) return;
      if (latest.current !== committed.current) drafts.set(draftKey, latest.current);
      else drafts.delete(draftKey);
    },
    [draftKey],
  );

  const commit = (raw: string): boolean => {
    const next = raw.trim();
    if (next === committed.current) {
      return true;
    }
    if ((next === "" && !allowEmpty) || onCommit(next) === false) {
      return false;
    }
    committed.current = next;
    return true;
  };

  return (
    <Input
      {...input}
      value={draft}
      aria-invalid={invalid || undefined}
      onInput={(event: Event) => {
        const raw = (event.target as HTMLInputElement).value;
        setDraft(raw);
        onDraft?.();
        if (live) {
          commit(raw);
        }
      }}
      onBlur={() => {
        if (!commit(draft) && !keepRefused) {
          setDraft(committed.current);
        }
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          if (!commit(draft) && !keepRefused) {
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
