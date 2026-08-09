import { Minus, Plus, Repeat2 } from "lucide-preact";
import {
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type TabBarPosition,
} from "../../../settings/settings-schema";
import { settings, updateSettings } from "../../../settings/settings-store";
import { getPreset, THEME_PRESETS } from "../../../settings/themes";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigRow, ToggleRow } from "../../controls/config-row";
import { FontRow } from "../../controls/font-row";
import { LogoRow } from "../../controls/logo-row";

const TAB_BAR_CHOICES: readonly TabBarPosition[] = ["left", "top"];

export function AppearanceSection() {
  const current = settings.value;
  const preset = getPreset(current.themeId);

  const stepFontSize = (delta: number): void => {
    updateSettings({ fontSize: clampFontSize(current.fontSize + delta) });
  };

  const cycleTheme = (): void => {
    const index = THEME_PRESETS.findIndex(
      (themePreset) => themePreset.id === current.themeId,
    );
    const next = THEME_PRESETS[(index + 1) % THEME_PRESETS.length];
    // Switching theme clears previous color overrides
    updateSettings({ themeId: next.id, colorOverrides: {} });
  };

  const cycleTabBar = (): void => {
    const index = TAB_BAR_CHOICES.indexOf(current.tabBarPosition);
    const next = TAB_BAR_CHOICES[(index + 1) % TAB_BAR_CHOICES.length];
    updateSettings({ tabBarPosition: next });
  };

  return (
    <>
      <ConfigRow label="Theme" desc="terminal palette">
        <button
          type="button"
          class="cfg-btn"
          title="Next theme"
          aria-label={`Theme: ${preset.label}. Switch to next theme`}
          onClick={cycleTheme}
        >
          <span
            class="cfg-swatch"
            style={{
              background: preset.theme.background,
              borderColor: preset.theme.blue,
            }}
          />
          {preset.id}
          <span class="cfg-btn__hint">
            <DeckIcon icon={Repeat2} size={ROW_ICON} />
          </span>
        </button>
      </ConfigRow>
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
      <ConfigRow label="Tab bar position" desc="where the tab list sits">
        <button
          type="button"
          class="cfg-btn"
          title="Next position"
          aria-label={`Tab bar position: ${current.tabBarPosition}. Switch to next position`}
          onClick={cycleTabBar}
        >
          {current.tabBarPosition}
          <span class="cfg-btn__hint">
            <DeckIcon icon={Repeat2} size={ROW_ICON} />
          </span>
        </button>
      </ConfigRow>
      <ToggleRow
        label="Show pane bar"
        desc="pane name bar inside splits"
        checked={current.showPaneBar}
        onToggle={() => updateSettings({ showPaneBar: !current.showPaneBar })}
      />
    </>
  );
}
