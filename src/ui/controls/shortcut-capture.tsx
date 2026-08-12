/**
 * The one editable element in a Shortcuts row (DL-15.3): a pill showing the
 * action's current chord that becomes a recorder when clicked.
 *
 * Three outcomes from one gesture, so the row needs no second control beyond
 * the reset button DL-6.1 already allows: a chord replaces the binding, bare
 * Backspace/Delete unbinds it, Escape cancels.
 */
import { useEffect, useRef } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { shortcutCaptureActive } from "../../chrome/events";
import { suspendMenuAccelerators } from "../../host/menu-host";
import { bindingOf, type Chord } from "../../lib/keybindings";
import { captureChord, type CaptureRejection } from "../../lib/capture-chord";
import { formatShortcutBinding } from "../../lib/shortcut-label";
import type { DesktopPlatform } from "../../lib/platform";
import type { ActionId } from "../../terminal/action-registry";

/**
 * What a refused keystroke says.
 *
 * Every reason gets its OWN words. `reserved` and `modifier-only` used to
 * share "press keys…", which made pressing Esc or Tab look identical to having
 * pressed nothing at all — the user cannot tell a rule from a dead control.
 */
const REJECTION_HINT: Readonly<Record<CaptureRejection, string>> = {
  "modifier-only": "press keys…",
  reserved: "Esc and Tab are reserved",
  "system-reserved": "reserved by macOS",
  "needs-modifier": "add ⌘, ⌃ or ⌥",
};

const WINDOWS_REJECTION_HINT: Readonly<Record<CaptureRejection, string>> = {
  ...REJECTION_HINT,
  "system-reserved": "reserved by Windows",
  "needs-modifier": "add Ctrl or Alt",
};

export function formatChords(
  chords: readonly Chord[],
  action: ActionId,
  platform: DesktopPlatform,
): string {
  if (chords.length === 0) {
    return "unbound";
  }
  return chords
    .map((chord) => formatShortcutBinding(bindingOf(chord, action), platform))
    .join(" · ");
}

interface ShortcutCaptureProps {
  readonly action: ActionId;
  /** Action name, for the control's accessible label. */
  readonly label: string;
  readonly chords: readonly Chord[];
  readonly platform: DesktopPlatform;
  /** An empty array unbinds; the caller decides how to persist it. */
  readonly onCommit: (chords: readonly Chord[]) => void;
}

export function ShortcutCapture({
  action,
  label,
  chords,
  platform,
  onCommit,
}: ShortcutCaptureProps) {
  const listening = useSignal(false);
  const hint = useSignal<string>("press keys…");
  // Held in a ref so it is NOT an effect dependency. `onCommit` is a fresh
  // closure on every render of the section, and the section re-renders on any
  // settings change — including a `settings:merged` broadcast from a peer
  // window about an unrelated setting. As a dependency it tore the effect down
  // and back up mid-recording, which flipped the gate off and on around a real
  // IPC round trip and wiped the hint the user was reading.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (!listening.value) {
      return;
    }
    // Both halves of the same guard: the flag stops `handleShortcut`
    // (tab-manager.ts) running the action inside the webview, and suspending
    // the accelerators stops Cocoa running it before the webview is reached.
    // Either one left out makes menu-bound chords unrebindable.
    shortcutCaptureActive.value = true;
    void suspendMenuAccelerators(true);

    const stop = (): void => {
      listening.value = false;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const bare =
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      // BARE Tab keeps moving focus — not preventDefault'ed, or this control
      // becomes a keyboard trap with no way out except the mouse. A MODIFIED
      // Tab is a real chord (Windows ships next-tab on Ctrl+Tab) and is
      // recorded like any other.
      if (event.key === "Tab" && bare) {
        stop();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        stop();
        return;
      }
      if (bare && (event.key === "Backspace" || event.key === "Delete")) {
        commitRef.current([]);
        stop();
        return;
      }
      const result = captureChord(event);
      if (!result.ok) {
        // Not an error to report — the user is mid-chord, still holding
        // modifiers down. Say what is missing and keep listening.
        hint.value =
          platform === "windows"
            ? WINDOWS_REJECTION_HINT[result.reason]
            : REJECTION_HINT[result.reason];
        return;
      }
      commitRef.current([result.chord]);
      stop();
    };

    // Capture phase, and on `window`, to match `handleShortcut`'s own
    // registration — a bubble-phase listener would see the event only after
    // xterm's textarea had already taken it.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      shortcutCaptureActive.value = false;
      void suspendMenuAccelerators(false);
    };
  }, [listening.value, action, platform]);

  const text = listening.value
    ? hint.value
    : formatChords(chords, action, platform);

  return (
    <button
      type="button"
      class={`cfg-btn cfg-chord ${listening.value ? "cfg-chord--listening" : ""} ${
        chords.length === 0 ? "cfg-chord--unbound" : ""
      }`}
      aria-label={`${label} shortcut: ${formatChords(chords, action, platform)}`}
      onClick={() => {
        // Reset the hint on the way IN, not in the effect cleanup: doing it on
        // teardown wiped "add ⌘, ⌃ or ⌥" the instant it was shown.
        hint.value = "press keys…";
        listening.value = !listening.value;
      }}
      // Clicking elsewhere, or tabbing away, ends the recording. Without this
      // the flag survives the user losing interest, and every shortcut in the
      // app stays dead until they come back and press Escape.
      onBlur={() => {
        listening.value = false;
      }}
    >
      {text}
    </button>
  );
}
