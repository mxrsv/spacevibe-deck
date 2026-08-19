import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { ConfigRow } from "./config-row";
import { DeckIcon, ROW_ICON } from "./deck-icon";

interface ColorRowProps {
  label: string;
  value: string;
  overridden: boolean;
  onChange: (hex: string) => void;
  onClear: () => void;
}

/** color value kind: swatch + hex pill over an invisible native color input (DL-6). */

export function ColorRow({ label, value, overridden, onChange, onClear }: ColorRowProps) {
  return (
    <ConfigRow label={label}>
      {overridden && (
        <button
          type="button"
          class="cfg-clear"
          title="Reset to theme color"
          aria-label={`Reset ${label} to theme color`}
          onClick={onClear}
        >
          <DeckIcon icon={ArrowCounterClockwise} size={ROW_ICON} />
        </button>
      )}
      <span class="cfg-btn cfg-btn--overlay">
        <span class="cfg-swatch" style={{ background: value }} />
        <span class="cfg-btn__hex">{value}</span>
        <input
          type="color"
          value={value}
          aria-label={`Pick ${label} color`}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
      </span>
    </ConfigRow>
  );
}
