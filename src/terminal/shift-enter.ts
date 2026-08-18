/**
 * Shift+Enter → a literal newline inside an agent CLI prompt.
 *
 * The classic terminal encoding has no room for a modifier on Enter: xterm.js
 * maps keyCode 13 to `CR`, and only Alt adds a prefix (`ESC CR`). Shift is
 * dropped, so Shift+Enter reaches the PTY as a plain `CR` and the agent
 * submits instead of wrapping the line.
 *
 * Every terminal that "supports" Shift+Enter therefore does it as a key
 * binding rather than a protocol feature — iTerm2, VS Code and Ghostty all
 * send `ESC CR`, which is exactly what `claude /terminal-setup` configures for
 * them. This module is Deck's equivalent of that binding.
 *
 * It listens on the pane's terminal element in the capture phase because
 * xterm's own keydown handler sits on the helper textarea *inside* that
 * element: capturing on the ancestor is the only ordering that reliably wins,
 * and `attachCustomKeyEventHandler` is a single slot already taken by the
 * WebKit IME workaround (see webkit-ime-fix.ts).
 */

/** ESC + CR — read as "insert a newline" by Claude Code and other agent CLIs. */
export const NEWLINE_SEQUENCE = '\x1b\r';

/**
 * True for a bare Shift+Enter headed for the PTY.
 *
 * ⌘⇧Enter is excluded on purpose: `action-registry.ts` binds it to
 * toggle-zoom-pane. A composing IME owns Enter (it commits the candidate), so
 * that case is left alone too.
 */
export function isShiftEnter(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.isComposing
  );
}

/**
 * Bind Shift+Enter on `host` to `send(NEWLINE_SEQUENCE)`; returns the
 * disposer, which the pane calls on teardown.
 */
export function installShiftEnterNewline(
  host: HTMLElement,
  send: (data: string) => void,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isShiftEnter(event)) {
      return;
    }
    // Both are required: preventDefault keeps the textarea from inserting its
    // own newline, stopPropagation keeps xterm from also emitting `CR`.
    event.preventDefault();
    event.stopPropagation();
    send(NEWLINE_SEQUENCE);
  };
  host.addEventListener('keydown', onKeyDown, true);
  return () => host.removeEventListener('keydown', onKeyDown, true);
}
