export interface SidebarBannerPreset {
  readonly id: string;
  readonly label: string;
  readonly background: string;
  readonly mark?: "star" | "sun" | "us-canton" | "taegeuk";
}

/**
 * Offline banner artwork. CSS fields and marks keep these out of the icon
 * system while avoiding network requests and external source files.
 */
export const SIDEBAR_BANNER_PRESETS = [
  {
    id: "vietnam",
    label: "Vietnam",
    background: "#da251d",
    mark: "star",
  },
  {
    id: "united-states",
    label: "United States",
    background:
      "repeating-linear-gradient(to bottom, #b22234 0 7.692%, #ffffff 7.692% 15.384%)",
    mark: "us-canton",
  },
  {
    id: "south-korea",
    label: "South Korea",
    background: "#ffffff",
    mark: "taegeuk",
  },
  {
    id: "japan",
    label: "Japan",
    background: "#ffffff",
    mark: "sun",
  },
  {
    id: "france",
    label: "France",
    background:
      "linear-gradient(to right, #002654 0 33.333%, #ffffff 33.333% 66.666%, #ce1126 66.666%)",
  },
  {
    id: "germany",
    label: "Germany",
    background:
      "linear-gradient(to bottom, #000000 0 33.333%, #dd0000 33.333% 66.666%, #ffce00 66.666%)",
  },
  {
    id: "ukraine",
    label: "Ukraine",
    background: "linear-gradient(to bottom, #0057b7 0 50%, #ffd700 50%)",
  },
  {
    id: "indonesia",
    label: "Indonesia",
    background: "linear-gradient(to bottom, #ce1126 0 50%, #ffffff 50%)",
  },
] as const satisfies readonly SidebarBannerPreset[];

export type SidebarBannerPresetId =
  (typeof SIDEBAR_BANNER_PRESETS)[number]["id"];

export const DEFAULT_SIDEBAR_BANNER_PRESET: SidebarBannerPresetId = "vietnam";

const PRESET_IDS = new Set<string>(
  SIDEBAR_BANNER_PRESETS.map((preset) => preset.id),
);

export function isSidebarBannerPresetId(
  value: unknown,
): value is SidebarBannerPresetId {
  return typeof value === "string" && PRESET_IDS.has(value);
}

export function getSidebarBannerPreset(
  id: SidebarBannerPresetId,
): SidebarBannerPreset {
  return (
    SIDEBAR_BANNER_PRESETS.find((preset) => preset.id === id) ??
    SIDEBAR_BANNER_PRESETS[0]
  );
}
