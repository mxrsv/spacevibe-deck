/**
 * The relay's only log line. The vocabulary is closed and the one payload is a number (a count or
 * a close/HTTP status), so no code path can put a token, a frame, a push body or an address into
 * the logs (spec MOB7).
 */
export type LogEvent =
  | "registered"
  | "expired"
  | "revoked"
  | "claimed"
  | "auth"
  | "close"
  | "bad-message"
  | "ignored-message"
  | "forwarded"
  | "dropped-no-peer"
  | "push-sent"
  | "push-skipped"
  | "push-failed"
  | "push-unregistered"
  | "push-no-token"
  | "push-rate-limited"
  | "socket-error";

export function logEvent(event: LogEvent, n = 1): void {
  console.log(JSON.stringify({ event, n }));
}
