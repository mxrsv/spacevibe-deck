import { useSignal } from "@preact/signals";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { GALLERY_SECTIONS } from "./section-registry";
import { unhandledCommands } from "./host-stub";
import { applyThemeVars } from "../lib/theme-vars";
import { settings } from "../settings/settings-store";
import { resolveTheme, THEME_PRESETS } from "../settings/themes";

const DEFAULT_SECTION_ID = "chrome";

/**
 * The gallery shell.
 *
 * The gallery carries one selected direction. Its specimens remain live app
 * components, and since 2026-08-13 the direction's colours are DERIVED from
 * whichever theme is published here rather than pinned to nine hex values —
 * which is what makes the picker below a review instrument instead of a
 * convenience. If a change only looks right on tokyo-night, this is where that
 * shows up.
 */

export function Gallery() {
  const activeId = useSignal(DEFAULT_SECTION_ID);
  const themeId = useSignal(THEME_PRESETS[0].id);
  const contentRef = useRef<HTMLElement>(null);

  // Published on `:root`, the same place `app.tsx` publishes it, so the
  // specimens read it through the identical cascade the app uses. The state
  // matrix overrides it per cell — that is the one place four themes coexist.
  useLayoutEffect(() => {
    applyThemeVars(
      document.documentElement.style,
      resolveTheme({
        ...settings.peek(),
        themeId: themeId.value,
        colorOverrides: {},
      }),
    );
  }, [themeId.value]);

  const active =
    GALLERY_SECTIONS.find((section) => section.id === activeId.value) ?? GALLERY_SECTIONS[0];

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0, left: 0 });
  }, [active.id]);

  const Section = active.Section;
  const missing = unhandledCommands.value;

  return (
    <div class="gx-app gx-app--chatgpt">
      <header class="gx-topbar">
        <span class="gx-topbar__title">Deck</span>
        <span class="gx-direction-badge">Deck Electron</span>
        {/* DL-1.4: a native select behind a styled pill — zero JS, zero extra
            DOM, free accessibility. */}
        <label class="gx-themepick">
          <span>theme</span>
          <select
            value={themeId.value}
            onChange={(event) => {
              themeId.value = (event.currentTarget as HTMLSelectElement).value;
            }}
          >
            {THEME_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.id}
              </option>
            ))}
          </select>
        </label>
        <span class="gx-topbar__hint">
          selected direction · real components · derived from the live theme
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
          <span>every IPC call the specimens made was answered by the stub.</span>
        ) : (
          <span>
            unstubbed IPC ({missing.length}): <code>{missing.join(", ")}</code> — the surfaces that
            need these render without their data.
          </span>
        )}
      </footer>
    </div>
  );
}
