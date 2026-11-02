import { useSignalEffect } from "@preact/signals";
import { applyThemeVars } from "../../lib/theme-vars";
import { settings } from "../../settings/settings-store";
import { activeTheme } from "../../settings/themes";
import { AppearanceSection } from "../../ui/settings/sections/appearance-section";
import { SectionHead, Specimen } from "../specimen";
import "../../ui/preset-entry.css";

/**
 * Appearance as the app mounts it. A card press re-themes the whole gallery the way `app.tsx` does
 * in the running app, so each theme is judged on its chrome and not only on its thumbnail.
 */
export function ThemesSection() {
  useSignalEffect(() => {
    const theme = activeTheme(settings.value);
    applyThemeVars(document.documentElement.style, theme);
    document.documentElement.classList.toggle("dark", theme.type === "dark");
  });

  return (
    <>
      <SectionHead
        title="Themes"
        blurb="The real picker on the gallery's in-memory settings. Pressing a card applies it."
      />
      <Specimen name=".theme-gallery" surface="bg">
        <div class="settings-screen__doc--studio">
          <div class="settings-screen__fields settings-screen__fields--studio">
            <AppearanceSection />
          </div>
        </div>
      </Specimen>
    </>
  );
}
