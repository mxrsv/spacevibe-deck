import { Minus, Plus, Repeat } from "@phosphor-icons/react";
import {
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type TabBarPosition,
} from "../../../settings/settings-schema";
import { settings, updateSettings } from "../../../settings/settings-store";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigGroup, ConfigRow, ToggleRow } from "../../controls/config-row";
import { FontRow } from "../../controls/font-row";
import { LogoRow } from "../../controls/logo-row";
import { ThemeModeSelector } from "../theme-mode-selector";
import { SidebarBannerSettings } from "../sidebar-banner-settings";

const TAB_BAR_CHOICES: readonly TabBarPosition[] = ["left", "top"];

export function AppearanceSection() {
  const current = settings.value;

  const stepFontSize = (delta: number): void => {
    updateSettings({ fontSize: clampFontSize(current.fontSize + delta) });
  };

  const cycleTabBar = (): void => {
    const index = TAB_BAR_CHOICES.indexOf(current.tabBarPosition);
    const next = TAB_BAR_CHOICES[(index + 1) % TAB_BAR_CHOICES.length];
    updateSettings({ tabBarPosition: next });
  };

  return (
    <>
      {/* Two segments where the theme gallery, the import action, the themes
          folder and the four colour override rows used to be (2026-08-19).
          None of that was deleted — `theme-gallery.tsx`, `color-overrides.tsx`
          and every parser still build and still have their tests — it is
          unmounted, so a legacy selection keeps working while Settings offers
          one plain product choice. */}
      <ConfigGroup label="Theme" />
      <ThemeModeSelector />
      <ConfigGroup label="Type and chrome" />
      <FontRow
        value={current.fontFamily}
        onChange={(fontFamily) => updateSettings({ fontFamily })}
      />
      <ConfigRow label="Font size">
        <span class="cfg-btn cfg-step" role="group" aria-label="Font size">
          <button
            type="button"
            class="cfg-step__btn"
            aria-label="Decrease font size"
            disabled={current.fontSize <= FONT_SIZE_MIN}
            onClick={() => stepFontSize(-1)}
          >
            <DeckIcon icon={Minus} size={ROW_ICON} />
          </button>
          <span class="cfg-step__val">{current.fontSize}px</span>
          <button
            type="button"
            class="cfg-step__btn"
            aria-label="Increase font size"
            disabled={current.fontSize >= FONT_SIZE_MAX}
            onClick={() => stepFontSize(1)}
          >
            <DeckIcon icon={Plus} size={ROW_ICON} />
          </button>
        </span>
      </ConfigRow>
      <LogoRow />
      <ConfigRow label="Tab bar position" desc="Where the tab list sits">
        <button
          type="button"
          class="cfg-btn"
          title="Next position"
          aria-label={`Tab bar position: ${current.tabBarPosition}. Switch to next position`}
          onClick={cycleTabBar}
        >
          {current.tabBarPosition}
          <span class="cfg-btn__hint">
            <DeckIcon icon={Repeat} size={ROW_ICON} />
          </span>
        </button>
      </ConfigRow>
      <ToggleRow
        label="Show pane bar"
        desc="Pane name bar inside splits"
        checked={current.showPaneBar}
        onToggle={() => updateSettings({ showPaneBar: !current.showPaneBar })}
      />
      <ToggleRow
        label="Show status bar"
        desc="Branch, path and window readout along the bottom"
        checked={current.showStatusBar}
        onToggle={() => updateSettings({ showStatusBar: !current.showStatusBar })}
      />
      <SidebarBannerSettings />
    </>
  );
}
