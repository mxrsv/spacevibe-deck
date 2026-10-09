import { BODY_MAX } from "./feedback-api.js";

/**
 * The "which build" line Deck's own Send Feedback link asks for.
 *
 * The app opens `/feedback?v=2.7.0&os=macos`; the details field asks for the OS
 * and Deck version, so the page writes that line in for the user. Both params
 * are untrusted URL input: anything off the strict shapes below drops the
 * prefill entirely rather than echoing a stranger's text into a public report.
 */
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?$/;
const OS_NAMES = new Map([
  ["macos", "macOS"],
  ["windows", "Windows"],
]);
const CONTEXT_LINE = /^Deck \S+ · (?:macOS|Windows)$/m;

/** @returns {string | null} e.g. "Deck 2.7.0 · macOS" */
export function appContextLine(params) {
  const version = params.get("v") ?? "";
  const os = OS_NAMES.get(params.get("os") ?? "");

  return VERSION.test(version) && os ? `Deck ${version} · ${os}` : null;
}

/**
 * The body with the context line in it: an earlier line (a restored draft, a
 * second visit after an upgrade) is replaced, never stacked. An empty body
 * keeps room above the line for the user's own words. A body the line would
 * push past the limit comes back unchanged.
 */
export function withAppContext(body, line) {
  const next = CONTEXT_LINE.test(body)
    ? body.replace(CONTEXT_LINE, line)
    : body.trim() === ""
      ? `\n\n${line}`
      : `${body.trimEnd()}\n\n${line}`;

  return next.length > BODY_MAX ? body : next;
}
