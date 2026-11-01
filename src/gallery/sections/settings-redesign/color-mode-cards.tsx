import { useRef } from "preact/hooks";
import { CANONICAL_THEME_IDS, getTheme } from "../../../settings/themes";
import { ThemeCardPreview } from "../../../ui/settings/theme-card-preview";
import { useSystemMode } from "./live-preview";
import { settings, update, type ColorMode } from "./model";
import { SettingRow } from "./primitives";
import "./page-appearance.css";

interface ModeOption {
  readonly value: ColorMode;
  readonly label: string;
}

/** Light first, like the shipping selector; Match system closes the row. */
const MODE_OPTIONS: readonly ModeOption[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

/** Match system is drawn as the two canonical modes cut by one hard diagonal. */
function ModeMini({ mode }: { readonly mode: ColorMode }) {
  if (mode === "system") {
    return (
      <span class="srd-appearance-split">
        <ThemeCardPreview theme={getTheme(CANONICAL_THEME_IDS.dark)} />
        <span class="srd-appearance-split__light">
          <ThemeCardPreview theme={getTheme(CANONICAL_THEME_IDS.light)} />
        </span>
      </span>
    );
  }
  return <ThemeCardPreview theme={getTheme(CANONICAL_THEME_IDS[mode])} />;
}

/**
 * Light / Dark / Match system as pictured radio cards. The row is the registry
 * row for `colorMode`, so the changed dot, reset and search-jump flash all work;
 * its stylesheet turns it into a header line with the cards underneath.
 */
export function ColorModeCards() {
  const groupRef = useRef<HTMLDivElement>(null);
  const mode = settings.value.colorMode;
  const system = useSystemMode();

  /** Arrow keys move the selection itself, like a native radio group. */
  const onKeyDown = (event: KeyboardEvent): void => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
    if (!keys.includes(event.key)) {
      return;
    }
    event.preventDefault();
    const index = MODE_OPTIONS.findIndex((option) => option.value === mode);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? MODE_OPTIONS.length - 1
          : (index + (forward ? 1 : -1) + MODE_OPTIONS.length) % MODE_OPTIONS.length;
    groupRef.current?.querySelectorAll<HTMLButtonElement>("button")[nextIndex]?.focus();
    update({ colorMode: MODE_OPTIONS[nextIndex].value });
  };

  return (
    <SettingRow k="colorMode" label="Mode">
      <div class="srd-appearance-color">
        <div
          ref={groupRef}
          class="srd-appearance-cards"
          role="radiogroup"
          aria-label="Color mode"
          onKeyDown={onKeyDown}
        >
          {MODE_OPTIONS.map((option) => {
            const selected = option.value === mode;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                class={`srd-appearance-card ${selected ? "is-selected" : ""}`}
                onClick={() => update({ colorMode: option.value })}
              >
                <span aria-hidden="true">
                  <ModeMini mode={option.value} />
                </span>
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
        {/* Always mounted so choosing Match system does not push the page down. */}
        <p class="srd-appearance-note" role="status">
          {mode === "system"
            ? `Follows macOS — currently ${system === "dark" ? "Dark" : "Light"}`
            : ""}
        </p>
      </div>
    </SettingRow>
  );
}
