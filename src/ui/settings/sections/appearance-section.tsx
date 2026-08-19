import { Minus, Plus, Repeat } from "@phosphor-icons/react";
import {
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TERMINAL_RENDERERS,
  type TabBarPosition,
} from "../../../settings/settings-schema";
import { settings, updateSettings } from "../../../settings/settings-store";
import { DeckIcon, ROW_ICON } from "../../controls/deck-icon";
import { ConfigGroup, ConfigRow, ToggleRow } from "../../controls/config-row";
import { FontRow } from "../../controls/font-row";
import { LogoRow } from "../../controls/logo-row";
import { ThemeGallery } from "../theme-gallery";
import { ColorOverrides } from "../color-overrides";
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

  const cycleRenderer = (): void => {
    const index = TERMINAL_RENDERERS.indexOf(current.terminalRenderer);
    const next = TERMINAL_RENDERERS[(index + 1) % TERMINAL_RENDERERS.length];
    updateSettings({ terminalRenderer: next });
  };

  return (
    <>
      <ThemeGallery />
      {/* The overrides live directly under the gallery because the gallery is
          what clears them: picking a card resets `colorOverrides`, so the rows
          that show what is overridden belong next to the control that wipes
          them, not one rail category away (2026-08-16). */}
      <ConfigGroup label="Colors" />
      <ColorOverrides />
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
      {/* Sits with the type rows because that is what it changes: the renderer
          is the thing that puts glyphs on screen, so it belongs beside font
          and size rather than under a Terminal category the user would reach
          only after the text already looked wrong. */}
      <ConfigRow
        label="Terminal renderer"
        desc="webgl joins block glyphs in TUIs; text antialiasing differs"
      >
        <button
          type="button"
          class="cfg-btn"
          title="Next renderer"
          aria-label={`Terminal renderer: ${current.terminalRenderer}. Switch to next renderer`}
          onClick={cycleRenderer}
        >
          {current.terminalRenderer}
          <span class="cfg-btn__hint">
            <DeckIcon icon={Repeat} size={ROW_ICON} />
          </span>
        </button>
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
