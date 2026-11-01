import { ArrowSquareIn, Check, FolderOpen } from "@phosphor-icons/react";
import { useEffect, useRef } from "preact/hooks";
import {
  importCustomThemes,
  loadCustomThemes,
  openThemesFolder,
  themeImportFailures,
  themeLoadState,
  themesLoading,
} from "../../settings/custom-themes-store";
import { settings, updateSettings } from "../../settings/settings-store";
import { allThemes, getTheme } from "../../settings/themes";
import type { Theme } from "../../settings/theme-schema";
import { ConfigGroup, ConfigRow } from "../controls/config-row";
import { CHROME_ICON, DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { ThemeCardPreview } from "./theme-card-preview";
import { LoadError } from "../controls/load-error";
import { Button } from "../controls/button";

/**
 * The theme gallery (DL-24).
 *
 * §5's row is the wrong control for this one setting and only this one: a
 * theme's value IS a picture, so a pill reading `tokyo-night` asks the user to
 * remember what four words look like. Everything around the grid stays rows —
 * import and the folder are ordinary `action` pills (DL-24.5) — so the section
 * gains one widget, not a second grammar.
 *
 * The grid is a radio group rather than a list of buttons: exactly one theme is
 * active, arrow keys are what a radio group promises, and screen readers get
 * "3 of 7, selected" out of it for free.
 */
export function ThemeGallery() {
  const current = settings.value;
  const themes = allThemes();
  const failures = themeImportFailures.value;
  const groupRef = useRef<HTMLDivElement>(null);

  // Through `getTheme`, never the raw `themeId`. A saved `file:` id whose file
  // the user deleted resolves to the fallback everywhere else in the app — the
  // status bar goes through this same call — so comparing the raw id here would
  // leave the grid with NO card checked while the running terminal and the
  // status bar agree on a theme. A radio group with nothing selected reads as
  // broken; this is the app's one answer to "which theme is on", so the picker
  // has to give the same one.
  const activeId = getTheme(current.themeId).id;

  // The folder is re-read on every mount of this section, never cached for the
  // session: the documented way to remove a theme is deleting the file in
  // Finder (DL-24.5), and a cache would keep showing a card for a file that is
  // no longer there.
  useEffect(() => {
    void loadCustomThemes();
  }, []);

  const select = (theme: Theme): void => {
    if (theme.id === activeId) {
      return;
    }
    updateSettings({ themeId: theme.id });
  };

  // Arrow keys move selection, which is what `role="radiogroup"` promises. The
  // focused card is always the selected one (roving tabindex below), so moving
  // focus and moving selection are the same gesture here.
  const onKeyDown = (event: KeyboardEvent): void => {
    const step = KEY_STEPS[event.key];
    if (step === undefined || themes.length === 0) {
      return;
    }
    event.preventDefault();
    const index = themes.findIndex((theme) => theme.id === activeId);
    const from = index === -1 ? 0 : index;
    const next = (from + step + themes.length) % themes.length;
    select(themes[next]);
    focusCard(groupRef.current, next);
  };

  return (
    <>
      <ConfigGroup label="Theme" />
      <div
        class="theme-gallery"
        role="radiogroup"
        aria-label="Theme"
        ref={groupRef}
        onKeyDown={onKeyDown}
      >
        {themes.map((theme) => {
          const active = theme.id === activeId;
          return (
            <button
              key={theme.id}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              class={`theme-card ${active ? "theme-card--active" : ""}`}
              onClick={() => select(theme)}
            >
              <ThemeCardPreview theme={theme} />
              <span class="theme-card__foot">
                {/* The card is a thumbnail now, so a long theme name ellipses
                    in the footer. The full one stays in the DOM (screen
                    readers read it whole) and `title` gives it back to the
                    pointer. */}
                <span class="theme-card__name" title={theme.name}>
                  {theme.name}
                </span>
                {/* CHROME_ICON, the smallest size the scale has (DL-14.1) —
                    the card shrank but the icon scale did not, so the mark's
                    circle is what tightened around it, not the check. */}
                <span class="theme-card__mark" aria-hidden="true">
                  {active && <DeckIcon icon={Check} size={CHROME_ICON} />}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {themeLoadState.value.status === "error" ? (
        <LoadError message={themeLoadState.value.message} onRetry={() => void loadCustomThemes()} />
      ) : null}
      <ConfigRow label="Import theme" desc="iTerm2, Windows Terminal, Ghostty, Alacritty">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={themesLoading.value || themeLoadState.value.status === "error"}
          onClick={() => void importCustomThemes()}
        >
          {themesLoading.value ? "reading…" : "choose files"}
          <DeckIcon icon={ArrowSquareIn} size={ROW_ICON} />
        </Button>
      </ConfigRow>
      <ConfigRow label="Themes folder" desc="Delete a file here to remove its theme">
        <Button type="button" variant="outline" size="sm" onClick={() => void openThemesFolder()}>
          reveal
          <DeckIcon icon={FolderOpen} size={ROW_ICON} />
        </Button>
      </ConfigRow>
      {/* DL-24.6. The pill reads `skipped` rather than `not a theme` because
          the list holds two kinds of file now: one the parser rejected, and one
          the host refused before it ever reached the folder. The row's
          description carries the difference; the pill says only what happened. */}
      {failures.map((failure, index) => (
        <ConfigRow
          // Two picked files can share a basename and be refused for the same
          // reason, so the name alone is not a key.
          key={`${index}-${failure.fileName}`}
          label={failure.fileName}
          desc={failure.reason}
          danger
        >
          <span class="cfg-btn cfg-btn--danger cfg-btn--disabled">skipped</span>
        </ConfigRow>
      ))}
    </>
  );
}

/** Both axes move by one card: the grid wraps, so rows are not a dimension. */
const KEY_STEPS: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

function focusCard(group: HTMLDivElement | null, index: number): void {
  const card = group?.querySelectorAll<HTMLButtonElement>(".theme-card")[index];
  card?.focus();
}
