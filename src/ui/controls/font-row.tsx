import { useMemo, useState } from "preact/hooks";
import { CommitInput } from "./commit-input";
import { ConfigRow } from "./config-row";
import { ChevronDown } from "lucide-preact";
import { DeckIcon, ROW_ICON } from "./deck-icon";

const FONT_CANDIDATES = [
  "SF Mono",
  "Menlo",
  "Monaco",
  "JetBrains Mono",
  "Fira Code",
  "Cascadia Code",
  "Source Code Pro",
  "IBM Plex Mono",
  "Hack",
];

const CUSTOM_VALUE = "__custom__";

// Compare rendered width against fallback fonts — document.fonts.check()
// returns false positives for system fonts that are not installed
function detectInstalledFonts(): string[] {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    return FONT_CANDIDATES;
  }
  const sample = "mmmmmmmmmmlliWQ@#1470";
  const measure = (font: string): number => {
    context.font = font;
    return context.measureText(sample).width;
  };
  const baselineMono = measure("16px monospace");
  const baselineSerif = measure("16px serif");
  return FONT_CANDIDATES.filter(
    (family) =>
      measure(`16px "${family}", monospace`) !== baselineMono ||
      measure(`16px "${family}", serif`) !== baselineSerif,
  );
}

interface FontRowProps {
  value: string;
  onChange: (family: string) => void;
}

/** menu value kind: pill over an invisible native select (DL-6), plus an
    inline text row when "custom…" is picked. */
export function FontRow({ value, onChange }: FontRowProps) {
  // Only list fonts actually installed; keep the currently selected one
  const available = useMemo(() => {
    const detected = detectInstalledFonts();
    if (!detected.includes(value) && FONT_CANDIDATES.includes(value)) {
      return [value, ...detected];
    }
    return detected;
  }, []);
  const [customMode, setCustomMode] = useState(
    () => !available.includes(value),
  );

  const selectValue =
    customMode || !available.includes(value) ? CUSTOM_VALUE : value;

  return (
    <>
      <ConfigRow label="Font" desc="terminal typeface">
        <span class="cfg-btn cfg-btn--overlay">
          <span class="cfg-btn__text">
            {selectValue === CUSTOM_VALUE ? value || "custom…" : value}
          </span>
          <span class="cfg-btn__hint">
            <DeckIcon icon={ChevronDown} size={ROW_ICON} />
          </span>
          <select
            value={selectValue}
            aria-label="Font family"
            onChange={(event) => {
              const next = event.currentTarget.value;
              if (next === CUSTOM_VALUE) {
                setCustomMode(true);
                return;
              }
              setCustomMode(false);
              onChange(next);
            }}
          >
            {available.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
            <option value={CUSTOM_VALUE}>custom…</option>
          </select>
        </span>
      </ConfigRow>
      {selectValue === CUSTOM_VALUE && (
        <div class="cfg-custom">
          <CommitInput
            value={value}
            placeholder='e.g. "Iosevka", monospace'
            ariaLabel="Custom font name"
            onCommit={onChange}
          />
        </div>
      )}
    </>
  );
}
