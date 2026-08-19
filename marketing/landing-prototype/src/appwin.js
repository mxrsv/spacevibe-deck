/**
 * Landing-side re-export of the shared app-window renderers.
 *
 * The renderers moved to `marketing/stage/` so the marketing video assembles
 * the exact same chrome; this shim keeps the landing's import paths unchanged.
 *
 * Every name the landing reaches through `../appwin.js` has to be listed
 * HERE — an omission is not a build error, just a module that resolves to
 * `undefined` at the call site.
 */

export {
  BRAND_ICON_SRC,
  STAGE_ICONS,
  renderChromeIcon,
  renderStageFrameRow,
  renderStagePane,
  renderStageRail,
  renderStageSidebar,
  renderStageStatus,
  renderStageStrip,
  renderStageTitlebar,
} from "../../stage/appwin.js";
