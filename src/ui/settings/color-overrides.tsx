import { COLOR_KEYS, type TerminalColors } from '../../settings/settings-schema';
import { settings, updateColorOverride } from '../../settings/settings-store';
import { getPreset } from '../../settings/themes';
import { ColorRow } from '../controls/color-row';

const COLOR_LABELS: Record<keyof TerminalColors, string> = {
  background: 'Background',
  foreground: 'Foreground',
  cursor: 'Cursor',
  selectionBackground: 'Selection',
};

/**
 * The per-colour overrides on top of the running theme — a block inside
 * `appearance`, not a category of its own (2026-08-16).
 *
 * It sits here rather than under `sections/` for the same reason
 * `theme-gallery.tsx` and `sidebar-banner-settings.tsx` do: files in `sections/`
 * ARE categories in the rail registry, and this one is four rows a section
 * mounts. It reads the same `getPreset` the gallery checks its cards against,
 * so a card and the swatch below it can never disagree about which theme is on.
 */
export function ColorOverrides() {
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
