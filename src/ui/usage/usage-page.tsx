import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef } from "preact/hooks";
import { DeckIcon, GLYPH_ROW } from "../controls/deck-icon";
import { UsageBody } from "./usage-body";

interface UsagePageProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * The usage details page: a surface laid over the stage's content area, the
 * rail and the stage strip left uncovered (spec R2, approach A). It is the
 * document surface's sibling, not Settings': panes underneath are never
 * unmounted or resized, and the page holds no lifecycle of its own — whoever
 * mounts it owns the poll, exactly as `UsageBody` already requires.
 *
 * Two keyboard contracts, both borrowed from `SettingsScreen`:
 *
 * - **Escape belongs to the innermost owner.** A terminal keeps its own Escape
 *   (the `.xterm` guard); only an Escape nothing claimed closes the page, and
 *   it blurs the focused control first so a draft commits instead of dropping.
 * - **Focus enters on open**, on Back, so that Escape reaches this listener
 *   instead of the terminal that had focus.
 *
 * Tab is deliberately NOT trapped: the rail stays live beside the page, and a
 * trap would make the one surface the user can still see unreachable.
 */
export function UsagePage({ open, onClose }: UsagePageProps) {
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      backRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target;
      if (target instanceof Element && target.closest(".xterm")) {
        return;
      }
      if (target instanceof HTMLElement) {
        target.blur();
      }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <section class={`usage-screen ${open ? "is-open" : ""}`} aria-label="Usage" aria-hidden={!open}>
      <div class="usage-screen__card">
        <header class="usage-screen__head">
          <button
            ref={backRef}
            type="button"
            class="usage-screen__back"
            title="Back (Esc)"
            onClick={onClose}
          >
            <DeckIcon icon={ArrowLeft01Icon} size={GLYPH_ROW} />
            Back
          </button>
          <h2 class="usage-screen__title">Usage</h2>
          <span class="usage-screen__scope">This machine · history still on disk</span>
        </header>
        <UsageBody variant="screen" />
      </div>
    </section>
  );
}
