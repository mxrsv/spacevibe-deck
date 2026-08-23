import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { trapTab } from "./focus-trap";

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
 *
 * Escape is caught at the DOCUMENT in the capture phase, not on the panel
 * (DL-29.5, amended 2026-08-19). Reading it on the panel meant Escape only
 * worked while focus was still inside the dialog — and one click on the scrim,
 * or a modal that handed focus to a native `<select>` and got it back on the
 * body, was enough to leave the modal on screen with Escape reaching the agent
 * behind it instead. The listener still stops the event dead, so xterm never
 * sees it either way.
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
   * Whether Escape dismisses. Default true.
   *
   * Only a DECISION modal may set it false (DL-29.9): the usage-consent
   * dialog offers two buttons that each persist an answer, and an Escape that
   * closed it would be a third answer the consent model does not have. The
   * document listener still swallows the key either way — a live terminal
   * reading raw keys is one element behind the scrim (DL-29.5).
   */
  dismissOnEscape?: boolean;
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
  dismissOnEscape = true,
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
  /**
   * The newest `onDismiss`, read by the document listener.
   *
   * The listener is installed ONCE (mount deps) so a caller passing a fresh
   * closure every render cannot churn document listeners; the ref is what
   * keeps that one listener from calling a stale one.
   */
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  /** Same one-listener shape as `dismissRef`, for the same churn reason. */
  const escapeRef = useRef(dismissOnEscape);
  escapeRef.current = dismissOnEscape;

  // Escape, wherever focus is. See the note at the top of this file for why
  // this cannot live on the panel.
  useEffect(() => {
    function onDocumentKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") {
        return;
      }
      if (escapeRef.current) {
        dismissRef.current();
      }
      // The terminal is one element away and reads raw keys; an Escape that
      // only closed the modal and then kept travelling would also reach the
      // agent running behind it.
      event.preventDefault();
      event.stopPropagation();
    }
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown, true);
    };
    // Mount only — `dismissRef` carries the current callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // Escape is not here: it is answered at the document (see the top of this
    // file), so it closes the modal from anywhere rather than only from
    // inside the panel.
    // Keep Tab inside the panel (DL-29, and what `aria-modal="true"`
    // promises). Without it the first Shift+Tab walks out of the dialog into
    // the stage strip and lands in xterm's textarea — the modal stays on
    // screen while every keystroke goes to the agent running behind it.
    //
    // The selector and the wrap live in `focus-trap.ts` since 2026-08-19,
    // shared with the Settings screen. They were two copies before that, and
    // the copies had already diverged — this one counted a roving
    // `tabindex="-1"` control as a tab stop, which no modal mounts today and
    // the next one would have inherited in silence. The panel passes ITSELF as
    // the fallback: it carries `tabIndex={0}` so a modal driven by bare keys
    // has somewhere to hold focus when it contains no stop of its own.
    if (event.key === "Tab") {
      trapTab(event, panelRef.current, panelRef.current);
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
