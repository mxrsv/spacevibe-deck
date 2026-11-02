import { useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { applyThemeVars } from "../../lib/theme-vars";
import { settings } from "../../settings/settings-store";
import { activeTheme, getTheme } from "../../settings/themes";
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
  // The gallery's own picker owns every other section, so a pick must not outlive this one.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    const shown = new URLSearchParams(window.location.search).get("theme") ?? "";
    return () => {
      applyThemeVars(root.style, getTheme(shown));
      root.classList.toggle("dark", wasDark);
    };
  }, []);

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
