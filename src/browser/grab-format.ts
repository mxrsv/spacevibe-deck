/**
 * Turning a grab into the text that reaches a terminal.
 *
 * This is the one place untrusted bytes cross into a PTY, so it is deliberately
 * a pure function with its own tests rather than a line inside the panel.
 *
 * The page the panel loaded is not Deck's, and it can dispatch the grab event
 * itself with any payload it likes. Two things follow:
 *
 *  - **Control characters are stripped.** A paste rides xterm's bracketed-paste
 *    path (`ESC[200~ … ESC[201~`), and text containing `ESC[201~` would close
 *    the bracket early and leave the rest of itself being interpreted as
 *    keystrokes by the agent's TUI. Stripping every C0 control except tab and
 *    newline removes that, and with it every other escape sequence a page could
 *    aim at the terminal — OSC 52 clipboard writes, cursor manipulation, title
 *    setting.
 *  - **Nothing here appends a newline.** Submitting is the caller's decision
 *    and Deck never makes it for a grab (see `browser-store.ts`).
 */

/** Hard ceiling on what one grab may paste. The host caps at the same figure. */
export const MAX_GRAB_CHARS = 16_000;

export interface GrabLike {
  readonly text: string;
  readonly url: string;
  readonly count: number;
}

/**
 * Remove everything a terminal would read as an instruction.
 *
 * Tab and newline survive because they are content: the snippet is indented
 * HTML across several lines. Everything else in C0, plus DEL, goes.
 */
export function sanitizeGrabText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Every C0 control except tab (\u0009) and newline (\u000A), plus DEL.
      // Written as code points, never as literal characters: an invisible ESC
      // inside a character class is precisely the thing a reviewer cannot see.
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd()
  );
}

/**
 * The paste body: the element context react-grab produced, plus the page it
 * came from.
 *
 * The URL is worth the extra line. The snippet names a source file, but a
 * component renders on some route with some state, and "which page was this"
 * is the first thing an agent otherwise has to ask.
 */
export function formatGrab(grab: GrabLike): string | null {
  const body = sanitizeGrabText(grab.text);
  if (body === "") {
    return null;
  }
  const url = sanitizeGrabText(grab.url).split("\n")[0]?.trim() ?? "";
  const withSource = url === "" ? body : `${body}\n\nPage: ${url}`;
  return withSource.slice(0, MAX_GRAB_CHARS);
}

/** Status line under the address bar after a grab lands. */
export function grabSummary(count: number, outcome: "pasted" | "clipboard" | "failed"): string {
  const what = count > 1 ? `${count} elements` : "Element";
  if (outcome === "pasted") {
    return `${what} sent to the focused pane`;
  }
  if (outcome === "clipboard") {
    return `${what} copied — no pane to paste into`;
  }
  return `${what} could not be pasted`;
}
