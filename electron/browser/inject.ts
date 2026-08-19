/**
 * The script Deck runs inside the page loaded in the browser panel.
 *
 * This module is a pure string builder so the interesting half — the order of
 * operations — can be asserted without a page. Three things about that order
 * are load-bearing:
 *
 *  1. `__REACT_GRAB_DISABLED__` is set BEFORE the vendored bundle runs. The
 *     bundle self-initialises on load unless that flag is up, and a self-init
 *     takes its default options: telemetry ON (a request to react-grab.com on
 *     every page load) and no `getContent` hook, so a grab would go to the
 *     clipboard and nowhere else. Deck ships "no accounts, no telemetry", so
 *     the flag is the difference between honouring that and not.
 *  2. The script runs in the page's MAIN world, not the preload's isolated
 *     world. React stores its fiber as an expando (`__reactFiber$…`) on the DOM
 *     node, and expandos are per-world — from an isolated world every element
 *     looks like plain HTML with no component and no source location, which is
 *     the entire feature. `executeJavaScript` is main-world; the preload is
 *     not, which is why the two halves talk over a DOM event instead.
 *  3. The result is handed back through `getContent`, not by watching the
 *     clipboard. `getContent` replaces what react-grab copies, so returning the
 *     same string keeps ⌘C working exactly as upstream does while giving Deck
 *     the text directly — no clipboard polling, no race with the user's own
 *     copy.
 */

/** DOM event the main world uses to hand a grab to the preload. */
export const GRAB_EVENT = "deck:browser-grab";

/** Global the bootstrap installs for the host to drive inspect mode. */
export const PAGE_API = "__deckGrab";

/**
 * Cap on the text one grab may produce, in characters.
 *
 * A grab is pasted into a terminal, and a deep component stack on a large page
 * can run long. 16k is far above any real selection (the format is a few lines
 * per element) and far below a size that would flood a PTY.
 */
export const MAX_GRAB_CHARS = 16_000;

export interface InjectionOptions {
  /**
   * How many source-location lines a grab may carry (react-grab's
   * `maxContextLines`). Upstream defaults to 3, which on a wrapped component
   * often names the wrapper instead of the surface the user clicked; 6 keeps
   * the paste short while reaching past one or two layers of wrappers.
   */
  readonly maxContextLines?: number;
}

const DEFAULT_MAX_CONTEXT_LINES = 6;

/**
 * Build the full injection: the vendored bundle plus Deck's bootstrap.
 *
 * `vendorSource` is `electron/vendor/react-grab/index.global.js` read from
 * disk. It is spliced in as source rather than loaded with a `<script src>`
 * because a script tag is subject to the page's own Content-Security-Policy,
 * and a dev server that sets one would block it with nothing to see but a
 * console message in someone else's console.
 */
export function buildInjection(vendorSource: string, options: InjectionOptions = {}): string {
  const maxLines = options.maxContextLines ?? DEFAULT_MAX_CONTEXT_LINES;
  const config = JSON.stringify({
    event: GRAB_EVENT,
    api: PAGE_API,
    maxLines,
    maxChars: MAX_GRAB_CHARS,
  });

  // Not wrapped in a function: the vendored bundle's first statement is
  // `this.globalThis = this.globalThis || {}`, and inside a function `this` is
  // no longer the window. A plain block keeps `this` as the global object
  // while still scoping the guard.
  return `
if (!window.${PAGE_API}) {
  window.__REACT_GRAB_DISABLED__ = true;
${vendorSource}
  (function () {
    var config = ${config};
    var mod = globalThis.__REACT_GRAB_MODULE__;
    if (!mod || typeof mod.init !== "function") {
      return "deck-grab:missing";
    }

    function send(text, count) {
      try {
        window.dispatchEvent(
          new CustomEvent(config.event, {
            detail: JSON.stringify({
              text: String(text).slice(0, config.maxChars),
              url: location.href,
              title: document.title,
              count: count,
            }),
          }),
        );
      } catch (err) {
        console.warn("[deck] could not hand the grab to the host:", err);
      }
    }

    // What a grab falls back to when the rich path does not answer: the
    // element's own markup, trimmed. Worse than a component stack, and far
    // better than an empty clipboard and a paste that never arrives.
    function plainMarkup(list) {
      return list
        .map(function (element) {
          var html = (element && element.outerHTML) || "";
          return html.length > 400 ? html.slice(0, 400) + "…" : html;
        })
        .filter(Boolean)
        .join("\\n");
    }

    // The content of the grab in flight, held between \`getContent\` and the
    // copy hooks below, and consumed exactly once.
    //
    // Sending from inside \`getContent\` was wrong: the bundle races that hook
    // against its own abort signal (\`e.signal\`) and DISCARDS the result when
    // the user cancels — changes selection, leaves inspect mode — but the hook
    // itself is called with one argument and never learns about it. So a copy
    // the user abandoned still reached the terminal. The copy hooks fire after
    // that decision, which is the only place that knows it happened.
    var inFlight = null;

    function flush(elements, ok) {
      if (inFlight === null) {
        return;
      }
      var grab = inFlight;
      inFlight = null;
      // \`ok === false\` means the CLIPBOARD write failed, not that the user
      // cancelled — a cancel never reaches these hooks at all. Delivering to
      // the pane is the point of the feature, so it still goes.
      void ok;
      send(grab.text, (elements && elements.length) || grab.count);
    }

    // Replaces what react-grab copies. Returning the same string it would have
    // produced is what keeps the clipboard behaving exactly as upstream.
    //
    // The deadline is not defensive decoration. \`generateSnippet\` is async and
    // does its work through the page's own scheduling, so a frame Chromium has
    // throttled (an occluded or backgrounded view) can leave it unsettled —
    // observed in the smoke environment, where the call never returned. This
    // hook sits between the user's ⌘C and BOTH destinations, so an unsettled
    // promise means no paste and no clipboard, with nothing on screen to say
    // why. Falling back keeps the gesture honest.
    function getContent(elements) {
      var list = Array.isArray(elements) ? elements : [elements];
      var timer = null;
      var rich = Promise.resolve(
        mod.generateSnippet(list, { maxLines: config.maxLines }),
      ).then(function (snippets) {
        return (Array.isArray(snippets) ? snippets : [snippets]).join("\\n");
      });
      var deadline = new Promise(function (resolve) {
        timer = setTimeout(function () {
          resolve(plainMarkup(list));
        }, 2000);
      });
      return Promise.race([rich, deadline])
        .catch(function () {
          return plainMarkup(list);
        })
        .then(function (text) {
          if (timer !== null) {
            clearTimeout(timer);
          }
          var body = text || plainMarkup(list);
          inFlight = { text: body, count: list.length };
          return body;
        });
    }

    // A page that ships react-grab itself already has a live instance with its
    // own toolbar. Initialising a second one would paint two overlays over the
    // same element, so Deck takes over the existing instance's content hook
    // instead. \`getContent\` is settable; \`telemetry\` is not, which is why the
    // disable flag above matters even here — it stops OUR copy from init'ing.
    var existing =
      typeof mod.getGlobalApi === "function" ? mod.getGlobalApi() : null;
    var api = existing;
    if (api && typeof api.setOptions === "function") {
      api.setOptions({ getContent: getContent, maxContextLines: config.maxLines });
    } else {
      api = mod.init({
        telemetry: false,
        maxContextLines: config.maxLines,
        getContent: getContent,
      });
      // The bundle's own self-init does this, and disabling it above means
      // nothing else will. Without it \`window.__REACT_GRAB__\` stays undefined:
      // react-grab's documented handle is missing, a page's own integration
      // cannot find the instance, and a second injection would fail to adopt
      // the live one instead of building a second overlay over the same
      // elements. Proven by the smoke run, which asserted the global and found
      // it undefined while everything else looked healthy.
      if (typeof mod.setGlobalApi === "function") {
        mod.setGlobalApi(api);
      }
    }

    // The hooks that decide a grab actually happened. Registered as a plugin
    // because \`init\` takes options, not hooks.
    if (api && typeof mod.registerPlugin === "function") {
      mod.registerPlugin({
        name: "deck-bridge",
        hooks: {
          onCopySuccess: function (elements, content) {
            if (content && inFlight !== null) {
              inFlight.text = content;
            }
            flush(elements, true);
          },
          onAfterCopy: function (elements, success) {
            // Fires for both outcomes; \`flush\` is a no-op once onCopySuccess
            // has consumed the grab, so a successful copy sends exactly once.
            flush(elements, success);
          },
          onCopyError: function () {
            inFlight = null;
          },
        },
      });
    }

    window[config.api] = {
      activate: function () {
        if (api && typeof api.activate === "function") api.activate();
      },
      deactivate: function () {
        if (api && typeof api.deactivate === "function") api.deactivate();
      },
      isActive: function () {
        return !!(api && typeof api.isActive === "function" && api.isActive());
      },
      adopted: !!existing,
    };
    return "deck-grab:ready";
  })();
} else {
  "deck-grab:present";
}
`;
}

/** Source for `window.__deckGrab.activate()` / `.deactivate()`. */
export function inspectCall(active: boolean): string {
  const method = active ? "activate" : "deactivate";
  return `(window.${PAGE_API} ? (window.${PAGE_API}.${method}(), true) : false)`;
}

export interface GrabPayload {
  readonly text: string;
  readonly url: string;
  readonly title: string;
  readonly count: number;
}

/**
 * Parse what the page sent.
 *
 * The page is untrusted — anything loaded in the panel can dispatch the same
 * DOM event with any payload it likes. That text ends up pasted into a
 * terminal, so it is treated as data at every step: parsed defensively here,
 * length-capped, and (in the renderer) never submitted with a newline of its
 * own. `null` means "not a grab", and the host drops it.
 */
export function parseGrabPayload(raw: unknown): GrabPayload | null {
  if (typeof raw !== "string" || raw.length > MAX_GRAB_CHARS * 2) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  if (text.trim() === "") {
    return null;
  }
  return {
    text: text.slice(0, MAX_GRAB_CHARS),
    url: typeof record.url === "string" ? record.url.slice(0, 2048) : "",
    title: typeof record.title === "string" ? record.title.slice(0, 512) : "",
    count:
      typeof record.count === "number" && Number.isFinite(record.count)
        ? Math.max(1, Math.min(99, Math.trunc(record.count)))
        : 1,
  };
}
