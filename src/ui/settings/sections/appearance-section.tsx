import { Minus, Plus } from "@phosphor-icons/react";
import { clampFontSize, type TabBarPosition } from "../../../settings/settings-schema";
import { FONT_SIZE_STEPPER, TAB_BAR_CHOICES } from "../../../settings/settings-rows";
import { settings, updateSettings } from "../../../settings/settings-store";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigRow, ToggleRow } from "../../controls/config-row";
import { FontRow } from "../../controls/font-row";
import { LogoRow } from "../../controls/logo-row";
import { SettingsGroup } from "../settings-group";
import { AppearancePreview } from "../appearance-preview";
import { AgentChoiceValue } from "../agent-choice-value";
import { ThemeModeSelector } from "../theme-mode-selector";

export function AppearanceSection() {
  const current = settings.value;

  const stepFontSize = (delta: number): void => {
    updateSettings({ fontSize: clampFontSize(current.fontSize + delta) });
  };

  return (
    <div class="appearance-studio">
      <div class="appearance-studio__controls">
        <SettingsGroup settingKey="themeId" description="Choose a light or dark workspace.">
          <ThemeModeSelector presentation="cards" />
        </SettingsGroup>
        <SettingsGroup title="Terminal text" description="Shared with the built-in editor.">
          <FontRow
            value={current.fontFamily}
            onChange={(fontFamily) => updateSettings({ fontFamily })}
          />
          <ConfigRow settingKey="fontSize">
            <span class="cfg-btn cfg-step" role="group" aria-label="Font size">
              <button
                type="button"
                class="cfg-step__btn"
                aria-label="Decrease font size"
                disabled={current.fontSize <= FONT_SIZE_STEPPER.min}
                onClick={() => stepFontSize(-FONT_SIZE_STEPPER.step)}
              >
                <DeckIcon icon={Minus} size={ROW_ICON} />
              </button>
              <span class="cfg-step__val">{`${current.fontSize}${FONT_SIZE_STEPPER.unit}`}</span>
              <button
                type="button"
                class="cfg-step__btn"
                aria-label="Increase font size"
                disabled={current.fontSize >= FONT_SIZE_STEPPER.max}
                onClick={() => stepFontSize(FONT_SIZE_STEPPER.step)}
              >
                <DeckIcon icon={Plus} size={ROW_ICON} />
              </button>
            </span>
          </ConfigRow>
        </SettingsGroup>
        <SettingsGroup title="Workspace">
          <ConfigRow settingKey="tabBarPosition" desc="Where the tab list sits">
            <AgentChoiceValue
              label="Tab bar position"
              value={current.tabBarPosition}
              choices={TAB_BAR_CHOICES}
              onChange={(value) => updateSettings({ tabBarPosition: value as TabBarPosition })}
            />
          </ConfigRow>
          <ToggleRow
            settingKey="showPaneBar"
            desc="Pane name bar inside splits"
            checked={current.showPaneBar}
            onToggle={() => updateSettings({ showPaneBar: !current.showPaneBar })}
          />
          <ToggleRow
            settingKey="showStatusBar"
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
