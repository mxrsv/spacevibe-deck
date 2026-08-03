import {
  COLOR_KEYS,
  type TerminalColors,
} from "../../../settings/settings-schema";
import {
  settings,
  updateColorOverride,
} from "../../../settings/settings-store";
import { getPreset } from "../../../settings/themes";
import { ColorRow } from "../../controls/color-row";

const COLOR_LABELS: Record<keyof TerminalColors, string> = {
  background: "Background",
  foreground: "Foreground",
  cursor: "Cursor",
  selectionBackground: "Selection",
};

export function ColorsSection() {
  const current = settings.value;
  const preset = getPreset(current.themeId);

  return (
    <>
      {COLOR_KEYS.map((key) => (
        <ColorRow
          key={key}
          label={COLOR_LABELS[key]}
          value={current.colorOverrides[key] ?? preset.theme[key]}
          overridden={current.colorOverrides[key] !== undefined}
          onChange={(hex) => updateColorOverride(key, hex)}
          onClear={() => updateColorOverride(key, undefined)}
        />
      ))}
    </>
  );
}
