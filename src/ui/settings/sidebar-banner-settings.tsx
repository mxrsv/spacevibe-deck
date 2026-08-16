import { useSignal } from "@preact/signals";
import { ChevronDown } from "lucide-preact";
import { open } from "../../host/dialog-host";
import {
  selectSidebarBanner,
  setSidebarBannerEnabled,
  setSidebarBannerFromPath,
  sidebarBanner,
} from "../../settings/sidebar-banner-store";
import {
  getSidebarBannerPreset,
  SIDEBAR_BANNER_PRESETS,
} from "../../settings/sidebar-banner-presets";
import { ConfigGroup, ConfigRow } from "../controls/config-row";
import { DeckIcon, ROW_ICON } from "../controls/deck-icon";

const OFF_VALUE = "off";
const CHOOSE_IMAGE_VALUE = "choose-image";

export function SidebarBannerSettings() {
  const error = useSignal<string | null>(null);
  const state = sidebarBanner.value;
  const controlValue = state.enabled ? state.selection : OFF_VALUE;
  const selectedLabel = state.enabled
    ? state.selection === "custom"
      ? "custom image"
      : getSidebarBannerPreset(state.selection).label
    : OFF_VALUE;

  async function chooseImage(): Promise<void> {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [
          { name: "Image", extensions: ["png", "jpg", "jpeg", "svg", "webp"] },
        ],
      });
      if (typeof picked !== "string") {
        return;
      }
      error.value = null;
      await setSidebarBannerFromPath(picked);
    } catch (err: unknown) {
      error.value =
        err instanceof Error ? err.message : "Couldn't set the sidebar banner";
    }
  }

  function changeSelection(event: Event): void {
    const select = event.currentTarget as HTMLSelectElement;
    const next = select.value;
    if (next === OFF_VALUE) {
      setSidebarBannerEnabled(false);
      return;
    }
    if (next === CHOOSE_IMAGE_VALUE) {
      select.value = controlValue;
      void chooseImage();
      return;
    }
    error.value = null;
    selectSidebarBanner(next);
  }

  return (
    <>
      <ConfigGroup label="Sidebar banner" />
      <ConfigRow
        label="Sidebar banner"
        desc="Artwork at the foot of the sidebar"
      >
        <span class="cfg-btn cfg-btn--overlay">
          <span class="cfg-btn__text">{selectedLabel}</span>
          <span class="cfg-btn__hint">
            <DeckIcon icon={ChevronDown} size={ROW_ICON} />
          </span>
          <select
            value={controlValue}
            aria-label="Sidebar banner"
            onChange={changeSelection}
          >
            <option value={OFF_VALUE}>Off</option>
            {SIDEBAR_BANNER_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {state.customImage !== "" ? (
              <option value="custom">Custom image</option>
            ) : null}
            <option value={CHOOSE_IMAGE_VALUE}>Choose image…</option>
          </select>
        </span>
      </ConfigRow>
      {error.value !== null ? (
        <div class="cfg-custom cfg-custom--error">{error.value}</div>
      ) : null}
    </>
  );
}
