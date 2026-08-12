import { useSignal, useSignalEffect } from "@preact/signals";
import { applyThemeVars } from "../lib/theme-vars";
import { settings, updateSettings } from "../settings/settings-store";
import { resolveTheme, THEME_PRESETS } from "../settings/themes";
import { GALLERY_SECTIONS } from "./section-registry";
import { unhandledCommands } from "./host-stub";

/**
 * The gallery shell.
 *
 * Theme switching goes through the app's real path — `updateSettings` then
 * `applyThemeVars` — rather than writing CSS variables directly, so what the
 * specimens show is what a user switching theme in Settings would get. That is
 * also why there is no "direction" picker yet: a redesign direction will be a
 * block of token overrides, and there is nothing honest to put behind such a
 * switch until a direction is actually chosen.
 */

export function Gallery() {
  const activeId = useSignal(GALLERY_SECTIONS[0].id);

  useSignalEffect(() => {
    applyThemeVars(
      document.documentElement.style,
      resolveTheme(settings.value),
    );
  });

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
  const Section = active.Section;
  const missing = unhandledCommands.value;

  return (
    <div class="gx-app">
      <header class="gx-topbar">
        <span class="gx-topbar__title">Deck chrome gallery</span>
        <button type="button" class="gx-themebtn" onClick={cycleTheme}>
          <span
            class="gx-themebtn__swatch"
            style={{ background: "var(--bg)", borderColor: "var(--accent)" }}
          />
          {settings.value.themeId}
        </button>
        <span class="gx-topbar__hint">
          theme drives every specimen · hover and focus are live · not the app,
          a harness
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

      <main class="gx-content">
        <Section />
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
