import { useSignal, useSignalEffect } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { applyThemeVars } from "../lib/theme-vars";
import { settings, updateSettings } from "../settings/settings-store";
import { resolveTheme, THEME_PRESETS } from "../settings/themes";
import { GALLERY_SECTIONS } from "./section-registry";
import { unhandledCommands } from "./host-stub";

const DEFAULT_SECTION_ID = "chrome";

interface GalleryDirection {
  readonly id: string;
  readonly label: string;
  readonly className: string;
}

const DIRECTIONS: readonly GalleryDirection[] = [
  {
    id: "chatgpt",
    label: "ChatGPT Desktop direction",
    className: "gx-app--chatgpt",
  },
  {
    // Inherits the ChatGPT surfaces and ink; changes only geometry — radius by
    // role, and one fixed control column.
    id: "radius",
    label: "Radius system · 6/8/12 + control column",
    className: "gx-app--chatgpt gx-app--radius",
  },
];

/**
 * The gallery shell.
 *
 * Theme switching goes through the app's real path — `updateSettings` then
 * `applyThemeVars` — rather than writing CSS variables directly, so what the
 * specimens show is what a user switching theme in Settings would get. That is
 * The chosen ChatGPT Desktop direction is intentionally fixed across every
 * category. The theme control remains because the current-token audit and the
 * state matrix still need to expose Deck's real theme behavior underneath it.
 */

export function Gallery() {
  const activeId = useSignal(DEFAULT_SECTION_ID);
  const directionId = useSignal(DIRECTIONS[0].id);
  const contentRef = useRef<HTMLElement>(null);

  useSignalEffect(() => {
    applyThemeVars(
      document.documentElement.style,
      resolveTheme(settings.value),
    );
  });

  /**
   * The directions on offer.
   *
   * Each is a root class plus one stylesheet, so switching is a class swap —
   * no rebuild, and both stay loaded. That is what makes a side-by-side
   * judgement possible at all: the same real components, same theme, same
   * state, one variable changed.
   */
  const cycleDirection = (): void => {
    const index = DIRECTIONS.findIndex((entry) => entry.id === directionId.value);
    directionId.value = DIRECTIONS[(index + 1) % DIRECTIONS.length].id;
  };

  const cycleTheme = (): void => {
    const index = THEME_PRESETS.findIndex(
      (preset) => preset.id === settings.value.themeId,
    );
    const next = THEME_PRESETS[(index + 1) % THEME_PRESETS.length];
    updateSettings({ themeId: next.id, colorOverrides: {} });
  };

  const active =
    GALLERY_SECTIONS.find((section) => section.id === activeId.value) ??
    GALLERY_SECTIONS[0];

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [active.id]);

  const Section = active.Section;
  const missing = unhandledCommands.value;

  const direction = directionId.value;
  const active_direction =
    DIRECTIONS.find((entry) => entry.id === direction) ?? DIRECTIONS[0];

  return (
    <div class={`gx-app ${active_direction.className}`}>
      <header class="gx-topbar">
        <span class="gx-topbar__title">Deck</span>
        <button
          type="button"
          class="gx-direction-badge gx-direction-badge--switch"
          onClick={cycleDirection}
          title="Switch direction"
        >
          {active_direction.label}
        </button>
        <button type="button" class="gx-themebtn" onClick={cycleTheme}>
          <span
            class="gx-themebtn__swatch"
            style={{ background: "var(--bg)", borderColor: "var(--accent)" }}
          />
          {settings.value.themeId}
        </button>
        <span class="gx-topbar__hint">
          one treatment across every surface · hover and focus are live
        </span>
      </header>

      <nav class="gx-rail" aria-label="Gallery sections">
        {GALLERY_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            class={`gx-rail__item ${section.id === active.id ? "is-active" : ""}`}
            aria-current={section.id === active.id}
            onClick={() => {
              activeId.value = section.id;
            }}
          >
            {section.label}
          </button>
        ))}
      </nav>

      <main ref={contentRef} class="gx-content">
        <div key={active.id} class="gx-section">
          <Section />
        </div>
      </main>

      <footer class="gx-foot">
        {missing.length === 0 ? (
          <span>
            every IPC call the specimens made was answered by the stub.
          </span>
        ) : (
          <span>
            unstubbed IPC ({missing.length}): <code>{missing.join(", ")}</code>{" "}
            — the surfaces that need these render without their data.
          </span>
        )}
      </footer>
    </div>
  );
}
