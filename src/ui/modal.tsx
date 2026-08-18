import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

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

/**
 * Everything inside the panel a Tab can land on, in document order.
 *
 * The panel itself is excluded: it carries `tabIndex={0}` so a modal driven by
 * bare keys has somewhere to put focus, but it is a container, not a stop the
 * cycle should keep returning to.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keep Tab inside the panel (DL-29, and what `aria-modal="true"` promises).
 *
 * Without this the first Shift+Tab walks out of the dialog into the stage
 * strip and lands in xterm's textarea — the modal stays on screen while every
 * keystroke goes to the agent running behind it, and Escape reaches the pty
 * instead of the dialog.
 */
function trapTab(event: KeyboardEvent, panel: HTMLElement | null): void {
  if (panel === null) {
    return;
  }
  const stops = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  if (stops.length === 0) {
    // Nothing to cycle through: hold focus on the panel rather than let Tab
    // escape into the app behind the scrim.
    event.preventDefault();
    panel.focus();
    return;
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  const active = document.activeElement;
  const inside = active instanceof Node && panel.contains(active);
  if (event.shiftKey && (!inside || active === first || active === panel)) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && (!inside || active === last)) {
    event.preventDefault();
    first.focus();
  }
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
  /**
   * Whether the pointer was RELEASED on the scrim too.
   *
   * The press alone is not enough in the other direction: a sweep that starts
   * on the scrim and ends inside the panel also fires `click` on the scrim,
   * so reading the press by itself threw away a half-typed preset name.
   * Dismissal needs both ends of the gesture outside the panel.
   */
  const releasedOnScrim = useRef(false);
  /** What had focus when this modal opened, so closing can give it back. */
  const focusOnOpen = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) {
      return;
    }
    const previous = document.activeElement;
    focusOnOpen.current = previous instanceof HTMLElement ? previous : null;
    const requested =
      initialFocus === undefined ? null : panel.querySelector<HTMLElement>(initialFocus);
    (requested ?? panel).focus();
    return () => {
      const target = focusOnOpen.current;
      focusOnOpen.current = null;
      // Only when this modal still owns focus, or focus has already fallen to
      // nothing. A modal that opened a tab hands focus to the new pane, and
      // restoring unconditionally would yank it straight back out.
      const active = document.activeElement;
      const ours = active === null || active === document.body || panel.contains(active);
      if (target !== null && target.isConnected && ours) {
        target.focus();
      }
    };
    // Mount only: a modal's focus is claimed once, and re-running this on a
    // prop change would yank focus back out of whatever the user moved to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScrimPointerDown(event: PointerEvent): void {
    pressedOnScrim.current = event.target === event.currentTarget;
  }

  function handleScrimPointerUp(event: PointerEvent): void {
    releasedOnScrim.current = event.target === event.currentTarget;
  }

  function handleScrimClick(event: MouseEvent): void {
    const onScrim =
      pressedOnScrim.current && releasedOnScrim.current && event.target === event.currentTarget;
    pressedOnScrim.current = false;
    releasedOnScrim.current = false;
    if (dismissOnScrim && onScrim) {
      onDismiss();
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      onDismiss();
      // The terminal is one element away and reads raw keys; an Escape that
      // only closed the modal and then kept travelling would also reach the
      // agent running behind it.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Tab') {
      trapTab(event, panelRef.current);
      return;
    }
    onKeyDown?.(event);
  }

  return (
    <div
      class="modal-scrim"
      onPointerDown={handleScrimPointerDown}
      onPointerUp={handleScrimPointerUp}
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
