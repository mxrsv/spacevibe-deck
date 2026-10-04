import { Minus, Plus } from "@phosphor-icons/react";
import {
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type TabBarPosition,
} from "../../../settings/settings-schema";
import { settings, updateSettings } from "../../../settings/settings-store";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigRow, ToggleRow } from "../../controls/config-row";
import { FontRow } from "../../controls/font-row";
import { LogoRow } from "../../controls/logo-row";
import { SettingsGroup } from "../settings-group";
import { AppearancePreview } from "../appearance-preview";
import { AgentChoiceValue } from "../agent-choice-value";
import { ThemeModeSelector } from "../theme-mode-selector";

const TAB_BAR_CHOICES = [
  { value: "left", label: "Left" },
  { value: "top", label: "Top" },
] as const;

export function AppearanceSection() {
  const current = settings.value;

  const stepFontSize = (delta: number): void => {
    updateSettings({ fontSize: clampFontSize(current.fontSize + delta) });
  };

  return (
    <div class="appearance-studio">
      <div class="appearance-studio__controls">
        <SettingsGroup title="Color mode" description="Choose a light or dark workspace.">
          <ThemeModeSelector presentation="cards" />
        </SettingsGroup>
        <SettingsGroup title="Terminal text" description="Shared with the built-in editor.">
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
        </SettingsGroup>
        <SettingsGroup title="Workspace">
          <ConfigRow label="Tab bar position" desc="Where the tab list sits">
            <AgentChoiceValue
              label="Tab bar position"
              value={current.tabBarPosition}
              choices={TAB_BAR_CHOICES}
              onChange={(value) => updateSettings({ tabBarPosition: value as TabBarPosition })}
            />
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
        </SettingsGroup>
        <SettingsGroup title="Identity">
          <LogoRow />
        </SettingsGroup>
      </div>
      <AppearancePreview />
    </div>
  );
}
