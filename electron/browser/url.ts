/**
 * What the browser panel's address bar is allowed to load.
 *
 * The panel points at a dev server the user is already running, so the input
 * is almost always `localhost:5173` — a string that is not a URL and that
 * `new URL()` parses as the `localhost:` scheme with `5173` as its path. Every
 * other guess (bare host, no scheme, a real URL) has to resolve the same way
 * or the address bar silently loads the wrong thing.
 *
 * Only `http:` and `https:` survive. `file:` is excluded with the rest: the
 * panel injects a script into whatever it loads, and a `file:` document is the
 * user's own disk. `javascript:` and `data:` are the ones that matter for
 * safety — a pasted `javascript:` URL would run in the panel's page context.
 */

/** Schemes the panel will load. Everything else is rejected outright. */
const ALLOWED = new Set(["http:", "https:"]);

/**
 * `localhost`, `127.x`, `::1`, `*.localhost` and `*.local` — the hosts a dev
 * server actually listens on. They get `http:` when the user typed no scheme,
 * because none of them serves TLS by default and defaulting to `https:` puts a
 * certificate error in front of the common case.
 */
function isLocalHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    bare === "localhost" ||
    bare === "::1" ||
    bare === "0.0.0.0" ||
    bare.endsWith(".localhost") ||
    bare.endsWith(".local") ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)
  );
}

/** Split `host:port` (or a bracketed IPv6 literal) off the front of an input. */
function hostOf(input: string): string {
  const authority = input.split(/[/?#]/, 1)[0] ?? "";
  if (authority.startsWith("[")) {
    return authority.slice(0, authority.indexOf("]") + 1);
  }
  return authority.split(":")[0] ?? "";
}

/**
 * Turn address-bar text into a URL to load, or `null` when it is not one.
 *
 * Returning `null` rather than falling back to a web search is deliberate:
 * this panel exists to look at a local dev server, and quietly sending a typo
 * to a search engine would send the user's text off the machine.
 */
export function normalizeBrowserUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }

  // A scheme-relative URL (`//example.com`) has no scheme to inspect, so it is
  // resolved as https before the parse below rather than after it.
  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      return null;
    }
    // `localhost:5173` parses as a URL whose scheme is `localhost:`. It is not
    // a scheme anyone types on purpose, and treating it as one is exactly the
    // failure this function exists to prevent.
    if (!ALLOWED.has(parsed.protocol)) {
      return schemeless(candidate);
    }
    return parsed.href;
  }

  return schemeless(candidate);
}

/** Add the scheme a schemeless input implies, then re-parse it properly. */
function schemeless(input: string): string | null {
  const host = hostOf(input);
  // Rejects "some sentence", "./relative" and "" — anything with no host to
  // put in front of a scheme.
  if (host === "" || /[\s]/.test(host)) {
    return null;
  }
  const hasDot = host.includes(".");
  const local = isLocalHost(host);
  if (!hasDot && !local) {
    return null;
  }
  const scheme = local ? "http://" : "https://";
  try {
    const parsed = new URL(`${scheme}${input}`);
    return ALLOWED.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Whether a URL the page itself navigated to may stay in the panel.
 *
 * `will-navigate` is the browser's own navigations, not the address bar's, so
 * the check is narrower on purpose: it only keeps the panel on schemes the
 * injector can work with. A blocked navigation is handed to the OS browser
 * instead of being dropped, which is what the host does with it.
 */
export function isLoadableUrl(url: string): boolean {
  try {
    return ALLOWED.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** Host and port, for the panel's compact title. `""` when unparseable. */
export function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
