/**
 * The browser panel's chrome: address bar, navigation, Inspect, and the hole
 * the host's native view is positioned over.
 *
 * `.browser-panel__view` is that hole — an empty element that never paints
 * anything. It exists to be measured: the web content is a `WebContentsView`
 * stacked on the window by the host, which has no way to know where this
 * column ended up. Every path that can move or resize it therefore ends in
 * `report()`.
 *
 * Styling follows DESIGN-LANGUAGE §17 (docked side panels): a real grid column
 * with a hairline seam, chrome-2 surface, and the same `iconbtn` the tab bar
 * uses so the panel's buttons are the app's buttons.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import {
  ArrowLeft,
  ArrowRight,
  MousePointerClick,
  RotateCw,
  X,
} from "lucide-preact";
import { CHROME_ICON, DeckIcon } from "../ui/controls/deck-icon";
import { shortcutLabel } from "../lib/shortcut-label";
import { getDesktopEnvironment } from "../lib/platform";
import { clampBrowserWidth } from "../settings/settings-schema";
import {
  defaultBrowserClient,
  type BrowserClient,
} from "./browser-client";
import { browserNotice, browserState, browserWidthLive } from "./browser-store";

interface BrowserPanelProps {
  /** Live width — the drag value while resizing, the setting otherwise. */
  readonly width: number;
  /** Committed at the end of a drag, not during it — one settings write. */
  readonly onWidthChange: (width: number) => void;
  readonly onClose: () => void;
  /** Hidden while a DOM overlay covers the stage; see `App`. */
  readonly hidden: boolean;
  readonly client?: BrowserClient;
}

export function BrowserPanel({
  width,
  onWidthChange,
  onClose,
  hidden,
  client = defaultBrowserClient,
}: BrowserPanelProps) {
  const viewRef = useRef<HTMLDivElement>(null);
  /**
   * Every host call here can legitimately reject — the panel may have closed,
   * or the window may be mid-teardown, and `labelOf` throws for a window the
   * host no longer knows. These are buttons, so the failure is visible as
   * "nothing happened"; what must not happen is an unhandled rejection from a
   * click.
   */
  const fire = (call: Promise<unknown>): void => {
    void call.catch((error: unknown) => {
      console.warn("Deck: the browser panel refused a command:", error);
    });
  };
  const state = browserState.value;
  const notice = browserNotice.value;
  const [draft, setDraft] = useState<string | null>(null);

  /** Hand the host the rectangle this column occupies right now. */
  const report = useCallback(() => {
    const element = viewRef.current;
    if (element === null) {
      return;
    }
    const rect = element.getBoundingClientRect();
    void client
      .setBounds({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      })
      .catch(() => {
        // The panel may have closed between the measurement and the call.
      });
  }, [client]);

  useLayoutEffect(() => {
    report();
  }, [report, width, hidden]);

  useEffect(() => {
    const element = viewRef.current;
    if (element === null) {
      return;
    }
    // The element's own size covers the common cases; `window.resize` covers
    // the ones that move it without resizing it — a maximise, a display change,
    // the status bar appearing.
    const observer = new ResizeObserver(() => report());
    observer.observe(element);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [report]);

  useEffect(() => {
    // `fire` is intentionally absent from the deps: it is rebuilt on every
    // render and holds no state, so depending on it would re-run this effect
    // for no reason.
    fire(client.setVisible(!hidden));
  }, [client, hidden]);

  const submitUrl = (event: Event): void => {
    event.preventDefault();
    const value = draft ?? state.url;
    fire(
      client.navigate(value).then((loaded) => {
        if (loaded === null) {
          // The typed text is kept: the address bar is the only place the user
          // can fix it, and clearing it back to the loaded URL would make them
          // retype the part that was right.
          browserNotice.value = "That is not an address Deck can open.";
          return;
        }
        browserNotice.value = null;
        setDraft(null);
      }),
    );
  };

  const startResize = (event: PointerEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent): void => {
      // The handle is on the panel's LEFT edge, so dragging left widens it.
      browserWidthLive.value = clampBrowserWidth(
        startWidth + (startX - moveEvent.clientX),
      );
    };
    const end = (): void => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      const dragged = browserWidthLive.value;
      // Cleared BEFORE the commit: the settings write is async, and leaving
      // the live value up until it lands makes the column jump back to the old
      // width for a frame if the write is slow.
      browserWidthLive.value = null;
      if (dragged !== null) {
        onWidthChange(dragged);
      }
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const inspectChord = shortcutLabel("toggle-browser");
  // react-grab's own copy gesture, which Deck does not own and cannot rebind —
  // but it is still a chord, and DL-17.7 keeps chord spelling out of literals
  // because ⌘ is not a key a Windows user has.
  const copyChord =
    getDesktopEnvironment().platform === "macos" ? "⌘C" : "Ctrl+C";

  return (
    <aside class="browser-panel" aria-label="Browser">
      <div
        class="browser-panel__grip"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the browser panel"
      />
      <div class="browser-panel__bar">
        <button
          type="button"
          class="iconbtn"
          disabled={!state.canGoBack}
          title="Back"
          aria-label="Go back"
          onClick={() => fire(client.back())}
        >
          <DeckIcon icon={ArrowLeft} size={CHROME_ICON} />
        </button>
        <button
          type="button"
          class="iconbtn"
          disabled={!state.canGoForward}
          title="Forward"
          aria-label="Go forward"
          onClick={() => fire(client.forward())}
        >
          <DeckIcon icon={ArrowRight} size={CHROME_ICON} />
        </button>
        <button
          type="button"
          class="iconbtn"
          title="Reload"
          aria-label="Reload the page"
          onClick={() => fire(client.reload())}
        >
          <DeckIcon icon={RotateCw} size={CHROME_ICON} />
        </button>
        <form class="browser-panel__form" onSubmit={submitUrl}>
          <input
            class="browser-panel__url"
            type="text"
            spellcheck={false}
            autocomplete="off"
            autocorrect="off"
            placeholder="localhost:5173"
            aria-label="Address"
            value={draft ?? state.url}
            onInput={(event) => setDraft(event.currentTarget.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(null);
                event.currentTarget.blur();
              }
            }}
          />
        </form>
        <button
          type="button"
          class={`iconbtn ${state.inspect ? "is-active" : ""}`}
          title={`Inspect element — hover, then ${copyChord} (${inspectChord} toggles the panel)`}
          aria-label="Inspect element"
          aria-pressed={state.inspect}
          onClick={() => fire(client.setInspect(!state.inspect))}
        >
          <DeckIcon icon={MousePointerClick} size={CHROME_ICON} />
        </button>
        <button
          type="button"
          class="iconbtn"
          title="Close the browser panel"
          aria-label="Close the browser panel"
          onClick={onClose}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </div>
      {state.error !== null ? (
        <p class="browser-panel__note browser-panel__note--error" role="status">
          {state.error}
        </p>
      ) : notice !== null ? (
        <p class="browser-panel__note" role="status">
          {notice}
        </p>
      ) : null}
      {/* Measured, never painted — the host's native view covers it. */}
      <div class="browser-panel__view" ref={viewRef} />
    </aside>
  );
}
