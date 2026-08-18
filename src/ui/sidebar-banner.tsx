import { resolveSidebarBannerCustomImage, sidebarBanner } from '../settings/sidebar-banner-store';
import { getSidebarBannerPreset } from '../settings/sidebar-banner-presets';

/** Decorative only: selection and import controls live in Appearance. */
export function SidebarBanner() {
  const state = sidebarBanner.value;
  if (!state.enabled) {
    return null;
  }
  const customImage = resolveSidebarBannerCustomImage(state);
  const preset = state.selection === 'custom' ? null : getSidebarBannerPreset(state.selection);
  return (
    // DL-26.1: one wrapper, one treatment class, for both artwork kinds —
    // the class sits on the shared wrapper so neither branch can drop it.
    <div class="sidebar-banner sidebar-banner--woven" aria-hidden="true">
      {customImage !== '' ? (
        <img src={customImage} alt="" draggable={false} />
      ) : preset !== null ? (
        <span class="sidebar-banner__art" style={{ background: preset.background }}>
          {preset.mark !== undefined ? (
            <span class={`sidebar-banner__mark sidebar-banner__mark--${preset.mark}`} />
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
