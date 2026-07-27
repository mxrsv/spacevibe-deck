import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { FONT_FALLBACK, type Settings } from "../settings/settings-schema";
import { applyWebkitImeFix, isWebKitWebView } from "./webkit-ime-fix";
import { installShiftEnterNewline } from "./shift-enter";
import { installImeTrace } from "./ime-trace";
import { resolveTheme } from "../settings/themes";
import type { PaneHeaderInfo } from "../lib/process-info";
import { createLinkProvider } from "./link-provider";
import { createOscLinkHandler } from "./osc-link-handler";
import { paneCwd } from "./pane-cwd";
import { classifyOscNotification } from "../lib/osc-notification";

/** Structured attention signal a pane can emit — never a native notification. */
export interface PaneAttentionSignal {
  kind: "requested";
  source: "osc-notification" | "bell";
}

export interface PaneEvents {
  onData(id: number, data: string): void;
  onResize(id: number, cols: number, rows: number): void;
  onFocus(id: number): void;
  onAttentionSignal?(id: number, signal: PaneAttentionSignal): void;
}

/** Single-line selection snapshot for search probes across NFC/NFD forms. */
export interface SelectionSnapshot {
  readonly col: number;
  readonly row: number;
  readonly length: number;
}

/** A terminal cell (xterm instance) bound to one PTY session by id. */
export interface Pane {
  readonly id: number;
  readonly element: HTMLElement;
  /** Per-pane search addon (Cmd+F); disposed with the terminal. */
  readonly search: SearchAddon;
  /** Call after the element is in the DOM — opens xterm and observes resize. */
  mount(): void;
  write(data: string): void;
  writeln(line: string): void;
  fit(): void;
  /** Drop scrollback and keep only the current prompt line (Cmd+K). */
  clear(): void;
  /** Scroll the viewport by one page; positive = down, negative = up. */
  scrollPage(dir: 1 | -1): void;
  /** Jump to the very top (oldest) or bottom (latest output) of scrollback. */
  scrollToEdge(edge: "top" | "bottom"): void;
  focus(): void;
  applySettings(next: Settings): void;
  /** Update the header bar (dot color, cwd, process badge). */
  setHeaderInfo(info: PaneHeaderInfo): void;
  /**
   * Snapshot the active selection so a failed NFC/NFD search probe can restore
   * it — the search addon clears selection on a miss.
   */
  captureSelection(): SelectionSnapshot | null;
  restoreSelection(snapshot: SelectionSnapshot | null): void;
  dispose(): void;
}

function toFontStack(family: string): string {
  // The user may enter their own fallback list — use it verbatim then
  if (family.includes(",")) {
    return family;
  }
  return `"${family}", ${FONT_FALLBACK}`;
}

export function createPane(
  id: number,
  initial: Settings,
  events: PaneEvents,
): Pane {
  const element = document.createElement("div");
  element.className = "pane";

  const bar = document.createElement("div");
  bar.className = "pane__bar";
  const dot = document.createElement("span");
  dot.className = "pane__dot";
  const cwdEl = document.createElement("span");
  cwdEl.className = "pane__cwd";
  const badge = document.createElement("span");
  badge.className = "pane__badge pane__badge--shell";
  badge.textContent = "shell";
  bar.append(dot, cwdEl, badge);

  // Hover anchor: shown only while the pane bar is hidden (CSS-gated).
  // It is the pane-drag handle and shows the cwd; revealed when the
  // pointer enters the top ~26px of the pane.
  const anchor = document.createElement("div");
  anchor.className = "pane__anchor";
  const anchorGrip = document.createElement("span");
  anchorGrip.className = "pane__anchor-grip";
  anchorGrip.textContent = "⋮⋮";
  const anchorCwd = document.createElement("span");
  anchorCwd.className = "pane__anchor-cwd";
  anchor.append(anchorGrip, anchorCwd);

  const termEl = document.createElement("div");
  termEl.className = "pane__term";
  element.append(bar, anchor, termEl);

  const term = new Terminal({
    // Terminal.unicode is gated behind the proposed-API check in xterm 6 —
    // required for the UnicodeGraphemesAddon below.
    allowProposedApi: true,
    cursorBlink: true,
    // A thin beam rather than xterm's default block. Only the starting style:
    // a program that emits DECSCUSR (`ESC [ n q` — vi mode, some TUIs) still
    // owns the cursor from then on, which is the correct precedence.
    cursorStyle: "bar",
    // Thinnest xterm allows: the option is floored to an integer and anything
    // below 1 throws. On a Retina panel 1 CSS px still paints as 2 device
    // pixels, so this is the hairline floor without patching the renderer.
    cursorWidth: 1,
    fontSize: initial.fontSize,
    fontFamily: toFontStack(initial.fontFamily),
    lineHeight: 1.25,
    scrollback: initial.scrollback,
    // Option must stay a character key on macOS so IMEs (Vietnamese Telex,
    // dead-key accents) can compose — `true` swallows it as Meta.
    macOptionIsMeta: false,
    theme: resolveTheme(initial),
    // OSC 8 hyperlinks otherwise fall back to window.confirm/open, which
    // WKWebView blocks — route through Tauri like the custom link provider.
    linkHandler: createOscLinkHandler(),
    // Search decorations paint match ticks here; width 0 skips the ruler.
    // No showTopBorder/showBottomBorder: `resolveTheme` pins
    // overviewRulerBorder to the background to kill xterm's white separator
    // hairline, so any border enabled here would be invisible too.
    overviewRuler: { width: 14 },
    // Smooth wheel scroll (~125ms) feels less jumpy than the default snap.
    smoothScrollDuration: 125,
    // No minimumContrastRatio on purpose: it rewrites *every* color, so an
    // agent TUI's deliberately dim grays get pulled up to near-white and the
    // information hierarchy flattens (SGR 2 `dim` stops reading as dim), on
    // top of a per-cell contrast computation in the render path. A theme
    // whose ANSI colors are too dark is fixed in `resolveTheme`, not here.
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);

  // ⌘+click opens URLs in the browser and file paths in the editor. This
  // replaces WebLinksAddon: that one underlines and activates on a plain
  // click, which an agent TUI needs for its own mouse handling.
  const linkProvider = term.registerLinkProvider(
    createLinkProvider(term, { getCwd: () => paneCwd(id) }),
  );

  // Structured attention signals only — no native/OS notification here.
  // OSC 9;4 progress payloads classify to null and stay handled by the
  // separate raw-output path in osc-progress.ts.
  const osc9Handler = term.parser.registerOscHandler(9, (payload) => {
    const signal = classifyOscNotification(9, payload);
    if (signal) {
      events.onAttentionSignal?.(id, signal);
    }
    return true;
  });
  const osc777Handler = term.parser.registerOscHandler(777, (payload) => {
    const signal = classifyOscNotification(777, payload);
    if (signal) {
      events.onAttentionSignal?.(id, signal);
    }
    return true;
  });
  const bellHandler = term.onBell(() => {
    events.onAttentionSignal?.(id, { kind: "requested", source: "bell" });
  });

  // xterm core measures cell width with a Unicode 6 table and no grapheme
  // clustering, so Vietnamese combining marks (NFD "ố" = o + ◌̂ + ◌́) are
  // counted as extra columns. Claude Code / Ink measure them as a single
  // column, so the two disagree — the cursor drifts and deleted text leaves
  // ghost cells. The graphemes addon switches xterm to Unicode 15 + grapheme
  // clustering so both sides agree on width.
  term.loadAddon(new UnicodeGraphemesAddon());
  // The addon's activate() already sets this; kept explicit as documentation.
  term.unicode.activeVersion = "15-graphemes";

  term.onData((data) => events.onData(id, data));
  term.onResize(({ cols, rows }) => events.onResize(id, cols, rows));
  // Shift+Enter carries no protocol encoding of its own — bind it to ESC CR so
  // agent CLIs wrap the line instead of submitting. See shift-enter.ts.
  const disposeShiftEnter = installShiftEnterNewline(termEl, (data) =>
    events.onData(id, data),
  );
  element.addEventListener("focusin", () => events.onFocus(id));
  element.addEventListener("mousedown", () => events.onFocus(id));

  const ANCHOR_ZONE_PX = 26;
  element.addEventListener("mousemove", (event) => {
    const top = element.getBoundingClientRect().top;
    element.classList.toggle(
      "is-anchor-zone",
      event.clientY - top < ANCHOR_ZONE_PX,
    );
  });
  element.addEventListener("mouseleave", () => {
    element.classList.remove("is-anchor-zone");
  });

  // The flex-grow transition fires ResizeObserver every frame for ~150ms;
  // debouncing here keeps fit()/resize_pty to one call after the dust
  // settles. Direct fit() calls (mount, show, applySettings) stay immediate.
  const RESIZE_DEBOUNCE_MS = 90;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const observer = new ResizeObserver(() => {
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      fit();
    }, RESIZE_DEBOUNCE_MS);
  });
  let opened = false;

  function mount(): void {
    if (!opened) {
      term.open(termEl);
      if (isWebKitWebView()) {
        applyWebkitImeFix(term);
      }
      // Diagnostic keystroke tap — dev builds only, never in production
      // (it POSTs every keystroke and PTY byte to a local collector).
      if (import.meta.env.DEV) {
        installImeTrace(term);
      }
      observer.observe(termEl);
      opened = true;
    }
    fit();
  }

  function fit(): void {
    try {
      fitAddon.fit();
    } catch {
      // Element not in DOM yet or zero-sized — skip, next fit will succeed
    }
  }

  function write(data: string): void {
    term.write(data);
  }

  function applySettings(next: Settings): void {
    term.options.fontFamily = toFontStack(next.fontFamily);
    term.options.fontSize = next.fontSize;
    term.options.theme = resolveTheme(next);
    term.options.scrollback = next.scrollback;
    fit();
  }

  function setHeaderInfo(info: PaneHeaderInfo): void {
    dot.style.background = info.dotColor;
    cwdEl.textContent = info.cwd;
    anchorCwd.textContent = info.cwd;
    badge.textContent = info.badge;
    badge.className = `pane__badge ${
      info.agent ? "pane__badge--agent" : "pane__badge--shell"
    }`;
  }

  function captureSelection(): SelectionSnapshot | null {
    const pos = term.getSelectionPosition();
    if (pos === undefined) {
      return null;
    }
    // Search matches are single-line; multi-line selections (user drag) are
    // restored as the start row only — enough for the probe's origin.
    if (pos.start.y !== pos.end.y) {
      return {
        col: pos.start.x,
        row: pos.start.y,
        length: Math.max(1, term.cols - pos.start.x),
      };
    }
    return {
      col: pos.start.x,
      row: pos.start.y,
      length: Math.max(0, pos.end.x - pos.start.x),
    };
  }

  function restoreSelection(snapshot: SelectionSnapshot | null): void {
    if (snapshot === null) {
      term.clearSelection();
      return;
    }
    term.select(snapshot.col, snapshot.row, snapshot.length);
  }

  function dispose(): void {
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
    }
    observer.disconnect();
    disposeShiftEnter();
    linkProvider.dispose();
    osc9Handler.dispose();
    osc777Handler.dispose();
    bellHandler.dispose();
    term.dispose();
    element.remove();
  }

  return {
    id,
    element,
    search: searchAddon,
    mount,
    write,
    writeln: (line) => term.writeln(line),
    fit,
    clear: () => term.clear(),
    scrollPage: (dir) => term.scrollPages(dir),
    scrollToEdge: (edge) =>
      edge === "top" ? term.scrollToTop() : term.scrollToBottom(),
    focus: () => term.focus(),
    applySettings,
    setHeaderInfo,
    captureSelection,
    restoreSelection,
    dispose,
  };
}
