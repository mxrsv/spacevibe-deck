import type { DesktopPlatform } from "./platform";

export const FEEDBACK_URL = "https://deck.spacevibe.dev/feedback";

/** The App-menu action id; handled by `app.tsx`'s `menu:action` listener. */
export const SEND_FEEDBACK_ACTION = "send-feedback";

/**
 * The feedback page, told which build is asking.
 *
 * The form's details field asks for the OS and Deck version; the page reads
 * `v` and `os` to fill that line in, so a report from the app arrives with it.
 * Either param is left off when unknown — a blank version (no host, or not
 * loaded yet) or an `unsupported` platform would only put noise in the report.
 */
export function feedbackUrl(version: string, platform: DesktopPlatform): string {
  const url = new URL(FEEDBACK_URL);
  if (version !== "") {
    url.searchParams.set("v", version);
  }
  if (platform !== "unsupported") {
    url.searchParams.set("os", platform);
  }
  return url.href;
}
