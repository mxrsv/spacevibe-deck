import type { ComponentChildren } from "preact";
import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { deriveChromeColors } from "../../../lib/derive-colors";
import type { Theme } from "../../../settings/theme-schema";
import { CANONICAL_THEME_IDS, getTheme, type ThemeMode } from "../../../settings/themes";
import { toFontStack } from "../../../terminal/pane";
import { settings, type ColorMode, type CursorStyle, type DemoSettings } from "./model";
import "./live-preview.css";

/*
 * The shared read-only preview for Appearance and Terminal: a miniature Deck
 * window drawn from the REAL canonical theme of the chosen mode (never a PTY).
 *
 * Its chrome comes from that theme's own tokens and washes, not from the
 * frame's `--tokens` — a token resolves to whatever mode the gallery frame is
 * running, which is exactly what the preview must be free to differ from while
 * the user is choosing between Light, Dark and Match system (same reasoning as
 * `ThemeCardPreview`, DL-24.3). Sizes are container-relative (`cqw`) so the
 * drawing scales with the column it sits in, down to the 480px frame.
 */

const DARK_QUERY = "(prefers-color-scheme: dark)";

const SPACES = ["deck", "api", "bench"] as const;
const CURSOR_LABEL: Readonly<Record<CursorStyle, string>> = {
  bar: "Bar",
  block: "Block",
  underline: "Underline",
};

function readSystemMode(): ThemeMode {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
    ? "dark"
    : "light";
}

/** The OS light/dark preference, live — what "Match system" resolves to. */
export function useSystemMode(): ThemeMode {
  const mode = useSignal<ThemeMode>(readSystemMode());
  /* oxlint-disable react-hooks/exhaustive-deps -- mount-only listener; a signal ref is stable */
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const sync = (): void => {
      mode.value = query.matches ? "dark" : "light";
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */
  return mode.value;
}

export function resolveMode(colorMode: ColorMode, system: ThemeMode): ThemeMode {
  return colorMode === "system" ? system : colorMode;
}

/** Every colour and type value the stylesheet reads, as custom properties on the root. */
function previewVars(theme: Theme, current: DemoSettings): Record<string, string> {
  const { terminal, ui } = theme;
  const chrome = deriveChromeColors(theme);
  return {
    "--srd-p-bg": terminal.background,
    "--srd-p-fg": terminal.foreground,
    "--srd-p-cursor": terminal.cursor,
    "--srd-p-selection": terminal.selectionBackground,
    "--srd-p-cwd": terminal.cyan,
    "--srd-p-branch": terminal.magenta,
    "--srd-p-prompt": terminal.blue,
    "--srd-p-ok": terminal.green,
    "--srd-p-sidebar": ui["sidebar-bg"],
    "--srd-p-seam": chrome.sidebarSeam,
    "--srd-p-chrome1": ui["chrome-1"],
    "--srd-p-chrome2": ui["chrome-2"],
    "--srd-p-active": chrome.tabActiveBg,
    "--srd-p-hair": chrome.hair,
    "--srd-p-hair-strong": chrome.hairStrong,
    "--srd-p-text": ui["text-primary"],
    "--srd-p-muted": ui["text-muted"],
    "--srd-p-faint": ui["text-faint"],
    "--srd-font": toFontStack(current.fontFamily),
    "--srd-fs": String(current.fontSize),
    "--srd-lh": String(current.lineHeight),
  };
}

function Cursor({ shape, blink }: { readonly shape: CursorStyle; readonly blink: boolean }) {
  return <span class={`srd-preview__cursor is-${shape} ${blink ? "is-blinking" : ""}`} />;
}

interface FocusedSampleProps {
  readonly cursor: CursorStyle;
  readonly blink: boolean;
  /** Terminal page: older lines above, and the last result shown selected. */
  readonly detailed: boolean;
}

function FocusedSample({ cursor, blink, detailed }: FocusedSampleProps) {
  return (
    <>
      {detailed && (
        <>
          <div class="srd-preview__line is-dim">$ git status</div>
          <div class="srd-preview__line is-dim">nothing to commit</div>
        </>
      )}
      <div class="srd-preview__line">
        <span class="is-cwd">~/spacevibe-deck</span>
        {"  "}
        <span class="is-branch">main</span>
      </div>
      <div class="srd-preview__line">$ claude</div>
      <div class="srd-preview__line">
        <span class="is-prompt">❯</span> Refine the settings experience
      </div>
      <div class="srd-preview__line is-dim">Reading the workspace…</div>
      <div class="srd-preview__line is-ok">
        ✓ Found{" "}
        {detailed ? <span class="srd-preview__select">8 setting pages</span> : "8 setting pages"}
      </div>
      <div class="srd-preview__line">
        $ <Cursor shape={cursor} blink={blink} />
      </div>
    </>
  );
}

function SideSample() {
  return (
    <>
      <div class="srd-preview__line">
        <span class="is-cwd">~/spacevibe-api</span>
        {"  "}
        <span class="is-branch">main</span>
      </div>
      <div class="srd-preview__line">$ npm run dev</div>
      <div class="srd-preview__line is-dim">Listening on :3000</div>
    </>
  );
}

interface PaneProps {
  readonly focused: boolean;
  /** Pane bar text; undefined = no bar. */
  readonly bar?: string;
  /** Floats over the pane (the Copied chip). */
  readonly badge?: ComponentChildren;
  readonly children: ComponentChildren;
}

function Pane({ focused, bar, badge, children }: PaneProps) {
  return (
    <div class={`srd-preview__pane ${focused ? "is-focused" : "is-idle"}`}>
      {bar !== undefined && <div class="srd-preview__panebar">{bar}</div>}
      <div class="srd-preview__term">{children}</div>
      {badge}
    </div>
  );
}

function WorkspaceView({ current }: { readonly current: DemoSettings }) {
  return (
    <>
      <div class="srd-preview__titlebar">
        <i />
        <i />
        <i />
      </div>
      <div class={`srd-preview__body is-${current.tabBarPosition}`}>
        <nav key={current.tabBarPosition} class="srd-preview__tabs">
          {SPACES.map((name, index) => (
            <span key={name} class={index === 0 ? "is-active" : ""}>
              {name}
            </span>
          ))}
        </nav>
        <div class={`srd-preview__stage ${current.focusExpand ? "is-expanded" : ""}`}>
          <Pane focused bar={current.showPaneBar ? "claude · spacevibe-deck" : undefined}>
            <FocusedSample
              cursor={current.cursorStyle}
              blink={current.cursorBlink}
              detailed={false}
            />
          </Pane>
          <Pane focused={false} bar={current.showPaneBar ? "zsh · spacevibe-api" : undefined}>
            <SideSample />
          </Pane>
        </div>
      </div>
      {current.showStatusBar && <div class="srd-preview__status">main · ~/spacevibe-deck</div>}
    </>
  );
}

function TerminalView({ current }: { readonly current: DemoSettings }) {
  const copied = (
    <span class={`srd-preview__copied ${current.copyOnSelect ? "is-on" : ""}`}>Copied</span>
  );
  return (
    <Pane focused badge={copied}>
      <FocusedSample cursor={current.cursorStyle} blink={current.cursorBlink} detailed />
    </Pane>
  );
}

function captionFor(focus: "appearance" | "terminal", current: DemoSettings): string {
  return focus === "terminal"
    ? `${CURSOR_LABEL[current.cursorStyle]} cursor · ${current.cursorBlink ? "blinking" : "steady"}`
    : `${current.fontFamily} · ${current.fontSize}px · ${current.lineHeight.toFixed(2)}`;
}

export function LivePreview({ focus }: { readonly focus: "appearance" | "terminal" }) {
  const current = settings.value;
  const system = useSystemMode();
  const mode = resolveMode(current.colorMode, system);
  const theme = getTheme(CANONICAL_THEME_IDS[mode]);
  const solo = focus === "terminal";

  return (
    <figure
      class={`srd-preview ${solo ? "is-solo" : ""}`}
      aria-label="Live preview"
      style={previewVars(theme, current)}
    >
      <div class="srd-preview__window" aria-hidden="true">
        {solo ? <TerminalView current={current} /> : <WorkspaceView current={current} />}
      </div>
      <figcaption class="srd-preview__caption">{captionFor(focus, current)}</figcaption>
    </figure>
  );
}
