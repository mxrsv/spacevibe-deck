import type { RefObject } from "preact";
import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { CaretLeft, Check } from "@phosphor-icons/react";
import { applyThemeVars } from "../../../lib/theme-vars";
import { CANONICAL_THEME_IDS, getTheme, type ThemeMode } from "../../../settings/themes";
import { DeckIcon, ROW_ICON } from "../../../ui/controls/deck-icon";
import { LoadError } from "../../../ui/controls/load-error";
import {
  FRAME_WIDTHS,
  activePage,
  focusTarget,
  frameSize,
  loadMode,
  pageInfo,
  registryEntry,
  remoteNotice,
  retrySave,
  saveStatus,
  settings,
} from "./model";
import { PAGE_COMPONENTS } from "./pages";
import { PANEL_ID, SettingsRail } from "./shell-rail";

/*
 * The Settings frame: the real full-window screen, contained in the gallery.
 * Layout follows `settings-screen.tsx` (header, rail, one scrolling section);
 * the frame also owns its own theme so light/dark can be shown inside the
 * dark gallery.
 */

const DARK_QUERY = "(prefers-color-scheme: dark)";
const LOAD_ERROR_MESSAGE =
  "Couldn't load settings. Changes are temporary until Deck can read settings.json.";
/** Longer than the row's own 1.4s flash, so clearing the target never cuts it short. */
const TARGET_LINGER_MS = 2000;

// ── theme ──────────────────────────────────────────────────────────────────

function readSystemDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** `system` follows the OS; light and dark are the two canonical themes. */
function useResolvedMode(): ThemeMode {
  const systemDark = useSignal(readSystemDark());
  /* oxlint-disable react-hooks/exhaustive-deps -- mount-only listener; a signal ref is stable */
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => {
      systemDark.value = event.matches;
    };
    systemDark.value = query.matches;
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  /* oxlint-enable react-hooks/exhaustive-deps */
  // Computed, so the frame re-renders when the resolved mode flips — not on
  // every edit that replaces `settings.value`.
  const mode = useComputed<ThemeMode>(() => {
    const chosen = settings.value.colorMode;
    if (chosen === "system") return systemDark.value ? "dark" : "light";
    return chosen;
  });
  return mode.value;
}

/**
 * Publishes the theme on the frame element, not `:root`. `applyThemeVars` sets
 * every derived chrome token (`--chrome-*`, `--hair`, `--text-*`) itself, so the
 * frame recomputes from its own `--bg/--fg`; only `--tab-rest-bg` is derived in
 * CSS at `:root` and is re-declared on `.srd-frame`.
 */
export function useFrameTheme(frameRef: RefObject<HTMLElement>): void {
  const mode = useResolvedMode();
  /* oxlint-disable react-hooks/exhaustive-deps -- keyed on the resolved mode; the ref is stable */
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (frame === null) return;
    applyThemeVars(frame.style, getTheme(CANONICAL_THEME_IDS[mode]));
    frame.style.setProperty("color-scheme", mode);
  }, [mode]);
  /* oxlint-enable react-hooks/exhaustive-deps */
}

// ── header ─────────────────────────────────────────────────────────────────

/** Quiet when idle; one line for whatever the settings file is doing. */
export function HeaderStatus() {
  const status = saveStatus.value;
  const loading = loadMode.value === "loading";
  return (
    <div class="srd-save" role="status" aria-live="polite">
      {loading && <span>Loading settings…</span>}
      {!loading && status.kind === "saving" && <span>Saving…</span>}
      {!loading && status.kind === "saved" && (
        <span class="srd-save__ok">
          <DeckIcon icon={Check} size={ROW_ICON} />
          Saved
        </span>
      )}
      {!loading && status.kind === "error" && (
        <>
          <span class="srd-save__error">Couldn't save</span>
          <button type="button" class="cfg-btn" onClick={retrySave}>
            Try again
          </button>
        </>
      )}
      {!loading && status.kind === "temporary" && (
        <span
          class="srd-save__warn"
          title="Deck could not read settings.json, so nothing is written to disk"
        >
          Changes are temporary
        </span>
      )}
    </div>
  );
}

function FrameHeader() {
  return (
    <header class="srd-head">
      {/* Inert in the prototype; the real Back closes Settings. */}
      <button type="button" class="settings-screen__back" title="Back to Deck (Esc)">
        <DeckIcon icon={CaretLeft} size={ROW_ICON} />
        Back
      </button>
      <div class="srd-remote" role="status" aria-live="polite">
        {remoteNotice.value}
      </div>
      <HeaderStatus />
    </header>
  );
}

// ── frame ──────────────────────────────────────────────────────────────────

/** A search jump leaves its target set; drop it once the flash is over so
 * re-entering the page later does not scroll and flash again. */
function useClearStaleTarget(): void {
  const nonce = focusTarget.value?.nonce;
  useEffect(() => {
    if (nonce === undefined) return;
    const timer = setTimeout(() => {
      if (focusTarget.peek()?.nonce === nonce) focusTarget.value = null;
    }, TARGET_LINGER_MS);
    return () => clearTimeout(timer);
  }, [nonce]);
}

/** A page change opens at the top, unless a search jump is about to scroll to a row on it. */
function useScrollToTopOnPage(scrollRef: RefObject<HTMLElement>, page: string): void {
  /* oxlint-disable react-hooks/exhaustive-deps -- keyed on the page; the ref is stable */
  useEffect(() => {
    const target = focusTarget.peek();
    const jumping =
      target !== null &&
      registryEntry(target.key).page === page &&
      Date.now() - target.nonce < 1000;
    if (!jumping && scrollRef.current !== null) scrollRef.current.scrollTop = 0;
  }, [page]);
  /* oxlint-enable react-hooks/exhaustive-deps */
}

export function SettingsFrame() {
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const page = activePage.value;
  const Page = PAGE_COMPONENTS[page];
  const mode = loadMode.value;
  const loading = mode === "loading";

  useFrameTheme(frameRef);
  useClearStaleTarget();
  useScrollToTopOnPage(scrollRef, page);

  // ⌘F / Ctrl+F belongs to the frame while focus is inside it.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if (event.key.toLowerCase() !== "f") return;
    event.preventDefault();
    searchRef.current?.focus();
    searchRef.current?.select();
  };

  const retryLoad = (): void => {
    loadMode.value = "ready";
    if (saveStatus.value.kind === "temporary") saveStatus.value = { kind: "idle", failedKeys: [] };
  };

  return (
    <div
      ref={frameRef}
      class="srd-frame"
      style={{ width: `min(100%, ${FRAME_WIDTHS[frameSize.value]}px)` }}
      onKeyDown={onKeyDown}
    >
      <FrameHeader />
      <div class="srd-body">
        <SettingsRail searchRef={searchRef} />
        <section
          ref={scrollRef}
          id={PANEL_ID}
          class="srd-scroll"
          role="tabpanel"
          aria-label={pageInfo(page).label}
          aria-busy={loading}
        >
          <div class="srd-doc">
            {mode === "error" && <LoadError message={LOAD_ERROR_MESSAGE} onRetry={retryLoad} />}
            {/* Disabled for real while loading, like the shipping fieldset: the rows
                would otherwise offer placeholder values as the user's own. */}
            <fieldset
              class="settings-screen__fields settings-screen__fields--studio srd-fields"
              disabled={loading}
              aria-busy={loading}
            >
              <Page />
            </fieldset>
          </div>
        </section>
      </div>
    </div>
  );
}
