import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import { WebglAddon } from "@xterm/addon-webgl";
import { FONT_FALLBACK, type Settings } from "../settings/settings-schema";
import { applyWebkitImeFix, isWebKitWebView } from "./webkit-ime-fix";
import { installShiftEnterNewline } from "./shift-enter";
import { resolveTheme } from "../settings/themes";
import type { PaneHeaderInfo } from "../lib/process-info";
import { createLinkProvider } from "./link-provider";
import { createOscLinkHandler } from "./osc-link-handler";
import { paneCwd } from "./pane-cwd";
import { classifyOscNotification } from "../lib/osc-notification";
import { copyTerminalSelection, pasteIntoTerminal } from "./terminal-clipboard";
import { getDesktopEnvironment } from "../lib/platform";
import { createCodexWheelHandler } from "./codex-wheel";

/** Structured attention signal a pane can emit — never a native notification. */
export interface PaneAttentionSignal {
  kind: "requested";
  source: "osc-notification" | "bell";
}

export interface PaneEvents {
  /** Resolves true only when this exact input write reaches the PTY. */
  onData(id: number, data: string): Promise<boolean>;
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
  /**
   * Resolves once xterm's parser has consumed everything written so far.
   * Built on xterm's own `write(data, callback)` drain callback — a pane
   * transfer serializes the buffer only after this settles, otherwise the
   * snapshot can miss bytes that were received but not yet parsed
   * (spec §7.4).
   */
  flush(): Promise<void>;
  /**
   * The buffer as a re-writable escape-sequence string, newest `lines` rows
   * of scrollback plus the viewport. Empty string when serialization fails —
   * losing history is never worth losing the session (spec §13).
   */
  serializeScrollback(lines: number): string;
  /**
   * Current terminal geometry in cells — travels with the pane across a move
   * (spec §10.2) and is what the destination constructs its terminal at, so
   * nothing has to resize while the route is `Transferring`.
   */
  readonly cols: number;
  readonly rows: number;
  writeln(line: string): void;
  fit(): void;
  /** Drop scrollback and keep only the current prompt line (Cmd+K). */
  clear(): void;
  /** Copy the current selection to the system clipboard (Ctrl+Shift+C). */
  copySelection(): void;
  /** Whether the terminal currently holds a selection. */
  hasSelection(): boolean;
  /**
   * Drop the selection. Separate from `copySelection` because only
   * `copy-or-interrupt` clears — a plain copy keeps the highlight
   * (docs/specs/2026-08-20-performable-keybindings-design.md D3).
   */
  clearSelection(): void;
  /** Paste the clipboard through xterm's bracketed-paste path (Ctrl+Shift+V). */
  paste(): void;
  /**
   * Paste arbitrary text through the same bracketed-paste path as the
   * clipboard (`\n → \r`, DECSET 2004) — the only route that lands a
   * multi-line body in an agent TUI's composer as one block instead of
   * line by line. Writing the bytes to the PTY directly skips both.
   */
  pasteText(text: string): Promise<boolean>;
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
  geometry?: { readonly cols: number; readonly rows: number },
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
  // It is the pane-drag handle and nothing else — the grip glyph is the whole
  // control. It used to print the cwd beside it, which made the pill grow with
  // the path and read as a label rather than a handle. Revealed when the
  // pointer enters the top ~26px of the pane.
  const anchor = document.createElement("div");
  anchor.className = "pane__anchor";
  anchor.setAttribute("aria-label", "Drag pane");
  const anchorGrip = document.createElement("span");
  anchorGrip.className = "pane__anchor-grip";
  anchorGrip.textContent = "⋮⋮";
  anchor.append(anchorGrip);

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
    // Stays 1.25 on purpose. Flush rows are NOT what joins OpenCode's block
    // and box-drawing glyphs — the WebGL renderer draws those to the full cell
    // box, and `device.cell.height` already folds this multiplier in, so the
    // leading grows with them rather than slicing them apart.
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
    //
    // A pane built for an adoption starts at the source's capture geometry, so
    // nothing has to resize while the route is still `Transferring`.
    ...(geometry ? { cols: geometry.cols, rows: geometry.rows } : {}),
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  const searchAddon = new SearchAddon();
  term.loadAddon(searchAddon);
  const serializeAddon = new SerializeAddon();
  term.loadAddon(serializeAddon);

  let activeAgent: string | null = null;
  let capturePasteWrite: ((write: Promise<boolean>) => void) | null = null;

  function forwardData(data: string): Promise<boolean> {
    const write = events.onData(id, data);
    capturePasteWrite?.(write);
    capturePasteWrite = null;
    return write;
  }

  term.attachCustomWheelEventHandler(
    createCodexWheelHandler({
      platform: getDesktopEnvironment().platform,
      isCodex: () => activeAgent === "codex",
      isAlternateBuffer: () => term.buffer.active.type === "alternate",
      send: (data) => void forwardData(data),
    }),
  );

  // Primary-modifier+click opens URLs in the browser and file paths in the
  // editor. This replaces WebLinksAddon: that one underlines and activates on
  // a plain click, which an agent TUI needs for its own mouse handling.
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

  term.onData((data) => void forwardData(data));
  term.onResize(({ cols, rows }) => events.onResize(id, cols, rows));
  // Shift+Enter carries no protocol encoding of its own — bind it to ESC CR so
  // agent CLIs wrap the line instead of submitting. See shift-enter.ts.
  const disposeShiftEnter = installShiftEnterNewline(termEl, (data) => {
    void forwardData(data);
  });
  element.addEventListener("focusin", () => events.onFocus(id));
  element.addEventListener("mousedown", () => events.onFocus(id));

  const ANCHOR_ZONE_PX = 26;
  element.addEventListener("mousemove", (event) => {
    const top = element.getBoundingClientRect().top;
    // The pill stands at y=12 and is taller than the zone that reveals it, so
    // its own lower half sits OUTSIDE that zone: aiming for the grip used to
    // remove the class and hide the pill from under the pointer. Standing on
    // the anchor holds it open — this is the hysteresis the zone alone lacks.
    const inZone = event.clientY - top < ANCHOR_ZONE_PX || anchor.contains(event.target as Node);
    element.classList.toggle("is-anchor-zone", inZone);
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
  let webglAddon: WebglAddon | undefined;

  function retireWebglAddon(addon: WebglAddon): boolean {
    if (webglAddon !== addon) {
      return false;
    }
    webglAddon = undefined;
    addon.dispose();
    return true;
  }

  function activateWebglRenderer(): void {
    let addon: WebglAddon | undefined;
    try {
      addon = new WebglAddon();
      const pending = addon;
      webglAddon = pending;
      pending.onContextLoss(() => {
        if (!retireWebglAddon(pending)) {
          return;
        }
        console.warn("WebGL terminal renderer context lost; falling back to DOM.");
      });
      term.loadAddon(pending);
    } catch (error) {
      if (addon === undefined || retireWebglAddon(addon)) {
        console.warn("WebGL terminal renderer initialization failed; falling back to DOM:", error);
      }
    }
  }

  function mount(): void {
    if (!opened) {
      term.open(termEl);
      if (isWebKitWebView()) {
        applyWebkitImeFix(term);
      }
      observer.observe(termEl);
      opened = true;
      // Last, and only now: WebGL activation needs the element created by
      // `open()`. Failure leaves xterm's DOM renderer active for this pane.
      activateWebglRenderer();
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

  function flush(): Promise<void> {
    // The empty write is deliberate: xterm queues the callback behind
    // everything already in the parser queue, so this resolves on the next
    // drain even when nothing is pending. Verified empirically on 2026-08-10
    // against @xterm/xterm@6.0.0 under jsdom — `write("", cb)` fires on an
    // idle terminal, and after a pending `write("abc", cb)` it fires SECOND.
    return new Promise((resolve) => {
      term.write("", () => resolve());
    });
  }

  function serializeScrollback(lines: number): string {
    try {
      return serializeAddon.serialize({ scrollback: lines });
    } catch (err) {
      console.warn("Failed to serialize pane scrollback:", err);
      return "";
    }
  }

  function applySettings(next: Settings): void {
    term.options.fontFamily = toFontStack(next.fontFamily);
    term.options.fontSize = next.fontSize;
    term.options.theme = resolveTheme(next);
    term.options.scrollback = next.scrollback;
    fit();
  }

  function setHeaderInfo(info: PaneHeaderInfo): void {
    activeAgent = info.agent ? info.badge : null;
    dot.style.background = info.dotColor;
    cwdEl.textContent = info.cwd;
    badge.textContent = info.badge;
    badge.className = `pane__badge ${info.agent ? "pane__badge--agent" : "pane__badge--shell"}`;
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
    serializeAddon.dispose();
    // Explicit like `serializeAddon` above, though `term.dispose()` would also
    // reach it: this one holds a GPU context, so it is released on the line
    // that decides to, not as a side effect further down.
    webglAddon?.dispose();
    webglAddon = undefined;
    term.dispose();
    element.remove();
  }

  return {
    id,
    element,
    search: searchAddon,
    mount,
    write,
    flush,
    serializeScrollback,
    // Getters, never captured values: a pane that resized after construction
    // must report what the user last saw, not what it was born with.
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    writeln: (line) => term.writeln(line),
    fit,
    clear: () => term.clear(),
    copySelection() {
      copyTerminalSelection(term);
    },
    hasSelection: () => term.hasSelection(),
    clearSelection: () => term.clearSelection(),
    paste() {
      pasteIntoTerminal(term);
    },
    pasteText(text) {
      let capturedWrite: Promise<boolean> | null = null;
      capturePasteWrite = (write) => {
        capturedWrite = write;
      };
      try {
        // xterm's public paste path synchronously emits one prepared/bracketed
        // onData frame. If it emits nothing, fail closed and never auto-submit.
        term.paste(text);
      } finally {
        capturePasteWrite = null;
      }
      return capturedWrite ?? Promise.resolve(false);
    },
    scrollPage: (dir) => term.scrollPages(dir),
    scrollToEdge: (edge) => (edge === "top" ? term.scrollToTop() : term.scrollToBottom()),
    focus: () => term.focus(),
    applySettings,
    setHeaderInfo,
    captureSelection,
    restoreSelection,
    dispose,
  };
}
