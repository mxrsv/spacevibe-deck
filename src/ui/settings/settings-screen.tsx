import { X } from "@phosphor-icons/react";
import { useEffect, useRef } from "preact/hooks";
import { CHROME_ICON, DeckIcon } from "../controls/deck-icon";
import { activeCategory } from "./active-category-store";
import { categoryTabId, SECTION_PANEL_ID, SETTINGS_CATEGORIES } from "./settings-categories";
import { SettingsNav } from "./settings-nav";
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
 * Escape and mount-focus are carried over unchanged from the drawer this
 * replaces — including the `.xterm` guard. The guard is inert once the
 * surface covers the window, but it is load-bearing for panes that still
 * hold focus at the moment of opening, and removing it is not this change's
 * job.
 */
export function SettingsScreen({ open, onClose }: SettingsScreenProps) {
  const escRef = useRef<HTMLButtonElement>(null);

  // Move focus into the screen on open, so Escape reaches the handler below
  // instead of being swallowed by the terminal that had focus. preventScroll:
  // the section area scrolls, and stealing focus must not jump it.
  useEffect(() => {
    if (open) {
      escRef.current?.focus({ preventScroll: true });
    }
  }, [open]);

  // Escape closes the screen — unless the key is headed for a terminal,
  // which owns its own Escape (vim, fzf, …).
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      const target = event.target;
      // A terminal owns its own Escape (vim, fzf) — leave it be. Guard the type:
      // keydown can target a non-Element (document/window) that has no closest().
      if (target instanceof Element && target.closest(".xterm")) {
        return;
      }
      // Blur first: a focused text field commits its draft on blur, so closing
      // never silently drops what the user just typed.
      if (target instanceof HTMLElement) {
        target.blur();
      }
      onClose();
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

  return (
    <aside
      class={`settings-screen ${open ? "is-open" : ""}`}
      aria-label="Settings"
      aria-hidden={!open}
    >
      <header class="settings-screen__head">
        <h2 class="settings-screen__path">
          <b>~</b>/deck/settings
        </h2>
        <button
          ref={escRef}
          type="button"
          class="iconbtn settings-screen__esc"
          title="Close settings"
          aria-label="Close settings"
          onClick={onClose}
        >
          <DeckIcon icon={X} size={CHROME_ICON} />
        </button>
      </header>

      <div class="settings-screen__grid">
        <SettingsNav />
        <section
          class="settings-screen__section"
          id={SECTION_PANEL_ID}
          role="tabpanel"
          aria-labelledby={categoryTabId(active.id)}
          aria-busy={settingsLoadState.value.status === "loading"}
        >
          {settingsLoadState.value.status === "error" ? (
            <LoadError
              message={settingsLoadState.value.message}
              onRetry={() => void initSettings()}
            />
          ) : null}
          <Section />
        </section>
      </div>
    </aside>
  );
}
