import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/**
 * The one modal shell (DL §29). Every surface that covers the stage on
 * `.modal-scrim` mounts through here — `AgentQuickPicker`, `SavePresetDialog`
 * and `PresetEditor` — so the scrim, the focus grab, the dialog role and the
 * two ways out (Escape, a click on the scrim) cannot drift apart between
 * three hand-rolled copies. Before this component each of the three built its
 * own wrapper and none of them dismissed on a scrim click at all.
 *
 * Deliberately NOT a genre for the full-window screens (`OpenBoard`,
 * `SettingsScreen` — DL §11) or the anchored popovers (DL §13): those are
 * different surfaces with their own rules, and folding them in here would
 * make the shell mean nothing.
 *
 * The panel keeps its own class so the stylesheet is untouched: this owns
 * behaviour and the frame, each modal still owns its own size and body.
 */

export interface ModalProps {
  /** The panel's own class — `.preset-editor`, `.save-preset`, and so on. */
  panelClass: string;
  /** Accessible name for the dialog. */
  label: string;
  /** Escape, and a scrim click unless `dismissOnScrim` is false. */
  onDismiss(): void;
  /**
   * Whether a click on the scrim dismisses. Default true.
   *
   * `PresetEditor` sets it false: it holds an unsaved draft (a split tree and
   * a name), so a slipped click must not be able to throw that away. Escape
   * and its own Cancel button stay the ways out.
   */
  dismissOnScrim?: boolean;
  /**
   * Selector, resolved inside the panel, for what takes focus on mount. The
   * panel itself when omitted — which is what a modal driven by bare keys
   * (digits, arrows) wants.
   */
  initialFocus?: string;
  /** Every key except Escape, which this component answers itself. */
  onKeyDown?(event: KeyboardEvent): void;
  children: ComponentChildren;
}

export function Modal({
  panelClass,
  label,
  onDismiss,
  dismissOnScrim = true,
  initialFocus,
  onKeyDown,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * Whether the press that a click completes STARTED on the scrim.
   *
   * Dismissal cannot read the click alone: a drag that begins inside the
   * panel — dragging a preset divider, sweeping a text selection out of an
   * input — releases outside it, and the browser fires `click` on the nearest
   * common ancestor, which is the scrim. Tracking the press is what keeps
   * that gesture from closing the modal the user was working in.
   */
  const pressedOnScrim = useRef(false);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const requested =
      initialFocus === undefined
        ? null
        : panel.querySelector<HTMLElement>(initialFocus);
    (requested ?? panel).focus();
    // Mount only: a modal's focus is claimed once, and re-running this on a
    // prop change would yank focus back out of whatever the user moved to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScrimPointerDown(event: PointerEvent): void {
    pressedOnScrim.current = event.target === event.currentTarget;
  }

  function handleScrimClick(event: MouseEvent): void {
    const onScrim =
      pressedOnScrim.current && event.target === event.currentTarget;
    pressedOnScrim.current = false;
    if (dismissOnScrim && onScrim) {
      onDismiss();
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      onDismiss();
      // The terminal is one element away and reads raw keys; an Escape that
      // only closed the modal and then kept travelling would also reach the
      // agent running behind it.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onKeyDown?.(event);
  }

  return (
    <div
      class="modal-scrim"
      onPointerDown={handleScrimPointerDown}
      onClick={handleScrimClick}
    >
      <div
        class={panelClass}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        ref={panelRef}
      >
        {children}
      </div>
    </div>
  );
}
