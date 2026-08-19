import { CaretLeft } from "@phosphor-icons/react";
import { useEffect, useRef } from "preact/hooks";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";
import { GithubStarButton } from "../controls/github-star-button";
import { activeCategory } from "./active-category-store";
import { categoryTabId, SECTION_PANEL_ID, SETTINGS_CATEGORIES } from "./settings-categories";
import { SettingsNav } from "./settings-nav";
import { trapTab } from "../focus-trap";
import { initSettings, settingsLoadState } from "../../settings/settings-store";
import { LoadError } from "../controls/load-error";

interface SettingsScreenProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The settings shell: a full-window surface over the stage, rail left,
 * section right (DL-11.1). The section area owns all scrolling; the rail
 * does not scroll with it.
 *
 * Three keyboard contracts live here, and each answers a failure the design
 * spec names by hand (spec §6):
 *
 * - **Escape belongs to the innermost owner.** A terminal keeps its own
 *   Escape (vim, fzf) through the `.xterm` guard, and a field with an
 *   uncommitted draft keeps its own by stopping the event before it reaches
 *   this window listener (`commit-input.tsx`). What arrives here is therefore
 *   an Escape nothing else claimed, and only that closes the screen.
 * - **Focus cannot leave the surface.** The screen covers the window but does
 *   not remove the app behind it from the document, so Tab used to walk
 *   straight into panes, tabs and the rail the user cannot even see.
 * - **A loading snapshot cannot overwrite an edit.** `initSettings` assigns
 *   the disk snapshot over `settings.value` when it resolves, so an edit made
 *   in the gap would be silently reverted; the section is inert until the
 *   snapshot has landed.
 */
export function SettingsScreen({ open, onClose }: SettingsScreenProps) {
  const escRef = useRef<HTMLButtonElement>(null);
  const screenRef = useRef<HTMLElement>(null);

  // Move focus into the screen on open, so Escape reaches the handler below
  // instead of being swallowed by the terminal that had focus. preventScroll:
  // the section area scrolls, and stealing focus must not jump it.
  useEffect(() => {
    if (open) {
      escRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Escape closes the screen, Tab stays inside it. One listener for both: they
  // are the same decision — which surface owns this key — and splitting them
  // would mean two window listeners racing to answer it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      // Key first, then the DOM walk. This listener is on `window` and fires
      // for EVERY keystroke while Settings is open; `closest()` walks to the
      // document root, so testing it before the key would pay for a tree walk
      // on each character typed into a field here. It only ever mattered once
      // Tab joined Escape and the handler stopped returning immediately.
      if (event.key !== "Escape" && event.key !== "Tab") {
        return;
      }
      const target = event.target;
      // A terminal owns its own Escape (vim, fzf) — leave it be. Guard the type:
      // keydown can target a non-Element (document/window) that has no closest().
      if (target instanceof Element && target.closest(".xterm")) {
        return;
      }

      if (event.key === "Escape") {
        // Blur first: a focused text field commits its draft on blur, so
        // closing never silently drops what the user just typed. An
        // UNCOMMITTED draft never reaches this line — the field reverts it and
        // stops the event — so this only ever commits a draft already equal to
        // the saved value.
        if (target instanceof HTMLElement) {
          target.blur();
        }
        onClose();
        return;
      }

      if (event.key === "Tab") {
        trapTab(event, screenRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Falls back to the first category rather than rendering an empty panel:
  // an unknown id can only come from a stale signal, and a blank screen is a
  // worse answer than the default one.
  const active =
    SETTINGS_CATEGORIES.find((category) => category.id === activeCategory.value) ??
    SETTINGS_CATEGORIES[0];
  const Section = active.Section;
  const loading = settingsLoadState.value.status === "loading";

  return (
    <aside
      ref={screenRef}
      class={`settings-screen ${open ? "is-open" : ""}`}
      aria-label="Settings"
      aria-hidden={!open}
    >
      {/* `data-tauri-drag-region` is what `11-settings-screen.css` and the
          Electron host both key the drag surface off (see the `-webkit-app-region`
          block in that file). Settings covers the window's own frame row now,
          so this header is the only draggable strip while it is open. */}
      <header class="settings-screen__head" data-tauri-drag-region>
        {/* Back, not close (2026-08-19, owner): the screen covers everything,
            so leaving it is going back to the work rather than dismissing a
            panel. It takes focus on open, which is also what puts Escape in
            reach of the window listener. */}
        <button
          ref={escRef}
          type="button"
          class="settings-screen__back"
          title="Back to Deck (Esc)"
          onClick={onClose}
        >
          <DeckIcon icon={CaretLeft} size={ROW_ICON} />
          Back
        </button>
        {/* The decorative `~/deck/settings` path stood here until 2026-08-19
            (owner): it named the surface a second time — the rail and the
            section title both already do — and the header is a leading
            cluster, so the slot it held is where a real control belongs.
            Achromatic like everything else on this screen (DL-3.7); it is
            shaped after `Back` beside it so the two read as one cluster
            rather than as an action and an advertisement. */}
        <GithubStarButton variant="header" />
      </header>

      <div class="settings-screen__grid">
        <SettingsNav />
        <section
          class="settings-screen__section"
          id={SECTION_PANEL_ID}
          role="tabpanel"
          aria-labelledby={categoryTabId(active.id)}
          aria-busy={loading}
        >
          {/* Three layers, in this order: what this section is, one sentence
              on what it is for, then one grouped surface holding the rows.
              The title is NOT the panel's accessible name — `aria-labelledby`
              above still points at the rail tab the user pressed, so the tab
              and the panel it opened keep naming each other. */}
          <div class="settings-screen__doc">
            <header class="settings-screen__intro">
              <h2 class="settings-screen__title">{active.label}</h2>
              <p class="settings-screen__lede">{active.description}</p>
            </header>
            {settingsLoadState.value.status === "error" ? (
              <LoadError
                message={settingsLoadState.value.message}
                onRetry={() => void initSettings()}
              />
            ) : null}
            {/* A native disabled fieldset, not a CSS veil: while the snapshot
                is in flight these rows are showing DEFAULT_SETTINGS, and
                offering somebody else's defaults as their editable values is
                what this refuses to do. Real enforcement rather than styling,
                because the values are on screen and reachable.

                What it is NOT is a data-integrity guarantee. `initSettings`
                assigns the disk snapshot over `settings.value` when it
                resolves, and every OTHER way into `updateSettings` during that
                window — a keybinding, the menu, `toggleDock` — still loses its
                edit. Closing that needs the store to refuse the clobber the
                way `mergedRevision` already refuses a stale broadcast; this
                covers one entry point, not the race. */}
            <fieldset class="settings-screen__fields" disabled={loading}>
              <Section />
            </fieldset>
          </div>
        </section>
      </div>
    </aside>
  );
}
