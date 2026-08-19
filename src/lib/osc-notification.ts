/**
 * OSC notification classifier — pure, no xterm dependency (xterm wiring is
 * Task 7). Given the OSC identifier and raw payload xterm's OSC handler
 * already split out, classify into a semantic "requested" signal or reject.
 *
 * Two producer forms are recognized:
 *
 *   OSC 9 general notification:  ESC ] 9 ; <text> (BEL | ESC \)
 *   OSC 777 notify form:         ESC ] 777 ; notify ; <title> [; <body>] (BEL | ESC \)
 *
 * OSC 9 is shared with OSC 9;4 progress reports (payload like "4", "4;1",
 * "4;2;50") — those are handled by the separate raw-output path in
 * osc-progress.ts and MUST be rejected here.
 *
 * Privacy: the returned signal never carries the payload's title/body text —
 * only `kind` and `source`, so callers can't accidentally leak notification
 * content into UI/OS surfaces via this classifier's result.
 */

/** OSC 9;4 progress reports piggyback on OSC 9 and start with "4" followed
 * by either end-of-payload or a ";" separator (state[, progress]). */
const PROGRESS_PAYLOAD = /^4(;|$)/;

export interface OscNotificationSignal {
  kind: "requested";
  source: "osc-notification";
}

const REQUESTED: OscNotificationSignal = {
  kind: "requested",
  source: "osc-notification",
};

function classifyOsc9(payload: string): OscNotificationSignal | null {
  if (payload.trim() === "") return null;
  if (PROGRESS_PAYLOAD.test(payload)) return null;
  return REQUESTED;
}

function classifyOsc777(payload: string): OscNotificationSignal | null {
  if (payload.trim() === "") return null;

  const segments = payload.split(";");
  const [form, title] = segments;
  if (form !== "notify") return null;
  if (title === undefined || title.trim() === "") return null;

  return REQUESTED;
}

/**
 * Classify an OSC identifier + raw payload into a notification-requested
 * signal, or `null` when it's not a recognized notification form (including
 * OSC 9;4 progress, which is handled elsewhere).
 */
export function classifyOscNotification(
  oscId: number,
  payload: string,
): OscNotificationSignal | null {
  if (oscId === 9) return classifyOsc9(payload);
  if (oscId === 777) return classifyOsc777(payload);
  return null;
}
