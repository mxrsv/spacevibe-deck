/**
 * Landing-side re-export of the shared app-window renderers.
 *
 * The renderers moved to `marketing/stage/` so the marketing video assembles
 * the exact same chrome; this shim keeps the landing's import paths unchanged.
 */

export {
  BRAND_ICON_SRC,
  BRAND_ICON_SRC as STACKGRID_ICON_SRC,
  STAGE_ICONS,
  renderChromeIcon,
  renderStagePane,
  renderStageSidebar,
  renderStageStatus,
  renderStageTitlebar,
} from "../../stage/appwin.js";
